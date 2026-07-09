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

    const sourceRows = parsed.castRows && parsed.castRows.length
      ? parsed.castRows
      : parsed.castNames.map(name => ({ castName: name, workTime: '' }));

    Logger.log('[changeDateAndStore] sourceRows.length=%s / names=%s', sourceRows.length, JSON.stringify(sourceRows.map(r => r.castName))); // 一時ログ（調査用）

    if (sourceRows.length) {
      const values = sourceRows.map((item, index) => [
        index + 1,
        item.castName,
        item.workTime || '',
        '出勤',
        ImageService.getImageStatusForCast(imageData, item.castName)
      ]);

      sheet.getRange(SHEET_LAYOUT.CAST_START_ROW, SHEET_LAYOUT.SORT_COLUMN, values.length, values[0].length).setValues(values);
    }

    const editRows = this.readEditRows_(sheet, imageData);

    LogService.operation('条件変更', selectedStore, date, '', '', 'count=' + sourceRows.length, '成功');

    return {
      success: true,
      store: selectedStore,
      date,
      castNames: sourceRows.map(row => row.castName),
      count: sourceRows.length,
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
    Logger.log('[getImageList] editRows.length=%s / names=%s', editRows.length, JSON.stringify(editRows.map(r => r.castName))); // 一時ログ（調査用）
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
        imageUrl: imageId ? ImageService.getThumbnailUrl(imageId, 'w240') : ''
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

  updateShiftRows(rows) {
    if (!Array.isArray(rows)) throw new Error('rows は配列で指定してください');

    const config = ConfigService.getConfig();
    const sheet = SpreadsheetService.getSheet(config.SHEET_IMAGE_GENERATION);
    const imageData = ImageService.getDriveImagesCached();

    const normalizedRows = rows
      .map((row, index) => this.normalizeEditableRow_(row, index + 1, imageData))
      .filter(row => row.castName)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const rowCount = SHEET_LAYOUT.CAST_END_ROW - SHEET_LAYOUT.CAST_START_ROW + 1;
    const width = SHEET_LAYOUT.IMAGE_STATUS_COLUMN - SHEET_LAYOUT.SORT_COLUMN + 1;

    sheet.getRange(SHEET_LAYOUT.CAST_START_ROW, SHEET_LAYOUT.SORT_COLUMN, rowCount, width).clearContent();

    if (normalizedRows.length) {
      const values = normalizedRows.map((row, index) => [
        index + 1,
        row.castName,
        row.workTime,
        row.status,
        row.imageStatus
      ]);

      sheet.getRange(SHEET_LAYOUT.CAST_START_ROW, SHEET_LAYOUT.SORT_COLUMN, values.length, width).setValues(values);
    }

    LogService.operation('編集テーブル保存', sheet.getRange(SHEET_LAYOUT.STORE_CELL).getDisplayValue(), sheet.getRange(SHEET_LAYOUT.DATE_CELL).getDisplayValue(), '', '', 'count=' + normalizedRows.length, '成功');

    return {
      success: true,
      count: normalizedRows.length,
      editRows: this.readEditRows_(sheet, imageData)
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

  normalizeEditableRow_(row, fallbackSortOrder, imageData) {
    const sortOrder = Number(row.sortOrder) || fallbackSortOrder;
    const castName = String(row.castName || row.name || '').trim();
    const workTime = String(row.workTime || '').trim();
    const status = String(row.status || '').trim() === '休み' ? '休み' : '出勤';

    if (workTime && WORK_TIME_OPTIONS.indexOf(workTime) === -1) {
      throw new Error('不正な出勤時間です: ' + workTime);
    }

    return {
      sortOrder,
      castName,
      workTime,
      status,
      imageStatus: ImageService.getImageStatusForCast(imageData, castName)
    };
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

        return {
          row: SHEET_LAYOUT.CAST_START_ROW + index,
          sortOrder,
          castName,
          name: castName,
          workTime: String(row[2] || '').trim(),
          status,
          imageStatus: ImageService.getImageStatusForCast(imageData, castName)
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.row - b.row);
  }
};