/**
 * 店舗×日付別 編集データの保存層（Phase 1.5）
 *
 * 方式: 「世代（revision）追記 + コミットマーカー」
 *  - シフト編集        : 1行 = 1キャスト。保存のたびに新しい revision の行一式を「追記」する（既存行を書き換えない）
 *  - シフト編集管理    : 1行 = 1店舗×日付。revision 列が「コミット済み世代」を示すコミットマーカー
 *  - 読み取りは管理行の revision と一致する行だけを返す。行数が rowCount と一致しない場合は DATA_INCONSISTENT。
 *  - 書き込み途中で失敗した世代（管理行より新しい revision の行）は読み取り側から見えず、次回の保存時にロック内で削除される。
 *  - 書き込みは必ず ShiftService.withLock_ 内で呼ぶこと（このファイルはロックを取得しない）。
 */
const ShiftRepository = {
  COL: {
    RECORD_ID: 0, STORE: 1, DATE: 2, CAST_NAME: 3, WORK_TIME: 4, STATUS: 5,
    SORT_ORDER: 6, IMAGE_FILE_ID: 7, CREATED_AT: 8, UPDATED_AT: 9, REVISION: 10
  },
  MCOL: {
    KEY: 0, STORE: 1, DATE: 2, REVISION: 3, INITIALIZED: 4, ROW_COUNT: 5,
    CREATED_AT: 6, UPDATED_AT: 7, UPDATED_BY: 8, LAST_REQUEST_ID: 9, SOURCE: 10
  },

  getSheets_() {
    const config = ConfigService.getConfig();
    return {
      data: SpreadsheetService.getSchemaSheet(config.SHEET_SHIFT_EDIT || DEFAULT_CONFIG.SHEET_SHIFT_EDIT, SHIFT_EDIT_HEADERS),
      manage: SpreadsheetService.getSchemaSheet(config.SHEET_SHIFT_EDIT_MANAGE || DEFAULT_CONFIG.SHEET_SHIFT_EDIT_MANAGE, SHIFT_MANAGE_HEADERS)
    };
  },

  // 管理行（コミットマーカー）。無ければ null
  readMeta(store, date, sheets) {
    const s = sheets || this.getSheets_();
    const key = Utils.shiftKey(store, date);
    const rows = SpreadsheetService.readTable(s.manage, SHIFT_MANAGE_HEADERS.length);
    const found = [];
    rows.forEach((row, index) => {
      if (row[this.MCOL.KEY] === key) found.push({ row, rowIndex: index + 2 });
    });
    if (!found.length) return null;
    if (found.length > 1) {
      throw Utils.apiError('DATA_INCONSISTENT', '管理行が重複しています: ' + key);
    }
    const row = found[0].row;
    if (row[this.MCOL.STORE] !== store || row[this.MCOL.DATE] !== date) {
      throw Utils.apiError('DATA_INCONSISTENT', '管理行の店舗・日付が key と一致しません: ' + key);
    }
    return {
      rowIndex: found[0].rowIndex,
      key,
      store,
      date,
      revision: Number(row[this.MCOL.REVISION]) || 0,
      initialized: String(row[this.MCOL.INITIALIZED]).toUpperCase() === 'TRUE',
      rowCount: Number(row[this.MCOL.ROW_COUNT]) || 0,
      createdAt: row[this.MCOL.CREATED_AT],
      updatedAt: row[this.MCOL.UPDATED_AT],
      updatedBy: row[this.MCOL.UPDATED_BY],
      lastRequestId: row[this.MCOL.LAST_REQUEST_ID],
      source: row[this.MCOL.SOURCE]
    };
  },

  // コミット済みデータを読む（副作用なし）
  readCommitted(store, date) {
    const sheets = this.getSheets_();
    const meta = this.readMeta(store, date, sheets);
    if (!meta || !meta.initialized) {
      return { meta: meta || null, initialized: false, revision: meta ? meta.revision : 0, rows: [] };
    }
    const rows = this.readRowsForKey_(sheets.data, store, date)
      .filter(item => item.revision === meta.revision)
      .map(item => item.record);

    if (rows.length !== meta.rowCount) {
      throw Utils.apiError('DATA_INCONSISTENT',
        '保存データの行数が管理情報と一致しません（' + store + ' / ' + date + ' rev ' + meta.revision + '）',
        { expected: meta.rowCount, actual: rows.length });
    }
    const ids = {};
    rows.forEach(r => {
      if (ids[r.recordId]) throw Utils.apiError('DATA_INCONSISTENT', 'recordId が重複しています: ' + r.recordId);
      ids[r.recordId] = true;
    });

    rows.sort((a, b) => a.sortOrder - b.sortOrder);
    return { meta, initialized: true, revision: meta.revision, rows };
  },

  readRowsForKey_(dataSheet, store, date) {
    const result = [];
    SpreadsheetService.readTable(dataSheet, SHIFT_EDIT_HEADERS.length).forEach((row, index) => {
      if (row[this.COL.STORE] !== store || row[this.COL.DATE] !== date) return;
      result.push({
        rowIndex: index + 2,
        revision: Number(row[this.COL.REVISION]) || 0,
        record: {
          recordId: row[this.COL.RECORD_ID],
          store: row[this.COL.STORE],
          date: row[this.COL.DATE],
          castName: row[this.COL.CAST_NAME],
          workTime: row[this.COL.WORK_TIME],
          status: row[this.COL.STATUS] === '休み' ? '休み' : '出勤',
          sortOrder: Number(row[this.COL.SORT_ORDER]) || 0,
          imageFileId: row[this.COL.IMAGE_FILE_ID],
          createdAt: row[this.COL.CREATED_AT],
          updatedAt: row[this.COL.UPDATED_AT]
        }
      });
    });
    return result;
  },

  /**
   * 新しい世代を書き込んでコミットする。ロック内で呼ぶこと。
   * @param {Object} p { store, date, expectedRevision, records[{recordId,castName,workTime,status,sortOrder,imageFileId,createdAt?}], requestId, user, source }
   * @return {Object} { revision, replayed, rowCount }
   */
  commit(p) {
    const sheets = this.getSheets_();
    const meta = this.readMeta(p.store, p.date, sheets);
    const currentRevision = meta ? meta.revision : 0;

    // 再送（同じ requestId）: 二重更新せず前回の結果を返す
    if (p.requestId && meta && meta.lastRequestId === p.requestId) {
      return { revision: meta.revision, replayed: true, rowCount: meta.rowCount };
    }

    if (Number(p.expectedRevision) !== currentRevision) {
      throw Utils.apiError('REVISION_CONFLICT',
        '他の端末または画面で編集内容が更新されています。最新データを確認してから、もう一度保存してください。',
        { expectedRevision: Number(p.expectedRevision), currentRevision });
    }

    // 1) 途中失敗で残った未コミット世代（revision > current）を削除
    const keyRows = this.readRowsForKey_(sheets.data, p.store, p.date);
    const orphanRows = keyRows.filter(item => item.revision > currentRevision).map(item => item.rowIndex);
    if (orphanRows.length) {
      SpreadsheetService.deleteSheetRows(sheets.data, orphanRows);
      SpreadsheetService.flush();
    }

    // 2) 新世代を追記
    const newRevision = currentRevision + 1;
    const now = Utils.now();
    const values = p.records.map((r, index) => [
      r.recordId,
      p.store,
      p.date,
      r.castName,
      r.workTime || '',
      r.status === '休み' ? '休み' : '出勤',
      index + 1,
      r.imageFileId || '',
      r.createdAt || now,
      now,
      newRevision
    ]);
    SpreadsheetService.appendTextRows(sheets.data, values, SHIFT_EDIT_HEADERS.length);
    SpreadsheetService.flush();

    // 3) 書き込み検証（読み戻して件数と recordId を確認）
    const written = this.readRowsForKey_(sheets.data, p.store, p.date).filter(item => item.revision === newRevision);
    const expectedIds = values.map(v => v[0]).sort().join(',');
    const actualIds = written.map(item => item.record.recordId).sort().join(',');
    if (written.length !== values.length || expectedIds !== actualIds) {
      throw Utils.apiError('WRITE_VERIFY_FAILED', '保存データの書き込み確認に失敗しました。保存は反映されていません。',
        { expected: values.length, actual: written.length });
    }

    // 4) コミットマーカー更新（ここで初めて読み取り側に新世代が見える）
    const metaValues = [
      Utils.shiftKey(p.store, p.date),
      p.store,
      p.date,
      newRevision,
      'TRUE',
      values.length,
      meta ? meta.createdAt : now,
      now,
      p.user || '',
      p.requestId || '',
      p.source || ''
    ];
    if (meta) {
      SpreadsheetService.writeTextRow(sheets.manage, meta.rowIndex, metaValues);
    } else {
      SpreadsheetService.appendTextRows(sheets.manage, [metaValues], SHIFT_MANAGE_HEADERS.length);
    }
    SpreadsheetService.flush();

    // 5) 古い世代を整理（失敗しても保存自体は成功しているので握りつぶす）
    try {
      this.pruneGenerations_(sheets.data, p.store, p.date, newRevision);
    } catch (err) {
      LogService.error('ShiftRepository.prune', err, { store: p.store, date: p.date, revision: newRevision });
    }

    return { revision: newRevision, replayed: false, rowCount: values.length };
  },

  pruneGenerations_(dataSheet, store, date, committedRevision) {
    const keep = Math.max(1, Number(SHIFT_STORAGE.KEEP_GENERATIONS) || 1);
    const minRevision = committedRevision - keep + 1;
    const old = this.readRowsForKey_(dataSheet, store, date)
      .filter(item => item.revision < minRevision)
      .map(item => item.rowIndex);
    if (old.length) {
      SpreadsheetService.deleteSheetRows(dataSheet, old);
      SpreadsheetService.flush();
    }
  },

  // 移行ロールバック専用: 管理行とデータ行を削除する（ロック内で呼ぶこと）
  removeKey_(store, date) {
    const sheets = this.getSheets_();
    const meta = this.readMeta(store, date, sheets);
    const rows = this.readRowsForKey_(sheets.data, store, date).map(item => item.rowIndex);
    if (meta) SpreadsheetService.deleteSheetRows(sheets.manage, [meta.rowIndex]);
    if (rows.length) SpreadsheetService.deleteSheetRows(sheets.data, rows);
    SpreadsheetService.flush();
    return { removedMeta: !!meta, removedRows: rows.length };
  }
};
