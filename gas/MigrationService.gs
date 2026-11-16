/**
 * 旧「画像生成」シート（単一スロット）→ 店舗×日付別「シフト編集」への移行ツール（Phase 1.5）
 *
 * - API からは呼べない。Apps Script エディタまたはスプレッドシートのメニューから実行する。
 * - 旧シートは読み取りのみ（削除・変更しない）。
 * - 実行前にバックアップ（シートのコピー）が必須。backupSheetName を渡さないと実行しない。
 * - 移行先に保存データがある場合は上書きしない（スキップ）。再実行しても重複しない。
 * - 移行できるのは旧シートにある「1店舗・1日分」だけ。それ以外の過去の編集内容は保存されていないため復元できない。
 */
const MigrationService = {
  // 旧シートの内容を読み取り、移行内容を返す（書き込みなし）
  // options.date: YYYY-MM-DD を明示する場合（A1 の「M月D日(曜)」から年を確定できない場合に使用）
  dryRun(options) {
    const opts = options || {};
    const legacy = this.readLegacySlot_(opts);
    const existing = ShiftRepository.readCommitted(legacy.store, legacy.date);
    const imageData = ImageService.getDriveImagesCached();
    const invalidImages = legacy.rows.filter(r => !ImageService.isKnownImageFileId(imageData, r.imageFileId)).map(r => r.castName);
    return {
      mode: 'dry-run',
      store: legacy.store,
      date: legacy.date,
      sourceLabel: legacy.sourceLabel,
      rowCount: legacy.rows.length,
      rows: legacy.rows,
      targetExists: existing.initialized,
      targetRevision: existing.revision,
      willMigrate: !existing.initialized && invalidImages.length === 0,
      invalidImages,
      checksum: this.checksum_(legacy.rows)
    };
  },

  // 旧シートを同じスプレッドシート内にコピーしてバックアップする（Drive への書き込みは行わない）
  backupLegacySheet() {
    const config = ConfigService.getConfig();
    const sheet = SpreadsheetService.getSheet(config.SHEET_IMAGE_GENERATION);
    const name = 'BK_' + config.SHEET_IMAGE_GENERATION + '_' + Utils.now('yyyyMMdd_HHmmss');
    const copy = sheet.copyTo(SpreadsheetService.getSpreadsheet());
    copy.setName(name);
    LogService.audit({ action: '移行バックアップ', result: '成功', detail: name });
    return { backupSheetName: name };
  },

  /**
   * 移行実行
   * @param {Object} options { backupSheetName (必須), date (任意: YYYY-MM-DD), expectedChecksum (任意: dry-run の checksum) }
   */
  migrate(options) {
    const opts = options || {};
    this.assertBackup_(opts.backupSheetName);
    const plan = this.dryRun(opts);
    if (opts.expectedChecksum && opts.expectedChecksum !== plan.checksum) {
      throw Utils.apiError('MIGRATION_SOURCE_CHANGED', 'dry-run 後に旧シートの内容が変わっています。dry-run からやり直してください');
    }
    if (plan.invalidImages.length) {
      throw Utils.apiError('INVALID_IMAGE', '画像フォルダに存在しない差込画像IDがあります: ' + plan.invalidImages.join('、'));
    }
    if (plan.targetExists) {
      LogService.audit({ action: '旧データ移行', store: plan.store, date: plan.date, revision: plan.targetRevision, result: 'スキップ', detail: '移行先に保存データあり' });
      return Object.assign({}, plan, { mode: 'migrate', migrated: false, skippedReason: 'TARGET_EXISTS' });
    }

    const result = ShiftService.withLock_(() => {
      const current = ShiftRepository.readCommitted(plan.store, plan.date);
      if (current.initialized) return { migrated: false, skippedReason: 'TARGET_EXISTS' };
      const records = plan.rows.map(r => ({
        recordId: Utils.uuid(), castName: r.castName, workTime: r.workTime, status: r.status, imageFileId: r.imageFileId
      }));
      const commit = ShiftRepository.commit({
        store: plan.store, date: plan.date, expectedRevision: current.revision, records,
        requestId: 'migration:' + plan.checksum, user: 'migration', source: 'migration'
      });
      return { migrated: !commit.replayed, revision: commit.revision };
    });

    const verification = result.migrated ? this.verify({ date: plan.date, store: plan.store, sourceRows: plan.rows }) : null;
    LogService.audit({ action: '旧データ移行', store: plan.store, date: plan.date, revision: result.revision,
      result: result.migrated ? (verification.ok ? '成功' : '検証NG') : 'スキップ', detail: 'count=' + plan.rowCount + ' backup=' + opts.backupSheetName });
    return Object.assign({}, plan, { mode: 'migrate' }, result, { verification });
  },

  // 移行結果の検証（旧シートと移行先の内容を比較）
  verify(options) {
    const opts = options || {};
    const sourceRows = opts.sourceRows || this.readLegacySlot_(opts).rows;
    const store = opts.store || this.readLegacySlot_(opts).store;
    const date = opts.date || this.readLegacySlot_(opts).date;
    const saved = ShiftRepository.readCommitted(store, date);
    const normalize = rows => rows.map(r => [r.castName, r.workTime, r.status, r.imageFileId].join('|'));
    const expected = normalize(sourceRows);
    const actual = normalize(saved.rows);
    const ok = saved.initialized && expected.length === actual.length && expected.every((v, i) => v === actual[i]);
    return { ok, store, date, expectedCount: expected.length, actualCount: actual.length, revision: saved.revision };
  },

  // ロールバック: 移行で作られたデータ（source=migration かつ revision=1）だけを削除する
  rollback(store, date) {
    const target = Utils.requireStoreAndIsoDate(store, date);
    return ShiftService.withLock_(() => {
      const meta = ShiftRepository.readMeta(target.store, target.date);
      if (!meta) return { rolledBack: false, reason: 'NOT_FOUND' };
      if (meta.source !== 'migration' || meta.revision !== 1) {
        throw Utils.apiError('ROLLBACK_REFUSED', '移行後に編集された、または移行以外で作成されたデータは自動ロールバックできません');
      }
      const removed = ShiftRepository.removeKey_(target.store, target.date);
      LogService.audit({ action: '移行ロールバック', store: target.store, date: target.date, revision: 1, result: '成功' });
      return Object.assign({ rolledBack: true }, removed);
    });
  },

  readLegacySlot_(opts) {
    const config = ConfigService.getConfig();
    const sheet = SpreadsheetService.getSheet(config.SHEET_IMAGE_GENERATION);
    const sourceLabel = String(sheet.getRange(SHEET_LAYOUT.DATE_CELL).getDisplayValue() || '').trim();
    const store = Utils.requireStore(String(sheet.getRange(SHEET_LAYOUT.STORE_CELL).getDisplayValue() || '').trim().toUpperCase());
    let date;
    if (opts && opts.date) {
      date = Utils.requireIsoDate(opts.date);
      if (Utils.isoToLabel(date) !== sourceLabel) {
        throw Utils.apiError('INVALID_DATE', '指定日付 ' + date + '（' + Utils.isoToLabel(date) + '）が旧シート A1「' + sourceLabel + '」と一致しません');
      }
    } else {
      date = Utils.resolveLabelToIso(sourceLabel);
    }

    const rowCount = SHEET_LAYOUT.CAST_END_ROW - SHEET_LAYOUT.CAST_START_ROW + 1;
    const width = SHEET_LAYOUT.IMAGE_FILE_ID_COLUMN - SHEET_LAYOUT.SORT_COLUMN + 1;
    const values = sheet.getRange(SHEET_LAYOUT.CAST_START_ROW, SHEET_LAYOUT.SORT_COLUMN, rowCount, width).getDisplayValues();
    const rows = values
      .map((row, index) => ({
        sortOrder: Number(row[0]) || index + 1,
        sheetRow: SHEET_LAYOUT.CAST_START_ROW + index,
        castName: String(row[1] || '').trim(),
        workTime: WORK_TIME_OPTIONS.indexOf(String(row[2] || '').trim()) !== -1 ? String(row[2]).trim() : '',
        status: String(row[3] || '').trim() === '休み' ? '休み' : '出勤',
        imageFileId: String(row[5] || '').trim()
      }))
      .filter(row => row.castName)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.sheetRow - b.sheetRow);
    return { store, date, sourceLabel, rows };
  },

  assertBackup_(backupSheetName) {
    const name = String(backupSheetName || '').trim();
    if (!name) throw Utils.apiError('BACKUP_REQUIRED', '移行前にバックアップ（backupLegacySheet）を実行し、そのシート名を指定してください');
    const sheet = SpreadsheetService.getSpreadsheet().getSheetByName(name);
    if (!sheet) throw Utils.apiError('BACKUP_REQUIRED', 'バックアップシートが見つかりません: ' + name);
  },

  checksum_(rows) {
    const text = JSON.stringify(rows.map(r => [r.castName, r.workTime, r.status, r.imageFileId]));
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) {
      hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    }
    return 'h' + (hash >>> 0).toString(16) + '_' + rows.length;
  }
};

// ===== スプレッドシートのメニュー / エディタから実行する入口 =====
function migrationDryRun() {
  const result = MigrationService.dryRun({});
  Logger.log(JSON.stringify(result, null, 2));
  showMenuMessage_('移行 dry-run', result.store + ' / ' + result.date + '\n件数: ' + result.rowCount +
    '\n移行先の既存データ: ' + (result.targetExists ? 'あり（上書きしません）' : 'なし') + '\nchecksum: ' + result.checksum);
  return result;
}

function migrationBackup() {
  const result = MigrationService.backupLegacySheet();
  showMenuMessage_('移行バックアップ', 'バックアップを作成しました: ' + result.backupSheetName);
  return result;
}

function migrationExecute() {
  const ui = SpreadsheetApp.getUi();
  const dry = MigrationService.dryRun({});
  const backup = ui.prompt('旧データ移行（' + dry.store + ' / ' + dry.date + ' / ' + dry.rowCount + '件）',
    'バックアップシート名を入力してください（例 BK_画像生成_20261116_120000）', ui.ButtonSet.OK_CANCEL);
  if (backup.getSelectedButton() !== ui.Button.OK) return null;
  const result = MigrationService.migrate({ backupSheetName: backup.getResponseText(), expectedChecksum: dry.checksum });
  Logger.log(JSON.stringify(result, null, 2));
  showMenuMessage_('旧データ移行', result.migrated
    ? '移行しました（rev ' + result.revision + '）。検証: ' + (result.verification && result.verification.ok ? 'OK' : 'NG')
    : 'スキップしました: ' + (result.skippedReason || ''));
  return result;
}
