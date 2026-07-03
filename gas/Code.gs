const BOOTSTRAP_SPREADSHEET_ID = '1s-Ga2SpUWzoKQHSOymqo5MCO_wgdevFKrQWHUIKvct0';

const CAST_MASTER = [
  'あいな','青葉','いおり','えりか','かれん','かなの','乖離','ここね','ここみ','こん','さおりん','さな','しちみ','しゅしゅ','すず','せい','たると','ちゃま','ちょこ','つゆ','とおる','なつめ','ななせ','ねぎたろう','ばぶ','ひめ','ひめる','まいか','ましろ','まにゃ','みらい','むぎ','めう','めえ','もも','ゆきの','ゆりあ','ゆる','ラミエル','りさ','りと','るう','るか','るり','るん',
  '恋富子','体入恋富子','みあは','体入みあは','体入らんこ','体入リア','体入アマ'
];

const DEFAULT_CONFIG = {
  SHEET_ID_MANAGEMENT: 'ID管理',
  SHEET_IMAGE_GENERATION: '画像生成',
  SHEET_SIFT_DATA: 'SIFT_DATA',
  SHEET_OPERATION_LOG: '画像操作ログ',
  SHEET_IMAGE_CHECK: '画像チェック',
  SHEET_ERROR_LOG: 'エラーログ',
  DRIVE_IMAGE_FOLDER_ID: '1Ob0yiSr0yP_sHa72t9xg8xmGn5YEUYR-',
  TIMEZONE: 'Asia/Tokyo',
  IMAGE_CACHE_SECONDS: 600
};

function doGet(e) {
  return handleRequest_(e, true);
}

function doPost(e) {
  return handleRequest_(e, false);
}

function handleRequest_(e, isJsonp) {
  const started = new Date();
  const callback = e && e.parameter ? e.parameter.callback : '';

  try {
    const request = parseRequest_(e, isJsonp);
    const data = routeAction_(request.action, request.payload || {});
    return output_({ success: true, data, elapsedMs: new Date() - started }, callback);
  } catch (err) {
    logError_('handleRequest', err, e && e.parameter ? e.parameter : {});
    return output_({ success: false, message: err.message || String(err) }, callback);
  }
}

function parseRequest_(e, isJsonp) {
  if (isJsonp) {
    const action = String(e.parameter.action || '').trim();
    const payload = e.parameter.payload ? JSON.parse(e.parameter.payload) : {};
    return { action, payload };
  }
  const body = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
  return JSON.parse(body);
}

function output_(obj, callback) {
  const json = JSON.stringify(obj);
  const body = callback ? `${callback}(${json});` : json;
  return ContentService.createTextOutput(body).setMimeType(callback ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON);
}

function routeAction_(action, payload) {
  switch (action) {
    case 'getConfig': return getPublicConfig_();
    case 'getDateList': return getDateList_();
    case 'changeDateAndStore': return changeDateAndStore_(payload.store, payload.date);
    case 'getImageList': return getImageList_(payload.store, payload.date);
    case 'setCastAbsent': return setCastAbsent_(payload.row, payload.isAbsent);
    case 'refreshImageCache': return refreshImageCache_();
    case 'checkImages': return checkImages_();
    case 'getSiftPreview': return getSiftPreview_(payload.store, payload.date);
    default: throw new Error('Unknown action: ' + action);
  }
}

function getConfig_() {
  const ss = SpreadsheetApp.openById(BOOTSTRAP_SPREADSHEET_ID);
  const sheet = ss.getSheetByName(DEFAULT_CONFIG.SHEET_ID_MANAGEMENT);
  const config = Object.assign({}, DEFAULT_CONFIG, { SPREADSHEET_ID: BOOTSTRAP_SPREADSHEET_ID });
  if (!sheet) return config;

  const values = sheet.getDataRange().getDisplayValues();
  for (let i = 1; i < values.length; i++) {
    const key = String(values[i][0] || '').trim();
    const value = String(values[i][1] || '').trim();
    if (key && value) config[key] = value;
  }
  return config;
}

function getPublicConfig_() {
  const c = getConfig_();
  return {
    appMode: c.APP_MODE || 'production',
    pagesUrl: c.GITHUB_PAGES_URL || '',
    stores: ['KABUKI', 'AKIBA']
  };
}

function getSpreadsheet_() {
  return SpreadsheetApp.openById(BOOTSTRAP_SPREADSHEET_ID);
}

function getSheet_(name) {
  const sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error(name + ' シートが見つかりません');
  return sheet;
}

function getDateList_() {
  const c = getConfig_();
  const sheet = getSheet_(c.SHEET_SIFT_DATA);
  const values = sheet.getRange(1, 1, 2, Math.max(sheet.getLastColumn(), 1)).getDisplayValues().flat();
  const dates = [];

  values.forEach(text => {
    const matches = String(text || '').match(/\d{1,2}月\d{1,2}日\([日月火水木金土]\)/g);
    if (!matches) return;
    matches.forEach(date => {
      if (!dates.includes(date)) dates.push(date);
    });
  });

  return dates.sort((a, b) => parseDate_(a) - parseDate_(b));
}

function parseDate_(text) {
  const m = String(text || '').match(/(\d+)月(\d+)日/);
  if (!m) return 0;
  return Number(m[1]) * 100 + Number(m[2]);
}

function changeDateAndStore_(store, date) {
  validateStoreAndDate_(store, date);
  const c = getConfig_();
  const sheet = getSheet_(c.SHEET_IMAGE_GENERATION);
  const parsed = getParsedShift_(store, date);

  sheet.getRange('A1').setValue(date);
  sheet.getRange('C1').setValue(store);
  sheet.getRange('H3:I80').clearContent();

  if (parsed.castNames.length) {
    sheet.getRange(3, 8, parsed.castNames.length, 1).setValues(parsed.castNames.map(name => [name]));
  }

  writeLog_('条件変更', store, date, '', '', '', '成功');
  return { success: true, count: parsed.castNames.length };
}

function getImageList_(store, date) {
  validateStoreAndDate_(store, date);
  const c = getConfig_();
  const sheet = getSheet_(c.SHEET_IMAGE_GENERATION);
  const names = sheet.getRange('H3:H80').getDisplayValues().flat();
  const absents = sheet.getRange('I3:I80').getDisplayValues().flat();
  const imageData = getDriveImagesCached_();
  const imageMap = imageData.imageMap || {};
  const preparingImageId = imageData.preparingImageId || '';
  const all = [];
  const missing = [];

  names.forEach((value, index) => {
    const name = String(value || '').trim();
    if (!name) return;
    const isAbsent = String(absents[index] || '').trim() === '休み';
    const imageId = imageMap[name] || preparingImageId || '';
    const usedPreparing = !imageMap[name] && !!preparingImageId;
    if (!imageMap[name]) missing.push(name);
    all.push({ row: index + 3, name, isAbsent, usedPreparing, imageUrl: imageId ? dataUrlFromFile_(imageId) : '' });
  });

  return {
    selectedStore: store,
    selectedDate: date,
    activeCastList: all.filter(item => !item.isAbsent && item.imageUrl),
    absentCastList: all.filter(item => item.isAbsent),
    missingImages: missing,
    updatedAt: Utilities.formatDate(new Date(), c.TIMEZONE || 'Asia/Tokyo', 'HH:mm:ss')
  };
}

function setCastAbsent_(row, isAbsent) {
  const c = getConfig_();
  const sheet = getSheet_(c.SHEET_IMAGE_GENERATION);
  const targetRow = Number(row);
  if (!targetRow || targetRow < 3 || targetRow > 80) throw new Error('不正な行番号です');
  sheet.getRange(targetRow, 9).setValue(isAbsent ? '休み' : '');
  writeLog_('休み設定変更', sheet.getRange('C1').getDisplayValue(), sheet.getRange('A1').getDisplayValue(), sheet.getRange(targetRow, 8).getDisplayValue(), targetRow, isAbsent ? '休み' : '出勤', '成功');
  return { success: true };
}

function getSiftPreview_(store, date) {
  validateStoreAndDate_(store, date);
  const posts = findSiftPosts_(store, date).map(item => ({ label: `${store} / ${date} / ${columnToLetter_(item.column)}`, text: item.text }));
  return { store, date, posts };
}

function getParsedShift_(store, date) {
  const posts = findSiftPosts_(store, date);
  if (!posts.length) throw new Error('SIFT_DATAに該当投稿が見つかりません: ' + store + ' / ' + date);
  return parsePostText_(posts[0].text);
}

function findSiftPosts_(store, date) {
  const c = getConfig_();
  const sheet = getSheet_(c.SHEET_SIFT_DATA);
  const row = String(store).toUpperCase() === 'KABUKI' ? 1 : 2;
  const values = sheet.getRange(row, 1, 1, Math.max(sheet.getLastColumn(), 1)).getDisplayValues()[0];
  const posts = [];
  values.forEach((text, index) => {
    const post = String(text || '').trim();
    if (post && post.includes(date)) posts.push({ column: index + 1, text: post });
  });
  return posts;
}

function parsePostText_(postText) {
  const lines = String(postText || '').split(/\r?\n/);
  const castNames = [];

  lines.forEach(raw => {
    const text = String(raw || '').trim();
    if (!text) return;
    if (/^\d{1,2}月\d{1,2}日/.test(text)) return;
    if (/^\d{1,2}:\d{2}$/.test(text)) return;
    if (/(営業時間|推し推せ|@oshiose_|http|https|#|OPEN|CLOSE|本日|出勤情報|七夕|海の日|推し握り|生誕|通常)/i.test(text)) return;

    const name = normalizeCastName_(text);
    if (!name) return;
    if (!CAST_MASTER.includes(name)) return;
    if (!castNames.includes(name)) castNames.push(name);
  });

  return { eventName: '', castNames };
}

function normalizeCastName_(text) {
  let name = String(text || '').replace(/@[^\s　]+.*/, '').replace(/[🔰💖🎀⚡️🫶🏼⭐️✨🌟🎪]/g, '').replace(/（ゲスト）|\(ゲスト\)/g, '').replace(/\s+/g, '').replace(/　+/g, '').trim();
  if (!name) return '';
  const aliases = {
    '恋富子': '恋富子',
    '体入恋富子': '体入恋富子',
    '体入らんこ': '体入らんこ',
    '体入リア': '体入リア',
    '体入アマ': '体入アマ',
    'みあは': 'みあは',
    '体入みあは': '体入みあは'
  };
  return aliases[name] || name;
}

function refreshImageCache_() {
  const data = getDriveImagesRaw_();
  CacheService.getScriptCache().put('SHIFT_IMAGE_MAP_V1', JSON.stringify(data), DEFAULT_CONFIG.IMAGE_CACHE_SECONDS);
  return { success: true, imageCount: Object.keys(data.imageMap).length, hasPreparingImage: !!data.preparingImageId };
}

function getDriveImagesCached_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('SHIFT_IMAGE_MAP_V1');
  if (cached) {
    try { return JSON.parse(cached); } catch (err) {}
  }
  const data = getDriveImagesRaw_();
  cache.put('SHIFT_IMAGE_MAP_V1', JSON.stringify(data), DEFAULT_CONFIG.IMAGE_CACHE_SECONDS);
  return data;
}

function getDriveImagesRaw_() {
  const c = getConfig_();
  const folderId = c.DRIVE_IMAGE_FOLDER_ID || DEFAULT_CONFIG.DRIVE_IMAGE_FOLDER_ID;
  const files = DriveApp.getFolderById(folderId).getFiles();
  const imageMap = {};
  let preparingImageId = '';

  while (files.hasNext()) {
    const file = files.next();
    const name = file.getName().replace(/\.[^/.]+$/, '').trim();
    if (name === '準備中') preparingImageId = file.getId();
    else imageMap[name] = file.getId();
  }
  return { imageMap, preparingImageId };
}

function dataUrlFromFile_(fileId) {
  const blob = DriveApp.getFileById(fileId).getBlob();
  return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
}

function checkImages_() {
  const c = getConfig_();
  const sheet = getSheet_(c.SHEET_IMAGE_GENERATION);
  const names = sheet.getRange('H3:H80').getDisplayValues().flat().map(v => String(v || '').trim()).filter(Boolean);
  const imageMap = getDriveImagesCached_().imageMap || {};
  const missingNames = names.filter(name => !imageMap[name]);

  const checkSheet = getSheet_(c.SHEET_IMAGE_CHECK);
  if (missingNames.length) {
    const now = Utilities.formatDate(new Date(), c.TIMEZONE || 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
    checkSheet.getRange(checkSheet.getLastRow() + 1, 1, missingNames.length, 4).setValues(missingNames.map(name => [now, '画像未登録', name, 'Drive内に同名画像がありません']));
  }
  return { success: true, missingCount: missingNames.length, missingNames };
}

function writeLog_(actionType, store, date, castName, row, value, result) {
  try {
    const c = getConfig_();
    const sheet = getSheet_(c.SHEET_OPERATION_LOG);
    const now = Utilities.formatDate(new Date(), c.TIMEZONE || 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
    sheet.appendRow([now, actionType || '', store || '', date || '', castName || '', row || '', value || '', '', '', result || '', '']);
  } catch (err) {}
}

function logError_(action, err, payload) {
  try {
    const c = getConfig_();
    const sheet = getSheet_(c.SHEET_ERROR_LOG);
    const now = Utilities.formatDate(new Date(), c.TIMEZONE || 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
    sheet.appendRow([now, action, err.message || String(err), err.stack || '', JSON.stringify(payload || {}), '']);
  } catch (e) {}
}

function validateStoreAndDate_(store, date) {
  if (!store) throw new Error('店舗が未指定です');
  if (!date) throw new Error('日付が未指定です');
  if (!['KABUKI', 'AKIBA'].includes(String(store).toUpperCase())) throw new Error('店舗は KABUKI または AKIBA を指定してください');
}

function columnToLetter_(column) {
  let temp;
  let letter = '';
  while (column > 0) {
    temp = (column - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    column = (column - temp - 1) / 26;
  }
  return letter;
}
