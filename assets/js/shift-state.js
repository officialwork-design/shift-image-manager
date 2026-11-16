/**
 * 編集状態の純粋ロジック（ブラウザ / Node テスト共用）
 * - 未保存変更の検出
 * - 保存ペイロードの組み立て
 * - API エラーの分類
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ShiftState = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const CONFLICT_MESSAGE = '他の端末または画面で編集内容が更新されています。最新データを確認してから、もう一度保存してください。';

  function normalizeRow(row) {
    return {
      recordId: String(row.recordId || ''),
      castName: String(row.castName || '').trim(),
      workTime: String(row.workTime || ''),
      status: row.status === '休み' ? '休み' : '出勤',
      imageFileId: String(row.imageFileId || '')
    };
  }

  // 並び順を含めた内容の署名（rows は表示順＝並び順の昇順で渡す）
  function rowsSignature(rows) {
    return JSON.stringify((rows || []).filter(r => String(r.castName || '').trim()).map(normalizeRow)
      .map(r => [r.recordId, r.castName, r.workTime, r.status, r.imageFileId]));
  }

  function isDirty(currentRows, savedSignature) {
    if (savedSignature === null || savedSignature === undefined) return false;
    return rowsSignature(currentRows) !== savedSignature;
  }

  function buildSavePayload(selection, revision, rows) {
    return {
      store: selection.store,
      date: selection.date,
      expectedRevision: Number(revision) || 0,
      rows: (rows || []).filter(r => String(r.castName || '').trim()).map((r, index) => Object.assign(normalizeRow(r), { sortOrder: index + 1 }))
    };
  }

  // 未保存の画面上で休み状態だけを変更（サーバーには送らない）
  function applyStatusLocally(rows, recordId, isAbsent) {
    return (rows || []).map(r => (r.recordId && r.recordId === recordId) ? Object.assign({}, r, { status: isAbsent ? '休み' : '出勤' }) : r);
  }

  function sameSelection(a, b) {
    return !!a && !!b && a.store === b.store && a.date === b.date;
  }

  // 同じ内容・同じ revision の再送には同じ requestId を使う（サーバー側で二重更新を防ぐ）
  function requestIdFor(pending, key, generate) {
    if (pending && pending.key === key) return pending;
    return { key, requestId: generate() };
  }

  function classifyError(err) {
    const code = (err && err.code) || '';
    if (code === 'REVISION_CONFLICT') return { kind: 'conflict', message: CONFLICT_MESSAGE };
    if (['AUTH_REQUIRED', 'AUTH_INVALID', 'AUTH_NOT_CONFIGURED'].indexOf(code) !== -1) {
      return { kind: 'auth', message: '更新するにはログインが必要です（' + ((err && err.message) || code) + '）' };
    }
    if (code === 'FORBIDDEN') return { kind: 'auth', message: 'この操作を行う権限がありません。' };
    if (code === 'LOCK_TIMEOUT') return { kind: 'lock', message: (err && err.message) || '他の保存処理が実行中です。' };
    if (code === 'NOT_INITIALIZED') return { kind: 'notInitialized', message: (err && err.message) || '保存データがありません。' };
    if (code === 'TIMEOUT' || code === 'NETWORK') return { kind: 'network', message: (err && err.message) || '通信に失敗しました。' };
    return { kind: 'other', message: (err && err.message) || 'エラーが発生しました。' };
  }

  return { CONFLICT_MESSAGE, rowsSignature, isDirty, buildSavePayload, applyStatusLocally, sameSelection, requestIdFor, classifyError };
});
