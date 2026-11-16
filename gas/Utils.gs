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
    const code = err && err.code ? err.code : 'INTERNAL_ERROR';
    return {
      success: false,
      data: null,
      message,
      code,
      // GAS WebApp は HTTP ステータスを指定できないため、相当する値をアプリケーションレベルで返す
      status: this.statusForCode(code),
      error: {
        code,
        message,
        action: action || '',
        details: err && err.details ? err.details : null
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

  statusForCode(code) {
    const map = {
      AUTH_REQUIRED: 401, AUTH_INVALID: 401, AUTH_EXPIRED: 401,
      FORBIDDEN: 403, ACCESS_LIST_EMPTY: 403, ACCESS_LIST_NOT_CONFIGURED: 403, ACCESS_LIST_INVALID: 403, ACCESS_LIST_UNAVAILABLE: 503,
      METHOD_NOT_ALLOWED: 405, LEGACY_API_REMOVED: 410, UNKNOWN_ACTION: 404,
      REVISION_CONFLICT: 409, LOCK_TIMEOUT: 423,
      AUTH_NOT_CONFIGURED: 503, AUTH_KEYS_UNAVAILABLE: 503,
      INTERNAL_ERROR: 500, WRITE_VERIFY_FAILED: 500, DATA_INCONSISTENT: 500
    };
    return map[code] || 400;
  },

  // ===== Phase 1.5: エラーコード付き例外 =====
  apiError(code, message, details) {
    const err = new Error(message || code);
    err.code = code;
    if (details) err.details = details;
    return err;
  },

  // 店舗は KABUKI / AKIBA の完全一致のみ（前後空白は除去）。それ以外は拒否する。
  requireStore(store) {
    const value = String(store == null ? '' : store).trim();
    if (!value) throw this.apiError('INVALID_STORE', '店舗が未指定です');
    if (STORE_NAMES.indexOf(value) === -1) {
      throw this.apiError('INVALID_STORE', '店舗は KABUKI または AKIBA を指定してください: ' + value);
    }
    return value;
  },

  // 内部日付は YYYY-MM-DD のみ受け付ける（年省略・存在しない日付は拒否）
  requireIsoDate(date) {
    const value = String(date == null ? '' : date).trim();
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) throw this.apiError('INVALID_DATE', '日付は YYYY-MM-DD 形式で指定してください: ' + value);
    const y = Number(match[1]);
    const m = Number(match[2]);
    const d = Number(match[3]);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
      throw this.apiError('INVALID_DATE', '存在しない日付です: ' + value);
    }
    return value;
  },

  requireStoreAndIsoDate(store, date) {
    return { store: this.requireStore(store), date: this.requireIsoDate(date) };
  },

  shiftKey(store, date) {
    return store + ':' + date;
  },

  // YYYY-MM-DD → 「M月D日(曜)」（SIFT_DATA と同じ表示形式）
  isoToLabel(iso) {
    const value = this.requireIsoDate(iso);
    const parts = value.split('-').map(Number);
    const weekday = ['日', '月', '火', '水', '木', '金', '土'][new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay()];
    return parts[1] + '月' + parts[2] + '日(' + weekday + ')';
  },

  todayIso() {
    return Utilities.formatDate(new Date(), this.getTimezone_(), 'yyyy-MM-dd');
  },

  // 「M月D日(曜)」→ YYYY-MM-DD
  // 年は推測で決めず、(1) 今日±windowDays 以内 かつ (2) 曜日が一致 する候補が「ちょうど1つ」の場合のみ確定する。
  // 候補なし・複数・曜日なしは AMBIGUOUS_DATE / INVALID_DATE として拒否する。
  resolveLabelToIso(label, todayIso, windowDays) {
    const text = String(label || '').trim();
    const match = text.match(/^(\d{1,2})月(\d{1,2})日\(([日月火水木金土])\)$/);
    if (!match) throw this.apiError('INVALID_DATE', '日付表記を解釈できません: ' + text);
    const month = Number(match[1]);
    const day = Number(match[2]);
    const weekday = ['日', '月', '火', '水', '木', '金', '土'].indexOf(match[3]);
    const today = this.requireIsoDate(todayIso || this.todayIso()).split('-').map(Number);
    const todayMs = Date.UTC(today[0], today[1] - 1, today[2]);
    const window = Number(windowDays || SHIFT_STORAGE.DATE_RESOLVE_WINDOW_DAYS) * 86400000;
    const candidates = [];

    [today[0] - 1, today[0], today[0] + 1].forEach(year => {
      const dt = new Date(Date.UTC(year, month - 1, day));
      if (dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return;
      if (dt.getUTCDay() !== weekday) return;
      if (Math.abs(dt.getTime() - todayMs) > window) return;
      candidates.push(year + '-' + ('0' + month).slice(-2) + '-' + ('0' + day).slice(-2));
    });

    if (candidates.length !== 1) {
      throw this.apiError('AMBIGUOUS_DATE', '年を確定できない日付です: ' + text, { candidates });
    }
    return candidates[0];
  },

  uuid() {
    return Utilities.getUuid();
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
