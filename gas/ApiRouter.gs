function doGet(e) {
  return ApiRouter.handle(e, 'GET');
}

function doPost(e) {
  return ApiRouter.handle(e, 'POST');
}

/**
 * Phase 1.5 ルーティング
 *  - 読み取り API : GET(JSONP) / POST どちらでも可。副作用なし。
 *  - 更新 API     : POST のみ。AuthService.requireEditor による認証・認可が必須（現在はフェイルクローズ）。
 *  - 旧更新 API   : 対象（店舗・日付・revision）を検証できないものは LEGACY_API_REMOVED で拒否。
 */
const API_READ_ACTIONS = ['getConfig', 'getDateList', 'getDateOptions', 'getSiftPreview', 'getSavedShift', 'getShiftSnapshot', 'getImageList'];
const API_WRITE_ACTIONS = ['initializeShift', 'saveShift', 'setCastAbsent', 'resetShiftFromSource', 'refreshImageCache', 'checkImages', 'changeDateAndStore'];
const API_AUDITED_ERROR_CODES = ['AUTH_REQUIRED', 'AUTH_INVALID', 'AUTH_NOT_CONFIGURED', 'FORBIDDEN', 'REVISION_CONFLICT', 'METHOD_NOT_ALLOWED', 'LEGACY_API_REMOVED'];
const API_REMOVED_ACTIONS = {
  updateShiftRows: 'saveShift（store / date / expectedRevision 必須）を使用してください'
};

const ApiRouter = {
  handle(e, method) {
    const started = new Date();
    const params = e && e.parameter ? e.parameter : {};
    const callback = method === 'GET' ? params.callback : '';
    let request = { action: '', payload: {} };

    try {
      request = this.parseRequest(e, method);
      const data = this.dispatch(request, method);
      return Utils.output(Utils.successResponse(data, new Date() - started), callback);
    } catch (err) {
      if (!err.code) err.code = (err instanceof SyntaxError) ? 'INVALID_REQUEST' : 'INTERNAL_ERROR';
      // 認証失敗・権限なし・競合などの「想定内の拒否」は監査ログ、それ以外はエラーログ
      if (API_AUDITED_ERROR_CODES.indexOf(err.code) !== -1) {
        LogService.audit({ action: request.action || '(unknown)', store: (request.payload || {}).store, date: (request.payload || {}).date,
          revision: (request.payload || {}).expectedRevision, result: '拒否', code: err.code, detail: method });
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
    const request = Utils.parseJson(body, {});
    return {
      action: String(request.action || '').trim(),
      payload: request.payload && typeof request.payload === 'object' ? request.payload : {},
      auth: request.auth || null,
      requestId: String(request.requestId || '').slice(0, 100)
    };
  },

  dispatch(request, method) {
    const action = request.action;
    const payload = request.payload || {};

    if (API_REMOVED_ACTIONS[action]) {
      throw Utils.apiError('LEGACY_API_REMOVED', action + ' は廃止されました。' + API_REMOVED_ACTIONS[action]);
    }
    if (API_READ_ACTIONS.indexOf(action) !== -1) {
      return this.routeRead(action, payload);
    }
    if (API_WRITE_ACTIONS.indexOf(action) !== -1) {
      if (method !== 'POST') {
        throw Utils.apiError('METHOD_NOT_ALLOWED', '更新操作は POST でのみ実行できます');
      }
      // 認証・認可を先に行い、未認証の呼び出し元には入力検証の詳細を返さない。入力検証は各サービスで実施。
      const identity = AuthService.requireEditor(request.auth);
      return this.routeWrite(action, payload, { user: identity.email, requestId: request.requestId || '' });
    }
    throw Utils.apiError('UNKNOWN_ACTION', 'Unknown action: ' + action);
  },

  routeRead(action, payload) {
    switch (action) {
      case 'getConfig':
        return ConfigService.getPublicConfig();
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
      default:
        throw Utils.apiError('UNKNOWN_ACTION', 'Unknown action: ' + action);
    }
  },

  routeWrite(action, payload, ctx) {
    switch (action) {
      case 'initializeShift':
      case 'changeDateAndStore':   // 旧API互換: 既存データを消さない初回作成として動作
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
