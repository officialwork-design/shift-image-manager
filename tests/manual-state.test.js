'use strict';
// 手動モードの画面ロジック（DOM に依存しない ManualState）
const test = require('node:test');
const assert = require('node:assert/strict');
const { ManualState: S } = require('../assets/js/manual-mode.js');

const reg = (id, file, rev) => ({ castId: id, castName: 'もも', imageFileId: file, revision: rev || 1, source: 'registry' });

test('まとめて入力: 改行・読点・カンマで分割し、空行を除き順番を保つ', () => {
  assert.deepEqual(S.parseBulkNames('もも\nゆきの、るん, ちょこ，\n\n  めう  \r\nもも'), ['もも', 'ゆきの', 'るん', 'ちょこ', 'めう', 'もも']);
  assert.deepEqual(S.parseBulkNames(''), []);
});

test('並べ替え・削除（範囲外は変更しない・元の配列は変えない）', () => {
  const rows = ['A', 'B', 'C'].map(n => S.newRow(n));
  const up = S.move(rows, 2, -1);
  assert.deepEqual(up.map(r => r.castName), ['A', 'C', 'B']);
  assert.deepEqual(rows.map(r => r.castName), ['A', 'B', 'C']);
  assert.deepEqual(S.move(rows, 0, -1).map(r => r.castName), ['A', 'B', 'C']);
  assert.deepEqual(S.move(rows, 2, 1).map(r => r.castName), ['A', 'B', 'C']);
  assert.deepEqual(S.remove(rows, 1).map(r => r.castName), ['A', 'C']);
});

test('署名: 名前・castId・順番の変更で変わり、写真の状態では変わらない', () => {
  const rows = S.fromServer([{ castName: 'A', castId: 'c_1' }, { castName: 'B', castId: '' }]);
  const sig = S.signature(rows);
  assert.equal(S.signature(rows.map(r => Object.assign({}, r, { status: 'registered', imageFileId: 'X' }))), sig);
  assert.notEqual(S.signature(S.move(rows, 0, 1)), sig);
  assert.notEqual(S.signature([rows[0], Object.assign({}, rows[1], { castId: 'c_2' })]), sig);
  assert.notEqual(S.signature([rows[0], Object.assign({}, rows[1], { castName: 'BB' })]), sig);
  assert.deepEqual(S.toPayload(rows), [{ castName: 'A', castId: 'c_1' }, { castName: 'B', castId: '' }]);
});

test('紐付け: 候補1件は自動・0件は未登録・2件以上は選ぶまで写真なし（同名の誤選択防止）', () => {
  const row = S.newRow('もも');
  const one = S.applyCandidates(row, [reg('c_a', 'F_A')]);
  assert.equal(one.status, 'registered');
  assert.equal(one.castId, 'c_a');
  assert.equal(one.imageFileId, 'F_A');
  assert.equal(S.applyCandidates(row, []).status, 'missing');
  const two = S.applyCandidates(row, [reg('c_a', 'F_A'), reg('c_b', 'F_B')]);
  assert.equal(two.status, 'ambiguous');
  assert.equal(two.castId, '');
  assert.equal(two.imageFileId, '', '同名が複数なら写真を自動で選ばない');
  const picked = S.selectCandidate(two, 'c_b');
  assert.equal(picked.imageFileId, 'F_B');
  assert.equal(picked.status, 'registered');
  // 保存済みの castId は同名が増えても維持
  const saved = Object.assign(S.newRow('もも'), { castId: 'c_b' });
  assert.equal(S.applyCandidates(saved, [reg('c_a', 'F_A'), reg('c_b', 'F_B2', 3)]).imageFileId, 'F_B2');
  assert.equal(S.applyCandidates(saved, [reg('c_a', 'F_A'), reg('c_b', 'F_B2', 3)]).castRevision, 3);
  // castId が候補に無くなった（名前変更など）→ 外して規則どおり
  const stale = S.applyCandidates(Object.assign(S.newRow('もも'), { castId: 'c_gone' }), [reg('c_a', 'F_A'), reg('c_b', 'F_B')]);
  assert.equal(stale.status, 'ambiguous');
  assert.equal(S.selectCandidate(two, '').status, 'ambiguous');
});

test('生成前の確認: 0人・同名未選択・確認中・空の名前・上限超過は生成しない／写真なしは人数を表示', () => {
  assert.ok(S.summarize([]).errors.length);
  const a = S.applyCandidates(S.newRow('A'), [reg('c_a', 'F_A')]);
  const b = S.applyCandidates(S.newRow('B'), []);
  const ok = S.summarize([a, b]);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.count, 2);
  assert.equal(ok.missingCount, 1);
  assert.deepEqual(ok.missingNames, ['B']);
  const amb = S.applyCandidates(S.newRow('もも'), [reg('c_a', 'F_A'), reg('c_b', 'F_B')]);
  assert.match(S.summarize([a, amb]).errors.join(), /写真を選んで/);
  assert.match(S.summarize([S.newRow('C')]).errors.join(), /確認中/);
  assert.match(S.summarize([Object.assign(S.newRow(''), { status: 'missing' })]).errors.join(), /入力してください/);
  const many = Array.from({ length: 41 }, (_, i) => Object.assign(S.newRow('C' + i), { status: 'missing' }));
  assert.match(S.validateForSave(many).join(), /40 人まで/);
  assert.equal(S.validateForSave(many.slice(0, 40)).length, 0);
  assert.match(S.validateForSave([S.newRow('あ'.repeat(31))]).join(), /30 文字/);
});

test('店舗の表示名', () => {
  assert.equal(S.storeLabel('KABUKI'), '歌舞伎');
  assert.equal(S.storeLabel('AKIBA'), '秋葉原');
});

test('写真の取得失敗: 該当ファイルの行だけ「取得失敗」・写真なしとして数える・店舗フォルダの由来を保持', () => {
  const a = S.applyCandidates(S.newRow('もも'), [{ castId: 'drive:K1', castName: 'もも', imageFileId: 'K1', source: 'store' }]);
  const b = S.applyCandidates(S.newRow('ちょこ'), [{ castId: 'drive:K2', castName: 'ちょこ', imageFileId: 'K2', source: 'store' }]);
  assert.equal(a.photoSource, 'store');
  const rows = S.markPhotoFailures([a, b], [{ fileId: 'K2', reason: 'UNAVAILABLE' }]);
  assert.deepEqual(rows.map(r => r.status), ['registered', 'photo_error']);
  assert.equal(rows[1].castId, 'drive:K2', '紐付けは保持（保存できる）');
  assert.equal(S.summarize(rows).missingCount, 1);
  assert.deepEqual(S.summarize(rows).errors, [], '取得失敗でも生成はできる（仮カード）');
});
