const ConfigService = {
  getConfig() {
    const defaults = this.getDefaultConfig();
    const sheetConfig = this.readIdManagementConfig_(defaults);
    const merged = Object.assign({}, defaults, sheetConfig);
    // ID管理に空欄・未登録のシート名があっても既定値で動かす
    ['SHEET_SHIFT_EDIT', 'SHEET_SHIFT_EDIT_MANAGE', 'SHEET_OPERATION_LOG', 'SHEET_ERROR_LOG', 'SHEET_IMAGE_CHECK', 'SHEET_SIFT_DATA', 'SHEET_IMAGE_GENERATION']
      .forEach(key => { if (!merged[key]) merged[key] = DEFAULT_CONFIG[key]; });
    return merged;
  },

  getDefaultConfig() {
    return Object.assign({}, DEFAULT_CONFIG);
  },

  getSpreadsheetId() {
    const config = this.getConfig();
    return config.SPREADSHEET_ID || BOOTSTRAP_SPREADSHEET_ID;
  },

  // 匿名でも取得できるため、Spreadsheet ID・Script ID・Drive フォルダID・シート名は返さない（Phase 1.5）
  getPublicConfig() {
    const config = this.getConfig();
    return {
      appMode: config.APP_MODE || DEFAULT_CONFIG.APP_MODE,
      pagesUrl: config.GITHUB_PAGES_URL || '',
      stores: STORE_NAMES.slice(),
      workTimeOptions: WORK_TIME_OPTIONS.slice(),
      TIMEZONE: config.TIMEZONE || DEFAULT_CONFIG.TIMEZONE,
      APP_MODE: config.APP_MODE || DEFAULT_CONFIG.APP_MODE,
      writeApiEnabled: this.isWriteApiConfigured_()
    };
  },

  // 認証方式が設定済みか（値そのものは返さない）
  isWriteApiConfigured_() {
    try {
      return !!PropertiesService.getScriptProperties().getProperty('AUTH_MODE');
    } catch (err) {
      return false;
    }
  },

  readIdManagementConfig_(defaults) {
    const values = {};
    try {
      const spreadsheet = SpreadsheetApp.openById(defaults.SPREADSHEET_ID || BOOTSTRAP_SPREADSHEET_ID);
      const sheet = spreadsheet.getSheetByName(defaults.SHEET_ID_MANAGEMENT);
      if (!sheet || sheet.getLastRow() < 2) return values;

      const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getDisplayValues();
      rows.forEach(row => {
        const key = String(row[0] || '').trim();
        const value = String(row[1] || '').trim();
        if (key && value !== '') values[key] = value;
      });
    } catch (err) {
      return values;
    }
    return values;
  }
};
