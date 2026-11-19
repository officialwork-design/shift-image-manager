'use strict';
// 初期セットアップ（SetupService）: 保存フォルダの作成・店舗フォルダの背景画像の登録
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGasContext, FakeSpreadsheet, seedSpreadsheet } = require('./gas-harness');
const { CLIENT_ID, jwksHandler, KEYS } = require('./jwt-test-utils');

const PROD_SS = '1s-Ga2SpUWzoKQHSOymqo5MCO_wgdevFKrQWHUIKvct0';
const K_FOLDER = 'K_STORE_FOLDER_00000000000000000';
const A_FOLDER = 'A_STORE_FOLDER_00000000000000000';

function png(w, h) {
  const b = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]).copy(b, 0);
  b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}

// 本番相当（本番の Script ID・本番スプレッドシート ID）。Drive はモック
function prodEnv(props, kFiles, aFiles) {
  const ss = new FakeSpreadsheet(); ss.id = PROD_SS;
  seedSpreadsheet(ss, { KABUKI: [], AKIBA: [] });
  const files = {
    K_BG: { name: '背景画像KABUKI .png', mimeType: 'image/png', bytes: png(2480, 3508) },
    A_BG: { name: '背景画像AKIBA .png', mimeType: 'image/png', bytes: png(2480, 3508) },
    K_CHOCO: { name: 'ちょこ.png', mimeType: 'image/png', bytes: png(566, 800) }
  };
  const fakeDrive = { folders: {}, files, seq: 0, photos: {} };
  const h = createGasContext({
    spreadsheet: ss, now: '2026-11-19T03:00:00Z', fakeDrive,
    scriptProperties: Object.assign({ AUTH_MODE: 'google_id_token', GOOGLE_OAUTH_CLIENT_ID: CLIENT_ID,
      DRIVE_KABUKI_CAST_FOLDER_ID: K_FOLDER, DRIVE_AKIBA_CAST_FOLDER_ID: A_FOLDER }, props || {}),
    urlFetch: jwksHandler({ keys: [KEYS.main] }),
    driveFolders: {
      [K_FOLDER]: { files: kFiles || [{ id: 'K_BG', name: '背景画像KABUKI .png' }, { id: 'K_CHOCO', name: 'ちょこ.png' }] },
      [A_FOLDER]: { files: aFiles || [{ id: 'A_BG', name: '背景画像AKIBA .png' }] }
    }
  });
  h.gas.setupShiftImageManager();
  return h;
}

test('setupDriveFolders: 未設定なら本番用の名前で作成して Script Properties に記録・2回目は何もしない', () => {
  const h = prodEnv();
  const r1 = h.gas.SetupService.setupDriveFolders();
  assert.equal(r1.env, 'production');
  assert.equal(r1.folders.DRIVE_BACKGROUND_FOLDER_ID.created, true);
  assert.equal(r1.folders.DRIVE_CAST_PHOTO_FOLDER_ID.created, true);
  const names = h.fakeDrive.writes.filter(w => w.type === 'folder').map(w => w.name).sort();
  assert.deepEqual(names, ['Shift Image Manager キャスト写真', 'Shift Image Manager 背景画像']);
  assert.equal(h.props.DRIVE_BACKGROUND_FOLDER_ID, r1.folders.DRIVE_BACKGROUND_FOLDER_ID.id);
  assert.equal(h.props.DRIVE_CAST_PHOTO_FOLDER_ID, r1.folders.DRIVE_CAST_PHOTO_FOLDER_ID.id);

  const writes = h.fakeDrive.writes.length;
  const r2 = h.gas.SetupService.setupDriveFolders();
  assert.equal(h.fakeDrive.writes.length, writes, '設定済みならフォルダを作らない');
  assert.equal(r2.folders.DRIVE_BACKGROUND_FOLDER_ID.created, false);
  assert.equal(r2.folders.DRIVE_BACKGROUND_FOLDER_ID.id, r1.folders.DRIVE_BACKGROUND_FOLDER_ID.id);
});

test('setupDriveFolders: 既に設定されているキーは変更しない', () => {
  const h = prodEnv({ DRIVE_BACKGROUND_FOLDER_ID: 'EXISTING_BG_FOLDER' });
  const r = h.gas.SetupService.setupDriveFolders();
  assert.equal(JSON.stringify(r.folders.DRIVE_BACKGROUND_FOLDER_ID), JSON.stringify({ id: 'EXISTING_BG_FOLDER', created: false }));
  assert.equal(h.props.DRIVE_BACKGROUND_FOLDER_ID, 'EXISTING_BG_FOLDER');
  assert.equal(h.fakeDrive.writes.filter(w => w.type === 'folder').length, 1);
});

test('importStoreBackgrounds: 店舗フォルダの「背景画像<店舗>」を背景フォルダへ登録・元ファイルは変更しない・2回目はスキップ', () => {
  const h = prodEnv();
  h.gas.SetupService.setupDriveFolders();
  const bgFolder = h.props.DRIVE_BACKGROUND_FOLDER_ID;
  const before = JSON.stringify(h.fakeDrive.files.K_BG) + JSON.stringify(h.fakeDrive.files.A_BG);
  const r = h.gas.SetupService.importStoreBackgrounds();
  assert.deepEqual(r.results.map(x => [x.store, x.status]), [['KABUKI', 'imported'], ['AKIBA', 'imported']], JSON.stringify(r));
  assert.equal(r.results[0].sourceFileId, 'K_BG');
  assert.equal(r.results[0].width, 2480);
  assert.equal(r.results[0].revision, 1);
  const uploads = h.fakeDrive.writes.filter(w => w.type === 'file');
  assert.equal(uploads.length, 2);
  assert.ok(uploads.every(w => w.parents.length === 1 && w.parents[0] === bgFolder), '背景フォルダにだけ書き込む');
  assert.equal(JSON.stringify(h.fakeDrive.files.K_BG) + JSON.stringify(h.fakeDrive.files.A_BG), before, '元ファイルは変更しない');
  const sheet = h.ss.getSheetByName('背景設定');
  assert.equal(sheet.get(2, 1), 'KABUKI');
  assert.equal(sheet.get(3, 1), 'AKIBA');

  const r2 = h.gas.SetupService.importStoreBackgrounds();
  assert.deepEqual(r2.results.map(x => x.status), ['skipped', 'skipped']);
  assert.equal(h.fakeDrive.writes.filter(w => w.type === 'file').length, 2, '登録済みなら上書きしない');
});

test('importStoreBackgrounds: 候補なし・複数・店舗フォルダ未設定は登録しない（理由を返す）', () => {
  const h = prodEnv({ DRIVE_AKIBA_CAST_FOLDER_ID: '' },
    [{ id: 'K_BG', name: '背景画像KABUKI .png' }, { id: 'A_BG', name: '背景画像ＫＡＢＵＫＩ.png' }]);
  h.gas.SetupService.setupDriveFolders();
  const r = h.gas.SetupService.importStoreBackgrounds();
  assert.equal(r.results[0].status, 'skipped');
  assert.match(r.results[0].reason, /複数/);
  assert.equal(r.results[1].status, 'skipped');
  assert.match(r.results[1].reason, /未設定/);
  assert.equal(h.fakeDrive.writes.filter(w => w.type === 'file').length, 0);

  const h2 = prodEnv({}, [{ id: 'K_CHOCO', name: 'ちょこ.png' }]);
  h2.gas.SetupService.setupDriveFolders();
  const r3 = h2.gas.SetupService.importStoreBackgrounds();
  assert.match(r3.results[0].reason, /ありません/);
  assert.equal(r3.results[1].status, 'imported');
});

test('setupShiftImageManager: 既存シートのデータは変更せず、足りないシートだけ作る', () => {
  const h = prodEnv();
  const sift = h.ss.getSheetByName('SIFT_DATA');
  sift.set(1, 1, '既存の投稿');
  const before = JSON.stringify(sift.rows);
  const res = h.gas.setupShiftImageManager();
  assert.equal(JSON.stringify(res.createdSheets), '[]', '2回目は何も作らない');
  assert.equal(JSON.stringify(sift.rows), before);
  ['アクセス権限', 'シフト編集', 'シフト編集管理', '背景設定', '手動シフト', 'キャスト画像'].forEach(n => assert.ok(h.ss.getSheetByName(n), n));
  assert.equal(h.ss.getSheetByName('アクセス権限').getLastRow(), 1, 'アクセス権限はヘッダーのみ（空 = 全員拒否）');
});

test('アクセス権限: 有効な ADMIN がいない間は EDITOR を登録できない／エディタからの登録はプロパティを必ず消す', () => {
  const h = prodEnv();
  const ADMIN_SUB = '100000000000000000001';
  const EDITOR_SUB = '100000000000000000002';
  // ADMIN がいない状態で EDITOR を登録しようとすると拒否（プロパティは消える）
  Object.assign(h.props, { ACCESS_ADD_SUB: EDITOR_SUB, ACCESS_ADD_EMAIL: 'e@example.com', ACCESS_ADD_ROLE: 'EDITOR' });
  assert.throws(() => h.gas.accessControlAddFromProperties(), e => e.code === 'ADMIN_REQUIRED');
  assert.ok(!('ACCESS_ADD_SUB' in h.props) && !('ACCESS_ADD_ROLE' in h.props) && !('ACCESS_ADD_EMAIL' in h.props));
  assert.equal(h.ss.getSheetByName('アクセス権限').getLastRow(), 1);
  // 最初の ADMIN
  Object.assign(h.props, { ACCESS_ADD_SUB: ADMIN_SUB, ACCESS_ADD_EMAIL: 'A@Example.com', ACCESS_ADD_ROLE: 'admin' });
  const r = h.gas.accessControlAddFromProperties();
  assert.equal(r.added.role, 'ADMIN');
  assert.equal(r.summary.activeAdmins, 1);
  assert.ok(!('ACCESS_ADD_SUB' in h.props));
  const sheet = h.ss.getSheetByName('アクセス権限');
  assert.equal(sheet.get(2, 1), ADMIN_SUB, 'sub は文字列のまま保存');
  assert.equal(sheet.get(2, 2), 'a@example.com');
  // ADMIN がいれば EDITOR を登録できる・重複は拒否
  Object.assign(h.props, { ACCESS_ADD_SUB: EDITOR_SUB, ACCESS_ADD_ROLE: 'EDITOR' });
  assert.equal(h.gas.accessControlAddFromProperties().summary.activeEditors, 1);
  Object.assign(h.props, { ACCESS_ADD_SUB: EDITOR_SUB, ACCESS_ADD_ROLE: 'EDITOR' });
  assert.throws(() => h.gas.accessControlAddFromProperties(), e => e.code === 'DUPLICATE_SUB');
  // 未入力
  assert.throws(() => h.gas.accessControlAddFromProperties(), e => e.code === 'INVALID_INPUT');
  const s = h.gas.accessControlSummary();
  assert.equal(JSON.stringify([s.total, s.activeAdmins, s.activeEditors]), '[2,1,1]');
});
