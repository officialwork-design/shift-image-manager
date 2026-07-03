const ShiftService = {
  changeDateAndStore(store, date) {
    Utils.validateStoreAndDate(store, date);
    const selectedStore = String(store).toUpperCase();
    const config = ConfigService.getConfig();
    const parsed = SiftService.getParsedShift(selectedStore, date);
    const sheet = SpreadsheetService.getSheet(config.SHEET_IMAGE_GENERATION);
    const rowCount = SHEET_LAYOUT.CAST_END_ROW - SHEET_LAYOUT.CAST_START_ROW + 1;

    sheet.getRange(SHEET_LAYOUT.DATE_CELL).setValue(date);
    sheet.getRange(SHEET_LAYOUT.STORE_CELL).setValue(selectedStore);
    sheet.getRange(SHEET_LAYOUT.CAST_START_ROW, SHEET_LAYOUT.CAST_NAME_COLUMN, rowCount, 2).clearContent();

    if (parsed.castNames.length) {
      sheet.getRange(SHEET_LAYOUT.CAST_START_ROW, SHEET_LAYOUT.CAST_NAME_COLUMN, parsed.castNames.length, 1)
        .setValues(parsed.castNames.map(name => [name]));
    }

    LogService.operation('条件変更', selectedStore, date, '', '', 'count=' + parsed.castNames.length, '成功');
    return {
      success: true,
      store: selectedStore,
      date,
      castNames: parsed.castNames,
      count: parsed.castNames.length
    };
  },

  getImageList(store, date) {
    const config = ConfigService.getConfig();
    const sheet = SpreadsheetService.getSheet(config.SHEET_IMAGE_GENERATION);
    const selectedStore = String(store || sheet.getRange(SHEET_LAYOUT.STORE_CELL).getDisplayValue() || '').toUpperCase();
    const selectedDate = String(date || sheet.getRange(SHEET_LAYOUT.DATE_CELL).getDisplayValue() || '').trim();
    Utils.validateStoreAndDate(selectedStore, selectedDate);

    const rowCount = SHEET_LAYOUT.CAST_END_ROW - SHEET_LAYOUT.CAST_START_ROW + 1;
    const names = sheet.getRange(SHEET_LAYOUT.CAST_START_ROW, SHEET_LAYOUT.CAST_NAME_COLUMN, rowCount, 1).getDisplayValues();
    const absents = sheet.getRange(SHEET_LAYOUT.CAST_START_ROW, SHEET_LAYOUT.CAST_ABSENT_COLUMN, rowCount, 1).getDisplayValues();
    const imageData = ImageService.getDriveImagesCached();
    const imageMap = imageData.imageMap || {};
    const preparingImageId = imageData.preparingImageId || '';
    const all = [];
    const missing = [];

    names.forEach((row, index) => {
      const name = String(row[0] || '').trim();
      if (!name) return;

      const isAbsent = String(absents[index][0] || '').trim() === '休み';
      const matchedImageId = ImageService.findImageIdForCast(imageMap, name);
      const imageId = matchedImageId || preparingImageId || '';
      const usedPreparing = !matchedImageId && !!preparingImageId;
      if (!matchedImageId) missing.push(name);

      all.push({
        row: SHEET_LAYOUT.CAST_START_ROW + index,
        name,
        isAbsent,
        usedPreparing,
        imageUrl: imageId ? ImageService.getDataUrl(imageId) : ''
      });
    });

    return {
      selectedStore,
      selectedDate,
      activeCastList: all.filter(item => !item.isAbsent && item.imageUrl),
      absentCastList: all.filter(item => item.isAbsent),
      missingImages: missing,
      updatedAt: Utils.now('HH:mm:ss')
    };
  },

  setCastAbsent(row, isAbsent) {
    const config = ConfigService.getConfig();
    const sheet = SpreadsheetService.getSheet(config.SHEET_IMAGE_GENERATION);
    const targetRow = Number(row);
    if (!targetRow || targetRow < SHEET_LAYOUT.CAST_START_ROW || targetRow > SHEET_LAYOUT.CAST_END_ROW) {
      throw new Error('不正な行番号です');
    }

    const value = Utils.toBoolean(isAbsent) ? '休み' : '';
    sheet.getRange(targetRow, SHEET_LAYOUT.CAST_ABSENT_COLUMN).setValue(value);
    LogService.operation(
      '休み設定変更',
      sheet.getRange(SHEET_LAYOUT.STORE_CELL).getDisplayValue(),
      sheet.getRange(SHEET_LAYOUT.DATE_CELL).getDisplayValue(),
      sheet.getRange(targetRow, SHEET_LAYOUT.CAST_NAME_COLUMN).getDisplayValue(),
      targetRow,
      value || '出勤',
      '成功'
    );
    return { success: true };
  }
};
