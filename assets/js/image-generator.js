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
  // 配置領域: 完成見本（KABUKI 13人・2480×3508）のカード配置範囲から確定（docs/IMAGE_LAYOUT.md §4）
  //   カード上端 y≈581・下端 y≈1825（キャンバス換算）、5枚の幅 1381px を左右中央。見出し下端 319・ロゴ上端 1868 を避ける
  const DEFAULT_AREA = Object.freeze({ top: 580, bottom: 220, left: 33, right: 33 });

  /**
   * 配置方式
   * - card（既定）: 店舗が作成済みの「名前入りカード画像」をそのまま並べる。名前・枠は描かない。画像は切り抜かない（contain）
   *   完成見本: カード 約 247 × 387 px（縦横比 1 : 1.567）、横の間隔 ≈ 0.15 × 幅、段の間隔 ≈ 0.15 × 幅、上の段から詰める（13人 → 5/5/3）
   * - photo: 写真（3:4・切り抜き）＋ 名前をアプリが描く方式（名前入りカードが無い場合用）
   */
  const PROFILES = Object.freeze({
    card: Object.freeze({
      ratio: 1.567, maxWidth: 400, minWidth: 80,
      gapXRatio: 0.15, minGapX: 12, gapYRatio: 0.15, minGapY: 12,
      nameGapRatio: 0, minNameGap: 0, nameHeightRatio: 0, minNameHeight: 0,
      distribution: 'fill', lastRow: 'spaceEvenly', drawName: false, frame: false, fit: 'contain'
    }),
    photo: Object.freeze({
      ratio: 4 / 3, maxWidth: 520, minWidth: 80,
      gapXRatio: 0.10, minGapX: 12, gapYRatio: 0.10, minGapY: 16,
      nameGapRatio: 0.04, minNameGap: 6, nameHeightRatio: 0.22, minNameHeight: 34,
      distribution: 'balanced', lastRow: 'center', drawName: true, frame: true, fit: 'cover'
    })
  });
  const DEFAULT_MODE = 'card';
  const PHOTO_RATIO = PROFILES.card.ratio;   // 互換: 既定方式の 高さ / 幅
  const SIZING = Object.freeze({ maxPhotoWidth: PROFILES.card.maxWidth, minPhotoWidth: PROFILES.card.minWidth, minFontSize: 10 });
  const FONT_FAMILY = '"Hiragino Kaku Gothic ProN", "Hiragino Sans", "Noto Sans JP", "Yu Gothic", Meiryo, sans-serif';

  function profileOf(mode) {
    const p = PROFILES[mode || DEFAULT_MODE];
    if (!p) throw layoutError('INVALID_MODE', '配置方式が不正です: ' + mode);
    return p;
  }

  function layoutError(code, message, details) {
    const err = new Error(message);
    err.code = code;
    if (details) err.details = details;
    return err;
  }

  // ===== 段数 =====
  // 0:背景のみ / 1〜3:1段 / 4〜8:2段 / 9〜13:3段 / 14〜:写真が最も大きくなる段数（3段以上）
  // 9〜10人は写真の視認性を優先して3段
  function rowCountFor(n, area, mode) {
    if (n <= 0) return 0;
    if (n <= 3) return 1;
    if (n <= 8) return 2;
    if (n <= 13) return 3;
    let best = 3;
    let bestWidth = -1;
    for (let r = 3; r <= n; r++) {
      const w = maxPhotoWidthFor(distribute(n, r, mode), area, mode);
      if (w > bestWidth + 0.5) { best = r; bestWidth = w; }
    }
    return best;
  }

  // 各段の人数
  // - fill（card 既定・完成見本どおり）: 上の段から 1段あたり ceil(人数/段数) 人ずつ詰め、最終段に残り（13→5/5/3、10→4/4/2）
  // - balanced（photo）: 差が 1 人以内になるよう上の段から多めに（13→5/4/4、10→4/3/3）
  function distribute(n, rows, mode) {
    if (n <= 0 || rows <= 0) return [];
    const out = [];
    if (profileOf(mode).distribution === 'fill') {
      const cols = Math.ceil(n / rows);
      let left = n;
      for (let i = 0; i < rows && left > 0; i++) { out.push(Math.min(cols, left)); left -= cols; }
      return out;
    }
    const base = Math.floor(n / rows);
    const extra = n % rows;
    for (let i = 0; i < rows; i++) out.push(base + (i < extra ? 1 : 0));
    return out.filter(c => c > 0);
  }

  function normalizeArea(area) {
    const a = Object.assign({}, DEFAULT_AREA, area || {});
    const box = { x: a.left, y: a.top, w: CANVAS.width - a.left - a.right, h: CANVAS.height - a.top - a.bottom };
    if (!(box.w > 0 && box.h > 0)) throw layoutError('INVALID_AREA', '配置領域が不正です');
    return box;
  }

  function metricsFor(photoW, mode) {
    const p = profileOf(mode);
    return {
      photoW,
      photoH: photoW * p.ratio,
      gapX: Math.max(photoW * p.gapXRatio, p.minGapX),
      gapY: Math.max(photoW * p.gapYRatio, p.minGapY),
      nameGap: p.drawName ? Math.max(photoW * p.nameGapRatio, p.minNameGap) : 0,
      nameH: p.drawName ? Math.max(photoW * p.nameHeightRatio, p.minNameHeight) : 0
    };
  }

  function blockSize(rows, m) {
    const maxCols = Math.max.apply(null, rows);
    const cellH = m.photoH + m.nameGap + m.nameH;
    return { w: maxCols * m.photoW + (maxCols - 1) * m.gapX, h: rows.length * cellH + (rows.length - 1) * m.gapY, cellH };
  }

  function fits(rows, box, photoW, mode) {
    const b = blockSize(rows, metricsFor(photoW, mode));
    return b.w <= box.w + 1e-6 && b.h <= box.h + 1e-6;
  }

  // 配置領域に収まる最大の写真（カード）幅（整数 px）
  function maxPhotoWidthFor(rows, areaOrBox, mode) {
    const p = profileOf(mode);
    const box = areaOrBox && areaOrBox.w !== undefined ? areaOrBox : normalizeArea(areaOrBox);
    const maxCols = Math.max.apply(null, rows);
    const r = rows.length;
    const nameRatio = p.drawName ? p.nameGapRatio + p.nameHeightRatio : 0;
    const byW = box.w / (maxCols + (maxCols - 1) * p.gapXRatio);
    const byH = box.h / (r * (p.ratio + nameRatio) + (r - 1) * p.gapYRatio);
    let w = Math.floor(Math.min(p.maxWidth, byW, byH));
    while (w > 0 && !fits(rows, box, w, mode)) w -= 1;   // 最小値（minGap 等）の影響を補正
    return w;
  }

  /**
   * 人数から配置を計算する。
   * @returns {{ count, rows:number[], cells:Array, photoW, photoH, area, canvas }}
   *   cells[i] = { index, row, col, photo:{x,y,w,h}, name:{x,y,w,h} }（i はシフトの並び順）
   */
  function computeLayout(count, options) {
    const opts = options || {};
    const mode = opts.mode || DEFAULT_MODE;
    const p = profileOf(mode);
    const n = Math.max(0, Math.floor(Number(count) || 0));
    const box = normalizeArea(opts.area);
    const base = { count: n, mode, canvas: Object.assign({}, CANVAS), area: box, rows: [], cells: [], photoW: 0, photoH: 0 };
    if (n === 0) return base;

    const rows = distribute(n, rowCountFor(n, box, mode), mode);
    const photoW = maxPhotoWidthFor(rows, box, mode);
    if (photoW < p.minWidth) {
      throw layoutError('LAYOUT_OVERFLOW', n + '人を配置領域に収められません（写真が小さくなりすぎます）。配置領域を広げてください',
        { count: n, rows, photoW });
    }
    const m = metricsFor(photoW, mode);
    const size = blockSize(rows, m);
    const top = box.y + (box.h - size.h) / 2;          // 領域内で上下中央
    const cells = [];
    let index = 0;
    const maxCols = Math.max.apply(null, rows);
    rows.forEach((cols, r) => {
      // 各段を左右中央（最終段が少人数でも中央）
      // card: 人数が足りない段は、満員の段と同じ幅の中に等間隔で並べる（完成見本の最終段 3 人と同じ）
      const spread = p.lastRow === 'spaceEvenly' && cols < maxCols;
      const gap = spread ? (size.w - cols * m.photoW) / (cols + 1) : m.gapX;
      const rowW = spread ? size.w : cols * m.photoW + (cols - 1) * m.gapX;
      const rowLeft = box.x + (box.w - rowW) / 2;
      const left = spread ? rowLeft + gap : rowLeft;
      const y = top + r * (size.cellH + m.gapY);
      for (let c = 0; c < cols; c++) {
        const x = left + c * (m.photoW + gap);
        // 名前枠は写真幅＋左右の間隔の半分ずつ（隣の名前枠とは重ならない）。配置領域の外には出さない
        const nameInset = 1;
        const nx1 = Math.max(box.x, x - m.gapX / 2 + nameInset);
        const nx2 = Math.min(box.x + box.w, x + m.photoW + m.gapX / 2 - nameInset);
        cells.push({
          index: index++, row: r, col: c,
          photo: { x, y, w: m.photoW, h: m.photoH },
          name: p.drawName ? { x: nx1, y: y + m.photoH + m.nameGap, w: nx2 - nx1, h: m.nameH } : null
        });
      }
    });
    return Object.assign(base, { rows, cells, photoW: m.photoW, photoH: m.photoH, metrics: m });
  }

  // 全セルが領域内にあり、写真・名前がどれも重ならないことを検証（重なりがあれば描画しない）
  function validateLayout(layout) {
    const rects = [];
    layout.cells.forEach(c => {
      rects.push(Object.assign({ kind: 'photo', i: c.index }, c.photo));
      if (c.name) rects.push(Object.assign({ kind: 'name', i: c.index }, c.name));
    });
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
    const mode = opts.mode || DEFAULT_MODE;
    const prof = profileOf(mode);
    const style = Object.assign({ textColor: '#2b2b2b', labelColor: 'rgba(255,255,255,0.88)', frameColor: '#ffffff', shadow: true,
      cardNameColor: '#38a8e0' }, opts.style || {});
    canvas.width = CANVAS.width;
    canvas.height = CANVAS.height;
    const ctx = canvas.getContext('2d');
    const casts = Array.isArray(opts.casts) ? opts.casts : [];

    // 1) 配置と名前サイズを先にすべて計算（失敗したら何も描かない）
    const layout = computeLayout(casts.length, { area: opts.area, mode });
    const check = validateLayout(layout);
    if (!check.ok) throw layoutError('LAYOUT_OVERLAP', '写真と名前が重なるため画像を生成できません', check);
    const measure = (text, size) => { ctx.font = font(size); return ctx.measureText(text).width; };
    // card 方式: 名前はカード画像に入っているため描かない。写真が無い人だけプレースホルダーのカードに名前を描く
    const names = layout.cells.map(c => {
      const cast = casts[c.index];
      if (prof.drawName) return fitName(cast.name, c.name, measure);
      return cast.image ? null : fitName(cast.name, cardNameBox(c.photo), measure);
    });

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
      if (prof.drawName) drawPhotoWithName(ctx, cell, cast, names[i], style);
      else drawCard(ctx, cell, cast, names[i], style);
    });

    return { layout, names };
  }

  // card 方式: 名前入りカード画像を枠いっぱいに収める（縦横比維持・切り抜かない・加工しない）
  function drawCard(ctx, cell, cast, fitted, style) {
    const p = cell.photo;
    if (cast.image) {
      const img = cast.image;
      const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
      const scale = Math.min(p.w / iw, p.h / ih);
      const w = iw * scale, h = ih * scale;
      ctx.drawImage(img, p.x + (p.w - w) / 2, p.y + (p.h - h) / 2, w, h);
      return;
    }
    // 写真なし: 完成見本と同じ形の白いカード（写真部分は NO PHOTO・下に名前）
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(p.x, p.y, p.w, p.h);
    const inner = { x: p.x + p.w * 0.07, y: p.y + p.w * 0.07, w: p.w * 0.86, h: p.h * 0.73 };
    drawPlaceholder(ctx, inner);
    const nb = cardNameBox(p);
    ctx.fillStyle = style.cardNameColor;
    ctx.font = font(fitted.fontSize);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const totalH = fitted.lineHeight * fitted.lines.length;
    fitted.lines.forEach((line, k) => ctx.fillText(line, nb.x + nb.w / 2, nb.y + (nb.h - totalH) / 2 + fitted.lineHeight * (k + 0.5)));
    ctx.restore();
  }

  function cardNameBox(p) {
    return { x: p.x + p.w * 0.06, y: p.y + p.h * 0.8, w: p.w * 0.88, h: p.h * 0.16 };
  }

  // photo 方式: 写真（3:4・切り抜き）＋白枠・影＋名前ラベル
  function drawPhotoWithName(ctx, cell, cast, fitted, style) {
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

    const nb = cell.name;
    ctx.save();
    ctx.fillStyle = style.labelColor;
    roundRect(ctx, nb.x, nb.y, nb.w, nb.h, Math.min(nb.h / 2, 18));
    ctx.fill();
    ctx.fillStyle = style.textColor;
    ctx.font = font(fitted.fontSize);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const totalH = fitted.lineHeight * fitted.lines.length;
    fitted.lines.forEach((line, k) => ctx.fillText(line, nb.x + nb.w / 2, nb.y + (nb.h - totalH) / 2 + fitted.lineHeight * (k + 0.5)));
    ctx.restore();
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
    CANVAS, DEFAULT_AREA, PHOTO_RATIO, SIZING, FONT_FAMILY, PROFILES, DEFAULT_MODE,
    rowCountFor, distribute, computeLayout, validateLayout, maxPhotoWidthFor, fitName, fitBackground, coverCrop,
    loadImage, sampleEdgeColor, render, toPngBlob, normalizeArea
  };
});
