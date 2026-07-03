const IMAGE_CACHE_KEY = 'SHIFT_IMAGE_MAP_V1';

const ImageService = {
  refreshCache() {
    const config = ConfigService.getConfig();
    const data = this.getDriveImagesRaw_();
    CacheService.getScriptCache().put(IMAGE_CACHE_KEY, JSON.stringify(data), Number(config.IMAGE_CACHE_SECONDS || DEFAULT_CONFIG.IMAGE_CACHE_SECONDS));
    LogService.operation('画像キャッシュ更新', '', '', '', '', 'imageCount=' + Object.keys(data.imageMap).length, '成功');
    return { success: true, imageCount: Object.keys(data.imageMap).length, hasPreparingImage: !!data.preparingImageId };
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

  getDriveImagesRaw_() {
    const config = ConfigService.getConfig();
    const folderId = config.DRIVE_IMAGE_FOLDER_ID || DEFAULT_CONFIG.DRIVE_IMAGE_FOLDER_ID;
    const files = DriveApp.getFolderById(folderId).getFiles();
    const imageMap = {};
    let preparingImageId = '';

    while (files.hasNext()) {
      const file = files.next();
      const baseName = Utils.stripExtension(file.getName()).trim();
      const normalizedName = SiftService.normalizeCastName(baseName) || Utils.normalize(baseName);
      if (baseName === '準備中' || normalizedName === '準備中') {
        preparingImageId = file.getId();
        continue;
      }

      if (baseName) imageMap[baseName] = file.getId();
      if (normalizedName && !imageMap[normalizedName]) imageMap[normalizedName] = file.getId();
    }

    return { imageMap, preparingImageId };
  },

  findImageIdForCast_(imageMap, castName) {
    const rawName = String(castName || '').trim();
    const normalizedName = SiftService.normalizeCastName(rawName) || Utils.normalize(rawName);
    return imageMap[rawName] || imageMap[normalizedName] || '';
  }
};
