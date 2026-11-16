/**
 * 更新系 API の認証・認可（Phase 1.5）
 *
 * 方針: フェイルクローズ。
 *  - 本人確認の方式（Google ID トークン検証など）は設計承認待ちのため、現時点では「検証器」が未実装。
 *  - 検証器が無い限り、更新系 API はすべて AUTH_NOT_CONFIGURED で拒否される。
 *  - クライアントが送るメールアドレス等は信用しない。本人確認は必ずサーバー側の検証器で行う。
 *  - 認可は Script Properties の SHIFT_EDITOR_EMAILS（カンマ/改行区切り）に含まれる利用者のみ許可。
 *
 * テスト時のみ AuthService.setVerifierForTest(fn) で検証器を差し替える。
 */
const AUTH_PROPERTY_KEYS = {
  MODE: 'AUTH_MODE',                     // 承認後に設定（例: google_id_token）。未設定 = 認証なし = 更新拒否
  EDITOR_EMAILS: 'SHIFT_EDITOR_EMAILS',  // 更新を許可する利用者
  GOOGLE_CLIENT_ID: 'GOOGLE_OAUTH_CLIENT_ID' // 承認後に使用予定（ID トークンの aud 検証）
};

const AuthService = {
  verifier_: null,

  // テスト専用。本番コードからは呼ばない。
  setVerifierForTest(fn) {
    this.verifier_ = fn || null;
  },

  /**
   * 更新系 API の入口で必ず呼ぶ。成功時は検証済み利用者 { email } を返す。
   * @param {Object} auth クライアントが送った認証情報（例: { idToken }）。内容はログに出さない。
   */
  requireEditor(auth) {
    const identity = this.verifyIdentity_(auth);
    if (!identity || !identity.email) {
      throw Utils.apiError('AUTH_INVALID', '認証情報を確認できません');
    }
    const allowed = this.getEditorEmails_();
    if (allowed.indexOf(String(identity.email).toLowerCase()) === -1) {
      throw Utils.apiError('FORBIDDEN', 'この操作を行う権限がありません');
    }
    return { email: String(identity.email).toLowerCase() };
  },

  verifyIdentity_(auth) {
    if (this.verifier_) return this.verifier_(auth);

    const mode = this.getProperty_(AUTH_PROPERTY_KEYS.MODE);
    if (!mode) {
      throw Utils.apiError('AUTH_NOT_CONFIGURED', '認証方式が未設定のため、更新操作は無効化されています');
    }
    // 承認された方式の検証器が実装されるまで、どの mode でも拒否する（フェイルクローズ）
    throw Utils.apiError('AUTH_NOT_CONFIGURED', '認証方式 ' + mode + ' の検証処理は未実装です');
  },

  getEditorEmails_() {
    return String(this.getProperty_(AUTH_PROPERTY_KEYS.EDITOR_EMAILS) || '')
      .split(/[\s,;]+/)
      .map(v => v.trim().toLowerCase())
      .filter(Boolean);
  },

  getProperty_(key) {
    try {
      return PropertiesService.getScriptProperties().getProperty(key) || '';
    } catch (err) {
      return '';
    }
  }
};
