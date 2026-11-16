/**
 * 認証（Google ID トークン）＋ 認可（許可リスト・ロール）の入口（Phase 1.6）
 *
 * 認証方式は Script Properties の AUTH_MODE = google_id_token のときだけ有効。
 * 未設定・クライアントID未設定・実行環境非対応は AUTH_NOT_CONFIGURED（＝すべて拒否）。
 * クライアントが送るメールアドレス等は使わず、署名検証済みのトークンの内容だけを信用する。
 */
const AUTH_PROPERTY_KEYS = {
  MODE: 'AUTH_MODE',
  GOOGLE_CLIENT_ID: 'GOOGLE_OAUTH_CLIENT_ID'
};
const AUTH_MODE_GOOGLE_ID_TOKEN = 'google_id_token';

const AuthService = {
  /**
   * @param {Object} auth クライアントが POST 本文で送った { idToken }。ログには出さない。
   * @param {string[]} allowedRoles 許可するロール
   * @return {{sub:string,email:string,role:string}}
   */
  requireRole(auth, allowedRoles) {
    const settings = this.getSettings();
    if (!settings.configured) {
      throw Utils.apiError('AUTH_NOT_CONFIGURED', '認証が設定されていないため、この操作は利用できません');
    }
    const idToken = auth && typeof auth === 'object' ? auth.idToken : undefined;
    const claims = GoogleIdTokenVerifier.verify(idToken, settings.clientId);
    const access = AccessControlService.authorize(claims);
    if (!AccessControlService.hasRole(access.role, allowedRoles)) {
      throw Utils.apiError('FORBIDDEN', 'この操作を行う権限がありません（' + allowedRoles.join(' / ') + ' のみ）',
        { reason: 'ROLE', role: access.role, sub: access.sub, email: access.email });
    }
    return access;
  },

  getSettings() {
    const mode = this.getProperty_(AUTH_PROPERTY_KEYS.MODE);
    const clientId = this.getProperty_(AUTH_PROPERTY_KEYS.GOOGLE_CLIENT_ID);
    const validClientId = /^[0-9A-Za-z-]+\.apps\.googleusercontent\.com$/.test(clientId);
    return {
      mode,
      clientId: validClientId ? clientId : '',
      configured: mode === AUTH_MODE_GOOGLE_ID_TOKEN && validClientId
    };
  },

  getProperty_(key) {
    try {
      return String(PropertiesService.getScriptProperties().getProperty(key) || '').trim();
    } catch (err) {
      return '';
    }
  }
};
