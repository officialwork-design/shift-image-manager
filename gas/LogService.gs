const LogService = {
  operation(actionType, store, date, castName, row, value, result, detail) {
    try {
      const config = ConfigService.getConfig();
      SpreadsheetService.appendRows(config.SHEET_OPERATION_LOG, [[
        Utils.now(),
        actionType || '',
        store || '',
        date || '',
        castName || '',
        row || '',
        value || '',
        '',
        '',
        result || '',
        detail || ''
      ]]);
    } catch (err) {
      // Logging must never break the user-facing API.
    }
  },

  error(action, err, payload) {
    try {
      const config = ConfigService.getConfig();
      SpreadsheetService.appendRows(config.SHEET_ERROR_LOG, [[
        Utils.now(),
        action || '',
        Utils.errorMessage(err),
        err && err.stack ? err.stack : '',
        JSON.stringify(payload || {}),
        ''
      ]]);
    } catch (e) {
      // Error logging also needs to be best-effort.
    }
  }
};
