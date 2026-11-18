function doGet(e) {
  return ApiRouter.handle(e, 'GET');
}

function doPost(e) {
  return ApiRouter.handle(e, 'POST');
}

/**
 * Phase 1.6 ルーティング
 *
 * 通信方式:
 *  - GAS の doPost(e) では HTTP ヘッダー（Authorization 等）を取得できないため、
 *    ID トークンは POST 本文（Content-Type: text/plain の JSON）の auth.idToken で受け取る。
 *  - URL（クエリ）にトークンを載せない。GET では認証情報を一切受け付けない。
 *
 * 公開範囲:
 *  - PUBLIC     : ログイン前に必要な公開設定のみ（GET/JSONP または POST）
 *  - 認証必須   : シフト・キャスト・画像情報などの読み取り（POST のみ、ADMIN / EDITOR）
 *  - 更新権限   : 保存・休み変更・初回作成・画像チェック（POST のみ、ADMIN / EDITOR）
 *  - ADMIN のみ : 元データから初期化・画像キャッシュ更新
 */
const API_ROLES_ANY = ['ADMIN', 'EDITOR'];
const API_MAX_BODY = 200000;
const API_MAX_UPLOAD_BODY = 12 * 1024 * 1024;
const API_UPLOAD_ACTIONS = ['saveBackground', 'registerCastPhoto'];   // 画像を送る操作だけ 200KB を超えてよい
const API_ROLES_ADMIN = ['ADMIN'];

const API_PUBLIC_ACTIONS = ['getPublicConfig', 'getConfig'];

// action → 許可ロール（ここに無い action は UNKNOWN_ACTION）
const API_PROTECTED_ACTIONS = {
  // 読み取り（認証必須）
  whoAmI: API_ROLES_ANY,
  getDateList: API_ROLES_ANY,
  getDateOptions: API_ROLES_ANY,
  getSiftPreview: API_ROLES_ANY,
  getSavedShift: API_ROLES_ANY,
  getShiftSnapshot: API_ROLES_ANY,
  getImageList: API_ROLES_ANY,
  // 更新
  initializeShift: API_ROLES_ANY,
  changeDateAndStore: API_ROLES_ANY,   // 旧API互換（initializeShift と同じ・既存データを消さない）
  saveShift: API_ROLES_ANY,
  setCastAbsent: API_ROLES_ANY,
  checkImages: API_ROLES_ANY,
  // 背景画像・画像生成（背景の差し替えは編集者も可。解除は ADMIN のみ）
  getBackground: API_ROLES_ANY,
  getCastPhotos: API_ROLES_ANY,
  saveBackground: API_ROLES_ANY,
  clearBackground: API_ROLES_ADMIN,
  // 手動モード（SIFT_DATA を使わずキャスト名を手入力）
  getManualShift: API_ROLES_ANY,
  saveManualShift: API_ROLES_ANY,
  lookupCasts: API_ROLES_ANY,
  getManualPhotos: API_ROLES_ANY,
  registerCastPhoto: API_ROLES_ANY,
  resetShiftFromSource: API_ROLES_ADMIN,
  refreshImageCache: API_ROLES_ADMIN
};

const API_REMOVED_ACTIONS = {
  updateShiftRows: 'saveShift（store / date / expectedRevision 必須）を使用してください'
};

// 想定内の拒否は監査ログ（画像操作ログ）、それ以外はエラーログ
const API_AUDITED_ERROR_CODES = ['AUTH_REQUIRED', 'AUTH_INVALID', 'AUTH_EXPIRED', 'AUTH_NOT_CONFIGURED', 'AUTH_KEYS_UNAVAILABLE',
  'FORBIDDEN', 'ACCESS_LIST_NOT_CONFIGURED', 'ACCESS_LIST_INVALID', 'ACCESS_LIST_UNAVAILABLE',
  'REVISION_CONFLICT', 'METHOD_NOT_ALLOWED', 'LEGACY_API_REMOVED'];

const ApiRouter = {
  handle(e, method) {
    const started = new Date();
    const params = e && e.parameter ? e.parameter : {};
    const callback = method === 'GET' ? params.callback : '';
    let request = { action: '', payload: {} };
    let identity = null;

    try {
      request = this.parseRequest(e, method);
      const result = this.dispatch(request, method);
      identity = result.identity;
      return Utils.output(Utils.successResponse(result.data, new Date() - started), callback);
    } catch (err) {
      if (!err.code) err.code = (err instanceof SyntaxError) ? 'INVALID_REQUEST' : 'INTERNAL_ERROR';
      const payload = request.payload || {};
      if (API_AUDITED_ERROR_CODES.indexOf(err.code) !== -1) {
        const details = err.details || {};
        LogService.audit({
          action: request.action || '(unknown)', store: payload.store, date: payload.date,
          revision: payload.expectedRevision, result: '拒否', code: err.code,
          user: identity ? identity.sub : (details.sub || ''),
          userLabel: identity ? identity.email : (details.email || ''),
          detail: method + (details.reason ? ' ' + details.reason : '')
        });
      } else {
        LogService.error(request.action || 'ApiRouter.handle', err, this.getErrorPayload_(e, request, method));
      }
      return Utils.output(Utils.errorResponse(err, request.action, new Date() - started), callback);
    }
  },

  parseRequest(e, method) {
    const params = e && e.parameter ? e.parameter : {};
    if (method === 'GET') {
      return {
        action: String(params.action || '').trim(),
        payload: params.payload ? Utils.parseJson(params.payload, {}) : {},
        auth: null   // GET では認証情報を受け付けない（URL・履歴・ログに残るため）
      };
    }
    const body = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    // 通常の API は 200KB まで。背景画像のアップロード（saveBackground）のみ 12MB まで（画像 8MB の base64 + JSON）
    if (body.length > API_MAX_UPLOAD_BODY) throw Utils.apiError('INVALID_REQUEST', 'リクエストが大きすぎます');
    const request = Utils.parseJson(body, {});
    if (body.length > API_MAX_BODY && API_UPLOAD_ACTIONS.indexOf(String(request.action || '')) === -1) {
      throw Utils.apiError('INVALID_REQUEST', 'リクエストが大きすぎます');
    }
    return {
      action: String(request.action || '').trim(),
      payload: request.payload && typeof request.payload === 'object' ? request.payload : {},
      auth: request.auth && typeof request.auth === 'object' ? request.auth : null,
      requestId: String(request.requestId || '').slice(0, 100)
    };
  },

  dispatch(request, method) {
    const action = request.action;
    const payload = request.payload || {};

    // 環境設定の安全確認（本番IDの混入・環境の取り違え）を最初に行い、問題があれば何もしない
    ConfigService.getEnvironment();

    if (API_REMOVED_ACTIONS[action]) {
      throw Utils.apiError('LEGACY_API_REMOVED', action + ' は廃止されました。' + API_REMOVED_ACTIONS[action]);
    }
    if (API_PUBLIC_ACTIONS.indexOf(action) !== -1) {
      return { data: ConfigService.getPublicConfig(), identity: null };
    }
    const allowedRoles = API_PROTECTED_ACTIONS[action];
    if (!allowedRoles) throw Utils.apiError('UNKNOWN_ACTION', 'Unknown action: ' + action);
    if (method !== 'POST') {
      throw Utils.apiError('METHOD_NOT_ALLOWED', 'この操作は POST でのみ実行できます');
    }

    // 認証（署名検証）→ 認可（許可リスト・ロール）を、すべての処理より先に完了させる
    const identity = AuthService.requireRole(request.auth, allowedRoles);
    const ctx = { user: identity.sub, userLabel: identity.email, role: identity.role, requestId: request.requestId || '' };
    return { data: this.route(action, payload, ctx, identity), identity };
  },

  route(action, payload, ctx, identity) {
    switch (action) {
      case 'whoAmI':
        LogService.audit({ action: 'ログイン確認', user: identity.sub, userLabel: identity.email, result: '成功',
          detail: 'role=' + identity.role + (identity.emailMismatch ? ' email-mismatch' : '') });
        return { sub: identity.sub, email: identity.email, role: identity.role };
      case 'getDateList':
        return SiftService.getDateList();
      case 'getDateOptions':
        return SiftService.getDateOptions();
      case 'getSiftPreview':
        return SiftService.getPreview(payload.store, payload.date);
      case 'getSavedShift':
        return ShiftService.getSavedShift(payload.store, payload.date);
      case 'getImageList':
        return ShiftService.getImageList(payload.store, payload.date);
      case 'getShiftSnapshot':
        return ShiftService.getShiftSnapshot(payload.store, payload.date);
      case 'initializeShift':
      case 'changeDateAndStore':
        return ShiftService.initializeShift(payload.store, payload.date, ctx);
      case 'saveShift':
        return ShiftService.saveShift(payload.store, payload.date, payload.expectedRevision, payload.rows, ctx);
      case 'setCastAbsent':
        if (payload.row !== undefined && !payload.recordId) {
          throw Utils.apiError('LEGACY_API_REMOVED', '行番号による休み設定は廃止されました。store / date / recordId / expectedRevision を指定してください');
        }
        return ShiftService.setCastAbsent(payload.store, payload.date, payload.recordId, payload.isAbsent, payload.expectedRevision, ctx);
      case 'resetShiftFromSource':
        return ShiftService.resetShiftFromSource(payload.store, payload.date, payload.expectedRevision, payload.confirmation, ctx);
      case 'refreshImageCache':
        return ImageService.refreshCache();
      case 'getBackground':
        return BackgroundService.getBackground(payload.store, { includeImage: payload.includeImage !== false });
      case 'getCastPhotos':
        return BackgroundService.getCastPhotos(payload.store, payload.date);
      case 'saveBackground':
        return BackgroundService.saveBackground(payload, ctx);
      case 'clearBackground':
        return BackgroundService.clearBackground(payload, ctx);
      case 'getManualShift':
        return ManualShiftService.getManualShift(payload.store, payload.date);
      case 'saveManualShift':
        return ManualShiftService.saveManualShift(payload, ctx);
      case 'lookupCasts':
        return ManualShiftService.lookupCasts(payload.names);
      case 'getManualPhotos':
        return ManualShiftService.getManualPhotos(payload.fileIds);
      case 'registerCastPhoto':
        return ManualShiftService.registerCastPhoto(payload, ctx);
      case 'checkImages':
        return ImageService.checkImages(payload.store, payload.date, ctx);
      default:
        throw Utils.apiError('UNKNOWN_ACTION', 'Unknown action: ' + action);
    }
  },

  getErrorPayload_(e, request, method) {
    return LogService.redact({
      method,
      action: request && request.action,
      payload: request && request.payload,
      parameters: e && e.parameter ? e.parameter : {},
      postData: e && e.postData && e.postData.contents ? e.postData.contents : ''
    });
  }
};
