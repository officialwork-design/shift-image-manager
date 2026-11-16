// ログに実値を出さないキー（認証情報・トークン）
const LOG_REDACT_KEYS = ['auth', 'idtoken', 'id_token', 'token', 'accesstoken', 'access_token', 'authorization', 'credential', 'password', 'secret'];

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

  /**
   * Phase 1.5 監査ログ（画像操作ログシート。列構成は既存のまま）
   * userId 列 = サーバー側で検証済みの利用者、詳細列 = revision などの JSON
   */
  // 監査ログの実行者表示用にメールアドレスを短縮する（例: ab***@example.com）
  maskEmail(email) {
    const text = String(email || '');
    const at = text.indexOf('@');
    if (at < 1) return text ? '***' : '';
    return text.slice(0, Math.min(2, at)) + '***' + text.slice(at);
  },

  audit(entry) {
    try {
      const e = entry || {};
      const config = ConfigService.getConfig();
      const detail = Object.assign({ revision: e.revision === undefined ? '' : e.revision }, e.code ? { code: e.code } : {});
      if (e.detail) detail.detail = e.detail;
      SpreadsheetService.appendRows(config.SHEET_OPERATION_LOG, [[
        Utils.now(),
        e.action || '',
        e.store || '',
        e.date || '',
        e.castName || '',
        '',
        e.value || '',
        e.user || '',
        e.userLabel ? this.maskEmail(e.userLabel) : '',
        e.result || '',
        JSON.stringify(detail)
      ]]);
    } catch (err) {
      // best-effort
    }
  },

  error(action, err, payload) {
    try {
      const config = ConfigService.getConfig();
      SpreadsheetService.appendRows(config.SHEET_ERROR_LOG, [[
        Utils.now(),
        action || '',
        (err && err.code ? '[' + err.code + '] ' : '') + Utils.errorMessage(err),
        err && err.stack ? err.stack : '',
        JSON.stringify(this.redact(payload || {})),
        ''
      ]]);
    } catch (e) {
      // Error logging also needs to be best-effort.
    }
  },

  // ネストしたオブジェクト・JSON文字列内の認証情報を伏字にする
  redact(value, depth) {
    const level = depth || 0;
    if (level > 6) return '[depth]';
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if ((trimmed[0] === '{' || trimmed[0] === '[') && trimmed.length < 200000) {
        try { return JSON.stringify(this.redact(JSON.parse(trimmed), level + 1)); } catch (err) { return value; }
      }
      return value;
    }
    if (Array.isArray(value)) return value.map(v => this.redact(v, level + 1));
    if (value && typeof value === 'object') {
      const out = {};
      Object.keys(value).forEach(key => {
        out[key] = LOG_REDACT_KEYS.indexOf(String(key).toLowerCase()) !== -1 ? '[REDACTED]' : this.redact(value[key], level + 1);
      });
      return out;
    }
    return value;
  }
};
