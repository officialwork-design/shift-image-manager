'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./fixtures');

function seedLegacy(h, label, store, rows) {
  const sheet = h.ss.getSheetByName('画像生成');
  sheet.set(1, 1, label); sheet.set(1, 3, store);
  rows.forEach((r, i) => { [r[0], r[1], r[2], r[3], '', r[4] || ''].forEach((v, c) => sheet.set(3 + i, 8 + c, v)); });
}
const legacyRows = [[2, 'すず', '19:00', '出勤', 'IMG_HIME'], [1, 'ちょこ', '18:00', '休み'], [3, '手入力', '', '出勤']];

test('移行: dry-run は書き込みなしで件数と内容を返す', () => {
  const h = setup(); seedLegacy(h, '11月16日(月)', 'KABUKI', legacyRows);
  const before = JSON.stringify(h.ss.getSheetByName('シフト編集').rows);
  const plan = h.gas.MigrationService.dryRun({});
  assert.equal(plan.store, 'KABUKI'); assert.equal(plan.date, '2026-11-16'); assert.equal(plan.rowCount, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(plan.rows.map(r => r.castName))), ['ちょこ', 'すず', '手入力']);
  assert.equal(plan.willMigrate, true);
  assert.equal(JSON.stringify(h.ss.getSheetByName('シフト編集').rows), before);
});

test('移行: バックアップ必須 → 実行 → 検証 → 再実行で重複しない → 旧シートは不変', () => {
  const h = setup(); seedLegacy(h, '11月16日(月)', 'KABUKI', legacyRows);
  const M = h.gas.MigrationService;
  const legacyBefore = JSON.stringify(h.ss.getSheetByName('画像生成').rows);
  assert.throws(() => M.migrate({}), e => e.code === 'BACKUP_REQUIRED');
  assert.throws(() => M.migrate({ backupSheetName: 'なし' }), e => e.code === 'BACKUP_REQUIRED');
  const { backupSheetName } = M.backupLegacySheet();
  assert.ok(h.ss.getSheetByName(backupSheetName));
  const plan = M.dryRun({});
  const res = M.migrate({ backupSheetName, expectedChecksum: plan.checksum });
  assert.equal(res.migrated, true); assert.equal(res.verification.ok, true);
  const saved = h.gas.ShiftService.getSavedShift('KABUKI', '2026-11-16');
  assert.deepEqual(JSON.parse(JSON.stringify(saved.editRows.map(r => [r.castName, r.workTime, r.status, r.imageFileId]))),
    [['ちょこ', '18:00', '休み', ''], ['すず', '19:00', '出勤', 'IMG_HIME'], ['手入力', '', '出勤', '']]);
  const again = M.migrate({ backupSheetName });
  assert.equal(again.migrated, false); assert.equal(again.skippedReason, 'TARGET_EXISTS');
  assert.equal(h.ss.getSheetByName('シフト編集').rows.slice(1).length, 3);
  assert.equal(JSON.stringify(h.ss.getSheetByName('画像生成').rows), legacyBefore);
});

test('移行: 既存データがある場合は上書きしない・dry-run 後に旧シートが変わったら中止', () => {
  const h = setup(); seedLegacy(h, '11月16日(月)', 'KABUKI', legacyRows);
  const M = h.gas.MigrationService;
  const { backupSheetName } = M.backupLegacySheet();
  const plan = M.dryRun({});
  h.ss.getSheetByName('画像生成').set(3, 10, '20:00');
  assert.throws(() => M.migrate({ backupSheetName, expectedChecksum: plan.checksum }), e => e.code === 'MIGRATION_SOURCE_CHANGED');
  h.gas.ShiftService.initializeShift('KABUKI', '2026-11-16', { user: 'e' });
  const res = M.migrate({ backupSheetName });
  assert.equal(res.migrated, false);
  assert.equal(h.gas.ShiftService.getSavedShift('KABUKI', '2026-11-16').editRows.length, 5);
});

test('移行: 年を確定できない日付は日付の明示が必要・A1と一致しない日付は拒否', () => {
  const h = setup(); seedLegacy(h, '3月3日(火)', 'AKIBA', legacyRows);
  const M = h.gas.MigrationService;
  assert.throws(() => M.dryRun({}), e => e.code === 'AMBIGUOUS_DATE');
  assert.throws(() => M.dryRun({ date: '2026-03-04' }), e => e.code === 'INVALID_DATE');
  assert.equal(M.dryRun({ date: '2026-03-03' }).date, '2026-03-03');
});

test('移行: ロールバックは移行直後（rev1, source=migration）のみ', () => {
  const h = setup(); seedLegacy(h, '11月16日(月)', 'KABUKI', legacyRows);
  const M = h.gas.MigrationService;
  const { backupSheetName } = M.backupLegacySheet();
  M.migrate({ backupSheetName });
  h.gas.ShiftService.initializeShift('AKIBA', '2026-11-16', { user: 'e' });
  assert.throws(() => M.rollback('AKIBA', '2026-11-16'), e => e.code === 'ROLLBACK_REFUSED');
  const r = M.rollback('KABUKI', '2026-11-16');
  assert.equal(r.rolledBack, true); assert.equal(r.removedRows, 3);
  assert.equal(h.gas.ShiftService.getSavedShift('KABUKI', '2026-11-16').initialized, false);
  assert.equal(h.gas.ShiftService.getSavedShift('AKIBA', '2026-11-16').initialized, true);
});
