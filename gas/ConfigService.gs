const ConfigService = {
  getConfig() {
    const defaults = this.getDefaultConfig();
    const sheetConfig = this.readIdManagementConfig_(defaults);
    return Object.assign({}, defaults, sheetConfig);
  },

  getDefaultConfig() {
    return Object.assign({}, DEFAULT_CONFIG);
  },

  getSpreadsheetId() {
    const config = this.getConfig();
    return config.SPREADSHEET_ID || BOOTSTRAP_SPREADSHEET_ID;
  },

  getPublicConfig() {
    const config = this.getConfig();
    return {
      appMode: config.APP_MODE || DEFAULT_CONFIG.APP_MODE,
      pagesUrl: config.GITHUB_PAGES_URL || '',
      stores: STORE_NAMES.slice(),
      GAS_WEB_APP_URL: config.GAS_WEB_APP_URL || '',
      GITHUB_REPOSITORY: config.GITHUB_REPOSITORY || '',
      GITHUB_PAGES_URL: config.GITHUB_PAGES_URL || '',
      SPREADSHEET_ID: config.SPREADSHEET_ID || '',
      SCRIPT_ID: config.SCRIPT_ID || '',
      DRIVE_IMAGE_FOLDER_ID: config.DRIVE_IMAGE_FOLDER_ID || '',
      SHEET_IMAGE_GENERATION: config.SHEET_IMAGE_GENERATION || DEFAULT_CONFIG.SHEET_IMAGE_GENERATION,
      SHEET_SIFT_DATA: config.SHEET_SIFT_DATA || DEFAULT_CONFIG.SHEET_SIFT_DATA,
      SHEET_OPERATION_LOG: config.SHEET_OPERATION_LOG || DEFAULT_CONFIG.SHEET_OPERATION_LOG,
      SHEET_IMAGE_CHECK: config.SHEET_IMAGE_CHECK || DEFAULT_CONFIG.SHEET_IMAGE_CHECK,
      SHEET_ERROR_LOG: config.SHEET_ERROR_LOG || DEFAULT_CONFIG.SHEET_ERROR_LOG,
      TIMEZONE: config.TIMEZONE || DEFAULT_CONFIG.TIMEZONE,
      APP_MODE: config.APP_MODE || DEFAULT_CONFIG.APP_MODE
    };
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
