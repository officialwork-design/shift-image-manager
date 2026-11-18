'use strict';
// 背景固定・キャスト自動配置: レイアウト計算（DOM 非依存部分）
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../assets/js/image-generator.js');

const CASES = [0, 1, 2, 3, 5, 8, 10, 13, 16, 20];
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;
// 等幅近似の文字幅（全角 = 1em、半角 = 0.55em）
const measure = (text, size) => Array.from(text).reduce((w, ch) => w + (/[\x20-\x7e]/.test(ch) ? 0.55 : 1) * size, 0);

test('画像サイズ: すべての人数で 1447 × 2048 px（人数で変わらない）', () => {
  assert.deepEqual(G.CANVAS, { width: 1447, height: 2048 });
  for (let n = 0; n <= 40; n++) {
    const L = G.computeLayout(n);
    assert.equal(L.canvas.width, 1447, 'n=' + n);
    assert.equal(L.canvas.height, 2048, 'n=' + n);
  }
});

test('段数: 配置ルールどおり（0:背景のみ / 1〜3:1段 / 4〜8:2段 / 9〜13:3段 / 14〜:3段以上）', () => {
  const expected = { 0: 0, 1: 1, 2: 1, 3: 1, 4: 2, 5: 2, 6: 2, 7: 2, 8: 2, 9: 3, 10: 3, 11: 3, 12: 3, 13: 3 };
  Object.keys(expected).forEach(n => assert.equal(G.computeLayout(Number(n)).rows.length, expected[n], 'n=' + n));
  for (let n = 14; n <= 40; n++) assert.ok(G.computeLayout(n).rows.length >= 3, 'n=' + n);
  assert.deepEqual(G.computeLayout(0).cells, []);
});

test('段ごとの人数: 上の段から多めに・合計は人数と一致', () => {
  assert.deepEqual(G.computeLayout(5).rows, [3, 2]);
  assert.deepEqual(G.computeLayout(7).rows, [4, 3]);
  assert.deepEqual(G.computeLayout(9).rows, [3, 3, 3]);
  assert.deepEqual(G.computeLayout(10).rows, [4, 3, 3]);
  assert.deepEqual(G.computeLayout(11).rows, [4, 4, 3]);
  assert.deepEqual(G.computeLayout(13).rows, [5, 4, 4]);
  for (let n = 1; n <= 40; n++) {
    const rows = G.computeLayout(n).rows;
    assert.equal(rows.reduce((a, b) => a + b, 0), n);
    for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1] >= rows[i] && rows[i - 1] - rows[i] <= 1, 'n=' + n);
  }
});

test('配置: 全ケースで領域内・重なりなし・各段（最終段を含む）が左右中央', () => {
  for (const n of CASES.concat([4, 6, 7, 9, 11, 12, 14, 15, 25, 30, 40])) {
    const L = G.computeLayout(n);
    assert.deepEqual(G.validateLayout(L), { ok: true }, 'n=' + n);
    L.rows.forEach((cols, r) => {
      const cells = L.cells.filter(c => c.row === r);
      assert.equal(cells.length, cols);
      const left = cells[0].photo.x - L.area.x;
      const right = L.area.x + L.area.w - (cells[cells.length - 1].photo.x + cells[cells.length - 1].photo.w);
      assert.ok(near(left, right), `n=${n} row=${r} left=${left} right=${right}`);
    });
    if (L.cells.length) {   // ブロックは上下中央
      const top = L.cells[0].photo.y - L.area.y;
      const last = L.cells[L.cells.length - 1];
      const bottom = L.area.y + L.area.h - (last.name.y + last.name.h);
      assert.ok(near(top, bottom), `n=${n} top=${top} bottom=${bottom}`);
    }
  }
});

test('配置: 並び順を保持（左上から右へ、上の段から順）・写真枠は全員同じ 3:4', () => {
  for (const n of CASES) {
    const L = G.computeLayout(n);
    L.cells.forEach((c, i) => {
      assert.equal(c.index, i);
      assert.ok(near(c.photo.h / c.photo.w, 4 / 3), 'aspect');
      assert.equal(c.photo.w, L.photoW);
      if (i > 0) {
        const p = L.cells[i - 1];
        assert.ok(c.row > p.row || (c.row === p.row && c.photo.x > p.photo.x), 'order n=' + n);
      }
    });
  }
});

test('9〜10人: 3段のほうが 2段（5/4・5/5）より写真が大きい（視認性優先）', () => {
  for (const n of [9, 10]) {
    const three = G.computeLayout(n).photoW;
    const two = G.maxPhotoWidthFor(G.distribute(n, 2), G.normalizeArea());
    assert.ok(three > two, `n=${n} 3段=${three} 2段=${two}`);
  }
});

test('写真枠: 人数が増えるほど小さくなる（キャンバスではなく写真枠と余白だけが縮む）', () => {
  const w = n => G.computeLayout(n).photoW;
  assert.ok(w(1) >= w(3) && w(3) >= w(8) && w(8) >= w(10) && w(13) >= w(16) && w(16) >= w(20) && w(20) >= w(40));
  assert.ok(w(1) <= G.SIZING.maxPhotoWidth);
  assert.ok(w(40) >= G.SIZING.minPhotoWidth);
});

test('配置不可: 配置領域が狭く収まらない場合は LAYOUT_OVERFLOW（重ねて描かない）', () => {
  const area = { top: 900, bottom: 700, left: 500, right: 500 };   // 447 × 448
  assert.throws(() => G.computeLayout(40, { area }), e => e.code === 'LAYOUT_OVERFLOW');
  assert.equal(G.computeLayout(1, { area }).cells.length, 1);
  assert.throws(() => G.computeLayout(1, { area: { top: 1500, bottom: 600 } }), e => e.code === 'INVALID_AREA');
});

test('配置領域: ヘッダー・フッターを除いた中央部分（設定値どおり）', () => {
  const L = G.computeLayout(8, { area: { top: 500, bottom: 300, left: 80, right: 80 } });
  assert.deepEqual(L.area, { x: 80, y: 500, w: 1447 - 160, h: 2048 - 800 });
  L.cells.forEach(c => {
    assert.ok(c.photo.y >= 500 && c.name.y + c.name.h <= 2048 - 300);
  });
});

test('名前: 長さに応じて文字サイズを調整・省略しない・必要なら2行・入らなければエラー', () => {
  const box = { x: 0, y: 0, w: 200, h: 46 };
  const short = G.fitName('あい', box, measure);
  const longer = G.fitName('ちょこれーとぱふぇ', box, measure);
  assert.equal(short.lines.join(''), 'あい');
  assert.ok(short.fontSize > longer.fontSize);
  assert.ok(measure(longer.lines[0], longer.fontSize) <= box.w);
  const veryLong = G.fitName('とってもながいなまえのきゃすとさんですよ', { x: 0, y: 0, w: 120, h: 46 }, measure);
  assert.equal(veryLong.lines.join(''), 'とってもながいなまえのきゃすとさんですよ', '省略しない');
  veryLong.lines.forEach(l => assert.ok(measure(l, veryLong.fontSize) <= 120));
  assert.ok(veryLong.fontSize >= G.SIZING.minFontSize);
  assert.throws(() => G.fitName('あ'.repeat(60), { x: 0, y: 0, w: 80, h: 34 }, measure), e => e.code === 'NAME_TOO_LONG');
});

test('名前: 20人・30文字の名前でも写真の下の枠に収まる（2行化）', () => {
  const L = G.computeLayout(20);
  const name = 'テスト体入おと🔰ながいなまえのきゃすと';
  L.cells.forEach(c => {
    const f = G.fitName(name, c.name, measure);
    f.lines.forEach(l => assert.ok(measure(l, f.fontSize) <= c.name.w));
    assert.ok(f.lineHeight * f.lines.length <= c.name.h + 0.01);
  });
});

test('背景: 縦横比を保ったまま全体を収める（切り抜かない）・比率が違えば余白', () => {
  for (const [w, h] of [[1447, 2048], [1080, 1920], [2048, 2048], [3000, 2000], [500, 800], [723, 1024]]) {
    const f = G.fitBackground(w, h);
    assert.ok(f.w <= 1447 + 1e-6 && f.h <= 2048 + 1e-6, 'はみ出さない');
    assert.ok(near(f.w / f.h, w / h, 1e-6), '比率維持');
    assert.ok(near(f.w, 1447) || near(f.h, 2048), 'どちらかの辺が一致');
    assert.ok(near(f.x, (1447 - f.w) / 2) && near(f.y, (2048 - f.h) / 2), '中央');
  }
  const same = G.fitBackground(1447, 2048);
  assert.deepEqual([same.x, same.y, same.w, same.h], [0, 0, 1447, 2048]);
});

test('写真: 3:4 枠を埋める切り抜きは元画像の範囲内', () => {
  for (const [w, h] of [[600, 800], [800, 600], [1000, 1000], [300, 900]]) {
    const c = G.coverCrop(w, h, 300, 400);
    assert.ok(c.sx >= -1e-6 && c.sy >= -1e-6 && c.sx + c.sw <= w + 1e-6 && c.sy + c.sh <= h + 1e-6);
    assert.ok(near(c.sh / c.sw, 4 / 3, 1e-6));
  }
});

test('既定の配置領域（参考デザインから確定）: 0〜40人で見出し（y≦319）・ロゴ（y≧1868）に重ならない', () => {
  assert.deepEqual({ ...G.DEFAULT_AREA }, { top: 350, bottom: 210, left: 60, right: 60 });
  const gasSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'gas', 'BackgroundService.gs'), 'utf8');
  assert.match(gasSrc, /DEFAULT_AREA: \{ top: 350, bottom: 210, left: 60, right: 60 \}/, 'GAS 側の既定値と一致');
  for (let n = 1; n <= 40; n++) {
    const L = G.computeLayout(n);
    L.cells.forEach(c => {
      assert.ok(c.photo.y >= 319 + 30, 'n=' + n);
      assert.ok(c.name.y + c.name.h <= 1868 - 30, 'n=' + n);
    });
  }
});
