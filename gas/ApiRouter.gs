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

    try {
      const request = this.parseRequest(e, isJsonp);
      const data = this.route(request.action, request.payload || {});

      return Utils.output({
        success: true,
        data,
        elapsedMs: new Date() - started,
        timestamp: Utils.now()
      }, callback);
    } catch (err) {
      LogService.error('ApiRouter.handle', err, e && e.parameter ? e.parameter : {});
      return Utils.output({
        success: false,
        data: null,
        error: {
          message: err && err.message ? err.message : String(err)
        },
        timestamp: Utils.now()
      }, callback);
    }
  },

  parseRequest(e, isJsonp) {
    if (isJsonp) {
      return {
        action: String(e.parameter.action || '').trim(),
        payload: e.parameter.payload ? JSON.parse(e.parameter.payload) : {}
      };
    }

    const body = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    return JSON.parse(body);
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
      case 'setCastAbsent':
        return ShiftService.setCastAbsent(payload.row, payload.isAbsent);
      case 'refreshImageCache':
        return ImageService.refreshCache();
      case 'checkImages':
        return ImageService.checkImages();
      default:
        throw new Error('Unknown action: ' + action);
    }
  }
};
