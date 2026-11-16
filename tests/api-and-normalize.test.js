'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, secondTerminal, callGet, callPost, EDITOR, ADMIN, tokenFor } = require('./fixtures');
const { createGasContext, FakeSpreadsheet, seedSpreadsheet } = require('./gas-harness');
const plain = v => JSON.parse(JSON.stringify(v));

// ---------- 名前正規化 ----------
test('名前正規化: 絵文字・♡・@・不可視文字・結合文字', () => {
  const h = setup({ noAuth: true });
  const n = s => h.gas.SiftService.normalizeCastName(s);
  const cases = [
    ['♡ちょこ', 'ちょこ'], ['ちょこ💗', 'ちょこ'], ['ひめ💙', 'ひめ'], ['るん🐰', 'るん'], ['🔰新人', '新人'],
    ['ちょこ @example', 'ちょこ'], ['ちょこ　＠example', 'ちょこ'], ['ち​ょ‍こ﻿', 'ちょこ'],
    ['👩‍👧ここ', 'ここ'], ['🫶🏼ゆき', 'ゆき'], ['❤️まい', 'まい'], ['1️⃣いち', 'いち'], ['🇯🇵みな', 'みな'],
    ['ねぎたろう', 'ねぎたろう'], ['体入 恋富子🔰', '体入恋富子'], ['ラミエル', 'ラミエル'], ['さおりん（ゲスト）', 'さおりん'],
    ['  すず  ', 'すず'], ['恋富子', '恋富子'], ['ひめる', 'ひめる'], ['青葉', '青葉']
  ];
  for (const [input, expected] of cases) {
    const out = n(input);
    assert.equal(out, expected, input);
    assert.ok(!/[\uD800-\uDFFF]/.test(out.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')), '孤立サロゲートなし: ' + input);
  }
});

test('名前正規化: 投稿テンプレートの定型文・見出しはキャストにならない', () => {
  const h = setup({ noAuth: true });
  const text = ['📢推し推せっ！KABUKI店 📢', '　　　✨マカロン✨', '💙11月16日(月)の出勤キャスト💙', '⏰営業時間18:00〜23:30🫶🏼',
    '今日会える女の子たちはこちら🎀', '18:00', '♡ちょこ', '♡ちょこ', '19:00', '♡すず', '気になるキャストのXアカウントは返信欄へ👇',
    'キャストのXはこちら💗', '気になる子がいたらフォローしてね🎀'].join('\n');
  const parsed = plain(h.gas.SiftService.parsePostText(text));
  assert.deepEqual(parsed.castRows.map(r => r.castName + '@' + r.workTime), ['ちょこ@18:00', 'すず@19:00']);
});

// ---------- API 安全性 ----------
test('API: 認証方式が未設定のとき更新 API はすべて AUTH_NOT_CONFIGURED', () => {
  const h = setup({ noAuth: true });
  const writes = ['initializeShift', 'saveShift', 'setCastAbsent', 'resetShiftFromSource', 'refreshImageCache', 'checkImages', 'changeDateAndStore'];
  for (const action of writes) {
    const res = callPost(h, action, { store: 'KABUKI', date: '2026-11-16', expectedRevision: 0, rows: [] }, { auth: { idToken: tokenFor('admin') } });
    assert.equal(res.success, false, action);
    assert.equal(res.code, 'AUTH_NOT_CONFIGURED', action);
  }
  // AUTH_MODE を設定してもクライアントIDが未設定・形式不正なら拒否（フェイルクローズ）
  h.props.AUTH_MODE = 'google_id_token';
  assert.equal(callPost(h, 'saveShift', {}, { auth: { idToken: tokenFor('admin') } }).code, 'AUTH_NOT_CONFIGURED');
  h.props.GOOGLE_OAUTH_CLIENT_ID = 'not-a-client-id';
  assert.equal(callPost(h, 'saveShift', {}, { auth: { idToken: tokenFor('admin') } }).code, 'AUTH_NOT_CONFIGURED');
  assert.equal(callPost(h, 'getPublicConfig', {}).data.authConfigured, false);
  assert.equal(h.ss.getSheetByName('シフト編集管理').getLastRow(), 1, '何も書き込まれていない');
});

test('API: 未認証・未許可の更新は拒否、監査ログに記録、トークン実値はログに残らない', () => {
  const h = setup();
  assert.equal(callPost(h, 'initializeShift', { store: 'KABUKI', date: '2026-11-16' }).code, 'AUTH_REQUIRED');
  const strangerToken = tokenFor('stranger');
  const res = callPost(h, 'initializeShift', { store: 'KABUKI', date: '2026-11-16' }, { auth: { idToken: strangerToken } });
  assert.equal(res.code, 'FORBIDDEN');
  assert.equal(res.status, 403);
  assert.equal(res.error.details.reason, 'NOT_REGISTERED');
  assert.equal(h.ss.getSheetByName('シフト編集管理').getLastRow(), 1);
  const logs = JSON.stringify(h.ss.getSheetByName('画像操作ログ').rows) + JSON.stringify(h.ss.getSheetByName('エラーログ').rows);
  assert.match(logs, /FORBIDDEN/);
  assert.match(logs, /AUTH_REQUIRED/);
  assert.ok(!logs.includes(strangerToken), 'トークン実値がログにない');
  assert.ok(!logs.includes(strangerToken.split('.')[2]), '署名部分もログにない');
  assert.ok(!logs.includes('stranger@example.com'), 'メールアドレスは短縮表示');
});

test('API: GET / JSONP による更新は METHOD_NOT_ALLOWED（認証情報があっても）', () => {
  const h = setup();
  for (const action of ['initializeShift', 'saveShift', 'setCastAbsent', 'resetShiftFromSource', 'refreshImageCache', 'checkImages', 'changeDateAndStore']) {
    const res = callGet(h, action, { store: 'KABUKI', date: '2026-11-16', auth: { idToken: tokenFor('admin') } });
    assert.equal(res.code, 'METHOD_NOT_ALLOWED', action);
  }
  assert.equal(h.ss.getSheetByName('シフト編集管理').getLastRow(), 1);
});

test('API: 旧 updateShiftRows・行番号指定の setCastAbsent は廃止（LEGACY_API_REMOVED）', () => {
  const h = setup();
  assert.equal(callPost(h, 'updateShiftRows', { rows: [] }, EDITOR).code, 'LEGACY_API_REMOVED');
  assert.equal(callGet(h, 'updateShiftRows', { rows: [] }).code, 'LEGACY_API_REMOVED');
  assert.equal(callPost(h, 'setCastAbsent', { row: 3, isAbsent: true }, EDITOR).code, 'LEGACY_API_REMOVED');
});

test('API: 旧 changeDateAndStore は既存データを消さない（initializeShift と同じ）', () => {
  const h = setup();
  const init = callPost(h, 'initializeShift', { store: 'KABUKI', date: '2026-11-16' }, EDITOR).data;
  const rows = init.editRows.slice(0, 1);
  callPost(h, 'saveShift', { store: 'KABUKI', date: '2026-11-16', expectedRevision: 1, rows }, EDITOR);
  const legacy = callPost(h, 'changeDateAndStore', { store: 'KABUKI', date: '2026-11-16' }, EDITOR);
  assert.equal(legacy.success, true);
  assert.equal(legacy.data.created, false);
  assert.equal(legacy.data.editRows.length, 1);
});

test('API: 認証済みの正常フロー（POST）と不正入力の拒否', () => {
  const h = setup();
  const init = callPost(h, 'initializeShift', { store: 'KABUKI', date: '2026-11-16' }, EDITOR);
  assert.equal(init.success, true);
  const rid = init.data.editRows[0].recordId;
  const bad = [
    [{ store: 'SHINJUKU', date: '2026-11-16', expectedRevision: 1, rows: [] }, 'INVALID_STORE'],
    [{ store: 'KABUKI', date: '11月16日(月)', expectedRevision: 1, rows: [] }, 'INVALID_DATE'],
    [{ store: 'KABUKI', date: '2026-11-16', expectedRevision: 'x', rows: [] }, 'INVALID_REVISION'],
    [{ store: 'KABUKI', date: '2026-11-16', expectedRevision: 1, rows: [{ castName: 'a', imageFileId: 'EVIL' }] }, 'INVALID_IMAGE'],
    [{ store: 'AKIBA', date: '2026-11-16', expectedRevision: 1, rows: [{ recordId: rid, castName: 'a' }] }, 'NOT_INITIALIZED'],
    [{ store: 'KABUKI', date: '2026-11-17', expectedRevision: 0, rows: [] }, 'NOT_INITIALIZED']
  ];
  for (const [payload, code] of bad) assert.equal(callPost(h, 'saveShift', payload, EDITOR).code, code, JSON.stringify(payload));
  callPost(h, 'initializeShift', { store: 'AKIBA', date: '2026-11-16' }, EDITOR);
  assert.equal(callPost(h, 'saveShift', { store: 'AKIBA', date: '2026-11-16', expectedRevision: 1, rows: [{ recordId: rid, castName: 'a' }] }, EDITOR).code, 'RECORD_NOT_FOUND', '他店舗の recordId');
  assert.equal(callPost(h, 'setCastAbsent', { store: 'AKIBA', date: '2026-11-16', recordId: rid, isAbsent: true, expectedRevision: 1 }, EDITOR).code, 'RECORD_NOT_FOUND');
  const ok = callPost(h, 'saveShift', { store: 'KABUKI', date: '2026-11-16', expectedRevision: 1, rows: init.data.editRows }, Object.assign({ requestId: 'r1' }, EDITOR));
  assert.equal(ok.data.revision, 2);
  const conflict = callPost(h, 'saveShift', { store: 'KABUKI', date: '2026-11-16', expectedRevision: 1, rows: init.data.editRows }, Object.assign({ requestId: 'r2' }, EDITOR));
  assert.equal(conflict.code, 'REVISION_CONFLICT');
  assert.equal(conflict.message, '他の端末または画面で編集内容が更新されています。最新データを確認してから、もう一度保存してください。');
});

test('API: 読み取り API は認証必須（POST のみ）・書き込みを行わない・公開設定に ID を含めない', () => {
  const h = setup();
  callPost(h, 'initializeShift', { store: 'KABUKI', date: '2026-11-16' }, EDITOR);
  const dataSheets = () => JSON.stringify(Object.fromEntries(Object.entries(h.ss.sheets).filter(([k]) => !['エラーログ', '画像操作ログ'].includes(k)).map(([k, v]) => [k, v.rows])));
  const before = dataSheets();
  for (const method of ['GET', 'POST']) {
    const cfg = method === 'GET' ? callGet(h, 'getConfig', {}) : callPost(h, 'getPublicConfig', {});
    assert.equal(cfg.success, true);
    assert.equal(cfg.data.SPREADSHEET_ID, undefined);
    assert.equal(cfg.data.DRIVE_IMAGE_FOLDER_ID, undefined);
    assert.equal(cfg.data.googleClientId, '123456789012-testclient.apps.googleusercontent.com');
    assert.equal(cfg.data.authConfigured, true);
  }
  const reads = ['getDateList', 'getDateOptions', 'getSiftPreview', 'getSavedShift', 'getShiftSnapshot', 'getImageList', 'whoAmI'];
  const p = { store: 'KABUKI', date: '2026-11-16' };
  for (const action of reads) {
    assert.equal(callGet(h, action, p).code, 'METHOD_NOT_ALLOWED', 'GET ' + action);
    assert.equal(callPost(h, action, p).code, 'AUTH_REQUIRED', '未認証 ' + action);
    assert.equal(callPost(h, action, p, { auth: { idToken: tokenFor('stranger') } }).code, 'FORBIDDEN', '未許可 ' + action);
  }
  assert.equal(callPost(h, 'getSavedShift', p, EDITOR).data.revision, 1);
  assert.equal(callPost(h, 'getSavedShift', { store: 'AKIBA', date: '2026-11-16' }, EDITOR).data.initialized, false);
  assert.equal(callPost(h, 'getShiftSnapshot', p, EDITOR).data.casts.length, 5);
  assert.equal(callPost(h, 'getImageList', p, EDITOR).data.editRows.length, 5);
  assert.equal(callPost(h, 'getSiftPreview', p, EDITOR).data.posts.length, 1);
  assert.equal(callPost(h, 'getDateOptions', {}, EDITOR).success, true);
  assert.equal(callPost(h, 'getImageList', {}, EDITOR).code, 'INVALID_STORE', '店舗・日付の省略（旧シート参照）は不可');
  assert.deepEqual(plain(callPost(h, 'whoAmI', {}, ADMIN).data), { sub: '100000000000000000001', email: 'admin@example.com', role: 'ADMIN' });
  assert.equal(dataSheets(), before, 'ログ以外のシートは不変');
});

test('API: ロール別の権限（EDITOR は初期化・キャッシュ更新不可、ADMIN は可）', () => {
  const h = setup();
  const init = callPost(h, 'initializeShift', { store: 'KABUKI', date: '2026-11-16' }, EDITOR);
  assert.equal(init.success, true);
  const saved = callPost(h, 'saveShift', { store: 'KABUKI', date: '2026-11-16', expectedRevision: 1, rows: init.data.editRows.slice(0, 2) }, EDITOR);
  assert.equal(saved.data.revision, 2, 'EDITOR は保存できる');
  assert.equal(callPost(h, 'setCastAbsent', { store: 'KABUKI', date: '2026-11-16', recordId: saved.data.editRows[0].recordId, isAbsent: true, expectedRevision: 2 }, EDITOR).data.revision, 3);
  const denied = callPost(h, 'resetShiftFromSource', { store: 'KABUKI', date: '2026-11-16', expectedRevision: 3, confirmation: 'KABUKI:2026-11-16' }, EDITOR);
  assert.equal(denied.code, 'FORBIDDEN'); assert.equal(denied.error.details.reason, 'ROLE');
  assert.equal(callPost(h, 'refreshImageCache', {}, EDITOR).code, 'FORBIDDEN');
  assert.equal(h.gas.ShiftService.getSavedShift('KABUKI', '2026-11-16').revision, 3, '拒否時は変更なし');
  const reset = callPost(h, 'resetShiftFromSource', { store: 'KABUKI', date: '2026-11-16', expectedRevision: 3, confirmation: 'KABUKI:2026-11-16' }, ADMIN);
  assert.equal(reset.success, true); assert.equal(reset.data.editRows.length, 5);
  assert.equal(callPost(h, 'refreshImageCache', {}, ADMIN).success, true);
  assert.match(JSON.stringify(h.ss.getSheetByName('シフト編集管理').rows), /100000000000000000001/, '更新者は sub で記録');
});

// ---------- 画像キャッシュ ----------
test('画像キャッシュ: put が例外でもデータ取得は成功する・100KB超は保存しない', () => {
  const ss = new FakeSpreadsheet(); seedSpreadsheet(ss, { KABUKI: [], AKIBA: [] });
  const files = Array.from({ length: 1500 }, (_, i) => ({ id: 'ID_' + 'x'.repeat(30) + i, name: 'キャスト' + i + '.png' }));
  const h = createGasContext({ spreadsheet: ss, now: '2026-11-16T03:00:00Z', driveFolders: { '1Ob0yiSr0yP_sHa72t9xg8xmGn5YEUYR-': { files }, '17zZbEhzgr3Fp_yfdox3zWLhO5kSUwvhZ': { files: [] } } });
  h.gas.setupShiftImageManager();
  const data = h.gas.ImageService.getDriveImagesCached();
  assert.equal(data.imageFiles.length, 1500);
  assert.equal(h.cacheStore.SHIFT_IMAGE_MAP_V5, undefined, '大きすぎるので保存しない');
  const refreshed = h.gas.ImageService.refreshCache();
  assert.equal(refreshed.cached, false);
  const errors = JSON.stringify(ss.getSheetByName('エラーログ').rows);
  assert.equal((errors.match(/IMAGE_CACHE_SKIPPED/g) || []).length, 1, '警告は1回だけ');

  const h2 = createGasContext({ spreadsheet: ss, cachePutThrows: true, driveFolders: { '1Ob0yiSr0yP_sHa72t9xg8xmGn5YEUYR-': { files: files.slice(0, 3) }, '17zZbEhzgr3Fp_yfdox3zWLhO5kSUwvhZ': { files: [] } } });
  assert.equal(h2.gas.ImageService.getDriveImagesCached().imageFiles.length, 3);
});

test('画像: 照合・準備中・未登録チェック（保存データ対象）', () => {
  const h = setup();
  const S = h.gas.ShiftService;
  S.initializeShift('KABUKI', '2026-11-16', { user: 'editor@example.com' });
  const res = h.gas.ImageService.checkImages('KABUKI', '2026-11-16', { user: 'editor@example.com' });
  assert.deepEqual(plain(res.missingNames), ['ぴょん']);
  assert.match(JSON.stringify(h.ss.getSheetByName('画像チェック').rows), /ぴょん/);
  const opts = plain(S.getSavedShift('KABUKI', '2026-11-16').imageOptions.map(o => o.name));
  assert.ok(!opts.includes('準備中'));
});
