'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { setup, callPost, callGet, EDITOR, ADMIN, tokenFor, seedAccess, FIXED_NOW_MS } = require('./fixtures');
const { CLIENT_ID, OTHER_CLIENT_ID, KEYS, makeToken, USERS, b64u } = require('./jwt-test-utils');
const { createGasContext, FakeSpreadsheet, seedSpreadsheet } = require('./gas-harness');

const P = { store: 'KABUKI', date: '2026-11-16' };
const nowSec = Math.floor(FIXED_NOW_MS / 1000);
const call = (h, token, action) => callPost(h, action || 'getSavedShift', P, { auth: { idToken: token } });
const editorClaims = { sub: USERS.editor.sub, email: USERS.editor.email };
const tok = (claims, opts) => makeToken(Object.assign({}, editorClaims, claims || {}), Object.assign({ now: FIXED_NOW_MS }, opts || {}));

// ---------- 認証（ID トークン検証） ----------
test('認証: 正常な ID トークン（ADMIN / EDITOR）', () => {
  const h = setup();
  assert.equal(callPost(h, 'whoAmI', {}, EDITOR).data.role, 'EDITOR');
  assert.equal(callPost(h, 'whoAmI', {}, ADMIN).data.role, 'ADMIN');
  assert.equal(call(h, tok({}, { header: { typ: undefined } })).success, true, 'typ なしも可');
  assert.equal(call(h, tok({ iss: 'accounts.google.com' })).success, true, 'iss の別表記');
  assert.equal(call(h, tok({ email_verified: 'true' })).success, true, 'email_verified 文字列');
});

test('認証: 期限切れトークン → AUTH_EXPIRED（401相当）', () => {
  const h = setup();
  const res = call(h, tok({ iat: nowSec - 7200, exp: nowSec - 3600 }));
  assert.equal(res.code, 'AUTH_EXPIRED'); assert.equal(res.status, 401);
  assert.equal(call(h, tok({ iat: nowSec - 3700, exp: nowSec - 30 })).success, true, '時計ずれ60秒以内は許容');
  assert.equal(call(h, tok({ iat: nowSec - 3700, exp: nowSec - 61 })).code, 'AUTH_EXPIRED');
});

test('認証: 署名の改ざん・別の鍵・偽の鍵ID・署名方式のすり替えを拒否', () => {
  const h = setup();
  const good = tok();
  const [hd, pl, sg] = good.split('.');
  const payload = JSON.parse(Buffer.from(pl, 'base64url').toString());
  const tamperedPayload = b64u(JSON.stringify(Object.assign({}, payload, { sub: USERS.admin.sub, email: USERS.admin.email })));
  const cases = {
    ペイロード改ざん: hd + '.' + tamperedPayload + '.' + sg,
    署名1ビット反転: hd + '.' + pl + '.' + b64u(Buffer.from(sg, 'base64url').map((b, i) => (i === 10 ? b ^ 1 : b))),
    署名切り詰め: hd + '.' + pl + '.' + sg.slice(0, 100),
    署名なし: hd + '.' + pl + '.',
    同じkidの別鍵で署名: tok({}, { key: KEYS.attacker }),
    未知のkid: tok({}, { header: { kid: 'unknown-kid' } }),
    alg_none: b64u(JSON.stringify({ alg: 'none', kid: KEYS.main.kid })) + '.' + pl + '.' + sg,
    alg_HS256: (() => { const hh = b64u(JSON.stringify({ alg: 'HS256', kid: KEYS.main.kid })); return hh + '.' + pl + '.' + b64u(crypto.createHmac('sha256', KEYS.main.jwk.n).update(hh + '.' + pl).digest()); })(),
    署名が法以上: (() => { const n = Buffer.from(KEYS.main.jwk.n, 'base64url'); return hd + '.' + pl + '.' + b64u(n); })(),
    crit付き: tok({}, { header: { crit: ['exp'] } })
  };
  for (const [name, token] of Object.entries(cases)) {
    const res = call(h, token);
    assert.equal(res.success, false, name);
    assert.ok(['AUTH_INVALID', 'AUTH_REQUIRED'].includes(res.code), name + ' => ' + res.code);
  }
  assert.equal(h.ss.getSheetByName('シフト編集管理').getLastRow(), 1);
});

test('認証: 不正な issuer / audience / azp / iat / sub / email / email_verified', () => {
  const h = setup();
  const cases = {
    issuer: { iss: 'https://evil.example.com' },
    audience別クライアント: { aud: OTHER_CLIENT_ID, azp: OTHER_CLIENT_ID },
    audience配列: { aud: [CLIENT_ID] },
    azp不一致: { azp: OTHER_CLIENT_ID },
    iat未来: { iat: nowSec + 3600, exp: nowSec + 7200 },
    iatなし: { iat: undefined },
    expなし: { exp: undefined },
    subなし: { sub: undefined },
    sub数字以外: { sub: 'abc' },
    emailなし: { email: undefined },
    email_verified_false: { email_verified: false },
    email_verifiedなし: { email_verified: undefined }
  };
  for (const [name, claims] of Object.entries(cases)) {
    const res = call(h, tok(claims));
    assert.equal(res.code, 'AUTH_INVALID', name + ' => ' + res.code);
  }
});

test('認証: トークン未送信・形式不正・巨大トークン', () => {
  const h = setup();
  assert.equal(callPost(h, 'getSavedShift', P).code, 'AUTH_REQUIRED');
  assert.equal(callPost(h, 'getSavedShift', P, { auth: {} }).code, 'AUTH_REQUIRED');
  assert.equal(callPost(h, 'getSavedShift', P, { auth: 'token-as-string' }).code, 'AUTH_REQUIRED');
  for (const bad of ['abc', 'a.b', 'a.b.c.d', '!!!.###.$$$', 123, { x: 1 }, 'x'.repeat(5000) + '.a.b', 'e30.e30.' + 'A'.repeat(10)]) {
    assert.equal(call(h, bad).code, 'AUTH_INVALID', String(bad).slice(0, 20));
  }
  // JSON でないヘッダー・UTF-8 でないバイト列
  assert.equal(call(h, b64u('not json') + '.' + b64u('{}') + '.' + b64u('sig')).code, 'AUTH_INVALID');
  assert.equal(call(h, b64u(Buffer.from([0xff, 0xfe])) + '.' + b64u('{}') + '.' + b64u('sig')).code, 'AUTH_INVALID');
});

test('認証: 別 Google アカウント（未登録）のトークンは本人の sub と email を返して拒否', () => {
  const h = setup();
  const res = call(h, tokenFor('stranger'));
  assert.equal(res.code, 'FORBIDDEN');
  assert.deepEqual(JSON.parse(JSON.stringify(res.error.details)), { reason: 'NOT_REGISTERED', sub: USERS.stranger.sub, email: USERS.stranger.email });
});

test('認証: 公開鍵の取得・キャッシュ・鍵ローテーション・取得失敗・再取得の回数制限', () => {
  const h = setup();
  assert.equal(callPost(h, 'whoAmI', {}, EDITOR).success, true);
  assert.equal(callPost(h, 'whoAmI', {}, EDITOR).success, true);
  assert.equal(h.fetchLog.length, 1, '2回目以降はキャッシュ');
  // 鍵ローテーション: 新しい kid は1回だけ再取得して検証できる
  h.jwksState.keys = [KEYS.main, KEYS.rotated];
  assert.equal(call(h, tok({}, { key: KEYS.rotated })).success, true);
  assert.equal(h.fetchLog.length, 2);
  // 未知の kid を連打しても再取得は5分に1回まで
  for (let i = 0; i < 5; i++) call(h, tok({}, { header: { kid: 'random-' + i } }));
  assert.equal(h.fetchLog.length, 2);
  // 取得失敗（キャッシュなし）→ AUTH_KEYS_UNAVAILABLE
  const h2 = setup(); h2.jwksState.fail = true;
  assert.equal(callPost(h2, 'whoAmI', {}, EDITOR).code, 'AUTH_KEYS_UNAVAILABLE');
});

test('認証: 2048bit 未満の鍵・e≠65537 の鍵は使わない', () => {
  const h = setup();
  const small = { kid: 'small', privateKey: null, jwk: null };
  const k = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 });
  small.privateKey = k.privateKey; small.jwk = Object.assign({ kid: 'small', alg: 'RS256', use: 'sig' }, k.publicKey.export({ format: 'jwk' }));
  const e3 = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 3 });
  const keyE3 = { kid: 'e3', privateKey: e3.privateKey, jwk: Object.assign({ kid: 'e3', alg: 'RS256' }, e3.publicKey.export({ format: 'jwk' })) };
  h.jwksState.keys = [KEYS.main, small, keyE3];
  assert.equal(call(h, tok({}, { key: small })).code, 'AUTH_INVALID');
  assert.equal(call(h, tok({}, { key: keyE3 })).code, 'AUTH_INVALID');
});

test('認証: RS256 検証は OpenSSL（Node crypto）と一致する（ランダム入力 200 件）', () => {
  const h = setup({ noAuth: true });
  const V = h.gas.GoogleIdTokenVerifier;
  const key = V.findKey_({ keys: [KEYS.main.jwk] }, KEYS.main.kid);
  for (let i = 0; i < 200; i++) {
    const input = crypto.randomBytes(1 + (i % 50)).toString('base64url') + '.' + crypto.randomBytes(20).toString('base64url');
    let sig = crypto.sign('sha256', Buffer.from(input), KEYS.main.privateKey);
    if (i % 2) sig = Buffer.from(sig.map((b, j) => (j === i % sig.length ? b ^ (1 << (i % 8)) : b)));
    const expected = crypto.verify('sha256', Buffer.from(input), KEYS.main.publicKey, sig);
    assert.equal(V.verifyRs256_(input, Array.from(sig), key), expected, 'case ' + i);
  }
});

test('認証: BigInt 非対応の実行環境では検証せず拒否（フェイルクローズ）', () => {
  const ss = new FakeSpreadsheet(); seedSpreadsheet(ss, { KABUKI: [], AKIBA: [] });
  const h = createGasContext({ spreadsheet: ss, noBigInt: true, scriptProperties: { AUTH_MODE: 'google_id_token', GOOGLE_OAUTH_CLIENT_ID: CLIENT_ID } });
  h.gas.setupShiftImageManager();
  assert.equal(callPost(h, 'whoAmI', {}, EDITOR).code, 'AUTH_NOT_CONFIGURED');
});

// ---------- 許可リスト ----------
function accessSheet(h) { return h.ss.getSheetByName('アクセス権限'); }

test('許可リスト: 登録済み ADMIN / EDITOR・未登録・無効化済み', () => {
  const h = setup();
  assert.equal(callPost(h, 'whoAmI', {}, ADMIN).data.role, 'ADMIN');
  assert.equal(callPost(h, 'whoAmI', {}, EDITOR).data.role, 'EDITOR');
  assert.equal(call(h, tokenFor('stranger')).error.details.reason, 'NOT_REGISTERED');
  const disabled = call(h, tokenFor('disabled'));
  assert.equal(disabled.code, 'FORBIDDEN'); assert.equal(disabled.error.details.reason, 'DISABLED');
  accessSheet(h).set(2, 4, false);   // ADMIN を無効化（チェックボックス false）
  assert.equal(callPost(h, 'whoAmI', {}, ADMIN).error.details.reason, 'DISABLED');
  accessSheet(h).set(2, 4, true);    // チェックボックス true でも可
  assert.equal(callPost(h, 'whoAmI', {}, ADMIN).data.role, 'ADMIN');
});

test('許可リスト: 同じメールアドレスで異なる sub は拒否（SUB_MISMATCH）・sub 一致でメール変更は許可', () => {
  const h = setup();
  const res = call(h, makeToken({ sub: '100000000000000000077', email: USERS.editor.email }, { now: FIXED_NOW_MS }));
  assert.equal(res.code, 'FORBIDDEN'); assert.equal(res.error.details.reason, 'SUB_MISMATCH');
  const renamed = call(h, makeToken({ sub: USERS.editor.sub, email: 'new-address@example.com' }, { now: FIXED_NOW_MS }), 'whoAmI');
  assert.equal(renamed.data.role, 'EDITOR');
  assert.match(JSON.stringify(h.ss.getSheetByName('画像操作ログ').rows), /email-mismatch/);
});

test('許可リスト: 重複 sub・不正ロール・数値化された sub は拒否', () => {
  const h = setup();
  const s = accessSheet(h);
  [USERS.editor.sub, 'other@example.com', 'ADMIN', 'TRUE'].forEach((v, c) => s.set(5, c + 1, v));
  assert.equal(callPost(h, 'whoAmI', {}, EDITOR).error.details.reason, 'DUPLICATE_SUB');
  assert.equal(callPost(h, 'whoAmI', {}, ADMIN).data.role, 'ADMIN', '他の利用者には影響しない');
  s.set(5, 1, ''); s.set(5, 2, ''); s.set(5, 3, ''); s.set(5, 4, '');
  s.set(2, 3, 'SUPERUSER');
  assert.equal(callPost(h, 'whoAmI', {}, ADMIN).error.details.reason, 'INVALID_ROLE');
  s.set(2, 3, 'ADMIN'); s.set(2, 1, 1.00000000000000000001e20);   // 数値として保存された sub
  assert.equal(callPost(h, 'whoAmI', {}, ADMIN).code, 'FORBIDDEN');
});

test('許可リスト: 空・シート不存在・列構成不正・読み取りエラーはすべて拒否', () => {
  const empty = setup({ noAccessList: true });
  assert.equal(callPost(empty, 'whoAmI', {}, ADMIN).error.details.reason, 'ACCESS_LIST_EMPTY');

  const missing = setup();
  delete missing.ss.sheets['アクセス権限'];
  assert.equal(callPost(missing, 'whoAmI', {}, ADMIN).code, 'ACCESS_LIST_NOT_CONFIGURED');

  const broken = setup();
  accessSheet(broken).set(1, 1, 'email');
  assert.equal(callPost(broken, 'whoAmI', {}, ADMIN).code, 'ACCESS_LIST_INVALID');

  const unreadable = setup();
  const sheet = accessSheet(unreadable);
  const orig = sheet.getRange.bind(sheet);
  sheet.getRange = (a, b, c, d) => { if (a === 2) throw new Error('Service error'); return orig(a, b, c, d); };
  assert.equal(callPost(unreadable, 'whoAmI', {}, ADMIN).code, 'ACCESS_LIST_UNAVAILABLE');
  for (const h of [empty, missing, broken, unreadable]) {
    assert.equal(callPost(h, 'initializeShift', P, ADMIN).success, false);
    assert.equal(h.ss.getSheetByName('シフト編集管理').getLastRow(), 1);
  }
});

test('許可リスト: 初期シート生成はヘッダーのみ作成（空 = 全員拒否）・既存の登録は変更しない', () => {
  const h = setup({ noAccessList: true });
  assert.deepEqual(JSON.parse(JSON.stringify(accessSheet(h).rows)), [['googleSub', 'email', 'role', 'enabled', 'createdAt', 'updatedAt', 'note']]);
  seedAccess(h.ss);
  const before = JSON.stringify(accessSheet(h).rows);
  h.gas.setupShiftImageManager();
  assert.equal(JSON.stringify(accessSheet(h).rows), before);
});

test('許可リスト: 管理者メニューからの追加（入力検証・重複拒否）', () => {
  const h = setup({ noAccessList: true });
  const A = h.gas.AccessControlService;
  assert.throws(() => A.addEntry('abc', 'x@example.com', 'ADMIN'), e => e.code === 'INVALID_SUB');
  assert.throws(() => A.addEntry('123', 'x@example.com', 'OWNER'), e => e.code === 'INVALID_ROLE');
  A.addEntry(USERS.admin.sub, USERS.admin.email, 'admin', '初期管理者');
  assert.throws(() => A.addEntry(USERS.admin.sub, 'y@example.com', 'EDITOR'), e => e.code === 'DUPLICATE_SUB');
  assert.equal(callPost(h, 'whoAmI', {}, ADMIN).data.role, 'ADMIN');
  assert.equal(typeof accessSheet(h).rows[1][0], 'string', 'sub は文字列で保存');
});

// ---------- API ----------
test('API: 未認証・未許可・期限切れでの更新は何も書き込まない（全更新経路）', () => {
  const h = setup();
  const writes = ['initializeShift', 'changeDateAndStore', 'saveShift', 'setCastAbsent', 'resetShiftFromSource', 'checkImages', 'refreshImageCache'];
  const bad = [undefined, { idToken: tokenFor('stranger') }, { idToken: tokenFor('disabled') }, { idToken: tok({ iat: nowSec - 7200, exp: nowSec - 3600 }) }, { idToken: tok({ aud: OTHER_CLIENT_ID, azp: undefined }) }];
  for (const action of writes) {
    for (const auth of bad) {
      const res = callPost(h, action, Object.assign({ expectedRevision: 0, rows: [], confirmation: 'KABUKI:2026-11-16' }, P), auth ? { auth } : {});
      assert.equal(res.success, false, action);
      assert.ok(['AUTH_REQUIRED', 'FORBIDDEN', 'AUTH_EXPIRED', 'AUTH_INVALID'].includes(res.code), action + ' ' + res.code);
    }
    assert.equal(callGet(h, action, Object.assign({ auth: { idToken: tokenFor('admin') } }, P)).code, 'METHOD_NOT_ALLOWED');
  }
  assert.equal(callPost(h, 'updateShiftRows', { rows: [] }, ADMIN).code, 'LEGACY_API_REMOVED');
  assert.equal(h.ss.getSheetByName('シフト編集').getLastRow(), 1);
  assert.equal(h.ss.getSheetByName('画像チェック').getLastRow(), 1);
});

test('API: 認証の後でも入力検証・revision 競合は従来どおり（EDITOR）', () => {
  const h = setup();
  const init = callPost(h, 'initializeShift', P, EDITOR).data;
  assert.equal(callPost(h, 'saveShift', { store: 'SHINJUKU', date: '2026-11-16', expectedRevision: 1, rows: [] }, EDITOR).code, 'INVALID_STORE');
  assert.equal(callPost(h, 'saveShift', { store: 'KABUKI', date: '2026/11/16', expectedRevision: 1, rows: [] }, EDITOR).code, 'INVALID_DATE');
  assert.equal(callPost(h, 'saveShift', Object.assign({ expectedRevision: 1, rows: init.editRows }, P), EDITOR).data.revision, 2);
  const conflict = callPost(h, 'saveShift', Object.assign({ expectedRevision: 1, rows: init.editRows }, P), ADMIN);
  assert.equal(conflict.code, 'REVISION_CONFLICT'); assert.equal(conflict.status, 409);
});

test('API: 更新処理の途中でトークンが失効しても、検証済みのリクエストは完了し次のリクエストは拒否', () => {
  const h = setup();
  const shortLived = tok({ iat: nowSec - 3500, exp: nowSec + 5 });
  const init = callPost(h, 'initializeShift', P, { auth: { idToken: shortLived } });
  assert.equal(init.success, true, '検証時点で有効なら処理する（認可は処理前に完了）');
  const later = createGasContext({ spreadsheet: h.ss, now: new Date(FIXED_NOW_MS + 120000).toISOString(), scriptProperties: h.props, cacheStore: h.cacheStore, urlFetch: require('./jwt-test-utils').jwksHandler(h.jwksState) });
  const res = callPost(later, 'saveShift', Object.assign({ expectedRevision: 1, rows: [] }, P), { auth: { idToken: shortLived } });
  assert.equal(res.code, 'AUTH_EXPIRED');
  assert.equal(h.gas.ShiftService.getSavedShift('KABUKI', '2026-11-16').revision, 1);
});
