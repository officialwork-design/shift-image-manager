/**
 * 本番・テスト共通の初期セットアップ（スクリプトエディタから手動で実行する）
 *
 * - setupDriveFolders()
 *     背景画像・キャスト写真の保存フォルダが未設定なら、アプリ（drive.file）でマイドライブに新規作成し、
 *     Script Properties に記録する。設定済みのキーは変更しない（何度実行しても同じ）。
 *     ※ drive.file はアプリが作成したフォルダにしか書き込めないため、既存フォルダは指定しない。
 * - importStoreBackgrounds()
 *     背景が未登録の店舗だけ、店舗別キャスト画像フォルダにある「背景画像<店舗>」（例: 背景画像KABUKI.png）を
 *     背景フォルダへ登録する。元のファイルは読むだけで変更・移動しない。登録済みの店舗は変更しない。
 *     候補が無い・複数ある場合は登録しない（結果に理由を返す）。
 */
const SETUP_FOLDER_NAMES = {
  DRIVE_BACKGROUND_FOLDER_ID: 'Shift Image Manager 背景画像',
  DRIVE_CAST_PHOTO_FOLDER_ID: 'Shift Image Manager キャスト写真'
};
const SETUP_BACKGROUND_PREFIX = '背景画像';

function setupDriveFolders() {
  const result = SetupService.setupDriveFolders();
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function importStoreBackgrounds() {
  const result = SetupService.importStoreBackgrounds();
  console.log(JSON.stringify(result, null, 2));
  return result;
}

const SetupService = {
  setupDriveFolders() {
    const env = ConfigService.getEnvironment().env;
    const props = PropertiesService.getScriptProperties();
    const config = ConfigService.getConfig();
    const folders = {};
    Object.keys(SETUP_FOLDER_NAMES).forEach(key => {
      const existing = String(config[key] || props.getProperty(key) || '').trim();
      if (existing) {
        folders[key] = { id: existing, created: false };
        return;
      }
      const name = SETUP_FOLDER_NAMES[key] + (env === 'test' ? ' TEST' : '');
      const id = BackgroundDrive.newFolder(name);
      props.setProperty(key, id);
      folders[key] = { id, created: true, name };
    });
    LogService.operation('初期セットアップ（保存フォルダ）', '', '', '', '', JSON.stringify(folders), '成功');
    return { env, folders };
  },

  importStoreBackgrounds() {
    const env = ConfigService.getEnvironment().env;
    const results = Object.keys(STORE_CAST_FOLDER_KEYS).map(store => {
      try {
        return this.importOne_(store);
      } catch (err) {
        return { store, status: 'error', reason: (err && err.code ? '[' + err.code + '] ' : '') + Utils.errorMessage(err) };
      }
    });
    LogService.operation('初期セットアップ（背景登録）', '', '', '', '', JSON.stringify(results), '成功');
    return { env, results };
  },

  importOne_(store) {
    const current = BackgroundService.getBackground(store, { includeImage: false });
    if (current.configured) return { store, status: 'skipped', reason: '背景は登録済み', fileName: current.fileName };
    const folderId = StoreImageService.getFolderId(store);
    if (!folderId) return { store, status: 'skipped', reason: '店舗フォルダ（' + STORE_CAST_FOLDER_KEYS[store] + '）が未設定' };

    const want = this.key_(SETUP_BACKGROUND_PREFIX + store);
    const matches = [];
    const files = DriveApp.getFolderById(folderId).getFiles();
    while (files.hasNext()) {
      const f = files.next();
      if (this.key_(String(f.getName()).replace(/\.[^.]+$/, '')) === want) matches.push(f.getId());
    }
    if (!matches.length) return { store, status: 'skipped', reason: '店舗フォルダに「' + SETUP_BACKGROUND_PREFIX + store + '」がありません' };
    if (matches.length > 1) return { store, status: 'skipped', reason: '「' + SETUP_BACKGROUND_PREFIX + store + '」が複数あります（' + matches.length + '件）' };

    const file = DriveApp.getFileById(matches[0]);
    const view = BackgroundService.saveBackground({
      store,
      expectedRevision: current.revision,
      image: { dataBase64: Utilities.base64Encode(file.getBlob().getBytes()), mimeType: String(file.getMimeType()).toLowerCase(), fileName: file.getName() }
    }, { user: 'setup', userLabel: 'importStoreBackgrounds' });
    return { store, status: 'imported', sourceFileId: matches[0], sourceName: file.getName(),
      fileName: view.fileName, width: view.width, height: view.height, revision: view.revision };
  },

  key_(value) {
    return String(value || '').normalize('NFKC').replace(/\s+/g, '').toUpperCase();
  }
};
