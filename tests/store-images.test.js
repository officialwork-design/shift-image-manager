'use strict';
// 店舗別キャスト画像フォルダ（StoreImageService）と手動モードの写真の自動表示
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGasContext, FakeSpreadsheet, seedSpreadsheet } = require('./gas-harness');
const { callPost, EDITOR } = require('./fixtures');
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


const K_FOLDER = 'KABUKI_CAST_FOLDER_0000000000';
const A_FOLDER = 'AKIBA_CAST_FOLDER_00000000000';
const BIG = Buffer.concat([png(1200, 1880), Buffer.alloc(3.5 * 1024 * 1024)]);   // 3MB 超の画像
function storeEnv(props, mutate) {
  const folders = {
    [TEST_IMG_FOLDER]: { files: [{ id: 'T_IMG_AI', name: 'テストあい.png' }, { id: 'T_IMG_ICHI', name: 'テストいち.jpg' }] },
    [K_FOLDER]: { files: [
      { id: 'K_MOMO', name: 'もも.png' }, { id: 'K_CHOCO', name: 'ちょこ.jpg' }, { id: 'K_MOMOKA', name: 'ももか.png' },
      { id: 'K_RUN1', name: 'るん.png' }, { id: 'K_RUN2', name: 'るん(1).png' }, { id: 'K_PREP', name: '準備中.png' },
      { id: 'K_MEMO', name: 'memo.txt' }, { id: 'K_BIG', name: 'おおきい.png' }, { id: 'K_SPACE', name: 'りさ @risa_oshiose.png' }] },
    [A_FOLDER]: { files: [{ id: 'A_SEI', name: 'せい.png' }, { id: 'A_MOMO', name: 'もも.png' }] }
  };
  if (mutate) mutate(folders);
  const h = testEnv(Object.assign({ DRIVE_KABUKI_CAST_FOLDER_ID: K_FOLDER, DRIVE_AKIBA_CAST_FOLDER_ID: 'https://drive.google.com/drive/folders/' + A_FOLDER }, props || {}),
    { driveFolders: folders });
  Object.assign(h.fakeDrive.photos, {
    K_MOMO: { mimeType: 'image/png', bytes: png(400, 627) }, K_CHOCO: { mimeType: 'image/jpeg', bytes: jpeg(400, 627) },
    A_SEI: { mimeType: 'image/png', bytes: png(400, 627) }, K_BIG: { mimeType: 'image/png', bytes: BIG }
  });
  h.folders = folders;
  return h;
}
const DATE = '2026-11-20';
const look = (h, store, names, extra) => callPost(h, 'lookupCasts', Object.assign({ store, names }, extra || {}), EDITOR);
const cands = (res, i) => res.data.results[i].candidates.map(c => c.castId);

test('店舗フォルダ: 名前とファイル名を照合（拡張子・@以降を除く）・店舗ごとに別フォルダ', () => {
  const h = storeEnv();
  const k = look(h, 'KABUKI', ['もも', 'ちょこ', 'せい', 'りさ', '未登録さん']);
  assert.equal(k.success, true, JSON.stringify(k));
  assert.equal(k.data.storeFolderConfigured, true);
  assert.deepEqual(cands(k, 0), ['drive:K_MOMO']);
  assert.equal(k.data.results[0].candidates[0].source, 'store');
  assert.deepEqual(cands(k, 1), ['drive:K_CHOCO']);
  assert.deepEqual(cands(k, 2), [], '秋葉原の「せい」は歌舞伎では出ない');
  assert.deepEqual(cands(k, 3), ['drive:K_SPACE'], '「りさ @id.png」も一致');
  assert.deepEqual(cands(k, 4), []);
  const a = look(h, 'AKIBA', ['せい', 'もも', 'ちょこ']);
  assert.deepEqual(cands(a, 0), ['drive:A_SEI']);
  assert.deepEqual(cands(a, 1), ['drive:A_MOMO'], '同じ名前でも店舗のフォルダの写真');
  assert.deepEqual(cands(a, 2), []);
  assert.deepEqual(cands(look(h, 'KABUKI', ['テストあい']), 0), [], '店舗フォルダがある店舗では既存の共通画像フォルダを使わない');
});

test('店舗フォルダ: 前方一致では紐付けない・同名ファイルが複数なら候補を全部返す・準備中/画像以外は除外', () => {
  const h = storeEnv();
  const r = look(h, 'KABUKI', ['もも', 'ももか', 'るん', '準備中', 'memo']);
  assert.deepEqual(cands(r, 0), ['drive:K_MOMO'], '「ももか.png」は「もも」に含めない');
  assert.deepEqual(cands(r, 1), ['drive:K_MOMOKA']);
  assert.deepEqual(cands(r, 2).sort(), ['drive:K_RUN1', 'drive:K_RUN2'], '「るん」「るん(1)」→ 画面で選ぶ');
  assert.deepEqual(cands(r, 3), []);
  assert.deepEqual(cands(r, 4), []);
  assert.equal(r.data.storeImageCount, 7);
});

test('店舗フォルダ: 保存（drive:<fileId>）→ 再読み込みで写真あり・名前違い/他店舗のファイルは拒否', () => {
  const h = storeEnv();
  const save = (store, rows) => callPost(h, 'saveManualShift', { store, date: DATE, expectedRevision: 0, rows }, EDITOR);
  assert.equal(save('KABUKI', [{ castName: 'もも', castId: 'drive:K_MOMO' }, { castName: 'ちょこ', castId: 'drive:K_CHOCO' }]).success, true);
  const rows = callPost(h, 'getManualShift', { store: 'KABUKI', date: DATE }, EDITOR).data.rows;
  assert.deepEqual(rows.map(r => [r.castName, r.photo.status, r.photo.imageFileId, r.photo.source]),
    [['もも', 'registered', 'K_MOMO', 'store'], ['ちょこ', 'registered', 'K_CHOCO', 'store']]);
  assert.equal(h.ss.getSheetByName('手動シフト').get(2, 6), 'K_MOMO', '画像ID 列');
  assert.equal(save('AKIBA', [{ castName: 'もも', castId: 'drive:K_MOMO' }]).code, 'UNKNOWN_CAST', '歌舞伎のファイルを秋葉原で使わない');
  assert.equal(save('AKIBA', [{ castName: 'せい', castId: 'drive:A_MOMO' }]).code, 'CAST_MISMATCH');
  assert.equal(save('AKIBA', [{ castName: 'もも', castId: 'drive:A_MOMO' }]).success, true);
});

test('店舗フォルダ: 写真は data URL（3MB 超はサムネイル s800 で取得）・他店舗/未登録のファイルは返さない', () => {
  const h = storeEnv();
  const r = callPost(h, 'getManualPhotos', { store: 'KABUKI', fileIds: ['K_MOMO', 'K_BIG', 'A_SEI', 'OTHER'] }, EDITOR);
  assert.equal(r.success, true, JSON.stringify(r).slice(0, 300));
  assert.match(r.data.photos.K_MOMO, /^data:image\/png;base64,/);
  assert.match(r.data.photos.K_BIG, /^data:image\/png;base64,/, '3MB 超でも取得');
  assert.ok(h.fakeDrive.thumbRequests.every(s => s === 's800'));
  assert.deepEqual(r.data.failed.map(f => f.fileId + ':' + f.reason).sort(), ['A_SEI:NOT_REGISTERED', 'OTHER:NOT_REGISTERED']);
  const a = callPost(h, 'getManualPhotos', { store: 'AKIBA', fileIds: ['A_SEI'] }, EDITOR);
  assert.match(a.data.photos.A_SEI, /^data:image\/png;base64,/);
});

test('店舗フォルダ: 一覧はキャッシュ・refresh=true で追加した写真を読み直す', () => {
  const h = storeEnv();
  assert.deepEqual(cands(look(h, 'KABUKI', ['しちみ']), 0), []);
  h.folders[K_FOLDER].files.push({ id: 'K_SHICHIMI', name: 'しちみ.png' });
  assert.deepEqual(cands(look(h, 'KABUKI', ['しちみ']), 0), [], 'キャッシュ中は前の一覧');
  assert.deepEqual(cands(look(h, 'KABUKI', ['しちみ'], { refresh: true }), 0), ['drive:K_SHICHIMI']);
});

test('店舗フォルダ: 未設定は警告のみ（手動入力・登録写真は使える）・読めないフォルダも警告で続行', () => {
  const h = storeEnv({ DRIVE_KABUKI_CAST_FOLDER_ID: '' });
  const r = look(h, 'KABUKI', ['もも', 'テストあい']);
  assert.equal(r.success, true);
  assert.equal(r.data.storeFolderConfigured, false);
  assert.match(r.data.folderWarning, /DRIVE_KABUKI_CAST_FOLDER_ID/);
  assert.deepEqual(cands(r, 1), ['drive:T_IMG_AI'], '既存の画像フォルダは引き続き使える');
  const h2 = storeEnv({ DRIVE_AKIBA_CAST_FOLDER_ID: 'NO_SUCH_FOLDER_000000000000' });
  const r2 = look(h2, 'AKIBA', ['せい']);
  assert.equal(r2.success, true);
  assert.match(r2.data.folderWarning, /読み込めません/);
});

test('店舗フォルダ: テスト環境に本番の既存フォルダIDは指定できない', () => {
  const h = storeEnv({ DRIVE_KABUKI_CAST_FOLDER_ID: PROD_IMG_FOLDER });
  assert.equal(look(h, 'KABUKI', ['もも']).code, 'CONFIG_PRODUCTION_ID_IN_TEST');
});

test('店舗フォルダ: 店舗の指定は必須・登録写真との併用（両方あれば選ぶ）', () => {
  const h = storeEnv();
  assert.equal(callPost(h, 'lookupCasts', { names: ['もも'] }, EDITOR).code, 'INVALID_STORE');
  const reg = callPost(h, 'registerCastPhoto', { castName: 'ちょこ', image: { dataBase64: b64(png(400, 627)), mimeType: 'image/png' } }, EDITOR);
  assert.equal(reg.success, true);
  const r = look(h, 'KABUKI', ['ちょこ']);
  assert.deepEqual(cands(r, 0), ['drive:K_CHOCO', reg.data.castId]);
});

test('Drive の元画像を変更しない（書き込み・移動・削除の API を呼ばない）', () => {
  const h = storeEnv();
  look(h, 'KABUKI', ['もも', 'ちょこ']);
  callPost(h, 'getManualPhotos', { store: 'KABUKI', fileIds: ['K_MOMO'] }, EDITOR);
  assert.equal(h.fakeDrive.writes.length, 0);
});
