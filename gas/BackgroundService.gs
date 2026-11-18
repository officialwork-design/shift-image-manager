/**
 * 店舗別 背景画像の管理と、画像生成用のキャスト写真取得（背景画像固定・キャスト自動配置機能）
 *
 * - 背景画像は店舗ごとに1枚（PNG / JPEG）。Drive の「背景フォルダ」に保存し、設定は「背景設定」シートに記録する。
 * - 背景の差し替えでシフトデータ（シフト編集 / シフト編集管理）は一切変更しない。
 * - 古い背景ファイルは削除しない（設定の参照先だけを切り替える）。
 * - Drive への書き込みは Drive REST API（drive.file スコープ = このアプリが作成したファイルのみ）で行う。
 *   DriveApp の書き込み系はドライブ全体の権限（drive）を要求するため使用しない。
 * - 背景フォルダ:
 *     ID管理 / Script Properties の DRIVE_BACKGROUND_FOLDER_ID。
 *     テスト環境で未設定のときだけ、テスト用フォルダを新規作成して Script Properties に記録する。
 *     本番で未設定の場合は BACKGROUND_FOLDER_NOT_CONFIGURED（本番 Drive に自動で書き込まない）。
 *     本番の画像フォルダ等（PRODUCTION_RESOURCE_IDS）はテスト環境では使用不可。
 * - 画像はブラウザの Canvas を汚染しないよう、data URL（base64）で返す（Drive のサムネイル URL を Canvas に直接読み込まない）。
 * - キャスト写真は「画像フォルダに存在するファイル」だけを返す（任意の Drive ファイルを読み出させない）。
 */
const BACKGROUND_HEADERS = ['store', 'fileId', 'fileName', 'mimeType', 'width', 'height', 'bytes', 'fillColor',
  'areaTop', 'areaBottom', 'areaLeft', 'areaRight', 'revision', 'updatedAt', 'updatedBy'];

const BACKGROUND_LIMITS = {
  MAX_BYTES: 8 * 1024 * 1024,      // 8MB（base64 で約 10.7MB の POST 本文）
  MIN_SIDE: 200,
  MAX_SIDE: 8000,
  MIME_TYPES: ['image/png', 'image/jpeg'],
  CANVAS_WIDTH: 1447,
  CANVAS_HEIGHT: 2048,
  DEFAULT_AREA: { top: 580, bottom: 220, left: 33, right: 33 },   // 完成見本から確定（docs/IMAGE_LAYOUT.md §4）
  MIN_AREA_WIDTH: 400,
  MIN_AREA_HEIGHT: 400,
  MAX_PHOTOS: 40,
  PHOTO_SIZE: 's800',
  MAX_PHOTO_BYTES: 3 * 1024 * 1024,
  TEST_FOLDER_NAME: 'Shift Image Manager TEST Backgrounds'
};

const BackgroundService = {
  // ===== 読み取り =====
  getBackground(store, options) {
    const s = this.requireStore_(store);
    const opts = options || {};
    const entry = this.readEntry_(s);
    const view = this.toView_(s, entry);
    if (entry && entry.fileId && opts.includeImage !== false) {
      const file = this.getBackgroundFile_(entry.fileId);
      const blob = file.getBlob();
      view.dataUrl = 'data:' + entry.mimeType + ';base64,' + Utilities.base64Encode(blob.getBytes());
    }
    return view;
  },

  // ===== 更新（背景の差し替え / 配置設定の変更） =====
  // payload: { store, expectedRevision, image?: { dataBase64, mimeType, fileName }, settings?: { fillColor, area: {top,bottom,left,right} } }
  saveBackground(payload, ctx) {
    const p = payload || {};
    const s = this.requireStore_(p.store);
    const context = ctx || {};
    const expected = this.requireRevision_(p.expectedRevision);
    const image = p.image ? this.validateImage_(p.image) : null;
    const settings = p.settings ? this.validateSettings_(p.settings) : null;
    if (!image && !settings) throw Utils.apiError('INVALID_BACKGROUND', '背景画像または設定を指定してください');

    const result = ShiftService.withLock_(() => {
      const sheet = this.getSheet_();
      const found = this.findRow_(sheet, s);
      const current = found ? found.entry : null;
      const currentRevision = current ? current.revision : 0;
      if (expected !== currentRevision) {
        throw Utils.apiError('REVISION_CONFLICT', '他の端末で背景設定が更新されています。再読み込みしてください',
          { expectedRevision: expected, currentRevision });
      }
      const next = Object.assign({
        store: s, fileId: '', fileName: '', mimeType: '', width: '', height: '', bytes: '', fillColor: '',
        areaTop: BACKGROUND_LIMITS.DEFAULT_AREA.top, areaBottom: BACKGROUND_LIMITS.DEFAULT_AREA.bottom,
        areaLeft: BACKGROUND_LIMITS.DEFAULT_AREA.left, areaRight: BACKGROUND_LIMITS.DEFAULT_AREA.right
      }, current || {});
      if (image) {
        const folder = this.getFolder_();
        const name = s + '_background_' + Utilities.formatDate(new Date(), DEFAULT_CONFIG.TIMEZONE, 'yyyyMMdd_HHmmss') +
          (image.mimeType === 'image/png' ? '.png' : '.jpg');
        const fileId = BackgroundDrive.uploadFile(folder.getId(), name, image.mimeType, image.bytes);
        Object.assign(next, { fileId, fileName: name, mimeType: image.mimeType,
          width: image.width, height: image.height, bytes: image.bytes.length });
      }
      if (settings) {
        if (settings.fillColor !== undefined) next.fillColor = settings.fillColor;
        if (settings.area) {
          next.areaTop = settings.area.top; next.areaBottom = settings.area.bottom;
          next.areaLeft = settings.area.left; next.areaRight = settings.area.right;
        }
      }
      next.revision = currentRevision + 1;
      next.updatedAt = Utils.now();
      next.updatedBy = context.user || '';
      const row = BACKGROUND_HEADERS.map(h => next[h] === undefined || next[h] === null ? '' : String(next[h]));
      if (found) {
        sheet.getRange(found.rowNumber, 1, 1, BACKGROUND_HEADERS.length).setValues([row]);
      } else {
        SpreadsheetService.appendTextRows(sheet, [row], BACKGROUND_HEADERS.length);
      }
      return this.parseEntry_(row);
    });

    LogService.audit({ action: image ? '背景画像変更' : '背景設定変更', store: s, revision: result.revision,
      user: context.user, userLabel: context.userLabel, result: '成功',
      detail: image ? ('file=' + result.fileName + ' ' + result.width + 'x' + result.height) : 'settings' });
    return this.toView_(s, result);
  },

  // ADMIN のみ: 背景の参照を外す（Drive のファイルは削除しない）
  clearBackground(payload, ctx) {
    const p = payload || {};
    const s = this.requireStore_(p.store);
    const context = ctx || {};
    const expected = this.requireRevision_(p.expectedRevision);
    const result = ShiftService.withLock_(() => {
      const sheet = this.getSheet_();
      const found = this.findRow_(sheet, s);
      const currentRevision = found ? found.entry.revision : 0;
      if (expected !== currentRevision) {
        throw Utils.apiError('REVISION_CONFLICT', '他の端末で背景設定が更新されています。再読み込みしてください',
          { expectedRevision: expected, currentRevision });
      }
      if (!found) return null;
      const next = Object.assign({}, found.entry, { fileId: '', fileName: '', mimeType: '', width: '', height: '', bytes: '',
        revision: currentRevision + 1, updatedAt: Utils.now(), updatedBy: context.user || '' });
      const row = BACKGROUND_HEADERS.map(h => next[h] === undefined || next[h] === null ? '' : String(next[h]));
      sheet.getRange(found.rowNumber, 1, 1, BACKGROUND_HEADERS.length).setValues([row]);
      return this.parseEntry_(row);
    });
    LogService.audit({ action: '背景画像解除', store: s, revision: result ? result.revision : 0,
      user: context.user, userLabel: context.userLabel, result: '成功' });
    return this.toView_(s, result);
  },

  // ===== 画像生成用: 出勤キャストと写真（data URL） =====
  // シフトの並び順を保持し、休みのキャストは含めない。写真は画像フォルダに存在するものだけ返す。
  getCastPhotos(store, date) {
    const target = Utils.requireStoreAndIsoDate(store, date);
    const saved = ShiftRepository.readCommitted(target.store, target.date);
    const imageData = ImageService.getDriveImagesCached();
    const casts = saved.rows
      .filter(row => row.status !== '休み')
      .map(row => {
        const resolved = ShiftService.resolveImage_(imageData, row);
        const known = resolved.fileId && (ImageService.isKnownImageFileId(imageData, resolved.fileId) ||
          (resolved.source === 'preparing' && resolved.fileId === imageData.preparingImageId));
        const fileId = known ? resolved.fileId : '';
        return { recordId: row.recordId, name: row.castName, workTime: row.workTime, fileId, source: fileId ? resolved.source : 'none' };
      });
    const ids = casts.map(c => c.fileId).filter((id, i, a) => id && a.indexOf(id) === i);
    if (ids.length > BACKGROUND_LIMITS.MAX_PHOTOS) {
      throw Utils.apiError('TOO_MANY_PHOTOS', '写真の数が上限（' + BACKGROUND_LIMITS.MAX_PHOTOS + '）を超えています');
    }
    const photos = {};
    const failed = [];
    ids.forEach(id => {
      try {
        photos[id] = this.fetchPhotoDataUrl_(id);
      } catch (err) {
        failed.push(id);
      }
    });
    casts.forEach(c => { if (c.fileId && !photos[c.fileId]) { c.fileId = ''; c.source = 'unavailable'; } });
    return { store: target.store, date: target.date, revision: saved.revision, initialized: saved.initialized,
      casts, photos, failedCount: failed.length };
  },

  // ===== 内部 =====
  fetchPhotoDataUrl_(fileId) {
    const cacheKey = 'bgphoto:' + fileId + ':' + BACKGROUND_LIMITS.PHOTO_SIZE;
    const cache = CacheService.getScriptCache();
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const token = ScriptApp.getOAuthToken();
    const headers = { Authorization: 'Bearer ' + token };
    const meta = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) +
      '?fields=thumbnailLink,mimeType,size&supportsAllDrives=true', { headers, muteHttpExceptions: true });
    let bytes = null;
    let mimeType = 'image/jpeg';
    if (meta.getResponseCode() === 200) {
      const info = JSON.parse(meta.getContentText() || '{}');
      if (info.thumbnailLink) {
        const url = String(info.thumbnailLink).replace(/=s\d+(-c)?$/, '=' + BACKGROUND_LIMITS.PHOTO_SIZE);
        const res = UrlFetchApp.fetch(url, { headers, muteHttpExceptions: true });
        if (res.getResponseCode() === 200) {
          const blob = res.getBlob();
          bytes = blob.getBytes();
          mimeType = blob.getContentType() || 'image/jpeg';
        }
      }
      if (!bytes && /^image\/(png|jpeg)$/.test(info.mimeType || '') && Number(info.size || 0) <= BACKGROUND_LIMITS.MAX_PHOTO_BYTES) {
        const blob = DriveApp.getFileById(fileId).getBlob();
        bytes = blob.getBytes();
        mimeType = info.mimeType;
      }
    }
    if (!bytes) throw Utils.apiError('PHOTO_UNAVAILABLE', '写真を取得できません');
    if (!/^image\/(png|jpeg|webp|gif)$/.test(mimeType)) mimeType = 'image/jpeg';
    const dataUrl = 'data:' + mimeType + ';base64,' + Utilities.base64Encode(bytes);
    try { if (dataUrl.length < 95 * 1024) cache.put(cacheKey, dataUrl, 600); } catch (err) { /* best-effort */ }
    return dataUrl;
  },

  requireStore_(store) {
    const s = String(store || '').trim().toUpperCase();
    if (STORE_NAMES.indexOf(s) === -1) throw Utils.apiError('INVALID_STORE', '店舗が不正です');
    return s;
  },

  requireRevision_(value) {
    const n = Number(value);
    if (value === '' || value === null || value === undefined || !Number.isInteger(n) || n < 0) {
      throw Utils.apiError('INVALID_REVISION', 'expectedRevision が不正です');
    }
    return n;
  },

  // 画像本文の検証（形式・サイズ・実寸）。拡張子や申告された MIME ではなく先頭バイトで判定する。
  validateImage_(image) {
    const mimeType = String(image.mimeType || '').toLowerCase();
    if (BACKGROUND_LIMITS.MIME_TYPES.indexOf(mimeType) === -1) {
      throw Utils.apiError('INVALID_IMAGE_TYPE', '背景画像は PNG または JPEG を指定してください');
    }
    const b64 = String(image.dataBase64 || '').replace(/^data:[^,]*,/, '');
    if (!b64 || !/^[A-Za-z0-9+/=\s]+$/.test(b64)) throw Utils.apiError('INVALID_IMAGE', '画像データが不正です');
    if (b64.length > Math.ceil(BACKGROUND_LIMITS.MAX_BYTES / 3) * 4 + 4) {
      throw Utils.apiError('IMAGE_TOO_LARGE', '背景画像は 8MB 以下にしてください');
    }
    const bytes = Utilities.base64Decode(b64);
    if (bytes.length > BACKGROUND_LIMITS.MAX_BYTES) throw Utils.apiError('IMAGE_TOO_LARGE', '背景画像は 8MB 以下にしてください');
    const info = BackgroundImageInfo.parse(bytes);
    if (!info || info.mimeType !== mimeType) throw Utils.apiError('INVALID_IMAGE', '画像の形式を判別できません（PNG / JPEG のみ）');
    const minSide = Math.min(info.width, info.height);
    const maxSide = Math.max(info.width, info.height);
    if (minSide < BACKGROUND_LIMITS.MIN_SIDE || maxSide > BACKGROUND_LIMITS.MAX_SIDE) {
      throw Utils.apiError('INVALID_IMAGE_SIZE', '背景画像の大きさは ' + BACKGROUND_LIMITS.MIN_SIDE + '〜' + BACKGROUND_LIMITS.MAX_SIDE + 'px にしてください');
    }
    return { bytes, mimeType, width: info.width, height: info.height };
  },

  validateSettings_(settings) {
    const out = {};
    if (settings.fillColor !== undefined && settings.fillColor !== '') {
      const c = String(settings.fillColor).trim().toLowerCase();
      if (!/^#[0-9a-f]{6}$/.test(c)) throw Utils.apiError('INVALID_SETTINGS', '余白の色は #RRGGBB 形式で指定してください');
      out.fillColor = c;
    } else if (settings.fillColor === '') {
      out.fillColor = '';
    }
    if (settings.area) {
      const a = {};
      ['top', 'bottom', 'left', 'right'].forEach(k => {
        const n = Number(settings.area[k]);
        if (!Number.isInteger(n) || n < 0) throw Utils.apiError('INVALID_SETTINGS', '配置領域の値が不正です（' + k + '）');
        a[k] = n;
      });
      if (BACKGROUND_LIMITS.CANVAS_WIDTH - a.left - a.right < BACKGROUND_LIMITS.MIN_AREA_WIDTH ||
          BACKGROUND_LIMITS.CANVAS_HEIGHT - a.top - a.bottom < BACKGROUND_LIMITS.MIN_AREA_HEIGHT) {
        throw Utils.apiError('INVALID_SETTINGS', '配置領域が狭すぎます（幅・高さ ' + BACKGROUND_LIMITS.MIN_AREA_WIDTH + 'px 以上）');
      }
      out.area = a;
    }
    return out;
  },

  getSheet_() {
    const config = ConfigService.getConfig();
    const name = config.SHEET_BACKGROUND || DEFAULT_CONFIG.SHEET_BACKGROUND;
    // 無ければヘッダー付きで作成、あればヘッダーを検証するだけ（既存データは変更しない）
    return SpreadsheetService.ensureSchemaSheet_(SpreadsheetService.getSpreadsheet(), name, BACKGROUND_HEADERS, []);
  },

  readEntry_(store) {
    const config = ConfigService.getConfig();
    const sheet = SpreadsheetService.getSpreadsheet().getSheetByName(config.SHEET_BACKGROUND || DEFAULT_CONFIG.SHEET_BACKGROUND);
    if (!sheet) return null;
    SpreadsheetService.assertHeaders_(sheet, sheet.getName(), BACKGROUND_HEADERS);
    const found = this.findRow_(sheet, store);
    return found ? found.entry : null;
  },

  findRow_(sheet, store) {
    const last = sheet.getLastRow();
    if (last < 2) return null;
    const values = sheet.getRange(2, 1, last - 1, BACKGROUND_HEADERS.length).getDisplayValues();
    const matches = [];
    values.forEach((row, i) => { if (String(row[0]).trim().toUpperCase() === store) matches.push({ rowNumber: i + 2, entry: this.parseEntry_(row) }); });
    if (matches.length > 1) throw Utils.apiError('BACKGROUND_DUPLICATE', '背景設定に同じ店舗が重複しています。管理者に確認してください');
    return matches[0] || null;
  },

  parseEntry_(row) {
    const e = {};
    BACKGROUND_HEADERS.forEach((h, i) => { e[h] = row[i] === undefined ? '' : String(row[i]); });
    ['width', 'height', 'bytes', 'areaTop', 'areaBottom', 'areaLeft', 'areaRight', 'revision'].forEach(k => {
      e[k] = e[k] === '' ? (k === 'revision' ? 0 : '') : Number(e[k]);
    });
    return e;
  },

  toView_(store, entry) {
    const e = entry || {};
    const d = BACKGROUND_LIMITS.DEFAULT_AREA;
    const num = (v, def) => (v === '' || v === undefined || v === null || isNaN(Number(v)) ? def : Number(v));
    return {
      store,
      revision: e.revision || 0,
      configured: !!e.fileId,
      fileName: e.fileName || '',
      mimeType: e.mimeType || '',
      width: e.width || 0,
      height: e.height || 0,
      bytes: e.bytes || 0,
      updatedAt: e.updatedAt || '',
      settings: {
        fillColor: e.fillColor || '',
        area: { top: num(e.areaTop, d.top), bottom: num(e.areaBottom, d.bottom), left: num(e.areaLeft, d.left), right: num(e.areaRight, d.right) }
      },
      canvas: { width: BACKGROUND_LIMITS.CANVAS_WIDTH, height: BACKGROUND_LIMITS.CANVAS_HEIGHT }
    };
  },

  // 背景ファイルが背景フォルダ内にあることを確認してから返す（設定シートの改ざんで他のファイルを読ませない）
  getBackgroundFile_(fileId) {
    const folder = this.getFolder_({ readOnly: true });
    const file = DriveApp.getFileById(fileId);
    const parents = file.getParents();
    while (parents.hasNext()) {
      if (parents.next().getId() === folder.getId()) return file;
    }
    throw Utils.apiError('BACKGROUND_UNAVAILABLE', '背景画像が背景フォルダにありません。背景を登録し直してください');
  },

  getFolder_(options) {
    const opts = options || {};
    const config = ConfigService.getConfig();
    const props = PropertiesService.getScriptProperties();
    let folderId = String(config.DRIVE_BACKGROUND_FOLDER_ID || props.getProperty('DRIVE_BACKGROUND_FOLDER_ID') || '').trim();
    const isTest = ConfigService.isTestEnvironment();
    if (folderId) {
      if (PRODUCTION_RESOURCE_IDS.indexOf(folderId) !== -1 && isTest) {
        throw Utils.apiError('CONFIG_PRODUCTION_ID_IN_TEST', 'テスト環境の背景フォルダに本番のIDが指定されています');
      }
      if (PRODUCTION_RESOURCE_IDS.indexOf(folderId) !== -1) {
        throw Utils.apiError('CONFIG_INVALID', '背景フォルダにキャスト画像フォルダを指定することはできません');
      }
      return DriveApp.getFolderById(folderId);
    }
    if (!isTest || opts.readOnly) {
      throw Utils.apiError('BACKGROUND_FOLDER_NOT_CONFIGURED', '背景画像の保存先（DRIVE_BACKGROUND_FOLDER_ID）が設定されていません');
    }
    const createdId = BackgroundDrive.newFolder(BACKGROUND_LIMITS.TEST_FOLDER_NAME);
    props.setProperty('DRIVE_BACKGROUND_FOLDER_ID', createdId);
    return DriveApp.getFolderById(createdId);
  }
};

// PNG / JPEG の先頭から形式と実寸を読む（GAS の byte は -128..127 のため & 0xff で扱う）
const BackgroundImageInfo = {
  parse(bytes) {
    const b = i => bytes[i] & 0xff;
    if (bytes.length >= 24 && b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47 &&
        b(12) === 0x49 && b(13) === 0x48 && b(14) === 0x44 && b(15) === 0x52) {
      const u32 = o => ((b(o) << 24) >>> 0) + (b(o + 1) << 16) + (b(o + 2) << 8) + b(o + 3);
      return { mimeType: 'image/png', width: u32(16), height: u32(20) };
    }
    if (bytes.length >= 4 && b(0) === 0xff && b(1) === 0xd8) {
      let o = 2;
      while (o + 9 < bytes.length) {
        if (b(o) !== 0xff) { o += 1; continue; }
        const marker = b(o + 1);
        if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xff) { o += marker === 0xff ? 1 : 2; continue; }
        const len = (b(o + 2) << 8) + b(o + 3);
        if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { mimeType: 'image/jpeg', height: (b(o + 5) << 8) + b(o + 6), width: (b(o + 7) << 8) + b(o + 8) };
        }
        if (len < 2) return null;
        o += 2 + len;
      }
    }
    return null;
  }
};

// Drive REST API（drive.file スコープ）での書き込み。アプリが作成したフォルダ・ファイルにだけ書き込める。
//   - フォルダ作成: POST https://www.googleapis.com/drive/v3/files（mimeType = application/vnd.google-apps.folder）
//   - アップロード: POST https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart（メタデータ + 画像、parents = 背景フォルダ）
//   - 認証: ScriptApp.getOAuthToken()（appsscript.json の oauthScopes で承認された範囲のトークン）
//   - 通信: UrlFetchApp（script.external_request スコープ）
// 読み取りは DriveApp（drive.readonly）と Drive API files.get（drive.readonly / drive.file）。
const BackgroundDrive = {
  newFolder(name) {
    const res = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files?fields=id&supportsAllDrives=true', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      payload: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' })
    });
    return this.idFrom_(res, 'フォルダを作成できません');
  },

  uploadFile(folderId, name, mimeType, bytes) {
    const boundary = 'sim-' + Utilities.getUuid();
    const meta = JSON.stringify({ name, mimeType, parents: [folderId] });
    const head = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta +
      '\r\n--' + boundary + '\r\nContent-Type: ' + mimeType + '\r\n\r\n';
    const tail = '\r\n--' + boundary + '--';
    const contentType = 'multipart/related; boundary=' + boundary;
    // 本文はバイナリ（Blob）で送る（文字列にすると画像のバイト列が文字コード変換で壊れる）
    const body = Utilities.newBlob([].concat(Utilities.newBlob(head).getBytes(), Array.prototype.slice.call(bytes), Utilities.newBlob(tail).getBytes()), contentType);
    const res = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,parents&supportsAllDrives=true', {
      method: 'post', contentType, muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      payload: body
    });
    return this.idFrom_(res, '背景画像を保存できません');
  },

  idFrom_(res, message) {
    const code = res.getResponseCode();
    let body = {};
    try { body = JSON.parse(res.getContentText() || '{}'); } catch (err) { body = {}; }
    if (code < 200 || code >= 300 || !body.id) {
      throw Utils.apiError('DRIVE_WRITE_FAILED', message + '（HTTP ' + code + '）');
    }
    return String(body.id);
  }
};

// ===== 背景機能の自己診断（読み取りのみ。エディタから実行し、実行ログで確認する） =====
// 必要スコープがトークンに含まれているか・背景フォルダ・背景設定シートの状態を確認する。Drive やシートには書き込まない。
const BACKGROUND_REQUIRED_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/script.external_request',
  'https://www.googleapis.com/auth/spreadsheets'
];
function backgroundSelfTest() {
  const checks = [];
  const add = (name, fn) => {
    try { checks.push({ name, ok: true, detail: String(fn() || 'OK') }); }
    catch (err) { checks.push({ name, ok: false, detail: (err && err.code ? '[' + err.code + '] ' : '') + Utils.errorMessage(err) }); }
  };
  add('環境', () => ConfigService.getEnvironment().env);
  add('OAuth スコープ（トークン）', () => {
    const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(ScriptApp.getOAuthToken()), { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('tokeninfo HTTP ' + res.getResponseCode());
    const granted = String(JSON.parse(res.getContentText()).scope || '').split(/\s+/);
    const missing = BACKGROUND_REQUIRED_SCOPES.filter(sc => granted.indexOf(sc) === -1);
    if (missing.length) throw new Error('未承認のスコープ: ' + missing.join(', ') + '（エディタから関数を実行して再承認してください）');
    return '必要なスコープ ' + BACKGROUND_REQUIRED_SCOPES.length + ' 件を確認';
  });
  add('背景フォルダ', () => {
    const config = ConfigService.getConfig();
    const id = String(config.DRIVE_BACKGROUND_FOLDER_ID || PropertiesService.getScriptProperties().getProperty('DRIVE_BACKGROUND_FOLDER_ID') || '').trim();
    if (!id) return ConfigService.isTestEnvironment() ? '未設定（テスト環境では最初の背景保存時に自動作成）' : '未設定（本番は設定が必要）';
    if (PRODUCTION_RESOURCE_IDS.indexOf(id) !== -1) throw Utils.apiError('CONFIG_PRODUCTION_ID_IN_TEST', '本番の画像フォルダ等が指定されています');
    const res = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) +
      '?fields=id,name,mimeType,capabilities(canAddChildren),trashed&supportsAllDrives=true',
      { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('フォルダを参照できません（HTTP ' + res.getResponseCode() + '）');
    const f = JSON.parse(res.getContentText());
    if (f.mimeType !== 'application/vnd.google-apps.folder') throw new Error('フォルダではありません');
    if (f.trashed) throw new Error('ゴミ箱にあります');
    if (!(f.capabilities && f.capabilities.canAddChildren)) throw new Error('このフォルダに書き込めません（drive.file ではアプリが作成したフォルダのみ書き込み可）');
    return 'OK（書き込み可）';
  });
  add('背景設定シート', () => {
    const config = ConfigService.getConfig();
    const sheet = SpreadsheetService.getSpreadsheet().getSheetByName(config.SHEET_BACKGROUND || DEFAULT_CONFIG.SHEET_BACKGROUND);
    if (!sheet) return '未作成（初期シート生成または最初の背景保存で作成）';
    SpreadsheetService.assertHeaders_(sheet, sheet.getName(), BACKGROUND_HEADERS);
    return '登録 ' + Math.max(0, sheet.getLastRow() - 1) + ' 店舗';
  });
  const result = { ok: checks.every(c => c.ok), checks };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}
