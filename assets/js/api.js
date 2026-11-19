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
      // fetch の TypeError は「通信できない」か「CORS で応答を読めない」のどちらか（ブラウザは区別できない）
      throw apiError('NETWORK', '通信に失敗しました（ネットワーク、または CORS により応答を読めません）: ' + (err && err.message ? err.message : err));
    } finally {
      clearTimeout(timer);
    }
    return parseResponse(res);
  }

  // 応答の検証。成功／失敗の判定は JSON 本文の success で行い、読めない応答は成功扱いにしない
  async function parseResponse(res) {
    if (!res || res.type === 'opaque' || res.type === 'opaqueredirect') {
      throw apiError('INVALID_RESPONSE', 'サーバーの応答を読み取れません（不透明レスポンス）');
    }
    const text = await res.text();
    if (/^\s*</.test(text)) {
      // GAS がログイン画面やエラーページ（HTML）を返した：デプロイのアクセス設定・URL の誤り
      throw apiError('GAS_HTML_RESPONSE', 'サーバーが JSON ではなく HTML を返しました（HTTP ' + res.status + '）。WebApp の URL・公開設定を確認してください');
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      throw apiError('INVALID_RESPONSE', 'サーバーの応答を読み取れませんでした（HTTP ' + res.status + '）');
    }
    if (!data || typeof data !== 'object' || typeof data.success !== 'boolean') {
      throw apiError('INVALID_RESPONSE', 'サーバーの応答形式が不正です');
    }
    if (!data.success) {
      const error = data.error || {};
      throw apiError(error.code || data.code || 'API_ERROR', data.message || error.message || 'API error', error.details, data.status);
    }
    if (!res.ok) throw apiError('INVALID_RESPONSE', 'サーバーの応答が異常です（HTTP ' + res.status + '）');
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

  // 背景画像・画像生成（すべて認証付き POST。画像は data URL / base64 で受け渡す）
  const background = {
    get: (store, options) => call('getBackground', { store, includeImage: !(options && options.includeImage === false) }),
    // image: { dataBase64, mimeType, fileName } / settings: { fillColor, area: { top, bottom, left, right } }
    save: (store, expectedRevision, image, settings) => call('saveBackground', Object.assign({ store, expectedRevision },
      image ? { image } : {}, settings ? { settings } : {}), { requestId: newRequestId(), timeoutMs: 180000 }),
    clear: (store, expectedRevision) => call('clearBackground', { store, expectedRevision }, { requestId: newRequestId() }),
    castPhotos: (store, date) => call('getCastPhotos', { store, date }, { timeoutMs: 180000 })
  };

  // 手動モード（キャスト名の手入力。SIFT_DATA は使わない）
  const manual = {
    get: (store, date) => call('getManualShift', { store, date }),
    // rows: [{ castName, castId }]（配列の順番が並び順）
    save: (store, date, expectedRevision, rows) => call('saveManualShift', { store, date, expectedRevision, rows }, { requestId: newRequestId() }),
    // store: 店舗（店舗別の写真フォルダを検索）。refresh=true でフォルダの一覧を読み直す
    lookup: (names, store, refresh) => call('lookupCasts', Object.assign({ names, store }, refresh ? { refresh: true } : {}), { timeoutMs: 120000 }),
    photos: (fileIds, store) => call('getManualPhotos', { fileIds, store }, { timeoutMs: 180000 }),
    // image: { dataBase64, mimeType, fileName }。castId ありは差し替え（expectedRevision 必須）
    registerPhoto: (castName, image, options) => call('registerCastPhoto', Object.assign({ castName, image }, options || {}),
      { requestId: newRequestId(), timeoutMs: 180000 })
  };

  // Phase 1.5 互換の名前（すべて認証付き POST）
  return { call, publicCall, write: call, read: call, setTokenProvider, newRequestId, parseResponse, background, manual };
})();
