const Utils = {
  successResponse(data, elapsedMs) {
    return {
      success: true,
      data,
      error: null,
      elapsedMs,
      timestamp: this.now()
    };
  },

  errorResponse(err, action, elapsedMs) {
    const message = this.errorMessage(err);
    return {
      success: false,
      data: null,
      message,
      error: {
        message,
        action: action || ''
      },
      elapsedMs,
      timestamp: this.now()
    };
  },

  output(obj, callback) {
    const json = JSON.stringify(obj);
    const callbackName = this.getJsonpCallback(callback);
    const body = callbackName ? callbackName + '(' + json + ');' : json;
    const mimeType = callbackName ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON;
    return ContentService.createTextOutput(body).setMimeType(mimeType);
  },

  getJsonpCallback(callback) {
    const name = String(callback || '').trim();
    if (!name) return '';
    return /^[A-Za-z_$][0-9A-Za-z_$]*(\.[A-Za-z_$][0-9A-Za-z_$]*)*$/.test(name) ? name : '';
  },

  now(pattern) {
    return Utilities.formatDate(new Date(), this.getTimezone_(), pattern || 'yyyy/MM/dd HH:mm:ss');
  },

  getTimezone_() {
    try {
      return ConfigService.getConfig().TIMEZONE || DEFAULT_CONFIG.TIMEZONE;
    } catch (err) {
      return DEFAULT_CONFIG.TIMEZONE;
    }
  },

  validateStoreAndDate(store, date) {
    if (!store) throw new Error('店舗が未指定です');
    if (!date) throw new Error('日付が未指定です');
    if (STORE_NAMES.indexOf(String(store).toUpperCase()) === -1) {
      throw new Error('店舗は KABUKI または AKIBA を指定してください');
    }
  },

  columnToLetter(column) {
    let current = Number(column);
    let letter = '';
    while (current > 0) {
      const temp = (current - 1) % 26;
      letter = String.fromCharCode(temp + 65) + letter;
      current = (current - temp - 1) / 26;
    }
    return letter;
  },

  parseDate(text) {
    const match = String(text || '').match(/(\d+)月(\d+)日/);
    if (!match) return 0;
    return Number(match[1]) * 100 + Number(match[2]);
  },

  normalize(value) {
    return String(value || '').replace(/\s+/g, '').replace(/　+/g, '').trim();
  },

  stripExtension(fileName) {
    return String(fileName || '').replace(/\.[^/.]+$/, '');
  },

  toBoolean(value) {
    if (value === true) return true;
    if (value === false || value == null) return false;
    return ['true', '1', 'yes', '休み'].indexOf(String(value).toLowerCase()) !== -1;
  },

  parseJson(text, fallback) {
    if (!text) return fallback;
    return JSON.parse(text);
  },

  errorMessage(err) {
    return err && err.message ? err.message : String(err);
  }
};
