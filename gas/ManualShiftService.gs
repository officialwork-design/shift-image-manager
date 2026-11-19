/**
 * 手動モード（キャスト名を手入力して画像を作る）
 *
 * - SIFT_DATA・シフト編集・シフト編集管理は一切読み書きしない（自動モードのデータとは完全に別）。
 * - 手動シフト: 店舗×日付ごとのキャスト一覧（並び順・名前・キャストID・画像ID）を「手動シフト」シートに保存する。
 *     保存のたびに新しい revision の行一式を追記 → 書き込みを確認 → 古い revision の行を削除する。
 *     読み取りは「行数が rowCount と一致する最も新しい revision」だけを使う（途中で失敗した書き込みは見えない）。
 *     expectedRevision が現在の revision と異なる保存は REVISION_CONFLICT（自動で上書きしない）。
 * - キャスト画像: 「キャスト画像」シートで castId（c_xxxx）と写真ファイルを結び付ける。
 *     同じ名前のキャストが複数いても castId で区別する（名前だけで写真を選ばない）。
 *     既存の画像フォルダ（DRIVE_IMAGE_FOLDER_ID）にある「名前.png」も候補にする（castId = drive:<fileId>）。
 * - 写真の登録は Drive REST（drive.file）でアプリ専用のフォルダに保存する（背景と同じ方式）。
 *     DRIVE_CAST_PHOTO_FOLDER_ID が未設定のとき、テスト環境に限りフォルダを自動作成する（本番は設定必須）。
 * - 写真は data URL で返す（Canvas を汚染させず PNG 保存できるようにする）。
 * - 店舗別キャスト画像フォルダ（StoreImageService。DRIVE_KABUKI/AKIBA_CAST_FOLDER_ID）のファイルも候補にする（castId = drive:<fileId>）。
 *   候補: 出勤先店舗のフォルダ ＋ この画面で登録したキャスト → 既存の画像フォルダ（出勤先店舗のフォルダが未設定の店舗だけ）。
 *   他店舗のフォルダの写真は候補にしない（保存・写真取得の検証も同じ）。
 *   同じ名前に候補が2つ以上あれば画面で選ぶ（名前だけで写真を決めない）。
 */
const MANUAL_SHIFT_HEADERS = ['store', 'date', 'sortOrder', 'castName', 'castId', 'imageFileId',
  'updatedAt', 'revision', 'rowCount', 'updatedBy'];
const CAST_REGISTRY_HEADERS = ['castId', 'castName', 'nameKey', 'imageFileId', 'fileName', 'mimeType',
  'width', 'height', 'revision', 'updatedAt', 'updatedBy'];

const MANUAL_LIMITS = {
  MAX_CASTS: 40,
  MAX_NAME_LENGTH: 30,
  MAX_LOOKUP_NAMES: 60,
  PHOTO_MAX_BYTES: 3 * 1024 * 1024,
  PHOTO_MIN_SIDE: 100,
  PHOTO_MAX_SIDE: 6000,
  PHOTO_MIME_TYPES: ['image/png', 'image/jpeg'],
  TEST_PHOTO_FOLDER_NAME: 'Shift Image Manager TEST Cast Photos'
};

const ManualShiftService = {
  MC: { STORE: 0, DATE: 1, SORT: 2, NAME: 3, CAST_ID: 4, IMAGE: 5, UPDATED_AT: 6, REVISION: 7, ROW_COUNT: 8, UPDATED_BY: 9 },
  RC: { CAST_ID: 0, NAME: 1, KEY: 2, IMAGE: 3, FILE_NAME: 4, MIME: 5, WIDTH: 6, HEIGHT: 7, REVISION: 8, UPDATED_AT: 9, UPDATED_BY: 10 },

  // ===== 手動シフトの取得 =====
  getManualShift(store, date) {
    const target = Utils.requireStoreAndIsoDate(store, date);
    const sheet = this.findSheet_(this.manualSheetName_(), MANUAL_SHIFT_HEADERS);
    const current = sheet ? this.readCurrent_(sheet, target.store, target.date) : { revision: 0, rows: [], updatedAt: '' };
    const src = this.sources_(target.store);
    const rows = current.rows.map(r => Object.assign({ sortOrder: r.sortOrder, castName: r.castName, castId: r.castId, imageFileId: r.imageFileId },
      { photo: this.resolvePhoto_(r.castId, r.castName, src) }));
    return { store: target.store, date: target.date, revision: current.revision, updatedAt: current.updatedAt, rows,
      folderWarning: this.warningOf_(src), storeFolderConfigured: src.store.configured };
  },

  // ===== 手動シフトの保存 =====
  // payload: { store, date, expectedRevision, rows: [{ castName, castId? }] }（配列の順番が並び順）
  saveManualShift(payload, ctx) {
    const p = payload || {};
    const target = Utils.requireStoreAndIsoDate(p.store, p.date);
    const expected = this.requireRevision_(p.expectedRevision);
    const context = ctx || {};
    if (!Array.isArray(p.rows)) throw Utils.apiError('INVALID_ROWS', 'rows を配列で指定してください');
    if (p.rows.length > MANUAL_LIMITS.MAX_CASTS) {
      throw Utils.apiError('TOO_MANY_CASTS', 'キャストは ' + MANUAL_LIMITS.MAX_CASTS + ' 人までです');
    }
    const src = this.sources_(target.store);
    const records = p.rows.map((row, index) => {
      const castName = this.requireCastName_(row && row.castName, index);
      const castId = String((row && row.castId) || '').trim();
      let imageFileId = '';
      if (castId) {
        const cand = this.findCandidateById_(castId, src);
        if (!cand) throw Utils.apiError('UNKNOWN_CAST', (index + 1) + '行目: キャストID が見つかりません（' + castName + '）。写真を選び直してください', { index });
        if (!this.candidateMatchesName_(cand, castName, src)) {
          throw Utils.apiError('CAST_MISMATCH', (index + 1) + '行目: 名前とキャストID が一致しません（' + castName + '）', { index });
        }
        imageFileId = cand.imageFileId;
      }
      return { castName, castId, imageFileId };
    });

    const result = ShiftService.withLock_(() => {
      const sheet = this.ensureSheet_(this.manualSheetName_(), MANUAL_SHIFT_HEADERS);
      const all = this.readKeyRows_(sheet, target.store, target.date);
      const current = this.pickCurrent_(all);
      if (expected !== current.revision) {
        throw Utils.apiError('REVISION_CONFLICT', '他の端末または画面で手動シフトが更新されています。最新の内容を読み込んでから、もう一度保存してください。',
          { expectedRevision: expected, currentRevision: current.revision });
      }
      const maxRevision = all.reduce((m, r) => Math.max(m, r.revision), 0);
      const newRevision = Math.max(current.revision, maxRevision) + 1;
      const now = Utils.now();
      const user = context.user || '';
      const values = records.length
        ? records.map((r, i) => [target.store, target.date, i + 1, r.castName, r.castId, r.imageFileId, now, newRevision, records.length, user])
        : [[target.store, target.date, 0, '', '', '', now, newRevision, 0, user]];   // 0人で保存した印（sortOrder 0）
      SpreadsheetService.appendTextRows(sheet, values, MANUAL_SHIFT_HEADERS.length);
      SpreadsheetService.flush();

      const written = this.readKeyRows_(sheet, target.store, target.date).filter(r => r.revision === newRevision);
      if (written.length !== values.length) {
        throw Utils.apiError('WRITE_VERIFY_FAILED', '手動シフトの書き込み確認に失敗しました。保存は反映されていません。',
          { expected: values.length, actual: written.length });
      }
      // 古い revision（と途中で失敗した行）を削除。失敗しても読み取りは最新の完全な revision を使うので保存は成功
      try {
        const old = this.readKeyRows_(sheet, target.store, target.date).filter(r => r.revision !== newRevision).map(r => r.rowIndex);
        if (old.length) { SpreadsheetService.deleteSheetRows(sheet, old); SpreadsheetService.flush(); }
      } catch (err) {
        LogService.error('ManualShiftService.prune', err, { store: target.store, date: target.date, revision: newRevision });
      }
      return { revision: newRevision, updatedAt: now };
    });

    LogService.audit({ action: '手動シフト保存', store: target.store, date: target.date, revision: result.revision,
      user: context.user, userLabel: context.userLabel, result: '成功', detail: 'count=' + records.length });
    return this.getManualShift(target.store, target.date);
  },

  // ===== 名前 → 写真の候補（castId 単位） =====
  // store: 店舗（必須）。refresh=true で店舗フォルダの一覧を Drive から読み直す
  lookupCasts(names, store, options) {
    if (!Array.isArray(names)) throw Utils.apiError('INVALID_REQUEST', 'names を配列で指定してください');
    if (names.length > MANUAL_LIMITS.MAX_LOOKUP_NAMES) throw Utils.apiError('INVALID_REQUEST', '一度に検索できる名前は ' + MANUAL_LIMITS.MAX_LOOKUP_NAMES + ' 件までです');
    const s = BackgroundService.requireStore_(store);
    const src = this.sources_(s, options);
    const results = names.map(raw => {
      const name = String(raw || '').trim().slice(0, MANUAL_LIMITS.MAX_NAME_LENGTH);
      return { name, candidates: name ? this.candidatesFor_(name, src) : [] };
    });
    return { store: s, results, folderWarning: this.warningOf_(src), storeFolderConfigured: src.store.configured,
      storeImageCount: src.store.files.length };
  },

  // ===== 画像生成用の写真（data URL）。登録済みの写真ファイルだけ返す =====
  getManualPhotos(fileIds, store) {
    if (!Array.isArray(fileIds)) throw Utils.apiError('INVALID_REQUEST', 'fileIds を配列で指定してください');
    const ids = fileIds.map(id => String(id || '').trim()).filter((id, i, a) => id && a.indexOf(id) === i);
    if (ids.length > BACKGROUND_LIMITS.MAX_PHOTOS) {
      throw Utils.apiError('TOO_MANY_PHOTOS', '写真の数が上限（' + BACKGROUND_LIMITS.MAX_PHOTOS + '）を超えています');
    }
    const src = this.sources_(store ? BackgroundService.requireStore_(store) : '');
    const known = {};
    src.registry.forEach(e => { if (e.imageFileId) known[e.imageFileId] = true; });
    src.folder.files.forEach(f => { if (this.folderFileAllowed_(f.fileId, src)) known[f.fileId] = true; });   // 共通フォルダ（他店舗のフォルダ分は除く）
    if (src.lookup) src.lookup.allFiles().forEach(f => { known[f.fileId] = true; });   // 出勤先店舗のフォルダだけ
    const photos = {};
    const failed = [];
    ids.forEach(id => {
      if (!known[id]) { failed.push({ fileId: id, reason: 'NOT_REGISTERED' }); return; }
      try { photos[id] = BackgroundService.fetchPhotoDataUrl_(id); }
      catch (err) { failed.push({ fileId: id, reason: 'UNAVAILABLE' }); }
    });
    return { photos, failed };
  },

  // ===== キャスト写真の登録・差し替え =====
  // payload: { castName, castId?, expectedRevision?, allowSameName?, image: { dataBase64, mimeType, fileName } }
  //  - castId あり: そのキャストの写真を差し替える（expectedRevision 必須・名前が一致すること）
  //  - castId なし: 新しいキャストとして登録。同じ名前が既にあれば CAST_NAME_EXISTS（allowSameName=true で同名の別キャストとして登録）
  registerCastPhoto(payload, ctx) {
    const p = payload || {};
    const context = ctx || {};
    const castName = this.requireCastName_(p.castName, 0);
    const nameKey = this.nameKey_(castName);
    const castId = String(p.castId || '').trim();
    if (castId && !/^c_[A-Za-z0-9_-]{1,64}$/.test(castId)) throw Utils.apiError('INVALID_CAST_ID', '写真を差し替えられるのは、この画面で登録したキャストだけです');
    const expected = castId ? this.requireRevision_(p.expectedRevision) : 0;
    if (!p.image) throw Utils.apiError('INVALID_IMAGE', '写真を指定してください');
    const image = this.validatePhoto_(p.image);

    const entry = ShiftService.withLock_(() => {
      const sheet = this.ensureSheet_(this.registrySheetName_(), CAST_REGISTRY_HEADERS);
      const rows = this.readRegistryRows_(sheet);
      let found = null;
      if (castId) {
        found = rows.find(r => r.entry.castId === castId) || null;
        if (!found) throw Utils.apiError('UNKNOWN_CAST', 'キャストが見つかりません。画面を再読み込みしてください');
        if (found.entry.nameKey !== nameKey) throw Utils.apiError('CAST_MISMATCH', '名前とキャストID が一致しません');
        if (found.entry.revision !== expected) {
          throw Utils.apiError('REVISION_CONFLICT', '他の端末でこのキャストの写真が更新されています。再読み込みしてください',
            { expectedRevision: expected, currentRevision: found.entry.revision });
        }
      } else {
        const same = rows.filter(r => r.entry.nameKey === nameKey);
        if (same.length && p.allowSameName !== true) {
          throw Utils.apiError('CAST_NAME_EXISTS', '「' + castName + '」は既に登録されています。写真を差し替えるか、同じ名前の別のキャストとして登録するか選んでください',
            { candidates: same.map(r => this.registryView_(r.entry)) });
        }
      }
      const folder = this.getPhotoFolder_();
      const ext = image.mimeType === 'image/png' ? '.png' : '.jpg';
      const id = castId || ('c_' + String(Utilities.getUuid()).replace(/[^A-Za-z0-9]/g, '').slice(0, 24));
      const fileName = castName + '_' + id + '_' + Utilities.formatDate(new Date(), DEFAULT_CONFIG.TIMEZONE, 'yyyyMMdd_HHmmss') + ext;
      const fileId = BackgroundDrive.uploadFile(folder.getId(), fileName, image.mimeType, image.bytes);
      const next = {
        castId: id, castName, nameKey, imageFileId: fileId, fileName, mimeType: image.mimeType,
        width: image.width, height: image.height, revision: (found ? found.entry.revision : 0) + 1,
        updatedAt: Utils.now(), updatedBy: context.user || ''
      };
      const row = CAST_REGISTRY_HEADERS.map(h => String(next[h] === undefined || next[h] === null ? '' : next[h]));
      if (found) SpreadsheetService.writeTextRow(sheet, found.rowIndex, row);
      else SpreadsheetService.appendTextRows(sheet, [row], CAST_REGISTRY_HEADERS.length);
      SpreadsheetService.flush();
      return next;
    });

    LogService.audit({ action: castId ? 'キャスト写真差し替え' : 'キャスト写真登録', user: context.user, userLabel: context.userLabel,
      result: '成功', detail: entry.castId + ' ' + entry.width + 'x' + entry.height });
    return this.registryView_(entry);
  },

  // ===== 内部: 手動シフトの読み取り =====
  readKeyRows_(sheet, store, date) {
    const out = [];
    SpreadsheetService.readTable(sheet, MANUAL_SHIFT_HEADERS.length).forEach((row, index) => {
      if (row[this.MC.STORE] !== store || row[this.MC.DATE] !== date) return;
      out.push({
        rowIndex: index + 2,
        revision: Number(row[this.MC.REVISION]) || 0,
        rowCount: Number(row[this.MC.ROW_COUNT]) || 0,
        sortOrder: Number(row[this.MC.SORT]) || 0,
        castName: row[this.MC.NAME],
        castId: row[this.MC.CAST_ID],
        imageFileId: row[this.MC.IMAGE],
        updatedAt: row[this.MC.UPDATED_AT]
      });
    });
    return out;
  },

  // 行数が rowCount と一致する revision のうち最新のもの（途中失敗の世代は使わない）
  pickCurrent_(all) {
    const byRev = {};
    all.forEach(r => { (byRev[r.revision] = byRev[r.revision] || []).push(r); });
    const revisions = Object.keys(byRev).map(Number).filter(n => n > 0).sort((a, b) => b - a);
    for (let i = 0; i < revisions.length; i += 1) {
      const rows = byRev[revisions[i]];
      const expectedCount = rows[0].rowCount;
      const casts = rows.filter(r => r.sortOrder > 0);
      const complete = expectedCount === 0 ? (rows.length === 1 && casts.length === 0)
        : (casts.length === expectedCount && rows.every(r => r.rowCount === expectedCount));
      if (complete) {
        casts.sort((a, b) => a.sortOrder - b.sortOrder);
        return { revision: revisions[i], rows: casts, updatedAt: rows[0].updatedAt };
      }
    }
    return { revision: 0, rows: [], updatedAt: '' };
  },

  readCurrent_(sheet, store, date) {
    return this.pickCurrent_(this.readKeyRows_(sheet, store, date));
  },

  // ===== 内部: キャスト画像（castId ↔ 写真） =====
  readRegistry_() {
    const sheet = this.findSheet_(this.registrySheetName_(), CAST_REGISTRY_HEADERS);
    return sheet ? this.readRegistryRows_(sheet).map(r => r.entry) : [];
  },

  readRegistryRows_(sheet) {
    return SpreadsheetService.readTable(sheet, CAST_REGISTRY_HEADERS.length)
      .map((row, index) => ({ rowIndex: index + 2, entry: {
        castId: row[this.RC.CAST_ID], castName: row[this.RC.NAME], nameKey: row[this.RC.KEY] || this.nameKey_(row[this.RC.NAME]),
        imageFileId: row[this.RC.IMAGE], fileName: row[this.RC.FILE_NAME], mimeType: row[this.RC.MIME],
        width: Number(row[this.RC.WIDTH]) || 0, height: Number(row[this.RC.HEIGHT]) || 0,
        revision: Number(row[this.RC.REVISION]) || 0, updatedAt: row[this.RC.UPDATED_AT]
      } }))
      .filter(r => r.entry.castId);
  },

  registryView_(e) {
    return { castId: e.castId, castName: e.castName, imageFileId: e.imageFileId, width: Number(e.width) || 0, height: Number(e.height) || 0,
      revision: Number(e.revision) || 0, updatedAt: e.updatedAt || '', source: 'registry' };
  },

  // 既存の画像フォルダ（自動モードと同じ）。読めなくても手動モードは続ける
  readFolderImages_() {
    try {
      const data = ImageService.getDriveImagesCached();
      return { files: Array.isArray(data.imageFiles) ? data.imageFiles : [], imageMap: data.imageMap || {}, warning: '' };
    } catch (err) {
      return { files: [], imageMap: {}, warning: '画像フォルダを読み込めませんでした: ' + Utils.errorMessage(err) };
    }
  },

  // 写真の参照元（登録キャスト・既存の画像フォルダ・店舗フォルダ）
  // lookup: 店舗別の検索器（出勤先店舗のフォルダだけ）。store は出勤先店舗のフォルダ
  sources_(store, options) {
    const registry = this.readRegistry_();
    const folder = this.readFolderImages_();
    const lookup = store ? StoreImageService.createLookup(store, options) : null;
    const storeImgs = lookup ? lookup.images(lookup.store) : { configured: false, files: [], keyMap: {}, warning: '' };
    const warning = [storeImgs.warning, folder.warning].filter(Boolean).join(' / ');
    return { registry, folder, store: storeImgs, storeName: lookup ? lookup.store : '', lookup, warning };
  },

  // 画面に出す警告
  warningOf_(src) {
    const extra = src.lookup ? src.lookup.warnings() : [];
    return [src.warning].concat(extra).filter(Boolean).join(' / ');
  },

  // 共通画像フォルダのファイルのうち、もう一方の店舗のフォルダにあるものは使わない
  folderFileAllowed_(fileId, src) {
    return !(src.lookup && src.lookup.excludesFileId(fileId));
  },

  storeCandidate_(f, store) {
    return { castId: 'drive:' + f.fileId, castName: f.name, imageFileId: f.fileId, revision: 0, source: 'store', fileName: f.name, photoStore: store };
  },

  candidatesFor_(name, src) {
    const registry = src.registry, folder = src.folder;
    const key = this.nameKey_(name);
    const own = src.lookup ? StoreImageService.findFiles(src.store, name) : [];
    const fromStore = own.map(f => this.storeCandidate_(f, src.storeName));
    const fromRegistry = registry.filter(e => e.nameKey === key).map(e => this.registryView_(e));
    if (fromStore.length || fromRegistry.length) return fromStore.concat(fromRegistry);
    // 店舗フォルダが設定されている店舗では、店舗共通の既存画像フォルダは使わない（名前の前方一致で別人の写真を出さない）
    if (src.store.configured && !src.store.error) return [];
    const fileId = ImageService.findImageIdForCast(folder.imageMap, name);
    if (!fileId || !this.folderFileAllowed_(fileId, src)) return [];
    const file = folder.files.find(f => f.fileId === fileId);
    return [{ castId: 'drive:' + fileId, castName: name, imageFileId: fileId, revision: 0, source: 'folder', fileName: file ? file.name : '' }];
  },

  findCandidateById_(castId, src) {
    if (castId.indexOf('drive:') === 0) {
      const fileId = castId.slice(6);
      const photoStore = src.lookup ? src.lookup.storeOf(fileId) : '';
      if (photoStore) return { castId, imageFileId: fileId, source: 'store', photoStore };
      const file = src.folder.files.find(f => f.fileId === fileId);
      if (!file || !this.folderFileAllowed_(fileId, src)) return null;
      return { castId, imageFileId: fileId, source: 'folder' };
    }
    const e = src.registry.find(r => r.castId === castId);
    return e ? { castId, imageFileId: e.imageFileId, nameKey: e.nameKey, source: 'registry' } : null;
  },

  // フォルダ画像は「その名前で検索すると同じファイルになる」こと、登録キャストは名前キーの一致で確認する
  candidateMatchesName_(cand, castName, src) {
    // 店舗フォルダの写真は「今その名前で検索したときの候補」に含まれること（他店舗の写真は保存させない）
    if (cand.source === 'store') return this.candidatesFor_(castName, src).some(c => c.source === 'store' && c.imageFileId === cand.imageFileId);
    if (cand.source === 'folder') return ImageService.findImageIdForCast(src.folder.imageMap, castName) === cand.imageFileId;
    return cand.nameKey === this.nameKey_(castName);
  },

  resolvePhoto_(castId, castName, src) {
    if (castId) {
      const cand = this.findCandidateById_(castId, src);
      if (!cand || !this.candidateMatchesName_(cand, castName, src)) return { status: 'missing', imageFileId: '', reason: 'キャストID が見つかりません' };
      const photo = { status: cand.imageFileId ? 'registered' : 'missing', imageFileId: cand.imageFileId, source: cand.source };
      if (cand.photoStore) photo.photoStore = cand.photoStore;
      return photo;
    }
    const candidates = this.candidatesFor_(castName, src);
    if (candidates.length > 1) return { status: 'ambiguous', imageFileId: '', candidates };
    if (candidates.length === 1) return { status: 'unlinked', imageFileId: '', candidates };
    return { status: 'missing', imageFileId: '' };
  },

  nameKey_(name) {
    const raw = String(name || '').trim();
    return (SiftService.normalizeCastName(raw) || Utils.normalize(raw) || raw).normalize('NFKC');
  },

  // ===== 内部: 入力検証 =====
  requireCastName_(value, index) {
    const name = String(value === undefined || value === null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (!name) throw Utils.apiError('INVALID_CAST_NAME', (index + 1) + '行目: キャスト名を入力してください', { index });
    if (name.length > MANUAL_LIMITS.MAX_NAME_LENGTH) {
      throw Utils.apiError('INVALID_CAST_NAME', (index + 1) + '行目: キャスト名は ' + MANUAL_LIMITS.MAX_NAME_LENGTH + ' 文字以内にしてください', { index });
    }
    return name;
  },

  requireRevision_(value) {
    return BackgroundService.requireRevision_(value);
  },

  validatePhoto_(image) {
    const mimeType = String(image.mimeType || '').toLowerCase();
    if (MANUAL_LIMITS.PHOTO_MIME_TYPES.indexOf(mimeType) === -1) throw Utils.apiError('INVALID_IMAGE_TYPE', '写真は PNG または JPEG を指定してください');
    const b64 = String(image.dataBase64 || '').replace(/^data:[^,]*,/, '');
    if (!b64 || !/^[A-Za-z0-9+/=\s]+$/.test(b64)) throw Utils.apiError('INVALID_IMAGE', '画像データが不正です');
    if (b64.length > Math.ceil(MANUAL_LIMITS.PHOTO_MAX_BYTES / 3) * 4 + 4) throw Utils.apiError('IMAGE_TOO_LARGE', '写真は 3MB 以下にしてください');
    const bytes = Utilities.base64Decode(b64);
    if (bytes.length > MANUAL_LIMITS.PHOTO_MAX_BYTES) throw Utils.apiError('IMAGE_TOO_LARGE', '写真は 3MB 以下にしてください');
    const info = BackgroundImageInfo.parse(bytes);
    if (!info || info.mimeType !== mimeType) throw Utils.apiError('INVALID_IMAGE', '画像の形式を判別できません（PNG / JPEG のみ）');
    if (Math.min(info.width, info.height) < MANUAL_LIMITS.PHOTO_MIN_SIDE || Math.max(info.width, info.height) > MANUAL_LIMITS.PHOTO_MAX_SIDE) {
      throw Utils.apiError('INVALID_IMAGE_SIZE', '写真の大きさは ' + MANUAL_LIMITS.PHOTO_MIN_SIDE + '〜' + MANUAL_LIMITS.PHOTO_MAX_SIDE + 'px にしてください');
    }
    return { bytes, mimeType, width: info.width, height: info.height };
  },

  // ===== 内部: シート・フォルダ =====
  manualSheetName_() {
    return ConfigService.getConfig().SHEET_MANUAL_SHIFT || DEFAULT_CONFIG.SHEET_MANUAL_SHIFT;
  },

  registrySheetName_() {
    return ConfigService.getConfig().SHEET_CAST_REGISTRY || DEFAULT_CONFIG.SHEET_CAST_REGISTRY;
  },

  // 読み取り用: 無ければ null（読み取りではシートを作らない）。あればヘッダーを検証
  findSheet_(name, headers) {
    const sheet = SpreadsheetService.getSpreadsheet().getSheetByName(name);
    if (!sheet) return null;
    SpreadsheetService.assertHeaders_(sheet, name, headers);
    return sheet;
  },

  // 書き込み用: 無ければヘッダー付きで作成（既存シートは変更しない）
  ensureSheet_(name, headers) {
    return SpreadsheetService.ensureSchemaSheet_(SpreadsheetService.getSpreadsheet(), name, headers, []);
  },

  getPhotoFolder_() {
    const config = ConfigService.getConfig();
    const props = PropertiesService.getScriptProperties();
    const folderId = String(config.DRIVE_CAST_PHOTO_FOLDER_ID || props.getProperty('DRIVE_CAST_PHOTO_FOLDER_ID') || '').trim();
    const isTest = ConfigService.isTestEnvironment();
    if (folderId) {
      if (PRODUCTION_RESOURCE_IDS.indexOf(folderId) !== -1) {
        throw Utils.apiError(isTest ? 'CONFIG_PRODUCTION_ID_IN_TEST' : 'CONFIG_INVALID', 'キャスト写真の保存先に既存の画像フォルダ・本番のIDは指定できません');
      }
      return DriveApp.getFolderById(folderId);
    }
    if (!isTest) {
      throw Utils.apiError('CAST_PHOTO_FOLDER_NOT_CONFIGURED', 'キャスト写真の保存先（DRIVE_CAST_PHOTO_FOLDER_ID）が設定されていません');
    }
    const createdId = BackgroundDrive.newFolder(MANUAL_LIMITS.TEST_PHOTO_FOLDER_NAME);
    props.setProperty('DRIVE_CAST_PHOTO_FOLDER_ID', createdId);
    return DriveApp.getFolderById(createdId);
  }
};
