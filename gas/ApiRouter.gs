function doGet(e) {
  return ApiRouter.handle(e, true);
}

function doPost(e) {
  return ApiRouter.handle(e, false);
}

const ApiRouter = {
  handle(e, isJsonp) {
    const started = new Date();
    const callback = e && e.parameter ? e.parameter.callback : '';
    let request = { action: '', payload: {} };

    try {
      request = this.parseRequest(e, isJsonp);
      const data = this.route(request.action, request.payload || {});
      return Utils.output(Utils.successResponse(data, new Date() - started), callback);
    } catch (err) {
      LogService.error(request.action || 'ApiRouter.handle', err, this.getErrorPayload_(e, request));
      return Utils.output(Utils.errorResponse(err, request.action, new Date() - started), callback);
    }
  },

  parseRequest(e, isJsonp) {
    const params = e && e.parameter ? e.parameter : {};
    if (isJsonp) {
      return {
        action: String(params.action || '').trim(),
        payload: params.payload ? Utils.parseJson(params.payload, {}) : {}
      };
    }

    const body = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    const request = Utils.parseJson(body, {});
    if (!request.action && params.action) {
      request.action = String(params.action || '').trim();
      request.payload = params.payload ? Utils.parseJson(params.payload, {}) : {};
    }
    return request;
  },

  route(action, payload) {
    switch (action) {
      case 'getConfig':
        return ConfigService.getPublicConfig();
      case 'getDateList':
        return SiftService.getDateList();
      case 'getSiftPreview':
        return SiftService.getPreview(payload.store, payload.date);
      case 'changeDateAndStore':
        return ShiftService.changeDateAndStore(payload.store, payload.date);
      case 'getImageList':
        return ShiftService.getImageList(payload.store, payload.date);
      case 'updateShiftRows':
        return ShiftService.updateShiftRows(payload.rows || []);
      case 'setCastAbsent':
        return ShiftService.setCastAbsent(payload.row, payload.isAbsent);
      case 'refreshImageCache':
        return ImageService.refreshCache();
      case 'checkImages':
        return ImageService.checkImages();
      case 'uploadImage':
        return ImageService.uploadImage(payload || {});
      default:
        throw new Error('Unknown action: ' + action);
    }
  },

  getErrorPayload_(e, request) {
    return {
      request: this.sanitizeRequestForLog_(request),
      parameters: e && e.parameter ? e.parameter : {},
      postData: this.sanitizePostDataForLog_(e && e.postData && e.postData.contents ? e.postData.contents : '')
    };
  },

  sanitizeRequestForLog_(request) {
    const safePayload = Object.assign({}, request && request.payload ? request.payload : {});
    if (safePayload.dataUrl) {
      safePayload.dataUrl = '[omitted dataUrl length=' + String(request.payload.dataUrl).length + ']';
    }
    return {
      action: request && request.action ? request.action : '',
      payload: safePayload
    };
  },

  sanitizePostDataForLog_(postData) {
    const text = String(postData || '');
    if (text.length <= 2000) return text;
    return text.slice(0, 1000) + '\n[omitted postData length=' + text.length + ']';
  }
};
