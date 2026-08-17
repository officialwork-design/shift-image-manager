const IMAGE_CACHE_KEY = 'SHIFT_IMAGE_MAP_V5';
const IMAGE_FOLDER_MAX_DEPTH = 5;
const IMAGE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const TOKYO_IMAGE_FOLDER_ID = '1Ob0yiSr0yP_sHa72t9xg8xmGn5YEUYR-';
const OSAKA_IMAGE_FOLDER_ID = '17zZbEhzgr3Fp_yfdox3zWLhO5kSUwvhZ';

const ImageService = {
  refreshCache() {
    const config = ConfigService.getConfig();
    const data = this.getDriveImagesRaw_();
    const imageCount = data.imageFiles ? data.imageFiles.length : Object.keys(data.imageMap).length;
    CacheService.getScriptCache().put(IMAGE_CACHE_KEY, JSON.stringify(data), Number(config.IMAGE_CACHE_SECONDS || DEFAULT_CONFIG.IMAGE_CACHE_SECONDS));
    LogService.operation('画像キャッシュ更新', '', '', '', '', 'imageCount=' + imageCount + ', folderCount=' + data.folderCount, '成功');
    return {
      success: true,
      imageCount,
      hasPreparingImage: !!data.preparingImageId,
      folderCount: data.folderCount,
      fileCount: data.fileCount,
      folderIds: data.folderIds,
      folderErrors: data.folderErrors
    };
  },

  getDriveImagesCached() {
    const cache = CacheService.getScriptCache();
    const cached = cache.get(IMAGE_CACHE_KEY);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (err) {
        cache.remove(IMAGE_CACHE_KEY);
      }
    }

    const config = ConfigService.getConfig();
    const data = this.getDriveImagesRaw_();
    cache.put(IMAGE_CACHE_KEY, JSON.stringify(data), Number(config.IMAGE_CACHE_SECONDS || DEFAULT_CONFIG.IMAGE_CACHE_SECONDS));
    return data;
  },

  getDataUrl(fileId) {
    if (!fileId) return '';
    const blob = DriveApp.getFileById(fileId).getBlob();
    return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
  },

  getThumbnailUrl(fileId, size) {
    if (!fileId) return '';
    const safeSize = size || 'w240';
    return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(fileId) + '&sz=' + encodeURIComponent(safeSize);
  },

  uploadImage(payload) {
    const target = this.getUploadTarget_(payload.folderKey);
    const castName = this.sanitizeUploadName_(payload.name);
    if (!castName) throw new Error('画像名を入力してください');

    const parsed = this.parseImageDataUrl_(payload.dataUrl || '');
    if (!this.isAllowedUploadMimeType_(parsed.mimeType)) {
      throw new Error('画像ファイルを選択してください');
    }

    const bytes = Utilities.base64Decode(parsed.base64);
    if (bytes.length > IMAGE_UPLOAD_MAX_BYTES) {
      throw new Error('画像サイズが大きすぎます。10MB以下にしてください');
    }

    const extension = this.getUploadExtension_(payload.fileName, parsed.mimeType);
    const fileName = castName + extension;
    const blob = Utilities.newBlob(bytes, parsed.mimeType, fileName);
    const file = DriveApp.getFolderById(target.folderId).createFile(blob);
    file.setName(fileName);
    const fileId = file.getId();
    const imageUrl = this.getThumbnailUrl(fileId, 'w600');

    CacheService.getScriptCache().remove(IMAGE_CACHE_KEY);
    LogService.operation('画像追加', '', '', castName, '', target.label + ' / ' + fileName, '成功', fileId);
    const uploadLogConfig = this.getUploadLogConfig_();
    this.writeUploadLogSafely_({
      castName,
      target,
      fileName,
      fileId,
      imageUrl,
      sourceFileName: payload.fileName || '',
      mimeType: parsed.mimeType,
      sizeBytes: bytes.length,
      uploadLogConfig
    });

    return {
      success: true,
      name: castName,
      fileName,
      fileId,
      folderKey: target.key,
      folderLabel: target.label,
      imageUrl,
      uploadLogSpreadsheetId: uploadLogConfig.spreadsheetId,
      uploadLogSheetName: uploadLogConfig.sheetName
    };
  },

  checkImages() {
    const config = ConfigService.getConfig();
    const sheet = SpreadsheetService.getSheet(config.SHEET_IMAGE_GENERATION);
    const rowCount = SHEET_LAYOUT.CAST_END_ROW - SHEET_LAYOUT.CAST_START_ROW + 1;
    const width = SHEET_LAYOUT.IMAGE_FILE_ID_COLUMN - SHEET_LAYOUT.CAST_NAME_COLUMN + 1;
    const rows = sheet.getRange(SHEET_LAYOUT.CAST_START_ROW, SHEET_LAYOUT.CAST_NAME_COLUMN, rowCount, width)
      .getDisplayValues()
      .map(row => ({
        name: String(row[0] || '').trim(),
        imageFileId: String(row[4] || '').trim()
      }))
      .filter(row => row.name);
    const imageData = this.getDriveImagesCached();
    const missingNames = rows
      .filter(row => !row.imageFileId && !this.findImageIdForCast_(imageData.imageMap || {}, row.name))
      .map(row => row.name);

    if (missingNames.length) {
      const now = Utils.now();
      const rows = missingNames.map(name => [now, '画像未登録', name, 'Drive内に同名画像がありません']);
      SpreadsheetService.appendRows(config.SHEET_IMAGE_CHECK, rows);
    }

    LogService.operation('画像未登録チェック', '', '', '', '', 'missingCount=' + missingNames.length, '成功');
    return { success: true, missingCount: missingNames.length, missingNames };
  },

  findImageIdForCast(imageMap, castName) {
    return this.findImageIdForCast_(imageMap, castName);
  },

  getImageStatusForCast(imageData, castName) {
    const imageMap = imageData && imageData.imageMap ? imageData.imageMap : {};
    if (this.findImageIdForCast_(imageMap, castName)) return '登録済み';
    if (imageData && imageData.preparingImageId) return '準備中';
    return '未登録';
  },

  getImageIdForCast(imageData, castName) {
    const imageMap = imageData && imageData.imageMap ? imageData.imageMap : {};
    return this.findImageIdForCast_(imageMap, castName) || (imageData && imageData.preparingImageId ? imageData.preparingImageId : '');
  },

  getDriveImagesRaw_() {
    const config = ConfigService.getConfig();
    const folderIds = this.getImageFolderIds_(config);
    const imageMap = {};
    const state = { preparingImageId: '', imageFiles: [], imageFileIds: {} };
    const folderErrors = [];
    const rootErrors = [];
    const seenFolders = {};
    const stats = { folderCount: 0, fileCount: 0 };

    folderIds.forEach(folderId => {
      try {
        const folder = DriveApp.getFolderById(folderId);
        this.scanImageFolder_(folder, imageMap, state, folderErrors, seenFolders, stats, 0);
      } catch (err) {
        rootErrors.push({ folderId, message: Utils.errorMessage(err) });
        folderErrors.push({ folderId, message: Utils.errorMessage(err) });
        LogService.error('ImageService.getDriveImagesRaw', err, { folderId });
      }
    });

    if (folderIds.length && rootErrors.length === folderIds.length) {
      throw new Error('画像フォルダを読み込めません: ' + rootErrors.map(item => item.folderId).join(', '));
    }

    return {
      imageMap,
      preparingImageId: state.preparingImageId,
      imageFiles: state.imageFiles,
      folderIds,
      folderErrors,
      folderCount: stats.folderCount,
      fileCount: stats.fileCount
    };
  },

  scanImageFolder_(folder, imageMap, state, folderErrors, seenFolders, stats, depth) {
    const folderId = folder.getId();
    if (seenFolders[folderId]) return;
    seenFolders[folderId] = true;
    stats.folderCount += 1;

    const files = folder.getFiles();
    while (files.hasNext()) {
      const file = files.next();
      stats.fileCount += 1;
      this.addImageFile_(file, imageMap, state);
    }

    if (depth >= IMAGE_FOLDER_MAX_DEPTH) return;

    const folders = folder.getFolders();
    while (folders.hasNext()) {
      const childFolder = folders.next();
      try {
        this.scanImageFolder_(childFolder, imageMap, state, folderErrors, seenFolders, stats, depth + 1);
      } catch (err) {
        const childFolderId = this.getDriveItemId_(childFolder);
        folderErrors.push({ folderId: childFolderId, message: Utils.errorMessage(err) });
        LogService.error('ImageService.scanImageFolder', err, { folderId: childFolderId });
      }
    }
  },

  addImageFile_(file, imageMap, state) {
    const fileId = file.getId();
    const baseName = Utils.stripExtension(file.getName()).trim();
    const keys = this.getImageNameKeys_(baseName);
    if (keys.indexOf('準備中') !== -1) {
      if (!state.preparingImageId) state.preparingImageId = fileId;
      return;
    }

    if (!state.imageFileIds[fileId]) {
      state.imageFileIds[fileId] = true;
      state.imageFiles.push({
        fileId,
        name: baseName
      });
    }

    keys.forEach(key => this.setImageMapKey_(imageMap, key, fileId));
  },

  getDriveItemId_(item) {
    try {
      return item.getId();
    } catch (err) {
      return '';
    }
  },

  getImageFolderIds_(config) {
    const rawValues = [
      config.DRIVE_IMAGE_FOLDER_ID || DEFAULT_CONFIG.DRIVE_IMAGE_FOLDER_ID,
      config.DRIVE_IMAGE_FOLDER_IDS || ''
    ];
    const seen = {};
    const folderIds = [];

    rawValues
      .join('\n')
      .split(/[\s,;]+/)
      .map(value => this.extractFolderId_(value))
      .filter(Boolean)
      .forEach(folderId => {
        if (seen[folderId]) return;
        seen[folderId] = true;
        folderIds.push(folderId);
      });

    return folderIds;
  },

  extractFolderId_(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const folderMatch = text.match(/\/folders\/([A-Za-z0-9_-]+)/);
    if (folderMatch) return folderMatch[1];
    const idMatch = text.match(/[?&]id=([A-Za-z0-9_-]+)/);
    if (idMatch) return idMatch[1];
    return text;
  },

  getUploadTarget_(folderKey) {
    const key = String(folderKey || '').toLowerCase();
    const config = ConfigService.getConfig();
    const targets = {
      tokyo: {
        key: 'tokyo',
        label: '東京',
        folderId: this.extractFolderId_(config.DRIVE_IMAGE_FOLDER_ID || DEFAULT_CONFIG.DRIVE_IMAGE_FOLDER_ID || TOKYO_IMAGE_FOLDER_ID)
      },
      osaka: {
        key: 'osaka',
        label: '大阪',
        folderId: this.getOsakaUploadFolderId_(config)
      }
    };

    if (!targets[key] || !targets[key].folderId) {
      throw new Error('画像追加先フォルダを選択してください');
    }

    return targets[key];
  },

  getOsakaUploadFolderId_(config) {
    const folderIds = String(config.DRIVE_IMAGE_FOLDER_IDS || DEFAULT_CONFIG.DRIVE_IMAGE_FOLDER_IDS || OSAKA_IMAGE_FOLDER_ID)
      .split(/[\s,;]+/)
      .map(value => this.extractFolderId_(value))
      .filter(Boolean);
    return folderIds.indexOf(OSAKA_IMAGE_FOLDER_ID) !== -1 ? OSAKA_IMAGE_FOLDER_ID : (folderIds[0] || OSAKA_IMAGE_FOLDER_ID);
  },

  writeUploadLogSafely_(record) {
    try {
      this.writeUploadLog_(record);
    } catch (err) {
      LogService.error('ImageService.writeUploadLog', err, {
        castName: record.castName,
        folderKey: record.target && record.target.key,
        fileId: record.fileId
      });
    }
  },

  writeUploadLog_(record) {
    const logConfig = record.uploadLogConfig || this.getUploadLogConfig_();
    if (!logConfig.spreadsheetId) return;

    const spreadsheet = SpreadsheetApp.openById(logConfig.spreadsheetId);
    const sheet = spreadsheet.getSheetByName(logConfig.sheetName) || spreadsheet.insertSheet(logConfig.sheetName);
    this.ensureUploadLogHeader_(sheet);
    sheet.appendRow([
      Utils.now(),
      record.castName,
      record.target.label,
      record.target.key,
      record.target.folderId,
      record.fileName,
      record.fileId,
      record.imageUrl,
      record.sourceFileName,
      record.mimeType,
      record.sizeBytes
    ]);
  },

  getUploadLogConfig_() {
    const config = ConfigService.getConfig();
    return {
      spreadsheetId: this.extractSpreadsheetId_(config.IMAGE_UPLOAD_LOG_SPREADSHEET_ID || DEFAULT_CONFIG.IMAGE_UPLOAD_LOG_SPREADSHEET_ID || ''),
      sheetName: String(config.SHEET_IMAGE_UPLOAD_LOG || DEFAULT_CONFIG.SHEET_IMAGE_UPLOAD_LOG || '画像保存記録').trim()
    };
  },

  extractSpreadsheetId_(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const spreadsheetMatch = text.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
    if (spreadsheetMatch) return spreadsheetMatch[1];
    const idMatch = text.match(/[?&]id=([A-Za-z0-9_-]+)/);
    if (idMatch) return idMatch[1];
    return text;
  },

  ensureUploadLogHeader_(sheet) {
    const headers = ['日時', '名前', '保存先', 'folderKey', 'folderId', 'ファイル名', 'fileId', '画像URL', '元ファイル名', 'mimeType', 'sizeBytes'];
    if (sheet.getLastRow() > 0) {
      const existing = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0].join('');
      if (existing) return;
    }

    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  },

  sanitizeUploadName_(name) {
    const normalized = SiftService.normalizeCastName(name) || Utils.normalize(name);
    return Utils.stripExtension(normalized)
      .replace(/[\\/:*?"<>|#%{}^~[\]`]/g, '')
      .trim();
  },

  parseImageDataUrl_(dataUrl) {
    const match = String(dataUrl || '').match(/^data:([^;,]+);base64,(.+)$/);
    if (!match) throw new Error('画像データを読み取れません');
    return {
      mimeType: match[1],
      base64: match[2]
    };
  },

  getUploadExtension_(fileName, mimeType) {
    const nameMatch = String(fileName || '').match(/\.(jpe?g|png|webp|gif)$/i);
    if (nameMatch) return '.' + nameMatch[1].toLowerCase().replace('jpeg', 'jpg');
    const extensions = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/gif': '.gif'
    };
    return extensions[String(mimeType || '').toLowerCase()] || '.jpg';
  },

  isAllowedUploadMimeType_(mimeType) {
    return ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].indexOf(String(mimeType || '').toLowerCase()) !== -1;
  },

  getImageNameKeys_(baseName) {
    const variants = [
      baseName,
      this.normalizeImageKey_(baseName),
      this.stripImageMetaSuffix_(baseName),
      this.stripImageMetaSuffix_(this.normalizeImageKey_(baseName))
    ];
    const keys = [];

    variants.forEach(value => {
      const raw = String(value || '').trim();
      const normalized = SiftService.normalizeCastName(raw) || Utils.normalize(raw);
      [raw, normalized, this.stripImageMetaSuffix_(normalized), this.findKnownCastPrefix_(normalized)]
        .filter(Boolean)
        .forEach(key => {
          if (keys.indexOf(key) === -1) keys.push(key);
        });
    });

    return keys;
  },

  normalizeImageKey_(value) {
    return String(value || '')
      .replace(/[\u00AD\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\uFE00-\uFE0F\uFEFF]/g, '')
      .replace(/[@＠].*/, '')
      .replace(/\s+/g, '')
      .replace(/　+/g, '')
      .replace(/[_＿\-‐‑‒–—―]+$/g, '')
      .trim();
  },

  stripImageMetaSuffix_(value) {
    return String(value || '')
      .replace(/[\s　]*[\(（［\[].*?[\)）］\]]$/g, '')
      .replace(/[\s　]*[-_＿ ]*(copy|コピー)$/i, '')
      .replace(/[\s　]*[-_＿ ]*[0-9０-９]+$/g, '')
      .replace(/[_＿\-‐‑‒–—―]+$/g, '')
      .trim();
  },

  findKnownCastPrefix_(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const sortedNames = CAST_MASTER.slice().sort((a, b) => b.length - a.length);
    for (let i = 0; i < sortedNames.length; i += 1) {
      const name = sortedNames[i];
      if (text === name || text.indexOf(name) === 0) return name;
    }
    return '';
  },

  setImageMapKey_(imageMap, key, fileId) {
    if (key && !imageMap[key]) imageMap[key] = fileId;
  },

  getImageOptions(imageData, size) {
    const imageFiles = imageData && Array.isArray(imageData.imageFiles) ? imageData.imageFiles : [];
    return imageFiles
      .map(file => ({
        fileId: file.fileId,
        name: file.name,
        imageUrl: this.getThumbnailUrl(file.fileId, size || 'w120')
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  },

  isKnownImageFileId(imageData, fileId) {
    const target = String(fileId || '').trim();
    if (!target) return true;
    const imageFiles = imageData && Array.isArray(imageData.imageFiles) ? imageData.imageFiles : [];
    return imageFiles.some(file => file.fileId === target);
  },

  getImageNameForFileId(imageData, fileId) {
    const target = String(fileId || '').trim();
    if (!target) return '';
    const imageFiles = imageData && Array.isArray(imageData.imageFiles) ? imageData.imageFiles : [];
    const found = imageFiles.find(file => file.fileId === target);
    return found ? found.name : '';
  },

  findImageIdForCast_(imageMap, castName) {
    const rawName = String(castName || '').trim();
    const normalizedName = SiftService.normalizeCastName(rawName) || Utils.normalize(rawName);
    const normalizedImageKey = this.normalizeImageKey_(rawName);
    return imageMap[rawName] || imageMap[normalizedName] || imageMap[normalizedImageKey] || '';
  }
};
