'use strict';
/**
 * ブラウザ E2E: 背景画像アップロード・店舗別管理・キャスト自動配置・PNG 出力（Chromium / Playwright）
 * GAS はモック（gas-harness）。Drive への書き込みもモック（fakeDrive）。本番には接続しない。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { setup } = require('./fixtures');
const { makeToken, USERS } = require('./jwt-test-utils');
const { makePng, pngSize } = require('./png-util');

const MOCK_GIS = `
window.google = { accounts: { id: {
  initialize(cfg) { window.__gis = { cfg }; },
  renderButton(el) { el.innerHTML = '<button type="button">Google でログイン（モック）</button>'; },
  prompt() {}, disableAutoSelect() {}
} } };`;
const ROOT = path.join(__dirname, '..');
const CDN_DIR = process.env.CDN_DIR || '/tmp/cdn/node_modules';
const GAS_URL = 'https://script.google.com/macros/s/AKfycbz-NSM70nThVEJkTZ3FUaf81pwZD-ykLvXbjfHOM_Nnf6sUSiHt8JK_D5TnQ4A9InU_/exec';
const APP = 'https://app.test/?mode=auto';   // 自動取得（SIFT_DATA）モードの E2E
const hasCdn = fs.existsSync(path.join(CDN_DIR, 'bootstrap'));
const BG_FOLDER = 'E2E_BACKGROUND_FOLDER';

const color = c => () => c;
const PHOTO = {
  IMG_CHOCO: makePng(300, 400, color([230, 80, 140])), IMG_SUZU: makePng(400, 300, color([60, 120, 220])),
  IMG_HIME: makePng(300, 400, color([240, 170, 40])), IMG_PREP: makePng(300, 400, color([150, 150, 150])),
  IMG_RUN: makePng(300, 400, color([40, 180, 120])), IMG_MUGI: makePng(500, 500, color([120, 60, 200]))
};

function newHarness() {
  const fakeDrive = { folders: { [BG_FOLDER]: { name: 'E2E backgrounds' } }, files: {}, seq: 0, photos: {} };
  Object.keys(PHOTO).forEach(id => { fakeDrive.photos[id] = { mimeType: 'image/png', bytes: PHOTO[id] }; });
  const h = setup({ realTime: true, context: { fakeDrive } });
  h.props.DRIVE_BACKGROUND_FOLDER_ID = BG_FOLDER;
  return h;
}

async function openApp(browser, h, log) {
  const page = await browser.newPage({ acceptDownloads: true });
  page.on('pageerror', e => log.push('pageerror: ' + e.message));
  page.on('dialog', d => d.accept());
  await page.route('**/*', async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.url().startsWith(GAS_URL) && req.method() === 'POST') {
      const body = JSON.parse(req.postData());
      log.push('POST ' + body.action);
      const out = h.gas.doPost({ parameter: {}, postData: { contents: req.postData() } });
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: out.body });
    }
    if (req.url() === 'https://accounts.google.com/gsi/client') return route.fulfill({ status: 200, contentType: 'application/javascript', body: MOCK_GIS });
    if (url.hostname === 'cdn.jsdelivr.net') {
      const m = url.pathname.match(/\/npm\/(bootstrap|html2canvas)@[^/]+\/(.*)$/);
      return route.fulfill({ path: path.join(CDN_DIR, m[1], m[2]) });
    }
    if (url.hostname === 'app.test') {
      return route.fulfill({ path: path.join(ROOT, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)) });
    }
    // CORS ヘッダーの無い外部画像（Drive のサムネイル URL を直接読んだ場合の再現）
    if (url.hostname === 'drive.google.com') return route.fulfill({ status: 200, contentType: 'image/png', body: PHOTO.IMG_CHOCO });
    return route.abort();
  });
  await page.goto(APP);
  await page.waitForFunction(() => window.__gis && state.authView === 'signedOut');
  const token = makeToken({ sub: USERS.admin.sub, email: USERS.admin.email });
  await page.evaluate(t => window.__gis.cfg.callback({ credential: t, select_by: 'btn' }), token);
  await page.waitForFunction(() => state.authView === 'signedIn' && document.querySelectorAll('#datePicker option').length > 1);
  return page;
}
const waitIdle = page => page.waitForFunction(() => document.getElementById('loading').classList.contains('d-none') && !bgState.loading);
async function select(page, store, date) {
  await page.selectOption('#storePicker', store);
  await page.selectOption('#datePicker', date);
  await page.waitForFunction(([s, d]) => state.selection.store === s && state.selection.date === d && bgState.store === s && !!bgState.view, [store, date]);
  await waitIdle(page);
}
const pixel = (page, x, y) => page.evaluate(([x, y]) => Array.from(document.getElementById('generatedCanvas').getContext('2d').getImageData(x, y, 1, 1).data.slice(0, 3)), [x, y]);

test('E2E 画像生成: 背景アップロード・店舗別・自動配置・PNG 出力', { skip: !hasCdn && 'CDN_DIR がありません' }, async (t) => {
  const h = newHarness();
  const browser = await chromium.launch();
  const log = [];
  try {
    const page = await openApp(browser, h, log);
    await select(page, 'KABUKI', '2026-11-16');

    await t.test('背景未登録: 白背景で生成・1447 × 2048 px', async () => {
      assert.match(await page.textContent('#bgStatus'), /未登録/);
      await page.click('#generateButton'); await waitIdle(page);
      assert.equal(await page.isHidden('#generateError'), true, await page.textContent('#generateError'));
      assert.deepEqual(await page.evaluate(() => [generatedCanvas.width, generatedCanvas.height]), [1447, 2048]);
      assert.match(await page.textContent('#generateInfo'), /1447 × 2048 px \/ 出勤 5人.*背景未登録/);
      assert.deepEqual(await pixel(page, 3, 3), [255, 255, 255]);
    });

    const shiftBefore = JSON.stringify(['シフト編集', 'シフト編集管理'].map(n => h.ss.getSheetByName(n).rows));

    await t.test('背景アップロード（比率の違う 1080 × 1920）→ 保存 → 店舗別に記録', async () => {
      const bg = makePng(1080, 1920, (x, y) => (y < 300 ? [20, 30, 90] : [250, 220, 235]));
      await page.setInputFiles('#bgFileInput', { name: 'kabuki-bg.png', mimeType: 'image/png', buffer: bg });
      await page.waitForFunction(() => !!bgState.pending);
      assert.match(await page.textContent('#bgStatus'), /未保存の背景: kabuki-bg\.png（1080 × 1920 px）/);
      assert.equal(await page.isDisabled('#bgSaveButton'), false);
      await page.click('#bgSaveButton'); await waitIdle(page);
      assert.match(await page.textContent('#alertArea'), /KABUKI の背景を保存しました/);
      assert.match(await page.textContent('#bgStatus'), /登録済み: 1080 × 1920 px（PNG）/);
      const row = h.ss.getSheetByName('背景設定').rows[1];
      assert.equal(row[0], 'KABUKI');
      assert.equal(row[12], '1', 'revision 1');
      const file = h.fakeDrive.files[row[1]];
      assert.deepEqual(file.parents, [BG_FOLDER]);
      assert.equal(Buffer.compare(file.bytes, bg), 0, 'アップロードした画像そのもの（加工しない）');
    });

    await t.test('背景変更でシフトデータは変わらない', async () => {
      assert.equal(JSON.stringify(['シフト編集', 'シフト編集管理'].map(n => h.ss.getSheetByName(n).rows)), shiftBefore);
    });

    await t.test('生成: 背景は切り抜かず余白で調整・写真と名前を合成・PNG は 1447 × 2048', async () => {
      await page.click('#generateButton'); await waitIdle(page);
      assert.equal(await page.isHidden('#generateError'), true, await page.textContent('#generateError'));
      assert.match(await page.textContent('#generateInfo'), /1447 × 2048 px \/ 出勤 5人$/);
      // 1080×1920 → 高さ 2048 に合わせ幅 1152。左右 147.5px は余白（自動 = 背景外周の平均色）
      const f = await page.evaluate(() => ImageGenerator.fitBackground(1080, 1920));
      assert.ok(Math.abs(f.w - 1152) < 0.01 && Math.abs(f.h - 2048) < 0.01 && Math.abs(f.x - 147.5) < 0.01);
      const leftMargin = await pixel(page, 20, 1000);
      const bgBody = await pixel(page, 723, 380);
      assert.deepEqual(bgBody, [250, 220, 235], '背景の本体');
      assert.notDeepEqual(leftMargin, [250, 220, 235], '左の余白は背景で埋めない（切り抜き・引き伸ばしなし）');
      const header = await pixel(page, 723, 100);
      assert.deepEqual(header, [20, 30, 90], 'ヘッダー部分（背景の上端）も切れていない');
      // 1人目（ちょこ）の写真の中心はちょこの色
      const cell = await page.evaluate(() => ImageGenerator.computeLayout(5, { area: readBackgroundSettingsFromForm().area }).cells[0].photo);
      assert.deepEqual(await pixel(page, Math.round(cell.x + cell.w / 2), Math.round(cell.y + cell.h / 2)), [230, 80, 140]);

      const [download] = await Promise.all([page.waitForEvent('download'), page.click('#pngSaveButton')]);
      assert.equal(download.suggestedFilename(), 'shift_KABUKI_2026-11-16_1447x2048.png');
      const buf = fs.readFileSync(await download.path());
      assert.deepEqual(pngSize(buf), { width: 1447, height: 2048 });
    });

    await t.test('店舗切り替え: AKIBA は背景未登録・生成画像はクリア → KABUKI に戻ると背景が残っている', async () => {
      await select(page, 'AKIBA', '2026-11-16');
      assert.match(await page.textContent('#bgStatus'), /未登録/);
      assert.equal(await page.isDisabled('#pngSaveButton'), true);
      assert.match(await page.textContent('#bgStoreLabel'), /AKIBA/);
      await select(page, 'KABUKI', '2026-11-16');
      assert.match(await page.textContent('#bgStatus'), /登録済み: 1080 × 1920 px/);
    });

    await t.test('再読み込み（ブラウザ）後も背景と設定が残る', async () => {
      await page.fill('#bgAreaTop', '520');
      await page.click('#bgSaveButton'); await waitIdle(page);
      await page.reload();
      await page.waitForFunction(() => window.__gis && state.authView === 'signedOut');
      const token = makeToken({ sub: USERS.admin.sub, email: USERS.admin.email });
      await page.evaluate(tk => window.__gis.cfg.callback({ credential: tk, select_by: 'btn' }), token);
      await page.waitForFunction(() => state.authView === 'signedIn' && document.querySelectorAll('#datePicker option').length > 1);
      await select(page, 'KABUKI', '2026-11-16');
      assert.match(await page.textContent('#bgStatus'), /登録済み: 1080 × 1920 px/);
      assert.equal(await page.inputValue('#bgAreaTop'), '520');
    });

    await t.test('未保存のシフト変更があるときは生成しない（保存を促す）', async () => {
      await page.fill('#addCastName', '未保存さん'); await page.click('#addCastButton');
      await page.click('#generateButton');
      assert.match(await page.textContent('#alertArea'), /「編集保存」してから画像を生成/);
      await page.click('#saveRowsButton'); await waitIdle(page);
      await page.click('#generateButton'); await waitIdle(page);
      assert.match(await page.textContent('#generateInfo'), /出勤 6人$/, '写真の無い「未保存さん」は準備中画像で表示');
    });

    await t.test('休みのキャストは描画しない', async () => {
      await page.click('#activeList .js-toggle-absent >> nth=0'); await waitIdle(page);
      await page.click('#generateButton'); await waitIdle(page);
      assert.match(await page.textContent('#generateInfo'), /出勤 5人/);
    });

    await t.test('人数別: 0/1/2/3/5/8/10/13/16/20 人で常に 1447 × 2048・重なりなし・PNG 出力可', async () => {
      const results = await page.evaluate(async () => {
        const photo = await ImageGenerator.loadImage(generatedCanvas.toDataURL('image/png'));
        const out = [];
        for (const n of [0, 1, 2, 3, 5, 8, 10, 13, 16, 20]) {
          const c = document.createElement('canvas');
          const casts = Array.from({ length: n }, (_, i) => ({ name: i % 4 === 0 ? 'テスト体入おと🔰ながいなまえ' : 'キャスト' + (i + 1), image: i % 3 === 2 ? null : photo }));
          const r = ImageGenerator.render(c, { background: bgState.image, casts, area: ImageGenerator.DEFAULT_AREA });
          const blob = await ImageGenerator.toPngBlob(c);
          const head = new DataView(await blob.slice(0, 24).arrayBuffer());
          out.push({ n, w: c.width, h: c.height, pngW: head.getUint32(16), pngH: head.getUint32(20), rows: r.layout.rows,
            valid: ImageGenerator.validateLayout(r.layout).ok,
            namesFit: r.names.every((f, i) => (casts[i].image ? f === null : f.lines.join('') === casts[i].name)) });
        }
        return out;
      });
      results.forEach(r => {
        assert.deepEqual([r.w, r.h, r.pngW, r.pngH], [1447, 2048, 1447, 2048], 'n=' + r.n);
        assert.equal(r.valid, true, 'n=' + r.n);
        assert.equal(r.namesFit, true, '写真ありは名前を描かない（カードに含まれる）・写真なしは名前を省略せず描く n=' + r.n);
      });
      assert.deepEqual(results.map(r => r.rows.length), [0, 1, 1, 1, 2, 2, 3, 3, 3, 4]);
    });

    await t.test('長すぎる名前は重ねて描かずエラー表示（PNG 保存不可）', async () => {
      const err = await page.evaluate(() => {
        try { ImageGenerator.render(document.createElement('canvas'), { casts: Array.from({ length: 20 }, () => ({ name: 'な'.repeat(80), image: null })) }); return null; }
        catch (e) { return e.code; }
      });
      assert.equal(err, 'NAME_TOO_LONG');
    });

    await t.test('接続先 GAS が背景機能に未対応（UNKNOWN_ACTION）の場合は原因を表示', async () => {
      const msg = await page.evaluate(() => backgroundErrorMessage(Object.assign(new Error('Unknown action: getBackground'), { code: 'UNKNOWN_ACTION' })));
      assert.match(msg, /GAS の新しいバージョンのデプロイが必要/);
    });

    await t.test('Canvas 汚染: CORS の無い外部画像を直接描くと PNG 保存できない（data URL 方式の必要性）', async () => {
      const result = await page.evaluate(async () => {
        const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = 'https://drive.google.com/thumbnail?id=X&sz=w600'; });
        const c = document.createElement('canvas');
        ImageGenerator.render(c, { casts: [{ name: 'テスト', image: img }] });
        try { await ImageGenerator.toPngBlob(c); return 'saved'; } catch (e) { return e.code; }
      });
      assert.equal(result, 'CANVAS_TAINTED');
      // アプリが Canvas に描く画像はすべて data URL（サーバーから base64 で取得）
      assert.ok(await page.evaluate(() => [bgState.image].concat([]).every(i => !i || /^data:/.test(i.src))));
      assert.equal(log.filter(l => l.startsWith('pageerror')).length, 0, log.join('\n'));
    });
  } finally {
    await browser.close();
  }
});
