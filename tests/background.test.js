'use strict';
// 背景画像管理（BackgroundService）・画像生成用キャスト写真（getCastPhotos）
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGasContext, FakeSpreadsheet, seedSpreadsheet } = require('./gas-harness');
const { setup, callPost, EDITOR, ADMIN } = require('./fixtures');
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
const save = (h, payload, who) => callPost(h, 'saveBackground', payload, who || EDITOR);
const snapshotShiftSheets = h => JSON.stringify(['シフト編集', 'シフト編集管理'].map(n => h.ss.getSheetByName(n).rows));

test('背景: アップロード → テスト用フォルダを作成して保存・設定シートに記録・revision 1', () => {
  const h = testEnv();
  const res = save(h, { store: 'KABUKI', expectedRevision: 0, image: { dataBase64: b64(png(1447, 2048)), mimeType: 'image/png', fileName: 'bg.png' } });
  assert.equal(res.success, true, JSON.stringify(res));
  assert.equal(res.data.revision, 1);
  assert.equal(res.data.configured, true);
  assert.equal(res.data.width, 1447);
  assert.equal(res.data.height, 2048);
  assert.deepEqual(res.data.canvas, { width: 1447, height: 2048 });
  const folderWrite = h.fakeDrive.writes.find(w => w.type === 'folder');
  assert.equal(folderWrite.name, 'Shift Image Manager TEST Backgrounds');
  assert.equal(h.props.DRIVE_BACKGROUND_FOLDER_ID, folderWrite.id);
  const fileWrite = h.fakeDrive.writes.find(w => w.type === 'file');
  assert.deepEqual(fileWrite.parents, [folderWrite.id], 'テスト用背景フォルダにだけ書き込む');
  assert.ok(!h.fakeDrive.writes.some(w => (w.parents || []).includes(PROD_IMG_FOLDER)));
  const sheet = h.ss.getSheetByName('背景設定');
  assert.equal(sheet.get(2, 1), 'KABUKI');
  assert.equal(sheet.get(2, 2), fileWrite.id);
});

test('背景: 取得は data URL（Canvas を汚染しない）・設定値・店舗ごとに独立', () => {
  const h = testEnv();
  save(h, { store: 'KABUKI', expectedRevision: 0, image: { dataBase64: b64(jpeg(1080, 1920)), mimeType: 'image/jpeg' } });
  const k = callPost(h, 'getBackground', { store: 'KABUKI' }, EDITOR);
  assert.equal(k.success, true, JSON.stringify(k));
  assert.match(k.data.dataUrl, /^data:image\/jpeg;base64,/);
  assert.equal(Buffer.from(k.data.dataUrl.split(',')[1], 'base64').equals(jpeg(1080, 1920)), true);
  assert.deepEqual(k.data.settings.area, { top: 440, bottom: 200, left: 60, right: 60 });
  const a = callPost(h, 'getBackground', { store: 'AKIBA' }, EDITOR);
  assert.equal(a.data.configured, false);
  assert.equal(a.data.revision, 0);
  assert.equal(a.data.dataUrl, undefined);
  const noImg = callPost(h, 'getBackground', { store: 'KABUKI', includeImage: false }, EDITOR);
  assert.equal(noImg.data.dataUrl, undefined);
});

test('背景: 差し替え・設定変更で revision が進む／古い revision は REVISION_CONFLICT（上書きしない）', () => {
  const h = testEnv();
  save(h, { store: 'KABUKI', expectedRevision: 0, image: { dataBase64: b64(png(1000, 1000)), mimeType: 'image/png' } });
  const r2 = save(h, { store: 'KABUKI', expectedRevision: 1, settings: { fillColor: '#FFEEDD', area: { top: 500, bottom: 250, left: 70, right: 70 } } });
  assert.equal(r2.data.revision, 2);
  assert.equal(r2.data.settings.fillColor, '#ffeedd');
  assert.deepEqual(r2.data.settings.area, { top: 500, bottom: 250, left: 70, right: 70 });
  assert.equal(r2.data.width, 1000, '設定だけの変更では画像は維持');
  const stale = save(h, { store: 'KABUKI', expectedRevision: 1, image: { dataBase64: b64(png(1447, 2048)), mimeType: 'image/png' } });
  assert.equal(stale.code, 'REVISION_CONFLICT');
  assert.equal(h.fakeDrive.writes.filter(w => w.type === 'file').length, 1, '競合時は Drive に書き込まない');
  const r3 = save(h, { store: 'KABUKI', expectedRevision: 2, image: { dataBase64: b64(png(1447, 2048)), mimeType: 'image/png' } });
  assert.equal(r3.data.revision, 3);
  assert.equal(r3.data.width, 1447);
  assert.equal(h.ss.getSheetByName('背景設定').getLastRow(), 2, '店舗ごとに1行（重複しない）');
});

test('背景: 形式・サイズの検証（先頭バイトで判定）', () => {
  const h = testEnv();
  const bad = (image, code) => assert.equal(save(h, { store: 'KABUKI', expectedRevision: 0, image }).code, code, JSON.stringify(image).slice(0, 60));
  bad({ dataBase64: b64(Buffer.from('GIF89a......')), mimeType: 'image/gif' }, 'INVALID_IMAGE_TYPE');
  bad({ dataBase64: b64(Buffer.from('GIF89a......')), mimeType: 'image/png' }, 'INVALID_IMAGE');
  bad({ dataBase64: b64(png(1447, 2048)), mimeType: 'image/jpeg' }, 'INVALID_IMAGE');   // 申告と実体の不一致
  bad({ dataBase64: b64(png(100, 2048)), mimeType: 'image/png' }, 'INVALID_IMAGE_SIZE');
  bad({ dataBase64: b64(png(9000, 2048)), mimeType: 'image/png' }, 'INVALID_IMAGE_SIZE');
  bad({ dataBase64: 'not*base64', mimeType: 'image/png' }, 'INVALID_IMAGE');
  bad({ dataBase64: 'A'.repeat(11 * 1024 * 1024), mimeType: 'image/png' }, 'IMAGE_TOO_LARGE');
  assert.equal(save(h, { store: 'KABUKI', expectedRevision: 0 }).code, 'INVALID_BACKGROUND');
  assert.equal(save(h, { store: 'SHIBUYA', expectedRevision: 0, settings: { fillColor: '#ffffff' } }).code, 'INVALID_STORE');
  assert.equal(save(h, { store: 'KABUKI', expectedRevision: -1, settings: { fillColor: '#ffffff' } }).code, 'INVALID_REVISION');
  assert.equal(save(h, { store: 'KABUKI', expectedRevision: 0, settings: { fillColor: 'red' } }).code, 'INVALID_SETTINGS');
  assert.equal(save(h, { store: 'KABUKI', expectedRevision: 0, settings: { area: { top: 1000, bottom: 900, left: 0, right: 0 } } }).code, 'INVALID_SETTINGS');
  assert.equal(h.fakeDrive.writes.length, 0, '検証エラーでは Drive に書き込まない');
});

test('背景: シフトデータ（シフト編集 / シフト編集管理）を変更しない', () => {
  const h = testEnv();
  assert.equal(callPost(h, 'initializeShift', { store: 'KABUKI', date: '2026-11-16' }, EDITOR).success, true);
  const before = snapshotShiftSheets(h);
  save(h, { store: 'KABUKI', expectedRevision: 0, image: { dataBase64: b64(png(1447, 2048)), mimeType: 'image/png' } });
  save(h, { store: 'KABUKI', expectedRevision: 1, settings: { fillColor: '#000000' } });
  callPost(h, 'clearBackground', { store: 'KABUKI', expectedRevision: 2 }, ADMIN);
  assert.equal(snapshotShiftSheets(h), before);
});

test('背景: 認証・認可（未ログイン拒否・EDITOR は変更可・解除は ADMIN のみ・GET 不可）', () => {
  const h = testEnv();
  assert.equal(callPost(h, 'getBackground', { store: 'KABUKI' }).code, 'AUTH_REQUIRED');
  assert.equal(callPost(h, 'saveBackground', { store: 'KABUKI', expectedRevision: 0, settings: { fillColor: '#ffffff' } }).code, 'AUTH_REQUIRED');
  assert.equal(save(h, { store: 'KABUKI', expectedRevision: 0, settings: { fillColor: '#ffffff' } }, EDITOR).success, true);
  assert.equal(callPost(h, 'clearBackground', { store: 'KABUKI', expectedRevision: 1 }, EDITOR).code, 'FORBIDDEN');
  const cleared = callPost(h, 'clearBackground', { store: 'KABUKI', expectedRevision: 1 }, ADMIN);
  assert.equal(cleared.success, true);
  assert.equal(cleared.data.configured, false);
  const out = h.gas.doGet({ parameter: { action: 'saveBackground', payload: JSON.stringify({ store: 'KABUKI' }), callback: 'cb' } });
  assert.match(out.body, /METHOD_NOT_ALLOWED|AUTH_REQUIRED/);
});

test('背景: 本番環境で保存先未設定なら BACKGROUND_FOLDER_NOT_CONFIGURED（本番 Drive に自動作成しない）', () => {
  const h = setup();
  const res = callPost(h, 'saveBackground', { store: 'KABUKI', expectedRevision: 0, image: { dataBase64: b64(png(1447, 2048)), mimeType: 'image/png' } }, EDITOR);
  assert.equal(res.code, 'BACKGROUND_FOLDER_NOT_CONFIGURED');
  assert.equal(h.fakeDrive.writes.length, 0);
});

test('背景: テスト環境で本番の画像フォルダIDを保存先に指定 → 停止', () => {
  const h = testEnv({ DRIVE_BACKGROUND_FOLDER_ID: PROD_IMG_FOLDER });
  const res = save(h, { store: 'KABUKI', expectedRevision: 0, image: { dataBase64: b64(png(1447, 2048)), mimeType: 'image/png' } });
  assert.equal(res.code, 'CONFIG_PRODUCTION_ID_IN_TEST');
  assert.equal(h.fakeDrive.writes.length, 0);
});

test('背景: 設定シートの fileId が背景フォルダ外のファイルを指していたら返さない', () => {
  const h = testEnv();
  save(h, { store: 'KABUKI', expectedRevision: 0, image: { dataBase64: b64(png(1447, 2048)), mimeType: 'image/png' } });
  h.fakeDrive.files.OTHER = { name: 'secret.png', mimeType: 'image/png', parents: ['SOMEWHERE_ELSE'], bytes: png(1447, 2048) };
  h.ss.getSheetByName('背景設定').set(2, 2, 'OTHER');
  assert.equal(callPost(h, 'getBackground', { store: 'KABUKI' }, EDITOR).code, 'BACKGROUND_UNAVAILABLE');
});

test('背景: Drive 書き込み失敗は DRIVE_WRITE_FAILED（設定シートは変更しない）', () => {
  const h = testEnv();
  h.fakeDrive.failWrites = true;
  const res = save(h, { store: 'KABUKI', expectedRevision: 0, image: { dataBase64: b64(png(1447, 2048)), mimeType: 'image/png' } });
  assert.equal(res.code, 'DRIVE_WRITE_FAILED');
  const sheet = h.ss.getSheetByName('背景設定');
  assert.equal(sheet.getLastRow(), 1);
});

test('画像生成用写真: 出勤者のみ・並び順を保持・写真は data URL・画像フォルダ外のIDは読まない', () => {
  const h = testEnv();
  const init = callPost(h, 'initializeShift', { store: 'KABUKI', date: '2026-11-16' }, EDITOR);
  assert.equal(init.success, true, JSON.stringify(init));
  const rows = init.data.editRows.map(r => ({ recordId: r.recordId, castName: r.castName, workTime: r.workTime, status: r.status, imageFileId: r.imageFileId, sortOrder: r.sortOrder }));
  // 並び替え・休み・画像フォルダ外のIDの差込
  const reordered = [rows[3], rows[0], rows[2], rows[1]].map((r, i) => Object.assign({}, r, { sortOrder: i + 1 }));
  reordered[2].status = '休み';
  const saved = callPost(h, 'saveShift', { store: 'KABUKI', date: '2026-11-16', expectedRevision: init.data.revision, rows: reordered }, EDITOR);
  assert.equal(saved.success, true, JSON.stringify(saved));
  const ss = h.ss.getSheetByName('シフト編集');
  for (let r = 2; r <= ss.getLastRow(); r++) if (ss.get(r, 4) === 'テストかな') ss.set(r, 8, 'SOMEONE_ELSES_FILE');
  const res = callPost(h, 'getCastPhotos', { store: 'KABUKI', date: '2026-11-16' }, EDITOR);
  assert.equal(res.success, true, JSON.stringify(res));
  assert.deepEqual(res.data.casts.map(c => c.name), ['テストかな', 'テストあい', 'テストいち']);
  const byName = Object.fromEntries(res.data.casts.map(c => [c.name, c]));
  assert.equal(byName['テストかな'].fileId, '', '画像フォルダ外のファイルは使わない');
  assert.match(res.data.photos[byName['テストあい'].fileId], /^data:image\/png;base64,/);
  assert.match(res.data.photos[byName['テストいち'].fileId], /^data:image\/jpeg;base64,/);
  assert.ok(!h.fetchLog.some(u => u.includes('SOMEONE_ELSES_FILE')));
  assert.ok(h.fakeDrive.thumbRequests.every(s => s === 's800'), '縮小サムネイル（s800）を取得');
  assert.equal(callPost(h, 'getCastPhotos', { store: 'KABUKI', date: '2026-11-16' }).code, 'AUTH_REQUIRED');
});

test('画像情報: PNG / JPEG の実寸を読む（GAS の符号付き byte）', () => {
  const h = testEnv();
  const signed = buf => Array.from(buf).map(b => (b > 127 ? b - 256 : b));
  const parse = b => JSON.parse(JSON.stringify(h.gas.BackgroundImageInfo.parse(signed(b))));
  assert.deepEqual(parse(png(1447, 2048)), { mimeType: 'image/png', width: 1447, height: 2048 });
  assert.deepEqual(parse(jpeg(1080, 1920)), { mimeType: 'image/jpeg', width: 1080, height: 1920 });
  assert.equal(h.gas.BackgroundImageInfo.parse(signed(Buffer.from('hello world, not an image'))), null);
});
