const IMAGE_CACHE_KEY = 'SHIFT_IMAGE_MAP_V3';
const IMAGE_FOLDER_MAX_DEPTH = 5;

const ImageService = {
  refreshCache() {
    const config = ConfigService.getConfig();
    const data = this.getDriveImagesRaw_();
    CacheService.getScriptCache().put(IMAGE_CACHE_KEY, JSON.stringify(data), Number(config.IMAGE_CACHE_SECONDS || DEFAULT_CONFIG.IMAGE_CACHE_SECONDS));
    LogService.operation('画像キャッシュ更新', '', '', '', '', 'imageCount=' + Object.keys(data.imageMap).length + ', folderCount=' + data.folderCount, '成功');
    return {
      success: true,
      imageCount: Object.keys(data.imageMap).length,
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

  checkImages() {
    const config = ConfigService.getConfig();
    const sheet = SpreadsheetService.getSheet(config.SHEET_IMAGE_GENERATION);
    const rowCount = SHEET_LAYOUT.CAST_END_ROW - SHEET_LAYOUT.CAST_START_ROW + 1;
    const names = sheet.getRange(SHEET_LAYOUT.CAST_START_ROW, SHEET_LAYOUT.CAST_NAME_COLUMN, rowCount, 1)
      .getDisplayValues()
      .map(row => String(row[0] || '').trim())
      .filter(Boolean);
    const imageData = this.getDriveImagesCached();
    const missingNames = names.filter(name => !this.findImageIdForCast_(imageData.imageMap || {}, name));

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
    const state = { preparingImageId: '' };
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
    const baseName = Utils.stripExtension(file.getName()).trim();
    const normalizedName = SiftService.normalizeCastName(baseName) || Utils.normalize(baseName);
    if (baseName === '準備中' || normalizedName === '準備中') {
      if (!state.preparingImageId) state.preparingImageId = file.getId();
      return;
    }

    if (baseName && !imageMap[baseName]) imageMap[baseName] = file.getId();
    if (normalizedName && !imageMap[normalizedName]) imageMap[normalizedName] = file.getId();
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

  findImageIdForCast_(imageMap, castName) {
    const rawName = String(castName || '').trim();
    const normalizedName = SiftService.normalizeCastName(rawName) || Utils.normalize(rawName);
    return imageMap[rawName] || imageMap[normalizedName] || '';
  }
};
