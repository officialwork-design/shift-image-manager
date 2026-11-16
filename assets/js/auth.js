/**
 * Google ログイン（Google Identity Services: Sign In With Google）の状態管理（Phase 1.6）
 *
 * - ID トークンはメモリ上だけで保持する（localStorage / sessionStorage / Cookie に保存しない）。
 * - ページ再読み込み時は GIS の自動ログイン（auto_select + prompt）で再取得を試み、
 *   できなければログインボタンを表示する。
 * - トークンの中身（exp・email）はここでは画面表示と期限管理にのみ使う。本人確認はサーバー側の署名検証で行う。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Auth = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const EXPIRY_MARGIN_SEC = 60;   // 残り60秒未満のトークンは送らない（送信中の失効を避ける）
  let token = null;
  let claims = null;
  let clientId = '';
  let initialized = false;
  const listeners = [];

  function authError(code, message) {
    const err = new Error(message);
    err.code = code;
    return err;
  }

  // 署名は検証しない（サーバーが検証する）。画面表示・期限判定用。
  function decodeClaims(idToken) {
    const parts = String(idToken || '').split('.');
    if (parts.length !== 3) return null;
    try {
      const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = b64 + '==='.slice((b64.length + 3) % 4);
      const bin = typeof atob === 'function' ? atob(padded) : Buffer.from(padded, 'base64').toString('binary');
      const json = decodeURIComponent(Array.from(bin).map(c => '%' + ('0' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
      const value = JSON.parse(json);
      return value && typeof value === 'object' ? value : null;
    } catch (err) {
      return null;
    }
  }

  function nowSec() {
    return Math.floor(Date.now() / 1000);
  }

  function secondsLeft() {
    if (!claims || typeof claims.exp !== 'number') return 0;
    return claims.exp - nowSec();
  }

  function emit(event, detail) {
    listeners.slice().forEach(fn => {
      try { fn(event, detail); } catch (err) { /* 画面側の例外で認証処理を止めない */ }
    });
  }

  function setCredential(idToken) {
    const decoded = decodeClaims(idToken);
    if (!decoded || typeof decoded.exp !== 'number' || decoded.exp - nowSec() <= EXPIRY_MARGIN_SEC) {
      emit('error', authError('AUTH_INVALID', 'Google から受け取ったログイン情報を利用できません。もう一度ログインしてください'));
      return false;
    }
    const previousSub = claims && claims.sub;
    token = idToken;
    claims = decoded;
    emit('signedIn', { email: decoded.email || '', name: decoded.name || '', sub: decoded.sub || '', accountChanged: !!previousSub && previousSub !== decoded.sub });
    return true;
  }

  function onCredential(response) {
    if (!response || !response.credential) {
      emit('error', authError('AUTH_INVALID', 'Google ログインに失敗しました'));
      return;
    }
    setCredential(response.credential);
  }

  function gis() {
    return typeof window !== 'undefined' && window.google && window.google.accounts && window.google.accounts.id;
  }

  function waitForGis(timeoutMs) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      (function check() {
        if (gis()) return resolve(gis());
        if (Date.now() - started > timeoutMs) return reject(authError('AUTH_UNAVAILABLE', 'Google ログインを読み込めませんでした。通信環境・広告ブロック等の設定を確認してください'));
        setTimeout(check, 100);
      })();
    });
  }

  async function init(options) {
    clientId = options.clientId;
    if (!clientId) throw authError('AUTH_NOT_CONFIGURED', 'ログイン設定（OAuth クライアントID）がありません。管理者に連絡してください');
    const id = await waitForGis(options.loadTimeoutMs || 10000);
    if (!initialized) {
      id.initialize({
        client_id: clientId,
        callback: onCredential,
        auto_select: true,               // 以前ログインした利用者は再読み込み時に自動でログイン
        cancel_on_tap_outside: false,
        itp_support: true,
        use_fedcm_for_prompt: true
      });
      initialized = true;
    }
    if (options.buttonElement) renderButton(options.buttonElement);
    if (options.autoPrompt !== false) id.prompt();
  }

  function renderButton(el) {
    const id = gis();
    if (!id || !el) return;
    el.innerHTML = '';
    id.renderButton(el, { type: 'standard', theme: 'outline', size: 'large', text: 'signin_with', locale: 'ja' });
  }

  function prompt() {
    const id = gis();
    if (id) id.prompt();
  }

  // API 呼び出し時に使う。無い・期限切れ間近は送らずに例外（画面で再ログインを案内）。
  function getToken() {
    if (!token) throw authError('AUTH_REQUIRED', 'ログインが必要です');
    if (secondsLeft() <= EXPIRY_MARGIN_SEC) {
      expire();
      throw authError('AUTH_EXPIRED', 'ログインの有効期限が切れました。もう一度ログインしてください');
    }
    return token;
  }

  // サーバーが AUTH_EXPIRED / AUTH_INVALID を返した場合などにトークンを破棄する（利用者情報は残す）
  function expire() {
    if (!token) return;
    token = null;
    emit('expired', {});
  }

  function signOut() {
    const id = gis();
    if (id) id.disableAutoSelect();
    token = null;
    claims = null;
    emit('signedOut', {});
  }

  function onChange(fn) {
    listeners.push(fn);
  }

  function getProfile() {
    return claims ? { email: claims.email || '', name: claims.name || '', sub: claims.sub || '', secondsLeft: secondsLeft() } : null;
  }

  function hasToken() {
    return !!token && secondsLeft() > EXPIRY_MARGIN_SEC;
  }

  return { init, renderButton, prompt, getToken, expire, signOut, onChange, getProfile, hasToken, decodeClaims, setCredentialForTest: setCredential, EXPIRY_MARGIN_SEC };
});
