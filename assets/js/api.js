/**
 * GAS WebApp 通信
 *  - read(action, payload)  : 読み取り API。JSONP(GET)。認証情報は送らない。
 *  - write(action, payload) : 更新 API。POST のみ。認証情報は authProvider から取得して本文で送る。
 *    認証方式は設計承認待ちのため、authProvider は未設定（null を返す）。サーバーは AUTH_NOT_CONFIGURED で拒否する。
 */
const Api = (() => {
  let seq = 0;
  let authProvider = async () => null;
  const WRITE_TIMEOUT_MS = 60000;

  function apiError(code, message, details) {
    const err = new Error(message || code);
    err.code = code;
    if (details) err.details = details;
    return err;
  }

  function getUrl() {
    const config = window.APP_CONFIG || {};
    if (!config.GAS_WEB_APP_URL) throw apiError('CONFIG', 'config.js の GAS_WEB_APP_URL が未設定です');
    return config.GAS_WEB_APP_URL;
  }

  function fromResponse(data) {
    if (!data || !data.success) {
      const error = (data && data.error) || {};
      throw apiError(error.code || (data && data.code) || 'API_ERROR', (data && data.message) || error.message || 'API error', error.details);
    }
    return data.data;
  }

  // ===== 読み取り =====
  function read(action, payload = {}) {
    let url;
    try { url = getUrl(); } catch (err) { return Promise.reject(err); }
    return jsonpRequestScript(url, action, payload).catch((err) => {
      if (err && err.message === 'API script load error') {
        return getRequest(url, action, payload).catch((fallbackErr) => {
          const message = fallbackErr && fallbackErr.message ? fallbackErr.message : '';
          if (message === 'Failed to fetch' || message === 'Load failed') throw err;
          throw fallbackErr;
        });
      }
      throw err;
    });
  }

  function jsonpRequestScript(url, action, payload) {
    return new Promise((resolve, reject) => {
      const callbackName = `__shiftApiCallback_${Date.now()}_${seq++}`;
      const script = document.createElement('script');
      const timer = setTimeout(() => cleanup(apiError('TIMEOUT', 'API timeout')), 60000);

      window[callbackName] = (data) => {
        try { cleanup(null, fromResponse(data)); } catch (err) { cleanup(err); }
      };

      function cleanup(err, data) {
        clearTimeout(timer);
        delete window[callbackName];
        if (script.parentNode) script.parentNode.removeChild(script);
        if (err) reject(err); else resolve(data);
      }

      const params = new URLSearchParams({ action, payload: JSON.stringify(payload), callback: callbackName });
      script.onerror = () => cleanup(new Error('API script load error'));
      script.src = `${url}?${params.toString()}`;
      document.body.appendChild(script);
    });
  }

  async function getRequest(url, action, payload) {
    const callbackName = `__shiftFetchCallback_${Date.now()}_${seq++}`;
    const params = new URLSearchParams({ action, payload: JSON.stringify(payload), callback: callbackName });
    const res = await fetch(`${url}?${params.toString()}`);
    const text = await res.text();
    if (/^\s*</.test(text)) throw new Error('API script load error');
    const prefix = `${callbackName}(`;
    const suffix = ');';
    const trimmed = text.trim();
    const jsonText = trimmed.indexOf(prefix) === 0 && trimmed.slice(-suffix.length) === suffix
      ? trimmed.slice(prefix.length, -suffix.length)
      : trimmed;
    return fromResponse(JSON.parse(jsonText));
  }

  // ===== 更新（POST のみ） =====
  async function write(action, payload = {}, options = {}) {
    const url = getUrl();
    const auth = await authProvider();
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => controller && controller.abort(), options.timeoutMs || WRITE_TIMEOUT_MS);
    let res;
    try {
      // text/plain はプリフライト不要の単純リクエスト。GAS は応答を googleusercontent.com 経由で返す。
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, payload, auth, requestId: options.requestId || '' }),
        redirect: 'follow',
        signal: controller ? controller.signal : undefined
      });
    } catch (err) {
      if (err && err.name === 'AbortError') throw apiError('TIMEOUT', '保存処理がタイムアウトしました。保存されたか最新データを確認してください');
      throw apiError('NETWORK', '通信に失敗しました: ' + (err && err.message ? err.message : err));
    } finally {
      clearTimeout(timer);
    }
    let data;
    try {
      data = await res.json();
    } catch (err) {
      throw apiError('NETWORK', 'サーバーの応答を読み取れませんでした（HTTP ' + res.status + '）');
    }
    return fromResponse(data);
  }

  // 認証方式の承認後に設定する（例: Google ID トークンを返す関数）
  function setAuthProvider(fn) {
    authProvider = typeof fn === 'function' ? fn : async () => null;
  }

  function newRequestId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return `req-${Date.now()}-${Math.random().toString(36).slice(2)}-${seq++}`;
  }

  // 旧呼び出し互換（読み取りのみ）
  function request(action, payload = {}) {
    return read(action, payload);
  }

  return { read, write, request, setAuthProvider, newRequestId };
})();
