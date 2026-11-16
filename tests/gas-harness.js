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
  copyTo(ss) { const s = ss.insertSheet('Copy of ' + this.name); s.rows = JSON.parse(JSON.stringify(this.rows)); return s; }
}

class FakeSpreadsheet {
  constructor() { this.sheets = {}; this.failAfterWrites = Infinity; this.writeCount = 0; this.failOnSheet = null; }
  getSheetByName(n) { return this.sheets[n] || null; }
  insertSheet(n) { const s = new FakeSheet(this, n); this.sheets[n] = s; return s; }
  getId() { return 'TEST_SPREADSHEET'; }
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
  const props = Object.assign({}, options.scriptProperties || {});
  const lockState = options.lockState || { held: false, forceTimeout: false };
  let uuidSeq = 0;

  const context = {
    console,
    Logger: { log() {} },
    SpreadsheetApp: { openById: () => ss, flush() {}, getUi() { throw new Error('no ui'); } },
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
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null) }) },
    Utilities: {
      formatDate(date, _tz, pattern) {
        // JST 固定（テスト用）
        const d = new Date(date.getTime() + 9 * 3600000);
        const p = n => String(n).padStart(2, '0');
        const map = { yyyy: d.getUTCFullYear(), MM: p(d.getUTCMonth() + 1), dd: p(d.getUTCDate()), HH: p(d.getUTCHours()), mm: p(d.getUTCMinutes()), ss: p(d.getUTCSeconds()) };
        return pattern.replace(/yyyy|MM|dd|HH|mm|ss/g, k => map[k]);
      },
      getUuid: () => 'uuid-' + (++uuidSeq),
      newBlob: s => ({ getBytes: () => Buffer.from(String(s), 'utf8') }),
      base64Encode: b => Buffer.from(b).toString('base64')
    },
    DriveApp: {
      getFolderById(id) {
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
    ContentService: {
      MimeType: { JAVASCRIPT: 'js', JSON: 'json' },
      createTextOutput: body => ({ body, setMimeType() { return this; } })
    },
    Date, JSON, Math, Object, Array, String, Number, RegExp, Error, SyntaxError, Buffer
  };
  if (options.now) {
    const fixed = new Date(options.now).getTime();
    context.Date = class extends Date { constructor(...a) { if (a.length) super(...a); else super(fixed); } static now() { return fixed; } };
  }

  const gasDir = path.join(__dirname, '..', 'gas');
  const files = fs.readdirSync(gasDir).filter(f => f.endsWith('.gs')).sort();
  const source = files.map(f => fs.readFileSync(path.join(gasDir, f), 'utf8')).join('\n;\n') +
    '\n;this.__gas = { ShiftService, ShiftRepository, SiftService, ImageService, AuthService, ApiRouter, MigrationService, ConfigService, LogService, SpreadsheetService, Utils, doGet, doPost, SHIFT_EDIT_HEADERS, SHIFT_MANAGE_HEADERS, SHIFT_STORAGE, setupShiftImageManager };';
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'gas-bundle.js' });
  return { gas: context.__gas, ss, cacheStore, props, lockState, context };
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
