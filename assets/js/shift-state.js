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

  const AUTH_RELOGIN_CODES = ['AUTH_REQUIRED', 'AUTH_INVALID', 'AUTH_EXPIRED'];
  const ACCESS_CODES = ['FORBIDDEN', 'ACCESS_LIST_EMPTY', 'ACCESS_LIST_NOT_CONFIGURED', 'ACCESS_LIST_INVALID', 'ACCESS_LIST_UNAVAILABLE'];

  function classifyError(err) {
    const code = (err && err.code) || '';
    const message = (err && err.message) || '';
    if (code === 'REVISION_CONFLICT') return { kind: 'conflict', message: CONFLICT_MESSAGE };
    if (AUTH_RELOGIN_CODES.indexOf(code) !== -1) {
      return { kind: 'relogin', message: code === 'AUTH_EXPIRED'
        ? 'ログインの有効期限が切れました。もう一度ログインしてください（入力中の内容は残っています）。'
        : 'ログインが必要です。Google アカウントでログインしてください（入力中の内容は残っています）。' };
    }
    if (ACCESS_CODES.indexOf(code) !== -1) {
      const reason = err && err.details && err.details.reason;
      if (reason === 'ROLE') return { kind: 'role', message: message || 'この操作を行う権限がありません。' };
      return { kind: 'forbidden', message: message || 'このアカウントには利用権限がありません。' };
    }
    if (code === 'AUTH_NOT_CONFIGURED' || code === 'AUTH_UNAVAILABLE' || code === 'AUTH_KEYS_UNAVAILABLE') {
      return { kind: 'authUnavailable', message: message || 'ログイン機能を利用できません。' };
    }
    if (code === 'LOCK_TIMEOUT') return { kind: 'lock', message: message || '他の保存処理が実行中です。' };
    if (code === 'NOT_INITIALIZED') return { kind: 'notInitialized', message: message || '保存データがありません。' };
    if (['TIMEOUT', 'NETWORK', 'INVALID_RESPONSE', 'GAS_HTML_RESPONSE'].indexOf(code) !== -1) return { kind: 'network', message: message || '通信に失敗しました。' };
    if (code.indexOf('CONFIG_') === 0) return { kind: 'authUnavailable', message: message || 'サーバーの設定に問題があるため停止しています。' };
    return { kind: 'other', message: message || 'エラーが発生しました。' };
  }

  // 画面の操作可否（ロール別）
  function permissionsFor(role) {
    return {
      canView: role === 'ADMIN' || role === 'EDITOR',
      canEdit: role === 'ADMIN' || role === 'EDITOR',
      canReset: role === 'ADMIN',
      canRefreshCache: role === 'ADMIN'
    };
  }

  return { CONFLICT_MESSAGE, rowsSignature, isDirty, buildSavePayload, applyStatusLocally, sameSelection, requestIdFor, classifyError, permissionsFor };
});
