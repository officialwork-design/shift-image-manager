/**
 * 出勤キャスト画像の生成（背景固定・キャスト自動配置）
 *
 * - 完成画像は常に 1447 × 2048 px（人数でキャンバスを変えない）
 * - 背景は縦横比を保ったまま全体が入るように縮小・拡大し、余った部分は余白色で塗る（切り抜かない）
 * - 写真枠は 3:4（縦長）で統一。人数に応じて写真枠と余白だけを縮める
 * - 名前は写真の下。長い名前は文字を小さくし、それでも入らなければ2行。省略はしない
 * - 配置できない場合はエラー（写真・文字を重ねて描かない）
 * - 画像は data: / blob: URL で読み込む（Drive の URL を直接読むと Canvas が汚染され PNG 出力できない）
 *
 * レイアウト計算（computeLayout / fitName）は DOM に依存しない純粋関数で、Node のテストからも使う。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ImageGenerator = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CANVAS = Object.freeze({ width: 1447, height: 2048 });
  const DEFAULT_AREA = Object.freeze({ top: 440, bottom: 200, left: 60, right: 60 });
  const PHOTO_RATIO = 4 / 3;            // 写真枠の 高さ / 幅（3:4）
  const SIZING = Object.freeze({
    maxPhotoWidth: 520,                 // 1人のときの上限（大きくなりすぎない）
    minPhotoWidth: 80,                  // これより小さくなる場合は配置不可
    gapXRatio: 0.10, minGapX: 12,       // 写真どうしの横の間隔
    gapYRatio: 0.10, minGapY: 16,       // 段どうしの縦の間隔（名前の下〜次の写真）
    nameGapRatio: 0.04, minNameGap: 6,  // 写真〜名前
    nameHeightRatio: 0.22, minNameHeight: 34,
    minFontSize: 10
  });
  const FONT_FAMILY = '"Hiragino Kaku Gothic ProN", "Hiragino Sans", "Noto Sans JP", "Yu Gothic", Meiryo, sans-serif';

  function layoutError(code, message, details) {
    const err = new Error(message);
    err.code = code;
    if (details) err.details = details;
    return err;
  }

  // ===== 段数（初期配置ルール） =====
  // 0:背景のみ / 1〜3:1段 / 4〜8:2段 / 9〜13:3段 / 14〜:写真が最も大きくなる段数（3段以上）
  // 9〜10人は写真の視認性を優先して3段（2段 5/5 より写真が大きくなる）
  function rowCountFor(n, area) {
    if (n <= 0) return 0;
    if (n <= 3) return 1;
    if (n <= 8) return 2;
    if (n <= 13) return 3;
    let best = 3;
    let bestWidth = -1;
    for (let r = 3; r <= n; r++) {
      const w = maxPhotoWidthFor(distribute(n, r), area);
      if (w > bestWidth + 0.5) { best = r; bestWidth = w; }
    }
    return best;
  }

  // 各段の人数。上の段から多めに割り振る（例: 5→3/2, 7→4/3, 11→4/4/3, 13→5/4/4）
  function distribute(n, rows) {
    if (n <= 0 || rows <= 0) return [];
    const base = Math.floor(n / rows);
    const extra = n % rows;
    const out = [];
    for (let i = 0; i < rows; i++) out.push(base + (i < extra ? 1 : 0));
    return out.filter(c => c > 0);
  }

  function normalizeArea(area) {
    const a = Object.assign({}, DEFAULT_AREA, area || {});
    const box = { x: a.left, y: a.top, w: CANVAS.width - a.left - a.right, h: CANVAS.height - a.top - a.bottom };
    if (!(box.w > 0 && box.h > 0)) throw layoutError('INVALID_AREA', '配置領域が不正です');
    return box;
  }

  function metricsFor(photoW) {
    return {
      photoW,
      photoH: photoW * PHOTO_RATIO,
      gapX: Math.max(photoW * SIZING.gapXRatio, SIZING.minGapX),
      gapY: Math.max(photoW * SIZING.gapYRatio, SIZING.minGapY),
      nameGap: Math.max(photoW * SIZING.nameGapRatio, SIZING.minNameGap),
      nameH: Math.max(photoW * SIZING.nameHeightRatio, SIZING.minNameHeight)
    };
  }

  function blockSize(rows, m) {
    const maxCols = Math.max.apply(null, rows);
    const cellH = m.photoH + m.nameGap + m.nameH;
    return { w: maxCols * m.photoW + (maxCols - 1) * m.gapX, h: rows.length * cellH + (rows.length - 1) * m.gapY, cellH };
  }

  function fits(rows, box, photoW) {
    const b = blockSize(rows, metricsFor(photoW));
    return b.w <= box.w + 1e-6 && b.h <= box.h + 1e-6;
  }

  // 配置領域に収まる最大の写真幅（整数 px）
  function maxPhotoWidthFor(rows, areaOrBox) {
    const box = areaOrBox && areaOrBox.w !== undefined ? areaOrBox : normalizeArea(areaOrBox);
    const maxCols = Math.max.apply(null, rows);
    const r = rows.length;
    const byW = box.w / (maxCols + (maxCols - 1) * SIZING.gapXRatio);
    const byH = box.h / (r * (PHOTO_RATIO + SIZING.nameGapRatio + SIZING.nameHeightRatio) + (r - 1) * SIZING.gapYRatio);
    let w = Math.floor(Math.min(SIZING.maxPhotoWidth, byW, byH));
    while (w > 0 && !fits(rows, box, w)) w -= 1;   // 最小値（minGap 等）の影響を補正
    return w;
  }

  /**
   * 人数から配置を計算する。
   * @returns {{ count, rows:number[], cells:Array, photoW, photoH, area, canvas }}
   *   cells[i] = { index, row, col, photo:{x,y,w,h}, name:{x,y,w,h} }（i はシフトの並び順）
   */
  function computeLayout(count, options) {
    const opts = options || {};
    const n = Math.max(0, Math.floor(Number(count) || 0));
    const box = normalizeArea(opts.area);
    const base = { count: n, canvas: Object.assign({}, CANVAS), area: box, rows: [], cells: [], photoW: 0, photoH: 0 };
    if (n === 0) return base;

    const rows = distribute(n, rowCountFor(n, box));
    const photoW = maxPhotoWidthFor(rows, box);
    if (photoW < SIZING.minPhotoWidth) {
      throw layoutError('LAYOUT_OVERFLOW', n + '人を配置領域に収められません（写真が小さくなりすぎます）。配置領域を広げてください',
        { count: n, rows, photoW });
    }
    const m = metricsFor(photoW);
    const size = blockSize(rows, m);
    const top = box.y + (box.h - size.h) / 2;          // 領域内で上下中央
    const cells = [];
    let index = 0;
    rows.forEach((cols, r) => {
      const rowW = cols * m.photoW + (cols - 1) * m.gapX;
      const left = box.x + (box.w - rowW) / 2;         // 各段を左右中央（最終段が少人数でも中央）
      const y = top + r * (size.cellH + m.gapY);
      for (let c = 0; c < cols; c++) {
        const x = left + c * (m.photoW + m.gapX);
        // 名前枠は写真幅＋左右の間隔の半分ずつ（隣の名前枠とは重ならない）。配置領域の外には出さない
        const nameInset = 1;
        const nx1 = Math.max(box.x, x - m.gapX / 2 + nameInset);
        const nx2 = Math.min(box.x + box.w, x + m.photoW + m.gapX / 2 - nameInset);
        cells.push({
          index: index++, row: r, col: c,
          photo: { x, y, w: m.photoW, h: m.photoH },
          name: { x: nx1, y: y + m.photoH + m.nameGap, w: nx2 - nx1, h: m.nameH }
        });
      }
    });
    return Object.assign(base, { rows, cells, photoW: m.photoW, photoH: m.photoH, metrics: m });
  }

  // 全セルが領域内にあり、写真・名前がどれも重ならないことを検証（重なりがあれば描画しない）
  function validateLayout(layout) {
    const rects = [];
    layout.cells.forEach(c => { rects.push(Object.assign({ kind: 'photo', i: c.index }, c.photo)); rects.push(Object.assign({ kind: 'name', i: c.index }, c.name)); });
    const a = layout.area;
    const eps = 0.01;
    for (const r of rects) {
      if (r.x < a.x - eps || r.y < a.y - eps || r.x + r.w > a.x + a.w + eps || r.y + r.h > a.y + a.h + eps) {
        return { ok: false, reason: 'OUT_OF_AREA', rect: r };
      }
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const p = rects[i], q = rects[j];
        if (p.x < q.x + q.w - eps && q.x < p.x + p.w - eps && p.y < q.y + q.h - eps && q.y < p.y + p.h - eps) {
          return { ok: false, reason: 'OVERLAP', a: p, b: q };
        }
      }
    }
    return { ok: true };
  }

  // ===== 名前の文字サイズ =====
  // measure(text, fontSize) → 幅(px)。1行で入る最大サイズ → 入らなければ2行 → それでも入らなければエラー
  function fitName(name, box, measure) {
    const text = String(name || '');
    const maxW = box.w * 0.94;
    let one = null;
    for (let size = Math.floor(box.h * 0.72); size >= SIZING.minFontSize; size--) {
      if (measure(text, size) <= maxW) { one = { lines: [text], fontSize: size, lineHeight: size * 1.15 }; break; }
    }
    // 1行だと文字がかなり小さくなる場合は、2行に分けたほうが大きく読める（省略はしない）
    let two = null;
    const chars = Array.from(text);
    if (chars.length >= 2 && (!one || one.fontSize < box.h * 0.45)) {
      for (let size = Math.floor((box.h * 0.92) / (2 * 1.15)); size >= SIZING.minFontSize; size--) {
        let best = null;
        for (let k = 1; k < chars.length; k++) {
          const a = chars.slice(0, k).join(''), b = chars.slice(k).join('');
          if (Math.max(measure(a, size), measure(b, size)) <= maxW &&
              (!best || Math.abs(a.length - b.length) < Math.abs(best[0].length - best[1].length))) best = [a, b];
        }
        if (best) { two = { lines: best, fontSize: size, lineHeight: size * 1.15 }; break; }
      }
    }
    if (one && (!two || two.fontSize < one.fontSize * 1.2)) return one;
    if (two) return two;
    throw layoutError('NAME_TOO_LONG', '名前「' + text + '」が長すぎて写真の下に収まりません', { name: text });
  }

  // 背景: 縦横比を保って全体を収める（contain）。切り抜かない
  function fitBackground(imgW, imgH) {
    const scale = Math.min(CANVAS.width / imgW, CANVAS.height / imgH);
    const w = imgW * scale, h = imgH * scale;
    return { x: (CANVAS.width - w) / 2, y: (CANVAS.height - h) / 2, w, h, scale };
  }

  // 写真: 3:4 の枠を埋めるように中央（上寄り）で切り抜く（写真のみ。背景は切り抜かない）
  function coverCrop(srcW, srcH, dstW, dstH, anchorY) {
    const scale = Math.max(dstW / srcW, dstH / srcH);
    const sw = dstW / scale, sh = dstH / scale;
    const ay = anchorY === undefined ? 0.25 : anchorY;
    return { sx: (srcW - sw) / 2, sy: (srcH - sh) * ay, sw, sh };
  }

  // ===== ブラウザ側（Canvas） =====
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      if (!src) { resolve(null); return; }
      const img = new Image();
      if (/^https?:/i.test(src)) img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(layoutError('IMAGE_LOAD_FAILED', '画像を読み込めませんでした'));
      img.src = src;
    });
  }

  function font(size) { return 'bold ' + size + 'px ' + FONT_FAMILY; }

  // 背景の外周の平均色（余白色の既定値）
  function sampleEdgeColor(image) {
    try {
      const c = document.createElement('canvas');
      c.width = 32; c.height = 32;
      const ctx = c.getContext('2d');
      ctx.drawImage(image, 0, 0, 32, 32);
      const d = ctx.getImageData(0, 0, 32, 32).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
        if (x !== 0 && y !== 0 && x !== 31 && y !== 31) continue;
        const i = (y * 32 + x) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
      }
      const h = v => ('0' + Math.round(v / n).toString(16)).slice(-2);
      return '#' + h(r) + h(g) + h(b);
    } catch (err) {
      return '#ffffff';
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function drawPlaceholder(ctx, p) {
    const g = ctx.createLinearGradient(p.x, p.y, p.x, p.y + p.h);
    g.addColorStop(0, '#eceff3'); g.addColorStop(1, '#cfd5dd');
    ctx.fillStyle = g;
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.fillStyle = '#aab3bf';
    const cx = p.x + p.w / 2;
    ctx.beginPath(); ctx.arc(cx, p.y + p.h * 0.38, p.w * 0.17, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx, p.y + p.h * 0.78, p.w * 0.32, p.h * 0.2, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#7d8794';
    ctx.font = font(Math.max(10, Math.round(p.w * 0.09)));
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('NO PHOTO', cx, p.y + p.h * 0.1);
  }

  /**
   * 画像を描画する。
   * @param {HTMLCanvasElement} canvas
   * @param {{ background: HTMLImageElement|null, fillColor?: string, area?: object,
   *           casts: Array<{ name: string, image: HTMLImageElement|null }>, style?: object }} input
   * @returns {{ layout, names }}
   */
  function render(canvas, input) {
    const opts = input || {};
    const style = Object.assign({ textColor: '#2b2b2b', labelColor: 'rgba(255,255,255,0.88)', frameColor: '#ffffff', shadow: true }, opts.style || {});
    canvas.width = CANVAS.width;
    canvas.height = CANVAS.height;
    const ctx = canvas.getContext('2d');
    const casts = Array.isArray(opts.casts) ? opts.casts : [];

    // 1) 配置と名前サイズを先にすべて計算（失敗したら何も描かない）
    const layout = computeLayout(casts.length, { area: opts.area });
    const check = validateLayout(layout);
    if (!check.ok) throw layoutError('LAYOUT_OVERLAP', '写真と名前が重なるため画像を生成できません', check);
    const measure = (text, size) => { ctx.font = font(size); return ctx.measureText(text).width; };
    const names = layout.cells.map(c => fitName(casts[c.index].name, c.name, measure));

    // 2) 背景（余白色 → 背景 contain）
    const bg = opts.background || null;
    ctx.fillStyle = opts.fillColor || (bg ? sampleEdgeColor(bg) : '#ffffff');
    ctx.fillRect(0, 0, CANVAS.width, CANVAS.height);
    if (bg) {
      const f = fitBackground(bg.naturalWidth || bg.width, bg.naturalHeight || bg.height);
      ctx.drawImage(bg, f.x, f.y, f.w, f.h);
    }

    // 3) キャスト（シフトの並び順）
    layout.cells.forEach((cell, i) => {
      const cast = casts[cell.index];
      const p = cell.photo;
      const radius = Math.max(6, p.w * 0.05);
      const border = Math.max(3, p.w * 0.02);
      ctx.save();
      if (style.shadow) { ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = p.w * 0.05; ctx.shadowOffsetY = p.w * 0.015; }
      ctx.fillStyle = style.frameColor;
      roundRect(ctx, p.x, p.y, p.w, p.h, radius);
      ctx.fill();
      ctx.restore();

      ctx.save();
      const inner = { x: p.x + border, y: p.y + border, w: p.w - border * 2, h: p.h - border * 2 };
      roundRect(ctx, inner.x, inner.y, inner.w, inner.h, Math.max(2, radius - border));
      ctx.clip();
      if (cast.image) {
        const img = cast.image;
        const crop = coverCrop(img.naturalWidth || img.width, img.naturalHeight || img.height, inner.w, inner.h);
        ctx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, inner.x, inner.y, inner.w, inner.h);
      } else {
        drawPlaceholder(ctx, inner);
      }
      ctx.restore();

      // 名前（写真の下・ラベル内に収める）
      const nb = cell.name;
      const fitted = names[i];
      ctx.save();
      ctx.fillStyle = style.labelColor;
      roundRect(ctx, nb.x, nb.y, nb.w, nb.h, Math.min(nb.h / 2, 18));
      ctx.fill();
      ctx.fillStyle = style.textColor;
      ctx.font = font(fitted.fontSize);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const totalH = fitted.lineHeight * fitted.lines.length;
      fitted.lines.forEach((line, k) => {
        ctx.fillText(line, nb.x + nb.w / 2, nb.y + (nb.h - totalH) / 2 + fitted.lineHeight * (k + 0.5));
      });
      ctx.restore();
    });

    return { layout, names };
  }

  // PNG（Blob）。外部画像で Canvas が汚染されている場合は CANVAS_TAINTED
  function toPngBlob(canvas) {
    return new Promise((resolve, reject) => {
      try {
        canvas.toBlob(blob => (blob ? resolve(blob) : reject(layoutError('PNG_FAILED', 'PNG を作成できませんでした'))), 'image/png');
      } catch (err) {
        if (err && err.name === 'SecurityError') reject(layoutError('CANVAS_TAINTED', '外部の画像が含まれているため PNG を保存できません（画像は data URL で読み込んでください）'));
        else reject(err);
      }
    });
  }

  return {
    CANVAS, DEFAULT_AREA, PHOTO_RATIO, SIZING, FONT_FAMILY,
    rowCountFor, distribute, computeLayout, validateLayout, maxPhotoWidthFor, fitName, fitBackground, coverCrop,
    loadImage, sampleEdgeColor, render, toPngBlob, normalizeArea
  };
});
