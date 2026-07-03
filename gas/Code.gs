const BOOTSTRAP_SPREADSHEET_ID = '1s-Ga2SpUWzoKQHSOymqo5MCO_wgdevFKrQWHUIKvct0';
const SCRIPT_ID = '1m0G9Y3ATR885RDD1LBEjp5Zsc5Ts4qv_hq1q9kFw3Xe0WmKy5DQVnATS';

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
  DRIVE_OUTPUT_FOLDER_ID: '',
  TIMEZONE: 'Asia/Tokyo',
  APP_MODE: 'production',
  IMAGE_CACHE_SECONDS: 600
};

const SHEET_LAYOUT = {
  CAST_START_ROW: 3,
  CAST_END_ROW: 80,
  SORT_COLUMN: 8,
  CAST_NAME_COLUMN: 9,
  WORK_TIME_COLUMN: 10,
  STATUS_COLUMN: 11,
  IMAGE_STATUS_COLUMN: 12,
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
  const result = ImageService.checkImages();
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
