/**
 * 店舗×日付別 編集データの業務ロジック（Phase 1.5）
 * - 読み取り（getSavedShift / getShiftSnapshot / getImageList）は副作用なし
 * - 更新（initializeShift / saveShift / setCastAbsent / resetShiftFromSource）は LockService 内で
 *   revision を再取得・検証してから ShiftRepository.commit を呼ぶ
 * - 旧「画像生成」シート（単一スロット）には一切書き込まない
 */
const ShiftService = {
  // ===== 読み取り =====

  getSavedShift(store, date) {
    const target = Utils.requireStoreAndIsoDate(store, date);
    const saved = ShiftRepository.readCommitted(target.store, target.date);
    return this.buildView_(target, saved);
  },

  // 旧 API 互換（読み取り専用）。store/date 必須。旧シートの A1/C1 は参照しない。
  getImageList(store, date) {
    return this.getSavedShift(store, date);
  },

  // 投稿文生成・画像生成用の読み取り専用スナップショット
  getShiftSnapshot(store, date) {
    const target = Utils.requireStoreAndIsoDate(store, date);
    const saved = ShiftRepository.readCommitted(target.store, target.date);
    const imageData = ImageService.getDriveImagesCached();
    const storeFinder = this.storeImageFinder_(target.store);
    return {
      store: target.store,
      date: target.date,
      dateLabel: Utils.isoToLabel(target.date),
      revision: saved.revision,
      initialized: saved.initialized,
      casts: saved.rows.map(row => {
        const resolved = this.resolveImage_(imageData, row, storeFinder);
        return {
          recordId: row.recordId,
          sortOrder: row.sortOrder,
          castName: row.castName,
          workTime: row.workTime,
          status: row.status,
          imageFileId: row.imageFileId,
          imageSource: resolved.source,
          resolvedImageFileId: resolved.fileId
        };
      })
    };
  },

  // ===== 更新（すべてロック内で revision を再検証） =====

  // 保存データが無い場合のみ SIFT_DATA から作成。既存データは上書きしない。
  initializeShift(store, date, ctx) {
    const target = Utils.requireStoreAndIsoDate(store, date);
    const context = ctx || {};
    const result = this.withLock_(() => {
      const current = ShiftRepository.readCommitted(target.store, target.date);
      if (current.initialized) {
        return { created: false, saved: current };
      }
      const parsed = SiftService.getParsedShift(target.store, target.date);
      const records = parsed.castRows.map(item => ({
        recordId: Utils.uuid(),
        castName: item.castName,
        workTime: WORK_TIME_OPTIONS.indexOf(item.workTime) !== -1 ? item.workTime : '',
        status: '出勤',
        imageFileId: ''
      }));
      this.assertRowLimit_(records);
      const commit = ShiftRepository.commit({
        store: target.store, date: target.date, expectedRevision: current.revision,
        records, requestId: context.requestId, user: context.user, userLabel: context.userLabel, source: 'sift'
      });
      return { created: !commit.replayed, commit, saved: ShiftRepository.readCommitted(target.store, target.date) };
    });

    if (result.created) {
      LogService.audit({ action: '初回データ作成', store: target.store, date: target.date,
        revision: result.saved.revision, user: context.user, userLabel: context.userLabel, result: '成功', detail: 'count=' + result.saved.rows.length });
    }
    return Object.assign(this.buildView_(target, result.saved), { created: result.created });
  },

  saveShift(store, date, expectedRevision, rows, ctx) {
    const target = Utils.requireStoreAndIsoDate(store, date);
    const context = ctx || {};
    const expected = this.requireRevision_(expectedRevision);
    if (!Array.isArray(rows)) throw Utils.apiError('INVALID_ROWS', 'rows は配列で指定してください');

    const imageData = ImageService.getDriveImagesCached();
    const normalized = rows
      .map((row, index) => this.normalizeEditableRow_(row, index + 1, imageData))
      .sort((a, b) => a.sortOrder - b.sortOrder);
    this.assertRowLimit_(normalized);

    const result = this.withLock_(() => {
      const current = ShiftRepository.readCommitted(target.store, target.date);
      const replay = !!(context.requestId && current.meta && current.meta.lastRequestId === context.requestId);
      if (!current.initialized && !replay) {
        throw Utils.apiError('NOT_INITIALIZED', 'この店舗・日付の保存データがありません。先に読み込みを行ってください');
      }
      // revision 競合を recordId 検証より先に判定する（他端末で削除された行が原因の誤ったエラーを防ぐ）
      if (!replay) this.assertRevision_(expected, current.revision);
      const records = replay ? current.rows : this.assignRecordIds_(normalized, current.rows);
      const commit = ShiftRepository.commit({
        store: target.store, date: target.date, expectedRevision: expected,
        records, requestId: context.requestId, user: context.user, userLabel: context.userLabel, source: 'edit'
      });
      return { commit, saved: ShiftRepository.readCommitted(target.store, target.date) };
    });

    LogService.audit({ action: '編集保存', store: target.store, date: target.date,
      revision: result.commit.revision, user: context.user, userLabel: context.userLabel,
      result: result.commit.replayed ? '成功(再送)' : '成功', detail: 'count=' + result.saved.rows.length });
    return Object.assign(this.buildView_(target, result.saved), { replayed: result.commit.replayed });
  },

  setCastAbsent(store, date, recordId, isAbsent, expectedRevision, ctx) {
    const target = Utils.requireStoreAndIsoDate(store, date);
    const context = ctx || {};
    const expected = this.requireRevision_(expectedRevision);
    const id = String(recordId || '').trim();
    if (!id) throw Utils.apiError('INVALID_RECORD_ID', 'recordId が未指定です');
    const status = Utils.toBoolean(isAbsent) ? '休み' : '出勤';
    let castName = '';

    const result = this.withLock_(() => {
      const current = ShiftRepository.readCommitted(target.store, target.date);
      const replay = context.requestId && current.meta && current.meta.lastRequestId === context.requestId;
      if (!replay) {
        if (!current.initialized) throw Utils.apiError('NOT_INITIALIZED', 'この店舗・日付の保存データがありません');
        this.assertRevision_(expected, current.revision);
        if (!current.rows.some(row => row.recordId === id)) {
          throw Utils.apiError('RECORD_NOT_FOUND', '指定されたキャストはこの店舗・日付に存在しません');
        }
      }
      const records = current.rows.map(row => {
        if (row.recordId !== id) return row;
        castName = row.castName;
        return Object.assign({}, row, { status });
      });
      const commit = ShiftRepository.commit({
        store: target.store, date: target.date, expectedRevision: expected,
        records, requestId: context.requestId, user: context.user, userLabel: context.userLabel, source: 'absent'
      });
      return { commit, saved: ShiftRepository.readCommitted(target.store, target.date) };
    });

    LogService.audit({ action: '休み設定変更', store: target.store, date: target.date, castName,
      revision: result.commit.revision, user: context.user, userLabel: context.userLabel, value: status, result: '成功' });
    return Object.assign(this.buildView_(target, result.saved), { replayed: result.commit.replayed });
  },

  // 明示的な初期化。confirmation は「店舗:日付」（例 KABUKI:2026-11-16）と完全一致が必要。
  resetShiftFromSource(store, date, expectedRevision, confirmation, ctx) {
    const target = Utils.requireStoreAndIsoDate(store, date);
    const context = ctx || {};
    const expected = this.requireRevision_(expectedRevision);
    if (String(confirmation || '') !== Utils.shiftKey(target.store, target.date)) {
      throw Utils.apiError('CONFIRMATION_REQUIRED', '初期化の確認が一致しません（対象: ' + Utils.shiftKey(target.store, target.date) + '）');
    }

    const result = this.withLock_(() => {
      const current = ShiftRepository.readCommitted(target.store, target.date);
      if (!(context.requestId && current.meta && current.meta.lastRequestId === context.requestId)) {
        this.assertRevision_(expected, current.revision);
      }
      const parsed = SiftService.getParsedShift(target.store, target.date);
      const records = parsed.castRows.map(item => ({
        recordId: Utils.uuid(),
        castName: item.castName,
        workTime: WORK_TIME_OPTIONS.indexOf(item.workTime) !== -1 ? item.workTime : '',
        status: '出勤',
        imageFileId: ''
      }));
      this.assertRowLimit_(records);
      const commit = ShiftRepository.commit({
        store: target.store, date: target.date, expectedRevision: expected,
        records, requestId: context.requestId, user: context.user, userLabel: context.userLabel, source: 'reset'
      });
      return { commit, saved: ShiftRepository.readCommitted(target.store, target.date) };
    });

    LogService.audit({ action: '元データから初期化', store: target.store, date: target.date,
      revision: result.commit.revision, user: context.user, userLabel: context.userLabel, result: '成功', detail: 'count=' + result.saved.rows.length });
    return Object.assign(this.buildView_(target, result.saved), { replayed: result.commit.replayed });
  },

  // ===== 内部処理 =====

  withLock_(fn) {
    const lock = LockService.getScriptLock();
    let acquired = false;
    try {
      acquired = lock.tryLock(SHIFT_STORAGE.LOCK_TIMEOUT_MS);
    } catch (err) {
      acquired = false;
    }
    if (!acquired) {
      throw Utils.apiError('LOCK_TIMEOUT', '他の保存処理が実行中です。少し待ってからもう一度お試しください');
    }
    try {
      return fn();
    } finally {
      lock.releaseLock();
    }
  },

  assertRevision_(expected, currentRevision) {
    if (Number(expected) !== Number(currentRevision)) {
      throw Utils.apiError('REVISION_CONFLICT',
        '他の端末または画面で編集内容が更新されています。最新データを確認してから、もう一度保存してください。',
        { expectedRevision: Number(expected), currentRevision: Number(currentRevision) });
    }
  },

  requireRevision_(value) {
    const n = Number(value);
    if (value === '' || value === null || value === undefined || !Number.isInteger(n) || n < 0) {
      throw Utils.apiError('INVALID_REVISION', 'expectedRevision が不正です');
    }
    return n;
  },

  assertRowLimit_(rows) {
    if (rows.length > SHIFT_STORAGE.MAX_ROWS_PER_SHIFT) {
      throw Utils.apiError('TOO_MANY_ROWS', '1日あたりのキャストは ' + SHIFT_STORAGE.MAX_ROWS_PER_SHIFT + ' 人までです');
    }
  },

  // 既存 recordId はこの店舗×日付に存在するものだけ引き継ぐ。不明・重複・未指定は新規採番。
  assignRecordIds_(rows, currentRows) {
    const existing = {};
    currentRows.forEach(row => { existing[row.recordId] = row; });
    const used = {};
    return rows.map(row => {
      let id = row.recordId;
      if (id && !existing[id]) {
        throw Utils.apiError('RECORD_NOT_FOUND', '他の店舗・日付のキャスト、または存在しない recordId は保存できません');
      }
      if (id && used[id]) throw Utils.apiError('INVALID_ROWS', 'recordId が重複しています');
      if (!id) id = Utils.uuid();
      used[id] = true;
      return Object.assign({}, row, { recordId: id, createdAt: existing[id] ? existing[id].createdAt : '' });
    });
  },

  normalizeEditableRow_(row, fallbackSortOrder, imageData) {
    const source = row || {};
    const sortOrder = Number(source.sortOrder) || fallbackSortOrder;
    const castName = String(source.castName || source.name || '').trim();
    const workTime = String(source.workTime || '').trim();
    const statusText = String(source.status || '').trim();
    const imageFileId = String(source.imageFileId || source.overrideImageId || '').trim();
    const recordId = String(source.recordId || '').trim();

    if (!castName) throw Utils.apiError('INVALID_ROWS', 'キャスト名が空の行があります');
    if (castName.length > SHIFT_STORAGE.MAX_CAST_NAME_LENGTH) throw Utils.apiError('INVALID_ROWS', 'キャスト名が長すぎます: ' + castName);
    if (statusText && SHIFT_STATUSES.indexOf(statusText) === -1) throw Utils.apiError('INVALID_ROWS', '不正な状態です: ' + statusText);
    if (workTime && WORK_TIME_OPTIONS.indexOf(workTime) === -1) {
      throw Utils.apiError('INVALID_ROWS', '不正な出勤時間です: ' + workTime);
    }
    if (!ImageService.isKnownImageFileId(imageData, imageFileId)) {
      throw Utils.apiError('INVALID_IMAGE', '不正な差し込み画像です');
    }

    return { recordId, sortOrder, castName, workTime, status: statusText === '休み' ? '休み' : '出勤', imageFileId };
  },

  // 手動選択 → 名前一致（既存の画像フォルダ）→ 店舗フォルダ（出勤先店舗 → もう一方の店舗）→ 準備中 → なし
  // storeFinder は省略可（省略時は店舗フォルダを使わない＝従来どおり）
  resolveImage_(imageData, row, storeFinder) {
    if (row.imageFileId) return { fileId: row.imageFileId, source: 'manual' };
    const matched = ImageService.findImageIdForCast((imageData && imageData.imageMap) || {}, row.castName);
    if (matched) return { fileId: matched, source: 'auto' };
    const hit = storeFinder ? storeFinder.find(row.castName) : null;
    if (hit) return { fileId: hit.fileId, source: 'store', photoStore: hit.store };
    if (imageData && imageData.preparingImageId) return { fileId: imageData.preparingImageId, source: 'preparing' };
    return { fileId: '', source: 'none' };
  },

  /**
   * 自動取得モード用: 店舗フォルダ（KABUKI・AKIBA 共通）から名前で写真を探す
   *  - 出勤先店舗のフォルダ → もう一方の店舗のフォルダ（StoreImageService.createLookup）
   *  - 一致が 1 件のときだけ使う（同名ファイルが複数ある場合は名前だけで選ばない）
   *  - フォルダ未設定・読み込み失敗・設定エラーでも自動取得モードは止めない（その写真が無い扱い）
   *  - フォルダの一覧は最初に必要になったときだけ読む
   */
  storeImageFinder_(store) {
    let lookup = null;
    let failed = false;
    return {
      find(castName) {
        if (failed || !String(castName || '').trim()) return null;
        try {
          if (!lookup) lookup = StoreImageService.createLookup(store);
          const hit = lookup.matches(castName);
          return hit.files.length === 1 ? { fileId: hit.files[0].fileId, store: hit.store } : null;
        } catch (err) {
          failed = true;
          LogService.error('ShiftService.storeImageFinder', err, { store });
          return null;
        }
      }
    };
  },

  // 画面表示用（旧 getImageList と同じ項目 + recordId / revision / initialized）
  buildView_(target, saved) {
    const imageData = ImageService.getDriveImagesCached();
    const storeFinder = this.storeImageFinder_(target.store);
    const activeCastList = [];
    const absentCastList = [];
    const missing = [];

    const editRows = saved.rows.map((row, index) => {
      const resolved = this.resolveImage_(imageData, row, storeFinder);
      if (resolved.source === 'preparing' || resolved.source === 'none') missing.push(row.castName);
      return {
        recordId: row.recordId,
        row: index + 1,
        sortOrder: row.sortOrder,
        castName: row.castName,
        name: row.castName,
        workTime: row.workTime,
        status: row.status,
        imageStatus: resolved.source === 'manual' || resolved.source === 'auto' || resolved.source === 'store' ? '登録済み' : (resolved.source === 'preparing' ? '準備中' : '未登録'),
        imageFileId: row.imageFileId,
        imageName: ImageService.getImageNameForFileId(imageData, row.imageFileId),
        imageSource: row.imageFileId ? 'manual' : 'auto',
        resolved
      };
    });

    editRows.forEach(item => {
      const viewRow = Object.assign({}, item, {
        isAbsent: item.status === '休み',
        usedOverride: item.resolved.source === 'manual',
        usedPreparing: item.resolved.source === 'preparing',
        imageUrl: item.resolved.fileId ? ImageService.getThumbnailUrl(item.resolved.fileId, 'w600') : ''
      });
      delete viewRow.resolved;
      if (viewRow.isAbsent) absentCastList.push(viewRow);
      else activeCastList.push(viewRow);   // 画像なしでも出勤者として表示（人数を一致させる）
    });
    editRows.forEach(item => { delete item.resolved; });

    return {
      store: target.store,
      date: target.date,
      selectedStore: target.store,
      selectedDate: target.date,
      dateLabel: Utils.isoToLabel(target.date),
      revision: saved.revision,
      initialized: saved.initialized,
      editRows,
      activeCastList,
      absentCastList,
      imageOptions: ImageService.getImageOptions(imageData, 'w120'),
      missingImages: missing,
      updatedAt: Utils.now('HH:mm:ss'),
      savedAt: saved.meta ? saved.meta.updatedAt : ''
    };
  }
};
