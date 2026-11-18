const BOOTSTRAP_SPREADSHEET_ID = '1s-Ga2SpUWzoKQHSOymqo5MCO_wgdevFKrQWHUIKvct0';
const SCRIPT_ID = '1m0G9Y3ATR885RDD1LBEjp5Zsc5Ts4qv_hq1q9kFw3Xe0WmKy5DQVnATS';

// 本番リソースのID。テスト環境（APP_ENV=test）でこれらが設定に含まれていたら全処理を停止する（Phase 1.7）
const PRODUCTION_RESOURCE_IDS = [
  BOOTSTRAP_SPREADSHEET_ID,
  SCRIPT_ID,
  '1Ob0yiSr0yP_sHa72t9xg8xmGn5YEUYR-',   // 本番 画像フォルダ
  '17zZbEhzgr3Fp_yfdox3zWLhO5kSUwvhZ',   // 本番 追加画像フォルダ
  'AKfycbz-NSM70nThVEJkTZ3FUaf81pwZD-ykLvXbjfHOM_Nnf6sUSiHt8JK_D5TnQ4A9InU_'   // 本番 WebApp デプロイ
];

const STORE_NAMES = ['KABUKI', 'AKIBA'];
const SHIFT_STATUSES = ['出勤', '休み'];
const WORK_TIME_OPTIONS = [
  '17:00', '17:30', '18:00', '18:30', '19:00', '19:30',
  '20:00', '20:30', '21:00', '21:30', '22:00'
];

const CAST_MASTER = [
  'あいな', '青葉', 'いおり', 'えりか', 'かれん', 'かなの', '乖離', 'ここね', 'ここみ', 'こん',
  'さおりん', 'さな', 'しちみ', 'しゅしゅ', 'すず', 'せい', 'たると', 'ちゃま', 'ちょこ', 'つゆ',
  'とおる', 'なつめ', 'ななせ', 'ねぎたろう', 'ばぶ', 'ひめ', 'ひめる', 'まいか', 'ましろ', 'まにゃ',
  'みらい', 'むぎ', 'めう', 'めえ', 'もも', 'ゆきの', 'ゆりあ', 'ゆる', 'ラミエル', 'りさ',
  'りと', 'るう', 'るか', 'るり', 'るん', '恋富子', '体入恋富子', 'みあは', '体入みあは',
  '体入らんこ', '体入リア', '体入アマ'
];

const DEFAULT_CONFIG = {
  SPREADSHEET_ID: BOOTSTRAP_SPREADSHEET_ID,
  SCRIPT_ID: SCRIPT_ID,
  GAS_WEB_APP_URL: '',
  GITHUB_REPOSITORY: 'https://github.com/officialwork-design/shift-image-manager.git',
  GITHUB_PAGES_URL: 'https://officialwork-design.github.io/shift-image-manager/',
  SHEET_ID_MANAGEMENT: 'ID管理',
  SHEET_SPECIFICATION: '仕様書',
  SHEET_IMAGE_GENERATION: '画像生成',
  SHEET_SIFT_DATA: 'SIFT_DATA',
  SHEET_OPERATION_LOG: '画像操作ログ',
  SHEET_IMAGE_CHECK: '画像チェック',
  SHEET_ERROR_LOG: 'エラーログ',
  DRIVE_IMAGE_FOLDER_ID: '1Ob0yiSr0yP_sHa72t9xg8xmGn5YEUYR-',
  DRIVE_IMAGE_FOLDER_IDS: '17zZbEhzgr3Fp_yfdox3zWLhO5kSUwvhZ',
  DRIVE_OUTPUT_FOLDER_ID: '',
  TIMEZONE: 'Asia/Tokyo',
  APP_MODE: 'production',
  IMAGE_CACHE_SECONDS: 600,
  SHEET_SHIFT_EDIT: 'シフト編集',
  SHEET_SHIFT_EDIT_MANAGE: 'シフト編集管理',
  SHEET_ACCESS_CONTROL: 'アクセス権限',
  SHEET_BACKGROUND: '背景設定',
  // 背景画像の保存先（店舗別背景）。本番は明示設定が必要。テスト環境で未設定ならテスト用フォルダを自動作成する
  DRIVE_BACKGROUND_FOLDER_ID: '',
  // 手動モード（キャスト名の手入力）。SIFT_DATA・シフト編集とは別のシートに保存する
  SHEET_MANUAL_SHIFT: '手動シフト',
  SHEET_CAST_REGISTRY: 'キャスト画像',
  // 手動モードで登録するキャスト写真の保存先。本番は明示設定が必要。テスト環境で未設定ならテスト用フォルダを自動作成する
  DRIVE_CAST_PHOTO_FOLDER_ID: ''
};

// 店舗×日付別 編集データ保存の設定（Phase 1.5）
const SHIFT_STORAGE = {
  LOCK_TIMEOUT_MS: 10000,        // LockService 取得待ち上限
  KEEP_GENERATIONS: 3,           // 店舗×日付ごとに保持する世代数（コミット済み世代を含む）
  MAX_ROWS_PER_SHIFT: 78,        // 旧 画像生成 H3:M80 と同じ上限
  MAX_CAST_NAME_LENGTH: 30,
  DATE_RESOLVE_WINDOW_DAYS: 185  // 「M月D日(曜)」から年を確定する際の許容範囲（今日±日数）
};

const SHIFT_EDIT_HEADERS = [
  'recordId', 'store', 'date', 'castName', 'workTime', 'status',
  'sortOrder', 'imageFileId', 'createdAt', 'updatedAt', 'revision'
];

const SHIFT_MANAGE_HEADERS = [
  'key', 'store', 'date', 'revision', 'initialized', 'rowCount',
  'createdAt', 'updatedAt', 'updatedBy', 'lastRequestId', 'source'
];

const SHEET_LAYOUT = {
  CAST_START_ROW: 3,
  CAST_END_ROW: 80,
  SORT_COLUMN: 8,
  CAST_NAME_COLUMN: 9,
  WORK_TIME_COLUMN: 10,
  STATUS_COLUMN: 11,
  IMAGE_STATUS_COLUMN: 12,
  IMAGE_FILE_ID_COLUMN: 13,
  DATE_CELL: 'A1',
  STORE_CELL: 'C1'
};

function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('画像シフト管理')
      .addItem('初期シート生成', 'setupShiftImageManager')
      .addSeparator()
      .addItem('画像キャッシュ更新', 'refreshImageCacheFromMenu')
      .addItem('画像未登録チェック', 'checkImagesFromMenu')
      .addSeparator()
      .addItem('旧データ移行: バックアップ作成', 'migrationBackup')
      .addItem('旧データ移行: dry-run', 'migrationDryRun')
      .addItem('旧データ移行: 実行', 'migrationExecute')
      .addSeparator()
      .addItem('アクセス権限の追加', 'accessControlAddUser')
      .addToUi();
  } catch (err) {
    // Standalone WebApp execution has no spreadsheet UI.
  }
}

function setupShiftImageManager() {
  const result = SpreadsheetService.ensureInitialSheets();
  LogService.operation('初期セットアップ', '', '', '', '', JSON.stringify(result), '成功');
  return result;
}

function refreshImageCacheFromMenu() {
  const result = ImageService.refreshCache();
  showMenuMessage_('画像キャッシュ更新', '画像数: ' + result.imageCount + '\n準備中画像: ' + (result.hasPreparingImage ? 'あり' : 'なし'));
  return result;
}

function checkImagesFromMenu() {
  const ui = SpreadsheetApp.getUi();
  const answer = ui.prompt('画像未登録チェック', '対象を「店舗:YYYY-MM-DD」で入力（例 KABUKI:2026-11-16）', ui.ButtonSet.OK_CANCEL);
  if (answer.getSelectedButton() !== ui.Button.OK) return null;
  const parts = String(answer.getResponseText() || '').split(':');
  const result = ImageService.checkImages(parts[0], parts[1], { user: 'menu' });
  showMenuMessage_('画像未登録チェック', result.missingCount ? result.missingNames.join('\n') : '画像未登録はありません。');
  return result;
}

function showMenuMessage_(title, message) {
  try {
    SpreadsheetApp.getUi().alert(title, message, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (err) {
    // Menu helpers may also be invoked from the script editor.
  }
}
