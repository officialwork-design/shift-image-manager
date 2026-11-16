/**
 * GAS WebApp 通信（Phase 1.6）
 *
 * - すべて POST（Content-Type: text/plain の JSON 本文）。プリフライトを発生させないため独自ヘッダーは付けない。
 *   GAS の doPost では HTTP ヘッダーを読めないため、ID トークンは本文の auth.idToken で送る。URL には載せない。
 * - call(action, payload)       : 認証必須 API（Auth.getToken() のトークンを付与）
 * - publicCall(action, payload) : ログイン前に使う公開 API（getPublicConfig のみ）
 * - GAS は HTTP ステータスを返せないため、アプリケーションのエラーコード（code / status）で判定する。
 */
const Api = (() => {
  let seq = 0;
  let tokenProvider = () => { throw apiError('AUTH_REQUIRED', 'ログインが必要です'); };

  function apiError(code, message, details, status) {
    const err = new Error(message || code);
    err.code = code;
    if (details) err.details = details;
    if (status) err.status = status;
    return err;
  }

  function getUrl() {
    const config = window.APP_CONFIG || {};
    if (!config.GAS_WEB_APP_URL) throw apiError('CONFIG', 'config.js の GAS_WEB_APP_URL が未設定です');
    return config.GAS_WEB_APP_URL;
  }

  function timeoutMs(options) {
    return (options && options.timeoutMs) || (window.APP_CONFIG && window.APP_CONFIG.API_TIMEOUT_MS) || 60000;
  }

  async function post(body, options) {
    const url = getUrl();
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => controller && controller.abort(), timeoutMs(options));
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
        redirect: 'follow',
        credentials: 'omit',      // Google の Cookie は送らない（本人確認は ID トークンのみ）
        cache: 'no-store',
        signal: controller ? controller.signal : undefined
      });
    } catch (err) {
      if (err && err.name === 'AbortError') {
        throw apiError('TIMEOUT', '通信がタイムアウトしました。保存操作の場合は、保存されたか最新データを確認してください');
      }
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
    if (!data || !data.success) {
      const error = (data && data.error) || {};
      throw apiError(error.code || (data && data.code) || 'API_ERROR', (data && data.message) || error.message || 'API error', error.details, data && data.status);
    }
    return data.data;
  }

  async function call(action, payload = {}, options = {}) {
    const idToken = tokenProvider();   // 未ログイン・期限切れはここで例外（送信しない）
    return post({ action, payload, auth: { idToken }, requestId: options.requestId || '' }, options);
  }

  function publicCall(action, payload = {}, options = {}) {
    return post({ action, payload }, options);
  }

  function setTokenProvider(fn) {
    tokenProvider = fn;
  }

  function newRequestId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return `req-${Date.now()}-${Math.random().toString(36).slice(2)}-${seq++}`;
  }

  // Phase 1.5 互換の名前（すべて認証付き POST）
  return { call, publicCall, write: call, read: call, setTokenProvider, newRequestId };
})();
