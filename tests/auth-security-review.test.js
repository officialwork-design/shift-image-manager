'use strict';
// Phase 1.7: RSA 署名検証・JWT 処理のセキュリティレビューで追加した攻撃ケース
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { setup, callPost, FIXED_NOW_MS } = require('./fixtures');
const { CLIENT_ID, KEYS, makeToken, makeRawToken, USERS, b64u } = require('./jwt-test-utils');

const P = { store: 'KABUKI', date: '2026-11-16' };
const nowSec = Math.floor(FIXED_NOW_MS / 1000);
const baseClaims = () => ({ iss: 'https://accounts.google.com', aud: CLIENT_ID, azp: CLIENT_ID, iat: nowSec - 10, exp: nowSec + 3590,
  sub: USERS.editor.sub, email: USERS.editor.email, email_verified: true });
const header = (extra) => Object.assign({ alg: 'RS256', kid: KEYS.main.kid, typ: 'JWT' }, extra || {});
const call = (h, token) => callPost(h, 'whoAmI', P, { auth: { idToken: token } });

test('レビュー: 正しく署名された基準トークンは通る（以下の拒否が署名以外の理由であることの確認）', () => {
  const h = setup();
  assert.equal(call(h, makeRawToken(JSON.stringify(header()), JSON.stringify(baseClaims()))).data.role, 'EDITOR');
});

test('レビュー: 重複した重要 claim（正しく署名されていても拒否）', () => {
  const h = setup();
  const c = baseClaims();
  const body = JSON.stringify(c).slice(0, -1);
  const cases = {
    sub重複: body + ',"sub":"' + USERS.admin.sub + '"}',
    aud重複: body + ',"aud":"other.apps.googleusercontent.com"}',
    エスケープ表記での重複: body + ',"\\u0073ub":"' + USERS.admin.sub + '"}',
    exp重複: body + ',"exp":' + (nowSec + 999999) + '}'
  };
  for (const [name, payload] of Object.entries(cases)) {
    assert.equal(call(h, makeRawToken(JSON.stringify(header()), payload)).code, 'AUTH_INVALID', name);
  }
  const dupHeader = '{"alg":"RS256","kid":"' + KEYS.main.kid + '","alg":"none"}';
  assert.equal(call(h, makeRawToken(dupHeader, JSON.stringify(c))).code, 'AUTH_INVALID', 'ヘッダーの alg 重複');
  // 入れ子オブジェクト内の同名キーは別階層なので許可（誤検知しない）
  const nested = JSON.stringify(Object.assign({}, c, { extra: { sub: 'x', list: [{ sub: 'y' }] } }));
  assert.equal(call(h, makeRawToken(JSON.stringify(header()), nested)).success, true);
});

test('レビュー: 非正規 base64url・パディング・不正文字', () => {
  const h = setup();
  const good = makeRawToken(JSON.stringify(header()), JSON.stringify(baseClaims()));
  const [hd, pl, sg] = good.split('.');
  // 署名部の最後の文字の「余りビット」を立てる（同じバイト列の別表記）
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const last = sg[sg.length - 1];
  const variant = alphabet[alphabet.indexOf(last) | 1] === last ? alphabet[alphabet.indexOf(last) | 2] : alphabet[alphabet.indexOf(last) | 1];
  assert.equal(call(h, hd + '.' + pl + '.' + sg.slice(0, -1) + variant).code, 'AUTH_INVALID', '非正規の署名表記');
  assert.equal(call(h, hd + '.' + pl + '.' + sg + '==').code, 'AUTH_INVALID', 'パディング付き');
  assert.equal(call(h, hd + '.' + pl.replace(/-/g, '+') + 'A+/' + '.' + sg).code, 'AUTH_INVALID', '標準 base64 文字');
  assert.equal(call(h, ' ' + good).code, 'AUTH_INVALID', '前後の空白');
});

test('レビュー: ヘッダー経由の鍵指定（jku / jwk / x5u / x5c）と未知の typ を拒否', () => {
  const h = setup();
  const attackerJwk = KEYS.attacker.jwk;
  for (const extra of [{ jku: 'https://evil.example.com/keys' }, { jwk: attackerJwk }, { x5u: 'https://evil.example.com/cert' }, { x5c: ['AAAA'] }, { typ: 'at+jwt' }]) {
    const token = makeRawToken(JSON.stringify(header(extra)), JSON.stringify(baseClaims()), { key: KEYS.attacker });
    assert.equal(call(h, token).code, 'AUTH_INVALID', JSON.stringify(Object.keys(extra)));
  }
  // 本物の鍵で署名されていても jwk ヘッダー付きは拒否
  assert.equal(call(h, makeRawToken(JSON.stringify(header({ jwk: KEYS.main.jwk })), JSON.stringify(baseClaims()))).code, 'AUTH_INVALID');
});

test('レビュー: 異常に長い有効期間・exp/iat の型', () => {
  const h = setup();
  const make = (patch) => makeToken(Object.assign({ sub: USERS.editor.sub, email: USERS.editor.email }, patch), { now: FIXED_NOW_MS });
  assert.equal(call(h, make({ iat: nowSec - 10, exp: nowSec + 86400 * 365 })).code, 'AUTH_INVALID', '1年有効');
  assert.equal(call(h, make({ exp: String(nowSec + 3000) })).code, 'AUTH_INVALID', 'exp が文字列');
  assert.equal(call(h, make({ iat: null })).code, 'AUTH_INVALID', 'iat が null');
  assert.equal(call(h, make({ exp: 1e300 })).code, 'AUTH_INVALID', 'exp が巨大');
});

test('レビュー: 不正な JWKS（形式・重複 kid・鍵の種類・欠落）は使わない', () => {
  const variants = {
    重複kid: s => ({ keys: [KEYS.main.jwk, Object.assign({}, KEYS.attacker.jwk, { kid: KEYS.main.kid })] }),
    EC鍵: s => ({ keys: [Object.assign({}, KEYS.main.jwk, { kty: 'EC' })] }),
    alg違い: s => ({ keys: [Object.assign({}, KEYS.main.jwk, { alg: 'RS512' })] }),
    use違い: s => ({ keys: [Object.assign({}, KEYS.main.jwk, { use: 'enc' })] }),
    n欠落: s => ({ keys: [Object.assign({}, KEYS.main.jwk, { n: undefined })] }),
    n不正: s => ({ keys: [Object.assign({}, KEYS.main.jwk, { n: 'AAAA' })] }),
    keysなし: s => ({ nokeys: true }),
    keys空: s => ({ keys: [] })
  };
  for (const [name, build] of Object.entries(variants)) {
    const h = setup({ context: { urlFetch: () => ({ status: 200, body: JSON.stringify(build()), headers: { 'Cache-Control': 'max-age=600' } }) } });
    const res = call(h, makeToken({ sub: USERS.editor.sub, email: USERS.editor.email }, { now: FIXED_NOW_MS }));
    assert.equal(res.success, false, name);
    assert.ok(['AUTH_INVALID', 'AUTH_KEYS_UNAVAILABLE'].includes(res.code), name + ' => ' + res.code);
  }
  const notJson = setup({ context: { urlFetch: () => ({ status: 200, body: '<html>', headers: {} }) } });
  assert.equal(call(notJson, makeToken({ sub: USERS.editor.sub, email: USERS.editor.email }, { now: FIXED_NOW_MS })).code, 'AUTH_KEYS_UNAVAILABLE');
});

test('レビュー: 公開鍵キャッシュの期限切れで再取得・TTL は Cache-Control に従い 5分〜6時間に制限', () => {
  const h = setup();
  const V = h.gas.GoogleIdTokenVerifier;
  assert.equal(V.cacheTtlFromHeaders_({ 'cache-control': 'public, max-age=19000' }), 19000);
  assert.equal(V.cacheTtlFromHeaders_({ 'Cache-Control': 'max-age=10' }), 300);
  assert.equal(V.cacheTtlFromHeaders_({ 'Cache-Control': 'max-age=999999' }), 21600);
  assert.equal(V.cacheTtlFromHeaders_({}), 300);
  const tok = () => makeToken({ sub: USERS.editor.sub, email: USERS.editor.email }, { now: FIXED_NOW_MS });
  assert.equal(call(h, tok()).success, true);
  assert.equal(h.fetchLog.length, 1);
  // キャッシュ期限切れ（CacheService から消えた）を再現。同一実行内のメモも無い新しい実行を想定
  delete h.cacheStore.GOOGLE_JWKS_V1;
  V.jwksMemo_ = null;
  assert.equal(call(h, tok()).success, true);
  assert.equal(h.fetchLog.length, 2, '期限切れ後は再取得');
  // 期限切れ後に鍵が入れ替わっていた（古い鍵の削除）場合、古い鍵のトークンは拒否
  delete h.cacheStore.GOOGLE_JWKS_V1; V.jwksMemo_ = null;
  h.jwksState.keys = [KEYS.rotated];
  assert.equal(call(h, tok()).code, 'AUTH_INVALID');
});

test('レビュー: 署名検証の内部（法の境界・長さ・期待値）', () => {
  const h = setup({ noAuth: true });
  const V = h.gas.GoogleIdTokenVerifier;
  const key = V.findKey_({ keys: [KEYS.main.jwk] }, KEYS.main.kid);
  const input = 'a.b';
  const sig = Array.from(crypto.sign('sha256', Buffer.from(input), KEYS.main.privateKey));
  assert.equal(V.verifyRs256_(input, sig, key), true);
  assert.equal(V.verifyRs256_(input, [0].concat(sig), key), false, '先頭に 0 を足した署名（長さ不一致）');
  assert.equal(V.verifyRs256_(input, sig.slice(1), key), false, '短い署名');
  assert.equal(V.verifyRs256_(input, new Array(sig.length).fill(0), key), false, '0 の署名');
  assert.equal(V.verifyRs256_(input, new Array(sig.length).fill(255), key), false, '法以上の署名');
  // SHA-1 / SHA-512 で署名されたもの（DigestInfo が異なる）は拒否
  for (const alg of ['sha1', 'sha512']) {
    assert.equal(V.verifyRs256_(input, Array.from(crypto.sign(alg, Buffer.from(input), KEYS.main.privateKey)), key), false, alg);
  }
  // PSS パディングは拒否
  const pss = crypto.sign('sha256', Buffer.from(input), { key: KEYS.main.privateKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING });
  assert.equal(V.verifyRs256_(input, Array.from(pss), key), false, 'PSS');
});
