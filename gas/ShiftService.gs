const ShiftService = {
  changeDateAndStore(store, date) {
    Utils.validateStoreAndDate(store, date);
    const selectedStore = String(store).toUpperCase();
    const config = ConfigService.getConfig();
    const parsed = SiftService.getParsedShift(selectedStore, date);
    const sheet = SpreadsheetService.getSheet(config.SHEET_IMAGE_GENERATION);
    const imageData = ImageService.getDriveImagesCached();
    const rowCount = SHEET_LAYOUT.CAST_END_ROW - SHEET_LAYOUT.CAST_START_ROW + 1;
    const width = SHEET_LAYOUT.IMAGE_STATUS_COLUMN - SHEET_LAYOUT.SORT_COLUMN + 1;

    sheet.getRange(SHEET_LAYOUT.DATE_CELL).setValue(date);
    sheet.getRange(SHEET_LAYOUT.STORE_CELL).setValue(selectedStore);
    sheet.getRange(SHEET_LAYOUT.CAST_START_ROW, SHEET_LAYOUT.SORT_COLUMN, rowCount, width).clearContent();

    if (parsed.castNames.length) {
      const values = parsed.castNames.map((name, index) => [
        index + 1,
        name,
        '',
        '出勤',
        ImageService.getImageStatusForCast(imageData, name)
      ]);
      sheet.getRange(SHEET_LAYOUT.CAST_START_ROW, SHEET_LAYOUT.SORT_COLUMN, values.length, values[0].length).setValues(values);
    }

    const editRows = this.readEditRows_(sheet, imageData);
    LogService.operation('条件変更', selectedStore, date, '', '', 'count=' + parsed.castNames.length, '成功');
    return {
      success: true,
      store: selectedStore,
      date,
      castNames: parsed.castNames,
      count: parsed.castNames.length,
      editRows
    };
  },

  getImageList(store, date) {
    const config = ConfigService.getConfig();
    const sheet = SpreadsheetService.getSheet(config.SHEET_IMAGE_GENERATION);
    const selectedStore = String(store || sheet.getRange(SHEET_LAYOUT.STORE_CELL).getDisplayValue() || '').toUpperCase();
    const selectedDate = String(date || sheet.getRange(SHEET_LAYOUT.DATE_CELL).getDisplayValue() || '').trim();
    Utils.validateStoreAndDate(selectedStore, selectedDate);

    const imageData = ImageService.getDriveImagesCached();
    const imageMap = imageData.imageMap || {};
    const preparingImageId = imageData.preparingImageId || '';
    const editRows = this.readEditRows_(sheet, imageData);
    const activeCastList = [];
    const absentCastList = [];
    const missing = [];

    editRows.forEach(item => {
      const matchedImageId = ImageService.findImageIdForCast(imageMap, item.castName);
      const imageId = matchedImageId || preparingImageId || '';
      const usedPreparing = !matchedImageId && !!preparingImageId;
      if (!matchedImageId) missing.push(item.castName);

      const viewRow = Object.assign({}, item, {
        name: item.castName,
        isAbsent: item.status === '休み',
        usedPreparing,
        imageUrl: imageId ? ImageService.getThumbnailUrl(imageId) : ''
      });

      if (viewRow.isAbsent) absentCastList.push(viewRow);
      else if (viewRow.imageUrl) activeCastList.push(viewRow);
    });

    return {
      selectedStore,
      selectedDate,
      activeCastList,
      absentCastList,
      editRows,
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

    const value = Utils.toBoolean(isAbsent) ? '休み' : '出勤';
    sheet.getRange(targetRow, SHEET_LAYOUT.STATUS_COLUMN).setValue(value);
    LogService.operation(
      '休み設定変更',
      sheet.getRange(SHEET_LAYOUT.STORE_CELL).getDisplayValue(),
      sheet.getRange(SHEET_LAYOUT.DATE_CELL).getDisplayValue(),
      sheet.getRange(targetRow, SHEET_LAYOUT.CAST_NAME_COLUMN).getDisplayValue(),
      targetRow,
      value,
      '成功'
    );
    return { success: true };
  },

  readEditRows_(sheet, imageData) {
    const rowCount = SHEET_LAYOUT.CAST_END_ROW - SHEET_LAYOUT.CAST_START_ROW + 1;
    const width = SHEET_LAYOUT.IMAGE_STATUS_COLUMN - SHEET_LAYOUT.SORT_COLUMN + 1;
    const values = sheet.getRange(SHEET_LAYOUT.CAST_START_ROW, SHEET_LAYOUT.SORT_COLUMN, rowCount, width).getDisplayValues();

    return values
      .map((row, index) => {
        const sortOrder = Number(row[0]) || index + 1;
        const castName = String(row[1] || '').trim();
        if (!castName) return null;
        const status = String(row[3] || '').trim() === '休み' ? '休み' : '出勤';
        const imageStatus = ImageService.getImageStatusForCast(imageData, castName);
        return {
          row: SHEET_LAYOUT.CAST_START_ROW + index,
          sortOrder,
          castName,
          name: castName,
          workTime: String(row[2] || '').trim(),
          status,
          imageStatus
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.row - b.row);
  }
};
