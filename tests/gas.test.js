'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, secondTerminal, callGet, callPost, EDITOR } = require('./fixtures');

const ctx = { user: 'editor@example.com' };
const names = view => view.editRows.map(r => r.castName);
const plain = v => JSON.parse(JSON.stringify(v));
// vm 内の配列は別 realm のため、比較前に JSON で通常の値へ変換する
const deepEqual = (actual, expected, msg) => assert.deepEqual(plain(actual), expected, msg);

// ---------- データ保存 ----------
test('保存: KABUKI 11/16, AKIBA 11/16, KABUKI 11/17 が独立して保存される', () => {
  const h = setup(); const S = h.gas.ShiftService;
  const k16 = S.initializeShift('KABUKI', '2026-11-16', ctx);
  const a16 = S.initializeShift('AKIBA', '2026-11-16', ctx);
  const k17 = S.initializeShift('KABUKI', '2026-11-17', ctx);
  deepEqual(names(k16), ['ちょこ', 'ぴょん', 'すず', 'るん', 'むぎ']);
  deepEqual(names(a16), ['ひめ', 'あみめ', 'みも', 'みな']);
  deepEqual(names(k17), ['ちょこ', 'しちみ']);

  // KABUKI 11/16 を編集
  const rows = plain(k16.editRows).reverse().map((r, i) => Object.assign(r, { sortOrder: i + 1 }));
  rows[0].workTime = '20:00';
  const saved = S.saveShift('KABUKI', '2026-11-16', 1, rows, ctx);
  assert.equal(saved.revision, 2);
  // 他の店舗・日付は変化なし
  deepEqual(names(S.getSavedShift('AKIBA', '2026-11-16')), ['ひめ', 'あみめ', 'みも', 'みな']);
  assert.equal(S.getSavedShift('AKIBA', '2026-11-16').revision, 1);
  deepEqual(names(S.getSavedShift('KABUKI', '2026-11-17')), ['ちょこ', 'しちみ']);
  deepEqual(names(S.getSavedShift('KABUKI', '2026-11-16')), ['むぎ', 'るん', 'すず', 'ぴょん', 'ちょこ']);
});

test('保存: 再読み込み・別日へ移動して戻る・再起動相当（新しいインスタンス）でも内容が残る', () => {
  const h = setup(); const S = h.gas.ShiftService;
  const v = S.initializeShift('KABUKI', '2026-11-16', ctx);
  const rows = plain(v.editRows);
  rows[1].status = '休み'; rows[2].imageFileId = 'IMG_HIME';
  rows.push({ castName: '手入力キャスト', workTime: '21:00', status: '出勤' });
  rows.splice(0, 1); // ちょこ削除
  S.saveShift('KABUKI', '2026-11-16', 1, rows, ctx);
  S.initializeShift('AKIBA', '2026-11-16', ctx);                 // 別店舗へ
  const again = S.initializeShift('KABUKI', '2026-11-16', ctx);   // 戻る（初期化は上書きしない）
  assert.equal(again.created, false);
  const fresh = secondTerminal(h).gas.ShiftService.getSavedShift('KABUKI', '2026-11-16'); // 再起動相当
  for (const view of [again, fresh]) {
    deepEqual(names(view), ['ぴょん', 'すず', 'るん', 'むぎ', '手入力キャスト']);   // 削除は復活しない・追加は残る
    assert.equal(view.editRows[0].status, '休み');
    assert.equal(view.editRows[1].imageFileId, 'IMG_HIME');
    assert.equal(view.editRows[4].workTime, '21:00');
    deepEqual(view.editRows.map(r => r.sortOrder), [1, 2, 3, 4, 5]);
  }
});

test('保存: 0人のシフトを保存でき、再読み込みで SIFT_DATA から再生成されない', () => {
  const h = setup(); const S = h.gas.ShiftService;
  S.initializeShift('KABUKI', '2026-11-16', ctx);
  const empty = S.saveShift('KABUKI', '2026-11-16', 1, [], ctx);
  assert.equal(empty.editRows.length, 0);
  assert.equal(empty.initialized, true);
  const again = S.initializeShift('KABUKI', '2026-11-16', ctx);
  assert.equal(again.created, false);
  assert.equal(again.editRows.length, 0);
});

test('保存: SIFT_DATA 原本と旧「画像生成」シートは変更されない', () => {
  const h = setup(); const S = h.gas.ShiftService;
  const before = JSON.stringify(h.ss.getSheetByName('SIFT_DATA').rows);
  const legacyBefore = JSON.stringify(h.ss.getSheetByName('画像生成').rows);
  const v = S.initializeShift('KABUKI', '2026-11-16', ctx);
  S.saveShift('KABUKI', '2026-11-16', 1, plain(v.editRows), ctx);
  S.resetShiftFromSource('KABUKI', '2026-11-16', 2, 'KABUKI:2026-11-16', ctx);
  assert.equal(JSON.stringify(h.ss.getSheetByName('SIFT_DATA').rows), before);
  assert.equal(JSON.stringify(h.ss.getSheetByName('画像生成').rows), legacyBefore);
});

test('保存: SIFT_DATA に投稿がない日付は保存データを作らない', () => {
  const h = setup(); const S = h.gas.ShiftService;
  assert.throws(() => S.initializeShift('KABUKI', '2026-11-20', ctx), e => e.code === 'SIFT_NOT_FOUND');
  assert.equal(S.getSavedShift('KABUKI', '2026-11-20').initialized, false);
});

test('保存: 古い世代は KEEP_GENERATIONS 件まで保持される', () => {
  const h = setup(); const S = h.gas.ShiftService;
  let v = S.initializeShift('KABUKI', '2026-11-16', ctx);
  for (let i = 0; i < 5; i++) v = S.saveShift('KABUKI', '2026-11-16', v.revision, plain(v.editRows), ctx);
  const revs = new Set(h.ss.getSheetByName('シフト編集').rows.slice(1).filter(r => r[1] === 'KABUKI').map(r => r[10]));
  deepEqual([...revs].map(Number).sort(), [4, 5, 6]);
});

// ---------- 同時更新 ----------
test('同時更新: 同一 revision の2端末 → 先の保存のみ成功、後続は REVISION_CONFLICT で上書きしない', () => {
  const h = setup(); const A = h.gas.ShiftService; const B = secondTerminal(h).gas.ShiftService;
  const base = A.initializeShift('KABUKI', '2026-11-16', ctx);
  const rowsA = plain(base.editRows); rowsA[0].workTime = '22:00';
  const rowsB = plain(base.editRows); rowsB[0].workTime = '17:00';
  assert.equal(A.saveShift('KABUKI', '2026-11-16', 1, rowsA, ctx).revision, 2);
  assert.throws(() => B.saveShift('KABUKI', '2026-11-16', 1, rowsB, ctx), e => e.code === 'REVISION_CONFLICT' && /他の端末または画面/.test(e.message));
  assert.equal(A.getSavedShift('KABUKI', '2026-11-16').editRows[0].workTime, '22:00');
});

test('同時更新: 異なる店舗・異なる日付は同じ revision 番号でも互いに干渉しない', () => {
  const h = setup(); const A = h.gas.ShiftService; const B = secondTerminal(h).gas.ShiftService;
  const k = A.initializeShift('KABUKI', '2026-11-16', ctx);
  const a = B.initializeShift('AKIBA', '2026-11-16', ctx);
  const k17 = B.initializeShift('KABUKI', '2026-11-17', ctx);
  A.saveShift('KABUKI', '2026-11-16', 1, plain(k.editRows).slice(0, 2), ctx);
  B.saveShift('AKIBA', '2026-11-16', 1, plain(a.editRows).slice(0, 1), ctx);
  B.saveShift('KABUKI', '2026-11-17', 1, plain(k17.editRows).slice(0, 1), ctx);
  deepEqual(names(A.getSavedShift('KABUKI', '2026-11-16')), ['ちょこ', 'ぴょん']);
  deepEqual(names(A.getSavedShift('AKIBA', '2026-11-16')), ['ひめ']);
  deepEqual(names(A.getSavedShift('KABUKI', '2026-11-17')), ['ちょこ']);
});

test('同時更新: LockService を取得できない場合は LOCK_TIMEOUT で何も書き込まない', () => {
  const h = setup(); const S = h.gas.ShiftService;
  const v = S.initializeShift('KABUKI', '2026-11-16', ctx);
  const before = JSON.stringify(h.ss.getSheetByName('シフト編集').rows);
  h.lockState.forceTimeout = true;
  assert.throws(() => S.saveShift('KABUKI', '2026-11-16', 1, plain(v.editRows), ctx), e => e.code === 'LOCK_TIMEOUT');
  assert.equal(JSON.stringify(h.ss.getSheetByName('シフト編集').rows), before);
  h.lockState.forceTimeout = false;
  assert.equal(h.lockState.held, false);
});

test('同時更新: 書き込み途中の失敗（管理行更新前）→ 旧データのまま読める・次回保存で回復', () => {
  const h = setup(); const S = h.gas.ShiftService;
  const v = S.initializeShift('KABUKI', '2026-11-16', ctx);
  const rows = plain(v.editRows).slice(0, 2);
  h.ss.injectFailure(0, 'シフト編集管理');  // シフト編集管理への最初の書き込みで失敗させる
  assert.throws(() => S.saveShift('KABUKI', '2026-11-16', 1, rows, ctx), /Injected write failure/);
  assert.equal(h.lockState.held, false, 'ロックは解放される');
  const after = S.getSavedShift('KABUKI', '2026-11-16');
  assert.equal(after.revision, 1);
  assert.equal(after.editRows.length, 5, '未コミットの世代は見えない');
  const retry = S.saveShift('KABUKI', '2026-11-16', 1, rows, ctx);  // 孤立行を掃除してから保存
  assert.equal(retry.revision, 2);
  deepEqual(names(retry), ['ちょこ', 'ぴょん']);
  const rev2 = h.ss.getSheetByName('シフト編集').rows.slice(1).filter(r => r[1] === 'KABUKI' && r[2] === '2026-11-16' && Number(r[10]) === 2);
  assert.equal(rev2.length, 2, '孤立行が二重に残らない');
});

test('同時更新: データ行の追記途中で失敗 → 正常データとして返さない', () => {
  const h = setup(); const S = h.gas.ShiftService;
  const v = S.initializeShift('KABUKI', '2026-11-16', ctx);
  h.ss.injectFailure(0, 'シフト編集');
  assert.throws(() => S.saveShift('KABUKI', '2026-11-16', 1, plain(v.editRows), ctx));
  assert.equal(S.getSavedShift('KABUKI', '2026-11-16').revision, 1);
});

test('同時更新: 管理情報と行数が食い違うデータは DATA_INCONSISTENT（正常扱いしない）', () => {
  const h = setup(); const S = h.gas.ShiftService;
  S.initializeShift('KABUKI', '2026-11-16', ctx);
  const sheet = h.ss.getSheetByName('シフト編集');
  sheet.deleteRows(2, 1); // 手作業で1行消えた想定
  assert.throws(() => S.getSavedShift('KABUKI', '2026-11-16'), e => e.code === 'DATA_INCONSISTENT');
});

test('同時更新: 同一リクエストの再送（同じ requestId）は二重更新しない', () => {
  const h = setup(); const S = h.gas.ShiftService;
  const v = S.initializeShift('KABUKI', '2026-11-16', ctx);
  const rows = plain(v.editRows);
  const first = S.saveShift('KABUKI', '2026-11-16', 1, rows, { user: ctx.user, requestId: 'req-1' });
  const resend = S.saveShift('KABUKI', '2026-11-16', 1, rows, { user: ctx.user, requestId: 'req-1' });
  assert.equal(first.revision, 2);
  assert.equal(resend.revision, 2);
  assert.equal(resend.replayed, true);
});

test('同時更新: 古い revision による初期化・休み変更は拒否', () => {
  const h = setup(); const S = h.gas.ShiftService;
  const v = S.initializeShift('KABUKI', '2026-11-16', ctx);
  S.saveShift('KABUKI', '2026-11-16', 1, plain(v.editRows), ctx);
  assert.throws(() => S.resetShiftFromSource('KABUKI', '2026-11-16', 1, 'KABUKI:2026-11-16', ctx), e => e.code === 'REVISION_CONFLICT');
  assert.throws(() => S.setCastAbsent('KABUKI', '2026-11-16', v.editRows[0].recordId, true, 1, ctx), e => e.code === 'REVISION_CONFLICT');
});

test('同時初期化: 2端末が同時に初回作成しても重複レコードを作らない', () => {
  const h = setup(); const A = h.gas.ShiftService; const B = secondTerminal(h).gas.ShiftService;
  const a = A.initializeShift('KABUKI', '2026-11-16', ctx);
  const b = B.initializeShift('KABUKI', '2026-11-16', ctx);
  assert.equal(a.created, true); assert.equal(b.created, false);
  assert.equal(h.ss.getSheetByName('シフト編集').rows.slice(1).filter(r => r[1] === 'KABUKI').length, 5);
  assert.equal(h.ss.getSheetByName('シフト編集管理').rows.slice(1).length, 1);
});

// ---------- 休み・初期化 ----------
test('休み変更: recordId で指定キャストだけ変更・他店舗の recordId は拒否', () => {
  const h = setup(); const S = h.gas.ShiftService;
  const k = S.initializeShift('KABUKI', '2026-11-16', ctx);
  const a = S.initializeShift('AKIBA', '2026-11-16', ctx);
  const r = S.setCastAbsent('KABUKI', '2026-11-16', k.editRows[2].recordId, true, 1, ctx);
  deepEqual(r.editRows.map(x => x.status), ['出勤', '出勤', '休み', '出勤', '出勤']);
  deepEqual(r.absentCastList.map(x => x.name), ['すず']);
  assert.throws(() => S.setCastAbsent('KABUKI', '2026-11-16', a.editRows[0].recordId, true, 2, ctx), e => e.code === 'RECORD_NOT_FOUND');
});

test('保存: 他の店舗・日付の recordId を含む rows は拒否', () => {
  const h = setup(); const S = h.gas.ShiftService;
  S.initializeShift('KABUKI', '2026-11-16', ctx);
  const a = S.initializeShift('AKIBA', '2026-11-16', ctx);
  assert.throws(() => S.saveShift('KABUKI', '2026-11-16', 1, plain(a.editRows), ctx), e => e.code === 'RECORD_NOT_FOUND');
});

test('初期化: 確認文字列が一致しないと実行しない・一致すれば対象のみ SIFT_DATA から再生成', () => {
  const h = setup(); const S = h.gas.ShiftService;
  const k = S.initializeShift('KABUKI', '2026-11-16', ctx);
  S.initializeShift('AKIBA', '2026-11-16', ctx);
  S.saveShift('KABUKI', '2026-11-16', 1, plain(k.editRows).slice(0, 1), ctx);
  assert.throws(() => S.resetShiftFromSource('KABUKI', '2026-11-16', 2, 'AKIBA:2026-11-16', ctx), e => e.code === 'CONFIRMATION_REQUIRED');
  assert.throws(() => S.resetShiftFromSource('KABUKI', '2026-11-16', 2, '', ctx), e => e.code === 'CONFIRMATION_REQUIRED');
  assert.equal(S.getSavedShift('KABUKI', '2026-11-16').editRows.length, 1);
  const reset = S.resetShiftFromSource('KABUKI', '2026-11-16', 2, 'KABUKI:2026-11-16', ctx);
  assert.equal(reset.editRows.length, 5);
  assert.equal(reset.revision, 3);
  assert.equal(S.getSavedShift('AKIBA', '2026-11-16').revision, 1);
});

test('入力検証: 不正な時間・状態・画像ID・revision・人数超過', () => {
  const h = setup(); const S = h.gas.ShiftService;
  const v = S.initializeShift('KABUKI', '2026-11-16', ctx);
  const bad = patch => { const rows = plain(v.editRows); Object.assign(rows[0], patch); return rows; };
  assert.throws(() => S.saveShift('KABUKI', '2026-11-16', 1, bad({ workTime: '25:00' }), ctx), e => e.code === 'INVALID_ROWS');
  assert.throws(() => S.saveShift('KABUKI', '2026-11-16', 1, bad({ status: '早退' }), ctx), e => e.code === 'INVALID_ROWS');
  assert.throws(() => S.saveShift('KABUKI', '2026-11-16', 1, bad({ imageFileId: 'NOT_IN_DRIVE' }), ctx), e => e.code === 'INVALID_IMAGE');
  assert.throws(() => S.saveShift('KABUKI', '2026-11-16', 1, bad({ castName: '', name: '' }), ctx), e => e.code === 'INVALID_ROWS');
  assert.throws(() => S.saveShift('KABUKI', '2026-11-16', -1, plain(v.editRows), ctx), e => e.code === 'INVALID_REVISION');
  assert.throws(() => S.saveShift('KABUKI', '2026-11-16', 'abc', plain(v.editRows), ctx), e => e.code === 'INVALID_REVISION');
  const many = Array.from({ length: 79 }, (_, i) => ({ castName: 'c' + i }));
  assert.throws(() => S.saveShift('KABUKI', '2026-11-16', 1, many, ctx), e => e.code === 'TOO_MANY_ROWS');
  assert.equal(S.getSavedShift('KABUKI', '2026-11-16').revision, 1);
});

test('入力検証: 不正な店舗・日付', () => {
  const h = setup(); const S = h.gas.ShiftService;
  for (const store of ['', 'SHINJUKU', 'kabuki ', 'KABUKI\u0000']) {
    if (store === 'kabuki ') { assert.throws(() => S.getSavedShift(store, '2026-11-16'), e => e.code === 'INVALID_STORE'); continue; }
    assert.throws(() => S.getSavedShift(store, '2026-11-16'), e => e.code === 'INVALID_STORE');
  }
  for (const date of ['', '11月16日(月)', '2026-11-31', '2026/11/16', '26-11-16', '2026-02-29']) {
    assert.throws(() => S.getSavedShift('KABUKI', date), e => e.code === 'INVALID_DATE', date);
  }
});

test('スナップショット: 読み取り専用・画像の優先順位（手動 → 名前一致 → 準備中）', () => {
  const h = setup(); const S = h.gas.ShiftService;
  const v = S.initializeShift('KABUKI', '2026-11-16', ctx);
  const rows = plain(v.editRows); rows[2].imageFileId = 'IMG_HIME';
  S.saveShift('KABUKI', '2026-11-16', 1, rows, ctx);
  const before = JSON.stringify(h.ss.sheets['シフト編集'].rows) + JSON.stringify(h.ss.sheets['画像操作ログ'].rows);
  const snap = S.getShiftSnapshot('KABUKI', '2026-11-16');
  assert.equal(JSON.stringify(h.ss.sheets['シフト編集'].rows) + JSON.stringify(h.ss.sheets['画像操作ログ'].rows), before);
  assert.equal(snap.dateLabel, '11月16日(月)');
  deepEqual(snap.casts.map(c => c.castName + ':' + c.imageSource + ':' + c.resolvedImageFileId), [
    'ちょこ:auto:IMG_CHOCO', 'ぴょん:preparing:IMG_PREP', 'すず:manual:IMG_HIME', 'るん:auto:IMG_RUN', 'むぎ:auto:IMG_MUGI'
  ]);
});

// ---------- 日付 ----------
test('日付: M月D日(曜) → YYYY-MM-DD は曜日と期間で一意に確定できる場合のみ', () => {
  const h = setup(); const U = h.gas.Utils;
  assert.equal(U.resolveLabelToIso('11月16日(月)', '2026-11-16'), '2026-11-16');
  assert.equal(U.resolveLabelToIso('1月1日(金)', '2026-11-16'), '2027-01-01');
  assert.throws(() => U.resolveLabelToIso('11月16日(火)', '2026-11-16'), e => e.code === 'AMBIGUOUS_DATE');
  assert.throws(() => U.resolveLabelToIso('11月16日', '2026-11-16'), e => e.code === 'INVALID_DATE');
  assert.throws(() => U.resolveLabelToIso('2月30日(月)', '2026-11-16'), e => e.code === 'AMBIGUOUS_DATE');
  assert.equal(U.isoToLabel('2026-11-03'), '11月3日(火)');
});

test('日付: 部分一致の防止（1月1日 が 11月1日 に一致しない）', () => {
  const h = setup({ kabuki: [['11月1日(金)', '18:00', 'ちょこ'].join('\n')], akiba: [['11月1日(金)', 'x'].join('\n')] });
  const posts = h.gas.SiftService.findSiftPosts('KABUKI', '2027-01-01'); // 2027-01-01 = 金
  assert.equal(posts.length, 0);
});

test('日付: getDateOptions は年付き日付を返し、確定できない日付は ok:false', () => {
  const h = setup({ kabuki: [['11月16日(月)', 'a'].join('\n'), ['3月3日(火)', 'b'].join('\n')], akiba: [['1月1日(金)', 'c'].join('\n')] });
  const opts = h.gas.SiftService.getDateOptions('2026-11-16');
  deepEqual(plain(opts.filter(o => o.ok).map(o => o.date)), ['2026-11-16', '2027-01-01']);
  deepEqual(plain(opts.filter(o => !o.ok).map(o => o.label)), ['3月3日(火)']);  // 2026-03-03(火) は期間外
});

test('同時更新: 他端末がキャストを削除した後の古い保存は RECORD_NOT_FOUND ではなく REVISION_CONFLICT', () => {
  const h = setup(); const A = h.gas.ShiftService; const B = secondTerminal(h).gas.ShiftService;
  const base = A.initializeShift('KABUKI', '2026-11-16', ctx);
  B.saveShift('KABUKI', '2026-11-16', 1, plain(base.editRows).slice(0, 1), ctx);
  assert.throws(() => A.saveShift('KABUKI', '2026-11-16', 1, plain(base.editRows), ctx), e => e.code === 'REVISION_CONFLICT');
  assert.throws(() => A.setCastAbsent('KABUKI', '2026-11-16', base.editRows[4].recordId, true, 1, ctx), e => e.code === 'REVISION_CONFLICT');
});
