'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../assets/js/shift-state.js');

const rows = [
  { recordId: 'a', castName: 'ちょこ', workTime: '18:00', status: '出勤', imageFileId: '' },
  { recordId: 'b', castName: 'すず', workTime: '19:00', status: '出勤', imageFileId: 'IMG' }
];

test('フロント状態: 未保存変更の検出（名前・時間・状態・並び順・画像・追加・削除）', () => {
  const saved = S.rowsSignature(rows);
  assert.equal(S.isDirty(rows, saved), false);
  const variants = [
    [Object.assign({}, rows[0], { castName: 'ちょこ2' }), rows[1]],
    [Object.assign({}, rows[0], { workTime: '20:00' }), rows[1]],
    [Object.assign({}, rows[0], { status: '休み' }), rows[1]],
    [rows[1], rows[0]],
    [rows[0], Object.assign({}, rows[1], { imageFileId: '' })],
    rows.concat([{ recordId: '', castName: '新人' }]),
    [rows[0]]
  ];
  variants.forEach((v, i) => assert.equal(S.isDirty(v, saved), true, 'case ' + i));
  assert.equal(S.isDirty(rows.concat([{ castName: '  ' }]), saved), false, '空名の行は無視');
});

test('フロント状態: 保存ペイロードは並び順を 1..n で送る・空名を除外', () => {
  const p = S.buildSavePayload({ store: 'KABUKI', date: '2026-11-16' }, 3, [rows[1], { castName: '' }, rows[0]]);
  assert.equal(p.expectedRevision, 3);
  assert.deepEqual(p.rows.map(r => [r.recordId, r.sortOrder]), [['b', 1], ['a', 2]]);
});

test('フロント状態: 休みの画面上変更は対象 recordId のみ', () => {
  const out = S.applyStatusLocally(rows, 'b', true);
  assert.deepEqual(out.map(r => r.status), ['出勤', '休み']);
  assert.equal(rows[1].status, '出勤', '元配列を変更しない');
});

test('フロント状態: 再送は同じ requestId、内容が変われば新しい requestId', () => {
  let n = 0; const gen = () => 'r' + (++n);
  const p1 = S.requestIdFor(null, 'k1', gen);
  const p2 = S.requestIdFor(p1, 'k1', gen);
  const p3 = S.requestIdFor(p2, 'k2', gen);
  assert.equal(p1.requestId, p2.requestId);
  assert.notEqual(p3.requestId, p1.requestId);
});

test('フロント状態: エラー分類（競合メッセージは仕様の文言）', () => {
  assert.deepEqual(S.classifyError({ code: 'REVISION_CONFLICT' }), { kind: 'conflict', message: '他の端末または画面で編集内容が更新されています。最新データを確認してから、もう一度保存してください。' });
  assert.equal(S.classifyError({ code: 'AUTH_NOT_CONFIGURED', message: 'x' }).kind, 'auth');
  assert.equal(S.classifyError({ code: 'FORBIDDEN' }).kind, 'auth');
  assert.equal(S.classifyError({ code: 'LOCK_TIMEOUT' }).kind, 'lock');
  assert.equal(S.classifyError(new Error('boom')).kind, 'other');
  assert.equal(S.sameSelection({ store: 'KABUKI', date: '2026-11-16' }, { store: 'AKIBA', date: '2026-11-16' }), false);
});
