// GAS サービスを Node の vm で読み込むためのモック環境（本番には一切接続しない）
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class FakeRange {
  constructor(sheet, row, col, numRows, numCols) {
    Object.assign(this, { sheet, row, col, numRows, numCols });
  }
  cells_(fn) {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const line = [];
      for (let c = 0; c < this.numCols; c++) line.push(fn(this.row + r, this.col + c));
      out.push(line);
    }
    return out;
  }
  getValues() { return this.cells_((r, c) => this.sheet.get(r, c)); }
  getDisplayValues() { return this.cells_((r, c) => String(this.sheet.get(r, c) ?? '')); }
  getDisplayValue() { return String(this.sheet.get(this.row, this.col) ?? ''); }
  setValue(v) { this.sheet.ss.onWrite(this.sheet); this.sheet.set(this.row, this.col, v); return this; }
  setValues(values) {
    this.sheet.ss.onWrite(this.sheet, values.length);
    if (values.length !== this.numRows || values.some(row => row.length !== this.numCols)) throw new Error('setValues size mismatch');
    values.forEach((row, r) => row.forEach((v, c) => this.sheet.set(this.row + r, this.col + c, v)));
    return this;
  }
  clearContent() { this.cells_((r, c) => this.sheet.set(r, c, '')); return this; }
  setNumberFormat() { return this; }
}

class FakeSheet {
  constructor(ss, name) { this.ss = ss; this.name = name; this.rows = []; this.maxRows = 1000; this.maxCols = 26; }
  get(r, c) { return (this.rows[r - 1] || [])[c - 1] ?? ''; }
  set(r, c, v) {
    while (this.rows.length < r) this.rows.push([]);
    this.rows[r - 1][c - 1] = v;
  }
  getName() { return this.name; }
  setName(n) { delete this.ss.sheets[this.name]; this.name = n; this.ss.sheets[n] = this; return this; }
  getLastRow() {
    for (let i = this.rows.length; i > 0; i--) if ((this.rows[i - 1] || []).some(v => v !== '' && v !== undefined && v !== null)) return i;
    return 0;
  }
  getLastColumn() { return this.rows.reduce((m, row) => { let l = 0; (row || []).forEach((v, i) => { if (v !== '' && v != null) l = i + 1; }); return Math.max(m, l); }, 0); }
  getMaxRows() { return Math.max(this.maxRows, this.rows.length); }
  getMaxColumns() { return this.maxCols; }
  insertRowsAfter(_a, n) { this.maxRows += n; }
  insertColumnsAfter(_a, n) { this.maxCols += n; }
  getRange(a, b, c, d) {
    if (typeof a === 'string') {
      const m = a.match(/^([A-Z]+)(\d+)$/);
      const col = m[1].split('').reduce((acc, ch) => acc * 26 + ch.charCodeAt(0) - 64, 0);
      return new FakeRange(this, Number(m[2]), col, 1, 1);
    }
    return new FakeRange(this, a, b, c || 1, d || 1);
  }
  deleteRows(start, count) { this.ss.onWrite(this); this.rows.splice(start - 1, count); }
  setFrozenRows() {}
  clearContents() { this.ss.onWrite(this); this.rows = []; }
  copyTo(ss) { const s = ss.insertSheet('Copy of ' + this.name); s.rows = JSON.parse(JSON.stringify(this.rows)); return s; }
}

class FakeSpreadsheet {
  constructor() { this.sheets = {}; this.failAfterWrites = Infinity; this.writeCount = 0; this.failOnSheet = null; }
  getSheetByName(n) { return this.sheets[n] || null; }
  insertSheet(n) { const s = new FakeSheet(this, n); this.sheets[n] = s; return s; }
  getId() { return this.id || 'TEST_SPREADSHEET'; }
  onWrite(sheet) {
    if (this.failOnSheet && sheet.name !== this.failOnSheet) return;
    this.writeCount += 1;
    if (this.writeCount > this.failAfterWrites) { this.failAfterWrites = Infinity; throw new Error('Injected write failure'); }
  }
  injectFailure(afterWrites, sheetName) { this.writeCount = 0; this.failAfterWrites = afterWrites; this.failOnSheet = sheetName || null; }
}

function createGasContext(opts) {
  const options = opts || {};
  const ss = options.spreadsheet || new FakeSpreadsheet();
  const cacheStore = options.cacheStore || {};
  const props = options.scriptProperties || {};
  const lockState = options.lockState || { held: false, forceTimeout: false };
  let uuidSeq = 0;
  const fetchLog = options.fetchLog || [];
  // Drive REST API（drive.file）のモック: フォルダ作成・multipart アップロード・メタデータ・サムネイル
  const fakeDrive = options.fakeDrive || { folders: {}, files: {}, seq: 0, writes: [] };
  if (!fakeDrive.writes) fakeDrive.writes = [];
  function fakeDriveFetch(url, params) {
    const p = params || {};
    if (url.indexOf('https://www.googleapis.com/') !== 0 && url.indexOf('https://lh3.googleusercontent.com/') !== 0 &&
        url.indexOf('https://oauth2.googleapis.com/tokeninfo') !== 0) return null;
    if (fakeDrive.failWrites && (p.method || '').toLowerCase() === 'post') return { status: 403, body: '{"error":{"message":"forbidden"}}' };
    if (/^https:\/\/www\.googleapis\.com\/drive\/v3\/files\?/.test(url) && (p.method || '').toLowerCase() === 'post') {
      const meta = JSON.parse(p.payload);
      const id = 'FOLDER_NEW_' + (++fakeDrive.seq);
      fakeDrive.folders[id] = { name: meta.name };
      fakeDrive.writes.push({ type: 'folder', id, name: meta.name, auth: (p.headers || {}).Authorization });
      return { status: 200, body: JSON.stringify({ id }) };
    }
    if (url.indexOf('https://oauth2.googleapis.com/tokeninfo') === 0) {
      return { status: 200, body: JSON.stringify({ scope: (fakeDrive.grantedScopes || []).join(' ') }) };
    }
    if (/\/upload\/drive\/v3\/files\?uploadType=multipart/.test(url)) {
      if (!p.payload || !p.payload.__isBlob) return { status: 400, body: '{"error":"payload must be a Blob"}' };
      const buf = Buffer.from(p.payload.getBytes().map(b => b & 0xff));
      const boundary = /boundary=(.+)$/.exec(p.contentType)[1];
      const text = buf.toString('latin1');
      const parts = text.split('--' + boundary);
      const metaPart = parts[1];
      const meta = JSON.parse(Buffer.from(metaPart.slice(metaPart.indexOf('\r\n\r\n') + 4).replace(/\r\n$/, ''), 'latin1').toString('utf8'));
      const filePart = parts[2];
      const body = filePart.slice(filePart.indexOf('\r\n\r\n') + 4).replace(/\r\n$/, '');
      const id = 'FILE_NEW_' + (++fakeDrive.seq);
      fakeDrive.files[id] = { name: meta.name, mimeType: meta.mimeType, parents: meta.parents, bytes: Buffer.from(body, 'latin1') };
      fakeDrive.writes.push({ type: 'file', id, name: meta.name, parents: meta.parents });
      return { status: 200, body: JSON.stringify({ id }) };
    }
    const metaMatch = /\/drive\/v3\/files\/([^?]+)\?fields=/.exec(url);
    if (metaMatch && fakeDrive.folders[decodeURIComponent(metaMatch[1])]) {
      const fid = decodeURIComponent(metaMatch[1]);
      return { status: 200, body: JSON.stringify({ id: fid, name: fakeDrive.folders[fid].name, mimeType: 'application/vnd.google-apps.folder', trashed: false,
        capabilities: { canAddChildren: fakeDrive.folders[fid].canAddChildren !== false } }) };
    }
    if (metaMatch) {
      const id = decodeURIComponent(metaMatch[1]);
      const f = fakeDrive.photos && fakeDrive.photos[id];
      // アプリがアップロードした直後のファイル: サムネイル未作成（thumbnailLink なし）→ 本体の取得にフォールバック
      if (!f && fakeDrive.files[id]) return { status: 200, body: JSON.stringify({ mimeType: fakeDrive.files[id].mimeType, size: String(fakeDrive.files[id].bytes.length) }) };
      if (!f) return { status: 404, body: '{}' };
      return { status: 200, body: JSON.stringify({ thumbnailLink: 'https://lh3.googleusercontent.com/thumb/' + id + '=s220', mimeType: f.mimeType, size: String(f.bytes.length) }) };
    }
    const thumb = /lh3\.googleusercontent\.com\/thumb\/([^=]+)=(s\d+)/.exec(url);
    if (thumb) {
      const f = fakeDrive.photos && fakeDrive.photos[thumb[1]];
      fakeDrive.thumbRequests = (fakeDrive.thumbRequests || []).concat(thumb[2]);
      return f ? { status: 200, bytes: f.bytes, contentType: f.mimeType } : { status: 404 };
    }
    return null;
  }
  const openLog = [];

  const context = {
    console,
    Logger: { log() {} },
    SpreadsheetApp: {
      openById: id => {
        if (options.openableIds && options.openableIds.indexOf(id) === -1) throw new Error('Spreadsheet not found or no access: ' + id);
        openLog.push(id);
        return ss;
      },
      flush() {}, getUi() { throw new Error('no ui'); }
    },
    CacheService: {
      getScriptCache: () => ({
        get: k => (k in cacheStore ? cacheStore[k] : null),
        put: (k, v) => {
          if (options.cachePutThrows) throw new Error('Argument too large');
          if (String(v).length > 100 * 1024) throw new Error('Argument too large');
          cacheStore[k] = v;
        },
        remove: k => { delete cacheStore[k]; }
      })
    },
    LockService: {
      getScriptLock: () => ({
        tryLock() {
          if (lockState.forceTimeout || lockState.held) return false;
          lockState.held = true; return true;
        },
        releaseLock() { lockState.held = false; }
      })
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), getProperties: () => Object.assign({}, props),
      setProperty: (k, v) => { props[k] = String(v); } }) },
    ScriptApp: { getScriptId: () => options.scriptId || '1m0G9Y3ATR885RDD1LBEjp5Zsc5Ts4qv_hq1q9kFw3Xe0WmKy5DQVnATS', getOAuthToken: () => 'FAKE_OAUTH_TOKEN' },
    Utilities: {
      formatDate(date, _tz, pattern) {
        // JST 固定（テスト用）
        const d = new Date(date.getTime() + 9 * 3600000);
        const p = n => String(n).padStart(2, '0');
        const map = { yyyy: d.getUTCFullYear(), MM: p(d.getUTCMonth() + 1), dd: p(d.getUTCDate()), HH: p(d.getUTCHours()), mm: p(d.getUTCMinutes()), ss: p(d.getUTCSeconds()) };
        return pattern.replace(/yyyy|MM|dd|HH|mm|ss/g, k => map[k]);
      },
      getUuid: () => 'uuid-' + (++uuidSeq),
      newBlob: (s, mime, name) => {
        const buf = Array.isArray(s) || Buffer.isBuffer(s) ? Buffer.from(s.map ? s.map(b => b & 0xff) : s) : Buffer.from(String(s), 'utf8');
        return { __isBlob: true, getBytes: () => Array.from(buf).map(b => (b > 127 ? b - 256 : b)), getContentType: () => mime || '', getName: () => name || '' };
      },
      base64Decode: b64 => Array.from(Buffer.from(String(b64), 'base64')).map(b => (b > 127 ? b - 256 : b)),
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { US_ASCII: 'US_ASCII', UTF_8: 'UTF_8' },
      // GAS と同じく符号付きバイト（-128..127）の配列を返す
      computeDigest(alg, value, charset) {
        if (alg !== 'SHA_256') throw new Error('unsupported digest');
        const buf = require('crypto').createHash('sha256').update(Buffer.from(String(value), charset === 'US_ASCII' ? 'latin1' : 'utf8')).digest();
        return Array.from(buf).map(b => (b > 127 ? b - 256 : b));
      },
      base64Encode: b => Buffer.from(Array.from(b).map(x => x & 0xff)).toString('base64')
    },
    DriveApp: {
      getFileById(id) {
        const f = fakeDrive.files[id];
        if (!f) throw new Error('File not found: ' + id);
        const iter = arr => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
        return {
          getId: () => id, getName: () => f.name, getMimeType: () => f.mimeType,
          getBlob: () => ({ getBytes: () => Array.from(f.bytes).map(b => (b > 127 ? b - 256 : b)), getContentType: () => f.mimeType }),
          getParents: () => iter((f.parents || []).map(pid => ({ getId: () => pid })))
        };
      },
      getFolderById(id) {
        if (fakeDrive.folders[id]) {
          return { getId: () => id, getName: () => fakeDrive.folders[id].name };
        }
        const folder = (options.driveFolders || {})[id];
        if (!folder) throw new Error('Folder not found: ' + id);
        const iter = arr => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
        return {
          getId: () => id,
          getFiles: () => iter(folder.files.map(f => ({ getId: () => f.id, getName: () => f.name }))),
          getFolders: () => iter([])
        };
      }
    },
    UrlFetchApp: {
      fetch(url, params) {
        const drive = fakeDriveFetch(url, params);
        if (drive) {
          fetchLog.push(url);
          return { getResponseCode: () => drive.status || 200, getContentText: () => drive.body || '', getHeaders: () => ({}),
            getBlob: () => ({ getBytes: () => Array.from(drive.bytes || []).map(b => (b > 127 ? b - 256 : b)), getContentType: () => drive.contentType || '' }) };
        }
        const handler = options.urlFetch;
        if (!handler) throw new Error('UrlFetchApp not available in this test');
        fetchLog.push(url);
        const res = handler(url, params);
        return {
          getResponseCode: () => res.status || 200,
          getContentText: () => res.body || '',
          getHeaders: () => res.headers || {}
        };
      }
    },
    ContentService: {
      MimeType: { JAVASCRIPT: 'js', JSON: 'json' },
      createTextOutput: body => ({ body, setMimeType() { return this; } })
    },
    Date, JSON, Math, Object, Array, String, Number, RegExp, Error, SyntaxError, Buffer, BigInt: options.noBigInt ? undefined : BigInt
  };
  if (options.now) {
    const fixed = new Date(options.now).getTime();
    context.Date = class extends Date { constructor(...a) { if (a.length) super(...a); else super(fixed); } static now() { return fixed; } };
  }

  const gasDir = path.join(__dirname, '..', 'gas');
  const files = fs.readdirSync(gasDir).filter(f => f.endsWith('.gs')).sort();
  const source = files.map(f => fs.readFileSync(path.join(gasDir, f), 'utf8')).join('\n;\n') +
    '\n;this.__gas = { ShiftService, ShiftRepository, SiftService, ImageService, AuthService, ApiRouter, MigrationService, ConfigService, LogService, SpreadsheetService, Utils, BackgroundService, BackgroundImageInfo, ManualShiftService, StoreImageService, MANUAL_SHIFT_HEADERS, CAST_REGISTRY_HEADERS, BACKGROUND_HEADERS, backgroundSelfTest, doGet, doPost, SHIFT_EDIT_HEADERS, SHIFT_MANAGE_HEADERS, SHIFT_STORAGE, setupShiftImageManager, GoogleIdTokenVerifier, AccessControlService, GOOGLE_ID_TOKEN, authSelfTest, setupTestFixtures, TestFixtures, API_PROTECTED_ACTIONS, API_PUBLIC_ACTIONS, API_REMOVED_ACTIONS };';
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'gas-bundle.js' });
  return { gas: context.__gas, ss, cacheStore, props, lockState, context, fetchLog, openLog, fakeDrive };
}

// 標準的なテスト用スプレッドシート（SIFT_DATA・画像フォルダ・ログ）
function seedSpreadsheet(ss, siftPosts) {
  const sift = ss.insertSheet('SIFT_DATA');
  (siftPosts.KABUKI || []).forEach((t, i) => sift.set(1, i + 1, t));
  (siftPosts.AKIBA || []).forEach((t, i) => sift.set(2, i + 1, t));
  ss.insertSheet('画像生成');
  return ss;
}

module.exports = { FakeSpreadsheet, createGasContext, seedSpreadsheet };
