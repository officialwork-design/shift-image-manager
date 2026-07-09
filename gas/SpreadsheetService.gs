const SpreadsheetService = {
  getSpreadsheet() {
    return SpreadsheetApp.openById(ConfigService.getSpreadsheetId());
  },

  getSheet(name) {
    const sheet = this.getSpreadsheet().getSheetByName(name);
    if (!sheet) throw new Error(name + ' シートが見つかりません');
    return sheet;
  },

  getOrCreateSheet(name) {
    const spreadsheet = this.getSpreadsheet();
    return spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
  },

  getDisplayValues(sheetName, rangeA1) {
    return this.getSheet(sheetName).getRange(rangeA1).getDisplayValues();
  },

  clearRange(sheetName, rangeA1) {
    this.getSheet(sheetName).getRange(rangeA1).clearContent();
  },

  setValues(sheetName, row, column, values) {
    if (!values || !values.length) return;
    this.getSheet(sheetName).getRange(row, column, values.length, values[0].length).setValues(values);
  },

  appendRows(sheetName, rows) {
    if (!rows || !rows.length) return;
    const sheet = this.getOrCreateSheet(sheetName);
    const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
    const normalizedRows = rows.map(row => {
      const copy = row.slice();
      while (copy.length < width) copy.push('');
      return copy;
    });
    sheet.getRange(sheet.getLastRow() + 1, 1, normalizedRows.length, width).setValues(normalizedRows);
  },

  ensureInitialSheets() {
    const config = ConfigService.getConfig();
    const spreadsheet = this.getSpreadsheet();
    const createdSheets = [];

    this.ensureIdManagementSheet_(spreadsheet, config, createdSheets);
    this.ensureSpecificationSheet_(spreadsheet, config, createdSheets);
    this.ensureImageGenerationSheet_(spreadsheet, config, createdSheets);
    this.ensureSiftDataSheet_(spreadsheet, config, createdSheets);
    this.ensureOperationLogSheet_(spreadsheet, config, createdSheets);
    this.ensureImageCheckSheet_(spreadsheet, config, createdSheets);
    this.ensureErrorLogSheet_(spreadsheet, config, createdSheets);

    return {
      success: true,
      spreadsheetId: spreadsheet.getId(),
      createdSheets,
      checkedSheets: [
        config.SHEET_ID_MANAGEMENT,
        config.SHEET_SPECIFICATION,
        config.SHEET_IMAGE_GENERATION,
        config.SHEET_SIFT_DATA,
        config.SHEET_OPERATION_LOG,
        config.SHEET_IMAGE_CHECK,
        config.SHEET_ERROR_LOG
      ].filter(Boolean)
    };
  },

  ensureSheet_(spreadsheet, name, createdSheets) {
    let sheet = spreadsheet.getSheetByName(name);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(name);
      createdSheets.push(name);
    }
    return sheet;
  },

  ensureSheetSize_(sheet, minRows, minColumns) {
    if (sheet.getMaxRows() < minRows) sheet.insertRowsAfter(sheet.getMaxRows(), minRows - sheet.getMaxRows());
    if (sheet.getMaxColumns() < minColumns) sheet.insertColumnsAfter(sheet.getMaxColumns(), minColumns - sheet.getMaxColumns());
  },

  ensureHeaders_(sheet, headers) {
    this.ensureSheetSize_(sheet, 1, headers.length);
    const current = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
    const hasHeader = current.some(value => String(value || '').trim());
    if (!hasHeader) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
    }
  },

  ensureIdManagementSheet_(spreadsheet, config, createdSheets) {
    const sheet = this.ensureSheet_(spreadsheet, config.SHEET_ID_MANAGEMENT, createdSheets);
    const headers = ['key', 'value', 'type', 'description', 'editable', 'updatedAt', 'memo'];
    this.ensureHeaders_(sheet, headers);
    this.appendMissingConfigRows_(sheet, this.getDefaultConfigRows_(config));
  },

  ensureSpecificationSheet_(spreadsheet, config, createdSheets) {
    if (!config.SHEET_SPECIFICATION) return;
    const sheet = this.ensureSheet_(spreadsheet, config.SHEET_SPECIFICATION, createdSheets);
    this.ensureHeaders_(sheet, ['章', '項目', '内容']);
  },

  ensureImageGenerationSheet_(spreadsheet, config, createdSheets) {
    const sheet = this.ensureSheet_(spreadsheet, config.SHEET_IMAGE_GENERATION, createdSheets);
    this.ensureSheetSize_(sheet, SHEET_LAYOUT.CAST_END_ROW, SHEET_LAYOUT.IMAGE_STATUS_COLUMN);
  },

  ensureSiftDataSheet_(spreadsheet, config, createdSheets) {
    const sheet = this.ensureSheet_(spreadsheet, config.SHEET_SIFT_DATA, createdSheets);
    this.ensureSheetSize_(sheet, 2, 1);
  },

  ensureOperationLogSheet_(spreadsheet, config, createdSheets) {
    const sheet = this.ensureSheet_(spreadsheet, config.SHEET_OPERATION_LOG, createdSheets);
    this.ensureHeaders_(sheet, ['日時', '操作種別', '店舗', '日付', 'キャスト名', '行番号', '操作値', 'userId', 'displayName', '結果', '詳細']);
  },

  ensureImageCheckSheet_(spreadsheet, config, createdSheets) {
    const sheet = this.ensureSheet_(spreadsheet, config.SHEET_IMAGE_CHECK, createdSheets);
    this.ensureHeaders_(sheet, ['日時', '種別', 'キャスト名', '詳細']);
  },

  ensureErrorLogSheet_(spreadsheet, config, createdSheets) {
    const sheet = this.ensureSheet_(spreadsheet, config.SHEET_ERROR_LOG, createdSheets);
    this.ensureHeaders_(sheet, ['日時', 'action', 'message', 'stack', 'payload', 'userAgent']);
  },

  appendMissingConfigRows_(sheet, rows) {
    const lastRow = sheet.getLastRow();
    const existingKeys = {};
    if (lastRow >= 2) {
      sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues().forEach(row => {
        const key = String(row[0] || '').trim();
        if (key) existingKeys[key] = true;
      });
    }

    const missingRows = rows.filter(row => !existingKeys[row[0]]);
    if (missingRows.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, missingRows.length, rows[0].length).setValues(missingRows);
    }
  },

  getDefaultConfigRows_(config) {
    const now = Utils.now();
    return [
      ['GAS_WEB_APP_URL', config.GAS_WEB_APP_URL || '', 'url', 'GAS WebApp URL', 'true', now, 'デプロイ後に入力'],
      ['GITHUB_REPOSITORY', config.GITHUB_REPOSITORY || '', 'url', 'GitHub repository', 'false', now, ''],
      ['GITHUB_PAGES_URL', config.GITHUB_PAGES_URL || '', 'url', 'GitHub Pages URL', 'false', now, ''],
      ['SPREADSHEET_ID', config.SPREADSHEET_ID || BOOTSTRAP_SPREADSHEET_ID, 'id', 'Spreadsheet ID', 'false', now, ''],
      ['SCRIPT_ID', config.SCRIPT_ID || SCRIPT_ID, 'id', 'Apps Script ID', 'false', now, ''],
      ['DRIVE_IMAGE_FOLDER_ID', config.DRIVE_IMAGE_FOLDER_ID || '', 'id', '画像取得フォルダ', 'true', now, ''],
      ['DRIVE_OUTPUT_FOLDER_ID', config.DRIVE_OUTPUT_FOLDER_ID || '', 'id', '出力フォルダ', 'true', now, '現時点では未使用'],
      ['SHEET_ID_MANAGEMENT', config.SHEET_ID_MANAGEMENT || DEFAULT_CONFIG.SHEET_ID_MANAGEMENT, 'sheet', 'ID管理シート名', 'false', now, ''],
      ['SHEET_SPECIFICATION', config.SHEET_SPECIFICATION || DEFAULT_CONFIG.SHEET_SPECIFICATION, 'sheet', '仕様書シート名', 'false', now, ''],
      ['SHEET_IMAGE_GENERATION', config.SHEET_IMAGE_GENERATION || DEFAULT_CONFIG.SHEET_IMAGE_GENERATION, 'sheet', '画像生成シート名', 'false', now, ''],
      ['SHEET_SIFT_DATA', config.SHEET_SIFT_DATA || DEFAULT_CONFIG.SHEET_SIFT_DATA, 'sheet', 'SIFT_DATAシート名', 'false', now, ''],
      ['SHEET_OPERATION_LOG', config.SHEET_OPERATION_LOG || DEFAULT_CONFIG.SHEET_OPERATION_LOG, 'sheet', '操作ログシート名', 'false', now, ''],
      ['SHEET_IMAGE_CHECK', config.SHEET_IMAGE_CHECK || DEFAULT_CONFIG.SHEET_IMAGE_CHECK, 'sheet', '画像チェックシート名', 'false', now, ''],
      ['SHEET_ERROR_LOG', config.SHEET_ERROR_LOG || DEFAULT_CONFIG.SHEET_ERROR_LOG, 'sheet', 'エラーログシート名', 'false', now, ''],
      ['TIMEZONE', config.TIMEZONE || DEFAULT_CONFIG.TIMEZONE, 'text', 'タイムゾーン', 'false', now, ''],
      ['APP_MODE', config.APP_MODE || DEFAULT_CONFIG.APP_MODE, 'text', '動作モード', 'true', now, '']
    ];
  }
};
