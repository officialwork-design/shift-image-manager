'use strict';
// 手動モード（ManualShiftService）: 手動シフトの保存・取得・競合、キャスト写真の登録と castId での紐付け
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGasContext, FakeSpreadsheet, seedSpreadsheet } = require('./gas-harness');
const { callPost, EDITOR, ADMIN } = require('./fixtures');
const { CLIENT_ID, jwksHandler, KEYS } = require('./jwt-test-utils');

const TEST_SS = 'TEST_SS_0000000000000000000000000000000000';
const TEST_SCRIPT = 'TEST_SCRIPT_00000000000000000000000000000000000000000';
const TEST_IMG_FOLDER = 'TEST_FOLDER_0000000000000000000';
const PROD_IMG_FOLDER = '1Ob0yiSr0yP_sHa72t9xg8xmGn5YEUYR-';

function png(w, h) {
  const b = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]).copy(b, 0);
  b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}
function jpeg(w, h) {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,
    0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
}
const b64 = buf => buf.toString('base64');

// テスト環境（APP_ENV=test）の GAS。キャスト画像フォルダはテスト用のみ
function testEnv(extraProps, opts) {
  const ss = new FakeSpreadsheet(); ss.id = TEST_SS;
  seedSpreadsheet(ss, { KABUKI: [['11月16日(月)', '18:00', 'テストあい', 'テストいち', '19:00', 'テストうみ', 'テストかな'].join('\n')], AKIBA: [] });
  const fakeDrive = { folders: {}, files: {}, seq: 0, photos: {
    T_IMG_AI: { mimeType: 'image/png', bytes: png(600, 800) }, T_IMG_ICHI: { mimeType: 'image/jpeg', bytes: jpeg(600, 800) }
  } };
  const h = createGasContext(Object.assign({
    spreadsheet: ss, now: '2026-11-16T03:00:00Z', scriptId: TEST_SCRIPT, openableIds: [TEST_SS], fakeDrive,
    scriptProperties: Object.assign({ APP_ENV: 'test', SPREADSHEET_ID: TEST_SS, AUTH_MODE: 'google_id_token', GOOGLE_OAUTH_CLIENT_ID: CLIENT_ID }, extraProps || {}),
    urlFetch: jwksHandler({ keys: [KEYS.main] }),
    driveFolders: { [TEST_IMG_FOLDER]: { files: [{ id: 'T_IMG_AI', name: 'テストあい.png' }, { id: 'T_IMG_ICHI', name: 'テストいち.jpg' }] } }
  }, opts || {}));
  h.gas.setupShiftImageManager();
  const idm = ss.getSheetByName('ID管理');
  for (let r = 2; r <= idm.getLastRow(); r++) if (idm.get(r, 1) === 'DRIVE_IMAGE_FOLDER_ID') idm.set(r, 2, TEST_IMG_FOLDER);
  const acc = ss.getSheetByName('アクセス権限');
  const { USERS } = require('./jwt-test-utils');
  ['admin', 'editor'].forEach((name, i) => {
    const u = USERS[name];
    [u.sub, u.email, u.role, 'TRUE', '', '', ''].forEach((v, c) => acc.set(2 + i, 1 + c, v));
  });
  return h;
}

const DATE = '2026-11-20';
const get = (h, store, date) => callPost(h, 'getManualShift', { store: store || 'KABUKI', date: date || DATE }, EDITOR);
const saveM = (h, payload, who) => callPost(h, 'saveManualShift', Object.assign({ store: 'KABUKI', date: DATE }, payload), who || EDITOR);
const names = res => res.data.rows.map(r => r.castName);
const register = (h, payload, who) => callPost(h, 'registerCastPhoto', payload, who || EDITOR);
const photo = (w, h) => ({ dataBase64: b64(png(w || 400, h || 627)), mimeType: 'image/png', fileName: 'card.png' });
const autoSheets = h => JSON.stringify(['SIFT_DATA', 'シフト編集', 'シフト編集管理'].map(n => h.ss.getSheetByName(n).rows));

test('手動: 未保存の店舗・日付は revision 0・空', () => {
  const h = testEnv();
  const res = get(h);
  assert.equal(res.success, true, JSON.stringify(res));
  assert.equal(res.data.revision, 0);
  assert.deepEqual(res.data.rows, []);
});

test('手動: 保存 → 再読み込みで同じ内容・並び順（手動シフト シートに記録）', () => {
  const h = testEnv();
  const r1 = saveM(h, { expectedRevision: 0, rows: [{ castName: 'もも' }, { castName: 'ゆきの' }, { castName: '  るん ' }] });
  assert.equal(r1.success, true, JSON.stringify(r1));
  assert.equal(r1.data.revision, 1);
  assert.deepEqual(names(r1), ['もも', 'ゆきの', 'るん']);
  const again = get(h);
  assert.deepEqual(names(again), ['もも', 'ゆきの', 'るん']);
  assert.deepEqual(again.data.rows.map(r => r.sortOrder), [1, 2, 3]);
  const sheet = h.ss.getSheetByName('手動シフト');
  assert.equal(JSON.stringify(sheet.rows[0]), JSON.stringify(h.gas.MANUAL_SHIFT_HEADERS));
  assert.equal(sheet.getLastRow(), 4);
  assert.equal(sheet.get(2, 1), 'KABUKI');
  assert.equal(sheet.get(2, 2), DATE);
});

test('手動: 追加・削除・並べ替えの保存で revision が進み、古い行は残らない', () => {
  const h = testEnv();
  saveM(h, { expectedRevision: 0, rows: [{ castName: 'A' }, { castName: 'B' }, { castName: 'C' }] });
  const r2 = saveM(h, { expectedRevision: 1, rows: [{ castName: 'C' }, { castName: 'A' }, { castName: 'D' }, { castName: 'E' }] });
  assert.equal(r2.data.revision, 2);
  assert.deepEqual(names(get(h)), ['C', 'A', 'D', 'E']);
  assert.equal(h.ss.getSheetByName('手動シフト').getLastRow(), 5, '最新の4行だけ');
  const r3 = saveM(h, { expectedRevision: 2, rows: [] });
  assert.equal(r3.data.revision, 3);
  assert.deepEqual(get(h).data.rows, [], '0人でも保存できる');
  const r4 = saveM(h, { expectedRevision: 3, rows: [{ castName: 'Z' }] });
  assert.equal(r4.data.revision, 4);
  assert.deepEqual(names(get(h)), ['Z']);
});

test('手動: 古い revision での保存は REVISION_CONFLICT（上書きしない）', () => {
  const h = testEnv();
  saveM(h, { expectedRevision: 0, rows: [{ castName: 'A' }] });
  saveM(h, { expectedRevision: 1, rows: [{ castName: 'B' }] });
  const stale = saveM(h, { expectedRevision: 1, rows: [{ castName: 'X' }] });
  assert.equal(stale.success, false);
  assert.equal(stale.code, 'REVISION_CONFLICT');
  assert.equal(stale.error.details.currentRevision, 2);
  assert.deepEqual(names(get(h)), ['B']);
});

test('手動: 店舗・日付ごとに独立（AKIBA・別の日付に影響しない）', () => {
  const h = testEnv();
  saveM(h, { expectedRevision: 0, rows: [{ castName: 'K1' }] });
  saveM(h, { store: 'AKIBA', expectedRevision: 0, rows: [{ castName: 'A1' }, { castName: 'A2' }] });
  saveM(h, { date: '2026-11-21', expectedRevision: 0, rows: [{ castName: 'K2' }] });
  assert.deepEqual(names(get(h, 'KABUKI')), ['K1']);
  assert.deepEqual(names(get(h, 'AKIBA')), ['A1', 'A2']);
  assert.deepEqual(names(get(h, 'KABUKI', '2026-11-21')), ['K2']);
  saveM(h, { store: 'AKIBA', expectedRevision: 1, rows: [{ castName: 'A3' }] });
  assert.deepEqual(names(get(h, 'KABUKI')), ['K1']);
});

test('手動: SIFT_DATA・シフト編集・シフト編集管理を変更しない（自動モードに影響しない）', () => {
  const h = testEnv();
  assert.equal(callPost(h, 'initializeShift', { store: 'KABUKI', date: '2026-11-16' }, EDITOR).success, true);
  const before = autoSheets(h);
  const autoBefore = callPost(h, 'getSavedShift', { store: 'KABUKI', date: '2026-11-16' }, EDITOR);
  saveM(h, { date: '2026-11-16', expectedRevision: 0, rows: [{ castName: 'テストあい' }, { castName: '手入力のみ' }] });
  register(h, { castName: '手入力のみ', image: photo() });
  assert.equal(autoSheets(h), before);
  const autoAfter = callPost(h, 'getSavedShift', { store: 'KABUKI', date: '2026-11-16' }, EDITOR);
  assert.deepEqual(autoAfter.data.editRows.map(r => r.castName), autoBefore.data.editRows.map(r => r.castName));
  assert.equal(autoAfter.data.revision, autoBefore.data.revision);
});

test('手動: 入力検証（空の名前・長すぎる名前・人数上限・不正な店舗/日付/revision）', () => {
  const h = testEnv();
  const code = p => saveM(h, Object.assign({ expectedRevision: 0 }, p)).code;
  assert.equal(code({ rows: [{ castName: 'A' }, { castName: '  ' }] }), 'INVALID_CAST_NAME');
  assert.equal(code({ rows: [{ castName: 'あ'.repeat(31) }] }), 'INVALID_CAST_NAME');
  assert.equal(code({ rows: Array.from({ length: 41 }, (_, i) => ({ castName: 'C' + i })) }), 'TOO_MANY_CASTS');
  assert.equal(code({ rows: 'A' }), 'INVALID_ROWS');
  assert.equal(code({ store: 'SHIBUYA', rows: [] }), 'INVALID_STORE');
  assert.notEqual(saveM(h, { date: '11月20日', expectedRevision: 0, rows: [] }).success, true);
  assert.equal(saveM(h, { expectedRevision: -1, rows: [] }).code, 'INVALID_REVISION');
  assert.equal(saveM(h, { expectedRevision: 0, rows: [{ castName: 'A', castId: 'c_doesnotexist01' }] }).code, 'UNKNOWN_CAST');
  assert.equal(get(h).data.revision, 0, 'エラー時は何も保存しない');
  const ok = saveM(h, { expectedRevision: 0, rows: Array.from({ length: 40 }, (_, i) => ({ castName: 'C' + i })) });
  assert.equal(ok.data.rows.length, 40);
});

test('手動: 途中で失敗した書き込み（行数不足の新しい revision）は読み取りに出ず、次の保存で整理される', () => {
  const h = testEnv();
  saveM(h, { expectedRevision: 0, rows: [{ castName: 'A' }, { castName: 'B' }] });
  const sheet = h.ss.getSheetByName('手動シフト');
  // revision 2 を 3人分の予定で 1行だけ書いた状態
  const r = sheet.getLastRow() + 1;
  ['KABUKI', DATE, '1', 'X', '', '', 'now', '2', '3', 'u'].forEach((v, c) => sheet.set(r, c + 1, v));
  const view = get(h);
  assert.equal(view.data.revision, 1);
  assert.deepEqual(names(view), ['A', 'B']);
  const next = saveM(h, { expectedRevision: 1, rows: [{ castName: 'C' }] });
  assert.equal(next.success, true, JSON.stringify(next));
  assert.equal(next.data.revision, 3, '途中失敗の revision 番号は再利用しない');
  assert.deepEqual(names(get(h)), ['C']);
  assert.equal(sheet.getLastRow(), 2);
});

test('写真登録: 新しいキャスト → castId を発行・テスト用写真フォルダに保存・キャスト画像シートに記録', () => {
  const h = testEnv();
  const res = register(h, { castName: 'もも', image: photo(400, 627) });
  assert.equal(res.success, true, JSON.stringify(res));
  assert.match(res.data.castId, /^c_[A-Za-z0-9]+$/);
  assert.equal(res.data.revision, 1);
  assert.equal(res.data.width, 400);
  const folderWrite = h.fakeDrive.writes.find(w => w.type === 'folder');
  assert.equal(folderWrite.name, 'Shift Image Manager TEST Cast Photos');
  assert.equal(h.props.DRIVE_CAST_PHOTO_FOLDER_ID, folderWrite.id);
  const fileWrite = h.fakeDrive.writes.find(w => w.type === 'file');
  assert.deepEqual(fileWrite.parents, [folderWrite.id]);
  assert.ok(!h.fakeDrive.writes.some(w => (w.parents || []).includes(PROD_IMG_FOLDER) || (w.parents || []).includes(TEST_IMG_FOLDER)),
    '既存の画像フォルダには書き込まない');
  const sheet = h.ss.getSheetByName('キャスト画像');
  assert.equal(sheet.get(2, 1), res.data.castId);
  assert.equal(sheet.get(2, 2), 'もも');
  assert.equal(sheet.get(2, 4), fileWrite.id);
});

test('写真の紐付け: 名前で候補を検索 → castId で保存 → 再読み込みで登録済み写真・PNG 生成用の data URL を取得', () => {
  const h = testEnv();
  const reg = register(h, { castName: 'もも', image: photo() }).data;
  const look = callPost(h, 'lookupCasts', { store: 'KABUKI', names: ['もも', 'テストあい', '未登録さん'] }, EDITOR);
  assert.equal(look.success, true, JSON.stringify(look));
  const [momo, ai, none] = look.data.results;
  assert.deepEqual(momo.candidates.map(c => c.castId), [reg.castId]);
  assert.equal(ai.candidates[0].castId, 'drive:T_IMG_AI', '既存の画像フォルダの画像も候補');
  assert.equal(ai.candidates[0].source, 'folder');
  assert.deepEqual(none.candidates, []);
  const saved = saveM(h, { expectedRevision: 0, rows: [
    { castName: 'もも', castId: reg.castId }, { castName: 'テストあい', castId: 'drive:T_IMG_AI' }, { castName: '未登録さん' }] });
  assert.equal(saved.success, true, JSON.stringify(saved));
  const rows = get(h).data.rows;
  assert.equal(rows[0].photo.status, 'registered');
  assert.equal(rows[0].photo.imageFileId, reg.imageFileId);
  assert.equal(rows[1].photo.imageFileId, 'T_IMG_AI');
  assert.equal(rows[2].photo.status, 'missing');
  assert.equal(h.ss.getSheetByName('手動シフト').get(2, 6), reg.imageFileId, '画像ID 列');
  const photos = callPost(h, 'getManualPhotos', { fileIds: [reg.imageFileId, 'T_IMG_AI', 'SOMEONE_ELSES_FILE'] }, EDITOR);
  assert.equal(photos.success, true, JSON.stringify(photos));
  assert.match(photos.data.photos[reg.imageFileId], /^data:image\/png;base64,/);
  assert.match(photos.data.photos.T_IMG_AI, /^data:image\/png;base64,/);
  assert.deepEqual(photos.data.failed, [{ fileId: 'SOMEONE_ELSES_FILE', reason: 'NOT_REGISTERED' }], '登録されていないファイルは読ませない');
});

test('同名キャスト: 既定では CAST_NAME_EXISTS・明示すれば別 castId で登録・castId で正しい写真を使う', () => {
  const h = testEnv();
  const first = register(h, { castName: 'もも', image: photo(400, 627) }).data;
  const dup = register(h, { castName: 'もも', image: photo(410, 640) });
  assert.equal(dup.code, 'CAST_NAME_EXISTS');
  assert.equal(dup.error.details.candidates[0].castId, first.castId);
  const second = register(h, { castName: 'もも', image: photo(410, 640), allowSameName: true }).data;
  assert.notEqual(second.castId, first.castId);
  const look = callPost(h, 'lookupCasts', { store: 'KABUKI', names: ['もも'] }, EDITOR).data.results[0];
  assert.equal(look.candidates.length, 2);
  // 名前だけでは決めない: castId なしで保存した行は「要選択（ambiguous）」
  saveM(h, { expectedRevision: 0, rows: [{ castName: 'もも' }] });
  assert.equal(get(h).data.rows[0].photo.status, 'ambiguous');
  saveM(h, { expectedRevision: 1, rows: [{ castName: 'もも', castId: second.castId }] });
  const row = get(h).data.rows[0];
  assert.equal(row.castId, second.castId);
  assert.equal(row.photo.imageFileId, second.imageFileId, '選んだキャストの写真');
  assert.notEqual(row.photo.imageFileId, first.imageFileId);
});

test('同名防止: 名前と castId が一致しない保存は CAST_MISMATCH', () => {
  const h = testEnv();
  const momo = register(h, { castName: 'もも', image: photo() }).data;
  const res = saveM(h, { expectedRevision: 0, rows: [{ castName: 'ゆきの', castId: momo.castId }] });
  assert.equal(res.code, 'CAST_MISMATCH');
  assert.equal(saveM(h, { expectedRevision: 0, rows: [{ castName: 'テストいち', castId: 'drive:T_IMG_AI' }] }).code, 'CAST_MISMATCH');
});

test('写真の差し替え: revision 必須・古い revision は REVISION_CONFLICT・保存済みシフトは新しい写真を表示', () => {
  const h = testEnv();
  const a = register(h, { castName: 'もも', image: photo() }).data;
  saveM(h, { expectedRevision: 0, rows: [{ castName: 'もも', castId: a.castId }] });
  const b = register(h, { castName: 'もも', castId: a.castId, expectedRevision: 1, image: photo(500, 784) });
  assert.equal(b.success, true, JSON.stringify(b));
  assert.equal(b.data.revision, 2);
  assert.notEqual(b.data.imageFileId, a.imageFileId);
  assert.equal(get(h).data.rows[0].photo.imageFileId, b.data.imageFileId);
  const stale = register(h, { castName: 'もも', castId: a.castId, expectedRevision: 1, image: photo() });
  assert.equal(stale.code, 'REVISION_CONFLICT');
  assert.equal(register(h, { castName: 'ゆきの', castId: a.castId, expectedRevision: 2, image: photo() }).code, 'CAST_MISMATCH');
  assert.equal(register(h, { castName: 'テストあい', castId: 'drive:T_IMG_AI', expectedRevision: 0, image: photo() }).code, 'INVALID_CAST_ID',
    '既存の画像フォルダの画像は差し替えない');
  assert.equal(h.ss.getSheetByName('キャスト画像').getLastRow(), 2);
});

test('写真登録: 形式・サイズの検証（Drive に書き込まない）・200KB 超の本文も受け付ける', () => {
  const h = testEnv();
  const bad = (image, code) => assert.equal(register(h, { castName: 'もも', image }).code, code);
  bad({ dataBase64: b64(Buffer.from('GIF89a......')), mimeType: 'image/gif' }, 'INVALID_IMAGE_TYPE');
  bad({ dataBase64: b64(png(400, 600)), mimeType: 'image/jpeg' }, 'INVALID_IMAGE');
  bad({ dataBase64: b64(png(50, 600)), mimeType: 'image/png' }, 'INVALID_IMAGE_SIZE');
  bad({ dataBase64: 'A'.repeat(5 * 1024 * 1024), mimeType: 'image/png' }, 'IMAGE_TOO_LARGE');
  assert.equal(register(h, { castName: '', image: photo() }).code, 'INVALID_CAST_NAME');
  assert.equal(register(h, { castName: 'もも' }).code, 'INVALID_IMAGE');
  assert.equal(h.fakeDrive.writes.length, 0);
  const big = Buffer.concat([png(400, 627), Buffer.alloc(400 * 1024)]);
  const ok = register(h, { castName: 'もも', image: { dataBase64: b64(big), mimeType: 'image/png' } });
  assert.equal(ok.success, true, JSON.stringify(ok).slice(0, 200));
  assert.equal(callPost(h, 'lookupCasts', { store: 'KABUKI', names: ['x'], pad: 'A'.repeat(300 * 1024) }, EDITOR).code, 'INVALID_REQUEST', '画像以外の操作は 200KB まで');
});

test('写真フォルダ: 本番の画像フォルダを保存先に指定すると拒否（書き込まない）', () => {
  const h = testEnv({ DRIVE_CAST_PHOTO_FOLDER_ID: PROD_IMG_FOLDER });
  const res = register(h, { castName: 'もも', image: photo() });
  assert.equal(res.success, false);
  assert.match(res.code, /^CONFIG_/);
  assert.equal(h.fakeDrive.writes.length, 0);
});

test('手動: 認証・認可（未ログイン拒否・EDITOR 可・GET 不可）', () => {
  const h = testEnv();
  ['getManualShift', 'saveManualShift', 'lookupCasts', 'getManualPhotos', 'registerCastPhoto'].forEach(action => {
    assert.equal(callPost(h, action, { store: 'KABUKI', date: DATE }).code, 'AUTH_REQUIRED', action);
    assert.equal(h.gas.API_PROTECTED_ACTIONS[action].join(','), 'ADMIN,EDITOR', action);
  });
  const out = h.gas.doGet({ parameter: { action: 'getManualShift', payload: JSON.stringify({ store: 'KABUKI', date: DATE }) } });
  assert.equal(JSON.parse(out.body).code, 'METHOD_NOT_ALLOWED');
  assert.equal(saveM(h, { expectedRevision: 0, rows: [{ castName: 'A' }] }, ADMIN).success, true);
});

test('初期シート生成で 手動シフト・キャスト画像 シートをヘッダー付きで作成（既存シートは変更しない）', () => {
  const h = testEnv();
  assert.equal(JSON.stringify(h.ss.getSheetByName('手動シフト').rows[0]), JSON.stringify(h.gas.MANUAL_SHIFT_HEADERS));
  assert.equal(JSON.stringify(h.ss.getSheetByName('キャスト画像').rows[0]), JSON.stringify(h.gas.CAST_REGISTRY_HEADERS));
  saveM(h, { expectedRevision: 0, rows: [{ castName: 'A' }] });
  const snap = JSON.stringify(h.ss.getSheetByName('手動シフト').rows);
  h.gas.setupShiftImageManager();
  assert.equal(JSON.stringify(h.ss.getSheetByName('手動シフト').rows), snap);
});
