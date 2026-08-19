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
    LogService.operation('画像キャッシュ更新', '', '', '', '', 'imageCount=' + imageCount + ', registryCount=' + (data.registryCount || 0) + ', folderCount=' + data.folderCount, '成功');
    return {
      success: true,
      imageCount,
      registryCount: data.registryCount || 0,
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
    if (payload && payload.__probe) {
      return { available: true, action: 'uploadImage' };
    }

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
    return this.saveUploadedImage_(target, castName, fileName, blob, {
      sourceFileName: payload.fileName || '',
      mimeType: parsed.mimeType,
      sizeBytes: bytes.length
    });
  },

  uploadImageFile(payload) {
    if (payload && payload.__probe) {
      return { available: true, action: 'uploadImageFile' };
    }

    const target = this.getUploadTarget_(payload.folderKey);
    const castName = this.sanitizeUploadName_(payload.name);
    if (!castName) throw new Error('画像名を入力してください');

    const sourceBlob = this.getUploadBlob_(payload);
    const mimeType = String(payload.mimeType || sourceBlob.getContentType() || '').toLowerCase();
    if (!this.isAllowedUploadMimeType_(mimeType)) {
      throw new Error('画像ファイルを選択してください');
    }

    const bytes = sourceBlob.getBytes();
    if (bytes.length > IMAGE_UPLOAD_MAX_BYTES) {
      throw new Error('画像サイズが大きすぎます。10MB以下にしてください');
    }

    const sourceFileName = payload.fileName || this.getBlobName_(sourceBlob);
    const extension = this.getUploadExtension_(sourceFileName, mimeType);
    const fileName = castName + extension;
    const blob = Utilities.newBlob(bytes, mimeType, fileName);
    return this.saveUploadedImage_(target, castName, fileName, blob, {
      sourceFileName,
      mimeType,
      sizeBytes: bytes.length
    });
  },

  registerImage(payload) {
    const record = this.normalizeImageRegistryPayload_(payload);
    const result = this.upsertImageRegistryRecord_(record);
    CacheService.getScriptCache().remove(IMAGE_CACHE_KEY);
    LogService.operation('画像登録', '', '', record.name, '', record.folderName + ' / ' + record.fileId, '成功');
    return Object.assign({ success: true }, result);
  },

  verifyImageUpload(payload) {
    const target = this.getUploadTarget_(payload.folderKey);
    const castName = this.sanitizeUploadName_(payload.name);
    if (!castName) throw new Error('画像名を入力してください');

    const extension = this.getUploadExtension_(payload.fileName, payload.mimeType);
    const fileName = castName + extension;
    const excluded = this.toLookup_(payload.excludeFileIds || []);
    const folder = DriveApp.getFolderById(target.folderId);
    const files = folder.getFilesByName(fileName);
    const matches = [];
    const newMatches = [];

    while (files.hasNext()) {
      const file = files.next();
      const record = {
        fileId: file.getId(),
        fileName: file.getName(),
        imageUrl: this.getThumbnailUrl(file.getId(), 'w600'),
        createdAt: Utils.formatDateTime(file.getDateCreated())
      };
      matches.push(record);
      if (!excluded[record.fileId]) newMatches.push(record);
    }

    const newest = newMatches[0] || null;
    return {
      found: !!newest,
      name: castName,
      fileName,
      folderKey: target.key,
      folderLabel: target.label,
      folderId: target.folderId,
      fileId: newest ? newest.fileId : '',
      imageUrl: newest ? newest.imageUrl : '',
      matches,
      newMatches
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
    const enableDriveScan = Utils.toBoolean(config.ENABLE_DRIVE_IMAGE_SCAN);
    const folderIds = enableDriveScan ? this.getImageFolderIds_(config) : [];
    const imageMap = {};
    const state = { preparingImageId: '', imageFiles: [], imageFileIds: {} };
    const folderErrors = [];
    const rootErrors = [];
    const seenFolders = {};
    const stats = { folderCount: 0, fileCount: 0 };
    const registryRows = this.readImageRegistryRows_(config);

    registryRows.forEach(record => {
      this.addRegisteredImage_(record, imageMap, state);
    });

    if (enableDriveScan) {
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
    }

    return {
      imageMap,
      preparingImageId: state.preparingImageId,
      imageFiles: state.imageFiles,
      registryCount: registryRows.length,
      driveScanEnabled: enableDriveScan,
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

  addRegisteredImage_(record, imageMap, state) {
    const fileId = String(record.fileId || '').trim();
    if (!fileId) return;

    const baseName = Utils.stripExtension(record.name || '').trim();
    const keys = this.getImageNameKeys_(baseName);
    if (keys.indexOf('準備中') !== -1) {
      if (!state.preparingImageId) state.preparingImageId = fileId;
      return;
    }

    if (!state.imageFileIds[fileId]) {
      state.imageFileIds[fileId] = true;
      state.imageFiles.push({
        fileId,
        name: baseName,
        fileName: record.name,
        fileUrl: record.fileUrl,
        imageUrl: record.thumbnailUrl,
        folderName: record.folderName,
        updatedAt: record.updatedAt,
        source: 'registry'
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

  saveUploadedImage_(target, castName, fileName, blob, meta) {
    const file = DriveApp.getFolderById(target.folderId).createFile(blob);
    file.setName(fileName);
    const fileId = file.getId();
    const imageUrl = this.getThumbnailUrl(fileId, 'w600');

    CacheService.getScriptCache().remove(IMAGE_CACHE_KEY);
    LogService.operation('画像追加', '', '', castName, '', target.label + ' / ' + fileName, '成功', fileId);
    this.writeImageRegistrySafely_({
      name: fileName,
      fileId,
      fileUrl: this.getDriveFileUrl_(fileId),
      thumbnailUrl: this.getThumbnailUrl(fileId, 'w1000'),
      folderName: target.label,
      updatedAt: Utils.now('yyyy/MM/dd')
    });
    const uploadLogConfig = this.getUploadLogConfig_();
    this.writeUploadLogSafely_({
      castName,
      target,
      fileName,
      fileId,
      imageUrl,
      sourceFileName: meta.sourceFileName || '',
      mimeType: meta.mimeType || '',
      sizeBytes: meta.sizeBytes || '',
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

  getUploadBlob_(payload) {
    const candidates = [payload.imageFile, payload.file, payload.uploadFile];
    for (let i = 0; i < candidates.length; i += 1) {
      const value = Array.isArray(candidates[i]) ? candidates[i][0] : candidates[i];
      if (value && typeof value.getBytes === 'function') return value;
    }
    throw new Error('画像ファイルを受信できませんでした');
  },

  getBlobName_(blob) {
    try {
      return blob.getName();
    } catch (err) {
      return '';
    }
  },

  normalizeImageRegistryPayload_(payload) {
    const name = String(payload.name || payload.fileName || '').trim();
    if (!name) throw new Error('画像名を入力してください');

    const fileId = this.extractFileId_(payload.fileId || payload.fileIdOrUrl || payload.fileUrl || payload.url || '');
    if (!fileId) throw new Error('DriveファイルIDまたはURLを入力してください');

    const folderName = this.getFolderLabel_(payload.folderKey || payload.folderName);
    return {
      name,
      fileId,
      fileUrl: String(payload.fileUrl || '').trim() || this.getDriveFileUrl_(fileId),
      thumbnailUrl: String(payload.thumbnailUrl || '').trim() || this.getThumbnailUrl(fileId, 'w1000'),
      folderName,
      updatedAt: Utils.now('yyyy/MM/dd')
    };
  },

  getFolderLabel_(value) {
    const text = String(value || '').trim();
    const key = text.toLowerCase();
    if (key === 'tokyo') return '東京';
    if (key === 'osaka') return '大阪';
    return text || '未設定';
  },

  upsertImageRegistryRecord_(record) {
    const config = ConfigService.getConfig();
    const sheet = SpreadsheetService.getOrCreateSheet(config.SHEET_IMAGE_REGISTRY || DEFAULT_CONFIG.SHEET_IMAGE_REGISTRY);
    this.ensureImageRegistryHeader_(sheet);

    const row = [
      record.name,
      record.fileId,
      record.fileUrl,
      record.thumbnailUrl,
      record.folderName,
      record.updatedAt
    ];
    const existingRow = this.findImageRegistryRow_(sheet, record.fileId);

    if (existingRow) {
      sheet.getRange(existingRow, 1, 1, IMAGE_REGISTRY_HEADERS.length).setValues([row]);
    } else {
      sheet.getRange(sheet.getLastRow() + 1, 1, 1, IMAGE_REGISTRY_HEADERS.length).setValues([row]);
    }

    return {
      name: record.name,
      fileId: record.fileId,
      fileUrl: record.fileUrl,
      thumbnailUrl: record.thumbnailUrl,
      folderName: record.folderName,
      updatedAt: record.updatedAt,
      row: existingRow || sheet.getLastRow()
    };
  },

  writeImageRegistrySafely_(record) {
    try {
      this.upsertImageRegistryRecord_(record);
    } catch (err) {
      LogService.error('ImageService.writeImageRegistry', err, { fileId: record.fileId, name: record.name });
    }
  },

  findImageRegistryRow_(sheet, fileId) {
    const target = String(fileId || '').trim();
    if (!target || sheet.getLastRow() < 2) return 0;

    const values = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getDisplayValues();
    for (let i = 0; i < values.length; i += 1) {
      if (String(values[i][0] || '').trim() === target) return i + 2;
    }
    return 0;
  },

  readImageRegistryRows_(config) {
    const sheetName = config.SHEET_IMAGE_REGISTRY || DEFAULT_CONFIG.SHEET_IMAGE_REGISTRY;
    try {
      const sheet = SpreadsheetService.getSpreadsheet().getSheetByName(sheetName);
      if (!sheet) return [];
      this.ensureImageRegistryHeader_(sheet);
      if (sheet.getLastRow() < 2) return [];

      return sheet.getRange(2, 1, sheet.getLastRow() - 1, IMAGE_REGISTRY_HEADERS.length)
        .getDisplayValues()
        .map(row => this.normalizeImageRegistryRow_(row))
        .filter(record => record.name && record.fileId);
    } catch (err) {
      LogService.error('ImageService.readImageRegistryRows', err, { sheetName });
      return [];
    }
  },

  normalizeImageRegistryRow_(row) {
    const fileId = this.extractFileId_(row[1] || row[2] || row[3] || '');
    return {
      name: String(row[0] || '').trim(),
      fileId,
      fileUrl: String(row[2] || '').trim() || (fileId ? this.getDriveFileUrl_(fileId) : ''),
      thumbnailUrl: String(row[3] || '').trim() || (fileId ? this.getThumbnailUrl(fileId, 'w1000') : ''),
      folderName: String(row[4] || '').trim(),
      updatedAt: String(row[5] || '').trim()
    };
  },

  ensureImageRegistryHeader_(sheet) {
    if (sheet.getMaxColumns() < IMAGE_REGISTRY_HEADERS.length) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), IMAGE_REGISTRY_HEADERS.length - sheet.getMaxColumns());
    }
    const current = sheet.getRange(1, 1, 1, IMAGE_REGISTRY_HEADERS.length).getDisplayValues()[0];
    const hasHeader = current.some(value => String(value || '').trim());
    if (!hasHeader) {
      sheet.getRange(1, 1, 1, IMAGE_REGISTRY_HEADERS.length).setValues([IMAGE_REGISTRY_HEADERS]);
      sheet.setFrozenRows(1);
    }
  },

  extractFileId_(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const fileMatch = text.match(/\/file\/d\/([A-Za-z0-9_-]+)/);
    if (fileMatch) return fileMatch[1];
    const idMatch = text.match(/[?&]id=([A-Za-z0-9_-]+)/);
    if (idMatch) return idMatch[1];
    const thumbnailMatch = text.match(/thumbnail\?id=([A-Za-z0-9_-]+)/);
    if (thumbnailMatch) return thumbnailMatch[1];
    const bareMatch = text.match(/^[A-Za-z0-9_-]{20,}$/);
    return bareMatch ? text : '';
  },

  getDriveFileUrl_(fileId) {
    return 'https://drive.google.com/file/d/' + encodeURIComponent(fileId) + '/view?usp=drivesdk';
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

  toLookup_(values) {
    const lookup = {};
    (Array.isArray(values) ? values : []).forEach(value => {
      const key = String(value || '').trim();
      if (key) lookup[key] = true;
    });
    return lookup;
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
        imageUrl: file.imageUrl || this.getThumbnailUrl(file.fileId, size || 'w120'),
        fileUrl: file.fileUrl || this.getDriveFileUrl_(file.fileId),
        folderName: file.folderName || '',
        source: file.source || 'drive'
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

  getImageUrlForFileId(imageData, fileId, size) {
    const target = String(fileId || '').trim();
    if (!target) return '';
    const imageFiles = imageData && Array.isArray(imageData.imageFiles) ? imageData.imageFiles : [];
    const found = imageFiles.find(file => file.fileId === target);
    return found && found.imageUrl ? found.imageUrl : this.getThumbnailUrl(target, size || 'w600');
  },

  findImageIdForCast_(imageMap, castName) {
    const rawName = String(castName || '').trim();
    const normalizedName = SiftService.normalizeCastName(rawName) || Utils.normalize(rawName);
    const normalizedImageKey = this.normalizeImageKey_(rawName);
    return imageMap[rawName] || imageMap[normalizedName] || imageMap[normalizedImageKey] || '';
  }
};
