'use strict';
// 店舗別キャスト画像フォルダ（StoreImageService）と手動モードの写真の自動表示
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
function testEnv(extraProps, optsIn) {
  const opts = Object.assign({}, optsIn || {});
  const sift = opts.sift || { KABUKI: [['11月16日(月)', '18:00', 'テストあい', 'テストいち', '19:00', 'テストうみ', 'テストかな'].join('\n')], AKIBA: [] };
  delete opts.sift;
  const ss = new FakeSpreadsheet(); ss.id = TEST_SS;
  seedSpreadsheet(ss, sift);
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
function storeEnv(props, mutate, sift) {
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
    sift ? { driveFolders: folders, sift } : { driveFolders: folders });
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

test('店舗フォルダ: 名前とファイル名を照合（拡張子・@以降を除く）・店舗ごとに別フォルダ（他店舗の写真は出さない）', () => {
  const h = storeEnv();
  const k = look(h, 'KABUKI', ['もも', 'ちょこ', 'せい', 'りさ', '未登録さん']);
  assert.equal(k.success, true, JSON.stringify(k));
  assert.equal(k.data.storeFolderConfigured, true);
  assert.deepEqual(cands(k, 0), ['drive:K_MOMO']);
  assert.equal(k.data.results[0].candidates[0].source, 'store');
  assert.deepEqual(cands(k, 1), ['drive:K_CHOCO']);
  assert.deepEqual(cands(k, 2), [], '秋葉原の「せい」は歌舞伎では出ない');
  assert.equal(k.data.results[0].candidates[0].photoStore, 'KABUKI', '既存の項目 photoStore は維持（常に出勤先店舗）');
  assert.deepEqual(cands(k, 3), ['drive:K_SPACE'], '「りさ @id.png」も一致');
  assert.deepEqual(cands(k, 4), []);
  const a = look(h, 'AKIBA', ['せい', 'もも', 'ちょこ']);
  assert.deepEqual(cands(a, 0), ['drive:A_SEI']);
  assert.deepEqual(cands(a, 1), ['drive:A_MOMO'], '両方の店舗にあれば出勤先店舗の写真だけ');
  assert.deepEqual(cands(a, 2), [], '歌舞伎の「ちょこ」は秋葉原では出ない');
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
  assert.equal(save('AKIBA', [{ castName: 'ちょこ', castId: 'drive:K_CHOCO' }]).code, 'UNKNOWN_CAST', '秋葉原に無い名前でも歌舞伎の写真は使わない');
  assert.equal(save('AKIBA', [{ castName: 'もも', castId: 'drive:NO_SUCH_FILE' }]).code, 'UNKNOWN_CAST');
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
  assert.equal(r.data.photos.A_SEI, undefined, '秋葉原フォルダの写真は歌舞伎で返さない');
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


// ===== 店舗別の写真検索（他店舗のフォルダは検索しない） =====
// 歌舞伎フォルダ: もも・ちょこ・ももか・るん×2 …／秋葉原フォルダ: せい・もも
const AUTO_DATE = '2026-11-16';
const sepSift = {
  KABUKI: [['11月16日(月)', '18:00', 'せい', 'もも', 'ちょこ', '19:00', 'なし子'].join('\n')],
  AKIBA: [['11月16日(月)', '18:00', 'ちょこ', 'もも', 'せい', '19:00', 'るん', 'なし子'].join('\n')]
};
const sepEnv = (props, mutate) => {
  const h = storeEnv(props, mutate, sepSift);
  h.fakeDrive.photos.A_MOMO = { mimeType: 'image/png', bytes: png(400, 627) };
  return h;
};
const autoView = (h, store) => {
  const init = callPost(h, 'initializeShift', { store, date: AUTO_DATE }, EDITOR);
  assert.equal(init.success, true, JSON.stringify(init).slice(0, 300));
  const v = callPost(h, 'getSavedShift', { store, date: AUTO_DATE }, EDITOR).data;
  const by = {};
  v.activeCastList.forEach(c => { by[c.castName] = { status: c.imageStatus, url: c.imageUrl }; });
  return { view: v, by };
};
const castPhotos = (h, store) => {
  const r = callPost(h, 'getCastPhotos', { store, date: AUTO_DATE }, EDITOR);
  assert.equal(r.success, true, JSON.stringify(r).slice(0, 300));
  const by = {};
  r.data.casts.forEach(c => { by[c.name] = c.fileId; });
  return { data: r.data, by };
};

test('店舗別 1-4: 歌舞伎の写真は歌舞伎だけ・秋葉原の写真は秋葉原だけ（他店舗にしかない写真は写真未登録）', () => {
  const h = sepEnv();
  assert.deepEqual(cands(look(h, 'KABUKI', ['ちょこ']), 0), ['drive:K_CHOCO'], '1. 歌舞伎の写真が歌舞伎で');
  assert.deepEqual(cands(look(h, 'AKIBA', ['せい']), 0), ['drive:A_SEI'], '2. 秋葉原の写真が秋葉原で');
  assert.deepEqual(cands(look(h, 'AKIBA', ['ちょこ']), 0), [], '3. 歌舞伎にしかない写真は秋葉原で未登録');
  assert.deepEqual(cands(look(h, 'KABUKI', ['せい']), 0), [], '4. 秋葉原にしかない写真は歌舞伎で未登録');
  // 保存済みの行（castId なし）を読み直しても他店舗の写真は出ない
  assert.equal(callPost(h, 'saveManualShift', { store: 'AKIBA', date: DATE, expectedRevision: 0, rows: [{ castName: 'ちょこ' }] }, EDITOR).success, true);
  const row = callPost(h, 'getManualShift', { store: 'AKIBA', date: DATE }, EDITOR).data.rows[0];
  assert.deepEqual([row.photo.status, row.photo.imageFileId], ['missing', '']);
});

test('店舗別 5: 両方の店舗に同名の写真があれば出勤先店舗の写真だけ（手動入力・自動取得・画像生成）', () => {
  const h = sepEnv();
  assert.deepEqual(cands(look(h, 'KABUKI', ['もも']), 0), ['drive:K_MOMO']);
  assert.deepEqual(cands(look(h, 'AKIBA', ['もも']), 0), ['drive:A_MOMO']);
  assert.match(autoView(h, 'KABUKI').by['もも'].url, /K_MOMO/);
  assert.match(autoView(h, 'AKIBA').by['もも'].url, /A_MOMO/);
  assert.equal(castPhotos(h, 'KABUKI').by['もも'], 'K_MOMO');
  assert.equal(castPhotos(h, 'AKIBA').by['もも'], 'A_MOMO');
});

test('店舗別: 保存・写真取得でも他店舗の写真は使わない（手動入力の写真照合）', () => {
  const h = sepEnv();
  const save = (store, rows) => callPost(h, 'saveManualShift', { store, date: DATE, expectedRevision: 0, rows }, EDITOR);
  assert.equal(save('KABUKI', [{ castName: 'せい', castId: 'drive:A_SEI' }]).code, 'UNKNOWN_CAST');
  assert.equal(save('AKIBA', [{ castName: 'もも', castId: 'drive:K_MOMO' }]).code, 'UNKNOWN_CAST');
  const p = callPost(h, 'getManualPhotos', { store: 'AKIBA', fileIds: ['K_CHOCO', 'A_SEI'] }, EDITOR);
  assert.deepEqual(Object.keys(p.data.photos), ['A_SEI']);
  assert.deepEqual(p.data.failed.map(f => f.fileId + ':' + f.reason), ['K_CHOCO:NOT_REGISTERED']);
});

test('店舗別 6・8: 自動取得は共通画像フォルダ → 出勤先店舗のフォルダ → 準備中/未登録（他店舗のフォルダは使わない）', () => {
  const h = sepEnv();
  const a = autoView(h, 'AKIBA');
  assert.equal(a.by['せい'].status, '登録済み');
  assert.match(a.by['せい'].url, /A_SEI/, '出勤先店舗のフォルダ');
  assert.equal(a.by['ちょこ'].status, '未登録', '歌舞伎の写真は秋葉原の自動取得で使わない');
  assert.equal(a.by['るん'].status, '未登録', '歌舞伎の同名ファイルも使わない');
  const k = autoView(h, 'KABUKI');
  assert.equal(k.by['せい'].status, '未登録', '秋葉原の写真は歌舞伎の自動取得で使わない');
  assert.match(k.by['ちょこ'].url, /K_CHOCO/);
  const cp = castPhotos(h, 'AKIBA');
  assert.equal(cp.by['ちょこ'], '');
  assert.equal(cp.data.photos.K_CHOCO, undefined);
  const chk = callPost(h, 'checkImages', { store: 'AKIBA', date: AUTO_DATE }, EDITOR);
  assert.deepEqual(chk.data.missingNames.sort(), ['なし子', 'るん', 'ちょこ'].sort(), '未登録チェックも店舗別');
  const snap = callPost(h, 'getShiftSnapshot', { store: 'AKIBA', date: AUTO_DATE }, EDITOR).data;
  assert.deepEqual(snap.casts.filter(c => c.imageSource === 'store').map(c => c.castName).sort(), ['もも', 'せい'].sort());
  // 8. 既存の共通画像フォルダの写真は従来どおり最優先（店舗に関係なく使える）
  const h2 = sepEnv(null, f => { f[TEST_IMG_FOLDER].files.push({ id: 'T_IMG_CHOCO', name: 'ちょこ.png' }); });
  assert.match(autoView(h2, 'AKIBA').by['ちょこ'].url, /T_IMG_CHOCO/);
  assert.match(autoView(h2, 'KABUKI').by['ちょこ'].url, /T_IMG_CHOCO/, '共通フォルダは店舗フォルダより先（従来どおり）');
});

test('店舗別 6・7: 写真再検索・ADMIN のキャッシュ更新後も他店舗の写真は混ざらない', () => {
  const h = sepEnv();
  h.folders[A_FOLDER].files.push({ id: 'A_MIKU', name: 'みく.png' });
  assert.deepEqual(cands(look(h, 'KABUKI', ['みく'], { refresh: true }), 0), [], '6. 再検索でも秋葉原の写真は歌舞伎に出ない');
  assert.deepEqual(cands(look(h, 'AKIBA', ['みく'], { refresh: true }), 0), ['drive:A_MIKU']);
  h.folders[K_FOLDER].files.push({ id: 'K_MIKU', name: 'みく.png' });
  assert.deepEqual(cands(look(h, 'KABUKI', ['みく'], { refresh: true }), 0), ['drive:K_MIKU']);
  assert.deepEqual(cands(look(h, 'AKIBA', ['みく'], { refresh: true }), 0), ['drive:A_MIKU'], '各店舗は自分のフォルダの写真');
  const h2 = sepEnv();
  autoView(h2, 'KABUKI');
  h2.folders[A_FOLDER].files.push({ id: 'A_NASHI', name: 'なし子.png' });
  assert.equal(callPost(h2, 'refreshImageCache', {}, ADMIN).success, true);
  const k = callPost(h2, 'getSavedShift', { store: 'KABUKI', date: AUTO_DATE }, EDITOR).data.activeCastList.find(c => c.castName === 'なし子');
  assert.equal(k.imageStatus, '未登録', '7. キャッシュ更新後も秋葉原の写真は歌舞伎で使わない');
  autoView(h2, 'AKIBA');
  const a = callPost(h2, 'getSavedShift', { store: 'AKIBA', date: AUTO_DATE }, EDITOR).data.activeCastList.find(c => c.castName === 'なし子');
  assert.match(a.imageUrl, /A_NASHI/);
});

test('店舗別: もう一方の店舗のフォルダの設定エラー・読めないフォルダでも出勤先店舗の検索は止まらない', () => {
  const h = sepEnv({ DRIVE_AKIBA_CAST_FOLDER_ID: PROD_IMG_FOLDER });   // 秋葉原の設定はテスト環境では停止する値
  const k = look(h, 'KABUKI', ['もも', 'せい']);
  assert.equal(k.success, true, '歌舞伎の検索は秋葉原の設定エラーで止まらない');
  assert.deepEqual(cands(k, 0), ['drive:K_MOMO']);
  assert.equal(k.data.folderWarning, '');
  assert.equal(callPost(h, 'getManualPhotos', { store: 'KABUKI', fileIds: ['K_MOMO'] }, EDITOR).success, true);
  assert.equal(autoView(h, 'KABUKI').by['もも'].status, '登録済み');
  assert.equal(look(h, 'AKIBA', ['せい']).code, 'CONFIG_PRODUCTION_ID_IN_TEST', '秋葉原自身の設定エラーは従来どおり停止');
  const h2 = sepEnv({ DRIVE_AKIBA_CAST_FOLDER_ID: 'NO_SUCH_FOLDER_000000000000' });
  const k2 = look(h2, 'KABUKI', ['もも']);
  assert.equal(k2.success, true);
  assert.equal(k2.data.folderWarning, '', '使っていない店舗のフォルダの問題は警告しない');
});

// 本番の構成: 共通画像フォルダの中に店舗フォルダがある（共通フォルダの読み込み結果に両店舗のファイルが含まれる）
const nestedEnv = props => sepEnv(props, f => {
  f[TEST_IMG_FOLDER].files.push({ id: 'A_SEI', name: 'せい.png' }, { id: 'K_CHOCO', name: 'ちょこ.jpg' }, { id: 'K_MOMO', name: 'もも.png' }, { id: 'T_IMG_NANA', name: 'なな.png' });
});

test('共通フォルダの中に店舗フォルダがある構成: 自動取得で他店舗のフォルダの写真を使わない（自店舗分・共通フォルダ独自の写真は従来どおり）', () => {
  const h = nestedEnv();
  const k = autoView(h, 'KABUKI');
  assert.equal(k.by['せい'].status, '未登録', '秋葉原フォルダの「せい」は共通フォルダ経由でも歌舞伎で使わない');
  assert.match(k.by['ちょこ'].url, /K_CHOCO/, '自店舗フォルダのファイルは共通フォルダ経由でも使える');
  const a = autoView(h, 'AKIBA');
  assert.match(a.by['せい'].url, /A_SEI/);
  assert.equal(a.by['ちょこ'].status, '未登録', '歌舞伎フォルダの「ちょこ」は秋葉原で使わない');
  assert.match(a.by['もも'].url, /A_MOMO/, '歌舞伎の「もも」（共通フォルダで先に見つかる）ではなく秋葉原の「もも」');
  assert.equal(castPhotos(h, 'KABUKI').by['せい'], '');
  assert.equal(castPhotos(h, 'AKIBA').by['ちょこ'], '');
  assert.deepEqual(callPost(h, 'checkImages', { store: 'KABUKI', date: AUTO_DATE }, EDITOR).data.missingNames.sort(), ['なし子', 'せい'].sort());
  // 差込候補（imageOptions）・差込の保存も他店舗のフォルダの写真を除く
  const opts = k.view.imageOptions.map(o => o.fileId);
  assert.equal(opts.includes('A_SEI'), false);
  assert.equal(opts.includes('K_CHOCO'), true);
  assert.equal(opts.includes('T_IMG_NANA'), true, '共通フォルダ独自の写真は従来どおり');
  const rows = k.view.editRows.map(r => ({ recordId: r.recordId, castName: r.castName, workTime: r.workTime, status: r.status, imageFileId: r.castName === 'せい' ? 'A_SEI' : '' }));
  assert.equal(callPost(h, 'saveShift', { store: 'KABUKI', date: AUTO_DATE, expectedRevision: k.view.revision, rows }, EDITOR).code, 'INVALID_IMAGE');
  rows.forEach(r => { r.imageFileId = r.castName === 'せい' ? 'T_IMG_NANA' : ''; });
  assert.equal(callPost(h, 'saveShift', { store: 'KABUKI', date: AUTO_DATE, expectedRevision: k.view.revision, rows }, EDITOR).success, true, '共通フォルダ独自の写真は差込できる（テスト環境のシート）');
});

test('共通フォルダの中に店舗フォルダがある構成: 手動入力で他店舗のフォルダの写真を取得・保存できない', () => {
  const h = nestedEnv();
  assert.equal(callPost(h, 'saveManualShift', { store: 'KABUKI', date: DATE, expectedRevision: 0, rows: [{ castName: 'せい', castId: 'drive:A_SEI' }] }, EDITOR).code, 'UNKNOWN_CAST');
  const p = callPost(h, 'getManualPhotos', { store: 'KABUKI', fileIds: ['A_SEI', 'T_IMG_NANA', 'K_MOMO'] }, EDITOR);
  assert.match(p.data.photos.K_MOMO, /^data:image\/png;base64,/);
  assert.equal(p.data.photos.A_SEI, undefined);
  assert.deepEqual(p.data.failed.filter(f => f.reason === 'NOT_REGISTERED').map(f => f.fileId), ['A_SEI'], '共通フォルダ独自の写真（T_IMG_NANA）は登録済み扱いのまま');
  // 歌舞伎の店舗フォルダが未設定（共通フォルダを使う店舗）でも秋葉原フォルダの写真は候補にしない
  const h2 = nestedEnv({ DRIVE_KABUKI_CAST_FOLDER_ID: '' });
  const r = look(h2, 'KABUKI', ['せい', 'なな', 'テストあい']);
  assert.deepEqual(cands(r, 0), []);
  assert.deepEqual(cands(r, 1), ['drive:T_IMG_NANA']);
  assert.deepEqual(cands(r, 2), ['drive:T_IMG_AI']);
});

test('店舗別: 写真ファイルを変更しない（書き込み・移動・複製・削除の Drive API を呼ばない）', () => {
  const h = sepEnv();
  look(h, 'AKIBA', ['ちょこ', 'せい', 'るん']);
  autoView(h, 'AKIBA');
  castPhotos(h, 'AKIBA');
  callPost(h, 'getManualPhotos', { store: 'KABUKI', fileIds: ['A_SEI', 'K_MOMO'] }, EDITOR);
  assert.equal(h.fakeDrive.writes.length, 0);
});
