'use strict';
/**
 * ブラウザ E2E: 手動モード（キャスト名の手入力 → 店舗別背景 → 画像生成 → PNG 保存）（Chromium / Playwright）
 * GAS はモック（gas-harness）。Drive への書き込みもモック（fakeDrive）。本番には接続しない。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { setup, callPost, FOLDERS } = require('./fixtures');
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
const APP = 'https://app.test/';
const hasCdn = fs.existsSync(path.join(CDN_DIR, 'bootstrap'));
const BG_FOLDER = 'E2E_BACKGROUND_FOLDER';
const CAST_FOLDER = 'E2E_CAST_PHOTO_FOLDER';
const DATE = '2026-11-20';
// 別端末（API 直接）。harness は実時刻で動くため、トークンも実時刻で作る
const otherTerminal = () => ({ auth: { idToken: makeToken({ sub: USERS.editor.sub, email: USERS.editor.email }) } });

const color = c => () => c;
const SEI = [90, 200, 220];
const CHOCO = [230, 80, 140], SUZU = [60, 120, 220], RUN = [40, 180, 120], MOMO = [250, 160, 30], MOMO2 = [20, 20, 160];
const PHOTO = {
  IMG_CHOCO: makePng(300, 400, color(CHOCO)), IMG_SUZU: makePng(400, 300, color(SUZU)), IMG_HIME: makePng(300, 400, color([240, 170, 40])),
  IMG_PREP: makePng(300, 400, color([150, 150, 150])), IMG_RUN: makePng(300, 400, color(RUN)), IMG_MUGI: makePng(500, 500, color([120, 60, 200])),
  // 店舗別フォルダ（歌舞伎・秋葉原）のカード画像
  K_CHOCO: makePng(300, 400, color(CHOCO)), K_SUZU: makePng(400, 300, color(SUZU)), K_RUN: makePng(300, 400, color(RUN)),
  A_SEI: makePng(300, 400, color(SEI))
};
const K_FOLDER = 'E2E_KABUKI_CAST_FOLDER_000000';
const A_FOLDER = 'E2E_AKIBA_CAST_FOLDER_0000000';
const STORE_FOLDERS = {
  [K_FOLDER]: { files: [{ id: 'K_CHOCO', name: 'ちょこ.png' }, { id: 'K_SUZU', name: 'すず.png' }, { id: 'K_RUN', name: 'るん.png' }] },
  [A_FOLDER]: { files: [{ id: 'A_SEI', name: 'せい.png' }] }
};

function newHarness() {
  const fakeDrive = { folders: { [BG_FOLDER]: { name: 'E2E backgrounds' }, [CAST_FOLDER]: { name: 'E2E cast photos' } }, files: {}, seq: 0, photos: {} };
  Object.keys(PHOTO).forEach(id => { fakeDrive.photos[id] = { mimeType: 'image/png', bytes: PHOTO[id] }; });
  const h = setup({ realTime: true, context: { fakeDrive, driveFolders: Object.assign({}, FOLDERS, STORE_FOLDERS) } });
  h.props.DRIVE_KABUKI_CAST_FOLDER_ID = K_FOLDER;
  h.props.DRIVE_AKIBA_CAST_FOLDER_ID = A_FOLDER;
  h.props.DRIVE_BACKGROUND_FOLDER_ID = BG_FOLDER;
  h.props.DRIVE_CAST_PHOTO_FOLDER_ID = CAST_FOLDER;   // 本番構成（APP_ENV なし）なので保存先は明示設定
  return h;
}

async function login(page) {
  await page.waitForFunction(() => window.__gis && state.authView === 'signedOut');
  const token = makeToken({ sub: USERS.admin.sub, email: USERS.admin.email });
  await page.evaluate(t => window.__gis.cfg.callback({ credential: t, select_by: 'btn' }), token);
  await page.waitForFunction(() => state.authView === 'signedIn');
}

let LOOKUP_DELAY_MS = 0;   // 写真検索の応答を遅らせて、連続追加時の競合を再現する
async function openApp(browser, h, log, dialogs) {
  const page = await browser.newPage({ acceptDownloads: true });
  page.on('pageerror', e => log.push('pageerror: ' + e.message));
  page.on('dialog', d => { log.push('dialog: ' + d.message().split('\n')[0]); return (dialogs.length ? dialogs.shift() : true) ? d.accept() : d.dismiss(); });
  await page.route('**/*', async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.url().startsWith(GAS_URL) && req.method() === 'POST') {
      const body = JSON.parse(req.postData());
      log.push('POST ' + body.action);
      if (body.action === 'lookupCasts' && LOOKUP_DELAY_MS) await new Promise(r => setTimeout(r, LOOKUP_DELAY_MS));
      const out = h.gas.doPost({ parameter: {}, postData: { contents: req.postData() } });
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: out.body });
    }
    if (req.url() === 'https://accounts.google.com/gsi/client') return route.fulfill({ status: 200, contentType: 'application/javascript', body: MOCK_GIS });
    if (url.hostname === 'cdn.jsdelivr.net') {
      const m = url.pathname.match(/\/npm\/(bootstrap|html2canvas)@[^/]+\/(.*)$/);
      return route.fulfill({ path: path.join(CDN_DIR, m[1], m[2]) });
    }
    if (url.hostname === 'app.test') return route.fulfill({ path: path.join(ROOT, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)) });
    return route.abort();
  });
  await page.goto(APP);
  await login(page);
  await waitIdle(page);
  return page;
}
const waitIdle = page => page.waitForFunction(() => document.getElementById('loading').classList.contains('d-none') && !bgState.loading &&
  !ManualMode.state.busy && !ManualMode.state.rows.some(r => r.status === 'checking'));
async function setDate(page, date) {
  await page.fill('#manualDate', date);
  await page.waitForFunction(d => ManualMode.state.date === d && ManualMode.state.loaded, date);
  await waitIdle(page);
}
async function clickStore(page, label, store) {
  await page.click(`.js-manual-store[data-store="${store}"]`);
  await page.waitForFunction(s => ManualMode.state.store === s && bgState.store === s && !!bgState.view, store);
  await waitIdle(page);
  assert.match(await page.textContent('#manualTarget'), new RegExp(label));
}
const names = page => page.evaluate(() => ManualMode.state.rows.map(r => r.castName));
const statuses = page => page.evaluate(() => ManualMode.state.rows.map(r => r.status));
async function addByEnter(page, name) {
  await page.fill('#manualAddName', name);
  await page.press('#manualAddName', 'Enter');
  await waitIdle(page);
}
async function bulk(page, text) {
  await page.evaluate(() => { document.querySelector('#manualPanel details').open = true; });
  await page.fill('#manualBulkInput', text);
  await page.click('#manualBulkAddButton');
  await waitIdle(page);
}
async function rowButton(page, index, act) {
  await page.click(`#manualList .manual-row:nth-child(${index + 1}) [data-act="${act}"]`);
  await waitIdle(page);
}
async function generate(page) {
  await page.click('#generateButton');
  await page.waitForSelector('#manualConfirmModal.show #manualConfirmRun', { state: 'visible' });
  const confirm = { list: await page.$$eval('#manualConfirmList li', els => els.map(e => e.textContent.trim())),
    target: await page.textContent('#manualConfirmTarget'), disabled: await page.isDisabled('#manualConfirmRun'),
    errors: await page.textContent('#manualConfirmErrors') };
  if (!confirm.disabled) {
    await page.click('#manualConfirmRun');
    await page.waitForSelector('#manualConfirmModal', { state: 'hidden' });
    await waitIdle(page);
  } else {
    await page.click('#manualConfirmModal [data-bs-dismiss="modal"].btn');
    await page.waitForSelector('#manualConfirmModal', { state: 'hidden' });
  }
  return confirm;
}
const pixel = (page, x, y) => page.evaluate(([x, y]) => Array.from(document.getElementById('generatedCanvas').getContext('2d').getImageData(x, y, 1, 1).data.slice(0, 3)), [x, y]);
async function cellCenter(page, n, i) {
  const c = await page.evaluate(([n, i]) => ImageGenerator.computeLayout(n, { area: readBackgroundSettingsFromForm().area }).cells[i].photo, [n, i]);
  return pixel(page, Math.round(c.x + c.w / 2), Math.round(c.y + c.h / 2));
}
// SHOT_DIR を指定すると画面のスクリーンショットを保存（目視確認用）
const shot = async (page, name) => { if (process.env.SHOT_DIR) await page.screenshot({ path: path.join(process.env.SHOT_DIR, name + '.png'), fullPage: true }); };
const autoSheets = h => JSON.stringify(['SIFT_DATA', 'シフト編集', 'シフト編集管理'].map(n => h.ss.getSheetByName(n).rows));

test('E2E 手動モード: 店舗ボタン・店舗別背景・手入力・保存/再読み込み・写真の紐付け・画像生成・PNG', { skip: !hasCdn && 'CDN_DIR がありません' }, async (t) => {
  const h = newHarness();
  const browser = await chromium.launch();
  const log = [];
  const dialogs = [];
  const autoBefore = autoSheets(h);
  try {
    const page = await openApp(browser, h, log, dialogs);

    await t.test('既定は手動入力・SIFT_DATA のシフト取得をしない・歌舞伎が選択済み', async () => {
      assert.equal(await page.isVisible('#manualPanel'), true);
      assert.equal(await page.isHidden('#storePicker'), true, '自動モードの店舗・日付は非表示');
      assert.equal(await page.getAttribute('.js-manual-store[data-store="KABUKI"]', 'aria-pressed'), 'true');
      await setDate(page, DATE);
      const actions = log.filter(l => l.startsWith('POST ')).map(l => l.slice(5));
      ['getDateOptions', 'getSavedShift', 'initializeShift', 'getSiftPreview'].forEach(a => assert.ok(!actions.includes(a), a + ' を呼ばない'));
      assert.ok(actions.includes('getManualShift'));
      assert.match(await page.textContent('#manualSaveState'), /未保存（新規）/);
    });

    await t.test('店舗別の背景: 歌舞伎・秋葉原に登録 → ボタンで自動切替', async () => {
      await page.setInputFiles('#bgFileInput', { name: 'kabuki.png', mimeType: 'image/png', buffer: makePng(1447, 2048, color([250, 220, 235])) });
      await page.waitForFunction(() => !!bgState.pending);
      await page.click('#bgSaveButton'); await waitIdle(page);
      await clickStore(page, '秋葉原', 'AKIBA');
      assert.match(await page.textContent('#bgStatus'), /未登録/);
      await page.setInputFiles('#bgFileInput', { name: 'akiba.png', mimeType: 'image/png', buffer: makePng(1080, 1920, color([210, 240, 255])) });
      await page.waitForFunction(() => !!bgState.pending);
      await page.click('#bgSaveButton'); await waitIdle(page);
      await clickStore(page, '歌舞伎', 'KABUKI');
      assert.match(await page.textContent('#bgStatus'), /登録済み: 1447 × 2048 px/);
      await clickStore(page, '秋葉原', 'AKIBA');
      assert.match(await page.textContent('#bgStatus'), /登録済み: 1080 × 1920 px/);
      await clickStore(page, '歌舞伎', 'KABUKI');
    });

    await t.test('キャストの追加（Enter・まとめて）・順序変更・削除', async () => {
      await addByEnter(page, 'ちょこ');
      await page.fill('#manualAddName', 'もも'); await page.click('#manualAddButton'); await waitIdle(page);
      await bulk(page, 'すず\n未登録さん、るん');
      assert.deepEqual(await names(page), ['ちょこ', 'もも', 'すず', '未登録さん', 'るん']);
      await rowButton(page, 0, 'down');
      assert.deepEqual(await names(page), ['もも', 'ちょこ', 'すず', '未登録さん', 'るん']);
      await rowButton(page, 4, 'up');
      assert.deepEqual(await names(page), ['もも', 'ちょこ', 'すず', 'るん', '未登録さん']);
      await rowButton(page, 4, 'remove');
      assert.deepEqual(await names(page), ['もも', 'ちょこ', 'すず', 'るん']);
      assert.match(await page.textContent('#manualSaveState'), /未保存の変更あり/);
    });

    await t.test('登録済み写真の自動表示（店舗フォルダの ちょこ・すず・るん）／未登録は明示', async () => {
      assert.deepEqual(await statuses(page), ['missing', 'registered', 'registered', 'registered']);
      assert.match(await page.textContent('#manualList .manual-row:nth-child(1)'), /写真未登録/);
      assert.match(await page.getAttribute('#manualList .manual-row:nth-child(2) img.manual-thumb', 'src'), /^data:image\/png;base64,/);
      assert.match(await page.textContent('#manualSummary'), /4人 \/ 写真なし 1人/);
      await shot(page, '01_manual_input');
    });

    await t.test('編集保存 → ブラウザ再読み込み後も同じ内容・順番', async () => {
      await page.click('#manualSaveButton'); await waitIdle(page);
      assert.match(await page.textContent('#manualSaveState'), /保存済み（rev 1）/);
      assert.match(await page.textContent('#alertArea'), /歌舞伎 \/ 2026-11-20 を保存しました（4人）/);
      const sheet = h.ss.getSheetByName('手動シフト');
      assert.deepEqual(sheet.rows.slice(1).map(r => [r[0], r[1], r[2], r[3], r[4]]), [
        ['KABUKI', DATE, '1', 'もも', ''], ['KABUKI', DATE, '2', 'ちょこ', 'drive:K_CHOCO'],
        ['KABUKI', DATE, '3', 'すず', 'drive:K_SUZU'], ['KABUKI', DATE, '4', 'るん', 'drive:K_RUN']]);
      await page.reload();
      await login(page); await waitIdle(page);
      await setDate(page, DATE);
      assert.deepEqual(await names(page), ['もも', 'ちょこ', 'すず', 'るん']);
      assert.match(await page.textContent('#manualSaveState'), /保存済み（rev 1）/);
      await clickStore(page, '秋葉原', 'AKIBA');
      assert.deepEqual(await names(page), [], '秋葉原は別データ');
      await clickStore(page, '歌舞伎', 'KABUKI');
      assert.deepEqual(await names(page), ['もも', 'ちょこ', 'すず', 'るん']);
    });

    await t.test('未登録写真の登録（写真を選択 → キャスト写真フォルダへ保存 → 表示）', async () => {
      const card = makePng(400, 627, color(MOMO));
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#manualList .manual-row:nth-child(1) [data-act="photo"]')]);
      await chooser.setFiles({ name: 'momo.png', mimeType: 'image/png', buffer: card });
      await page.waitForFunction(() => ManualMode.state.rows[0].status === 'registered');
      await waitIdle(page);
      const castId = await page.evaluate(() => ManualMode.state.rows[0].castId);
      assert.match(castId, /^c_/);
      const reg = h.ss.getSheetByName('キャスト画像').rows[1];
      assert.equal(reg[0], castId);
      assert.deepEqual(h.fakeDrive.files[reg[3]].parents, [CAST_FOLDER]);
      assert.equal(Buffer.compare(h.fakeDrive.files[reg[3]].bytes, card), 0, '写真は加工せず保存');
      assert.match(await page.textContent('#manualSaveState'), /未保存の変更あり/, '紐付けは編集保存で確定');
      await page.click('#manualSaveButton'); await waitIdle(page);
      assert.equal(h.ss.getSheetByName('手動シフト').rows[1][4], castId);
    });

    await t.test('生成前の確認 → 生成（背景・登録写真・並び順）→ PNG 1447 × 2048', async () => {
      const c = await generate(page);
      assert.equal(c.disabled, false, c.errors);
      assert.match(c.target, /歌舞伎（KABUKI） \/ 2026-11-20/);
      assert.equal(c.list.length, 4);
      assert.match(c.list[0], /^1\. もも/);
      await shot(page, '02_manual_after_generate');
      assert.equal(await page.isHidden('#generateError'), true, await page.textContent('#generateError'));
      assert.match(await page.textContent('#generateInfo'), /^1447 × 2048 px \/ 歌舞伎 4人$/);
      assert.deepEqual(await pixel(page, 5, 5), [250, 220, 235], '歌舞伎の背景');
      assert.deepEqual(await cellCenter(page, 4, 0), MOMO, '1人目 = 登録した もも の写真');
      assert.deepEqual(await cellCenter(page, 4, 1), CHOCO);
      assert.deepEqual(await cellCenter(page, 4, 2), SUZU);
      assert.deepEqual(await cellCenter(page, 4, 3), RUN);
      const [download] = await Promise.all([page.waitForEvent('download'), page.click('#pngSaveButton')]);
      assert.equal(download.suggestedFilename(), 'shift_KABUKI_2026-11-20_1447x2048.png');
      assert.deepEqual(pngSize(fs.readFileSync(await download.path())), { width: 1447, height: 2048 });
    });

    await t.test('入力を変えると生成済み画像は無効（古い画像を保存させない）', async () => {
      await rowButton(page, 0, 'down');
      assert.equal(await page.isDisabled('#pngSaveButton'), true);
      await rowButton(page, 1, 'up');
      assert.match(await page.textContent('#manualSaveState'), /保存済み/, '元の順番に戻せば未保存扱いにならない');
    });

    await t.test('同名キャスト: 選ぶまで写真を使わない・選んだキャストの写真で生成', async () => {
      // 別の端末で同じ名前「もも」の別キャストが登録された
      const other = callPost(h, 'registerCastPhoto', { castName: 'もも', allowSameName: true,
        image: { dataBase64: makePng(400, 627, color(MOMO2)).toString('base64'), mimeType: 'image/png' } }, otherTerminal());
      assert.equal(other.success, true, JSON.stringify(other).slice(0, 200));
      await addByEnter(page, 'もも');
      assert.deepEqual((await statuses(page))[4], 'ambiguous');
      assert.equal((await statuses(page))[0], 'registered', '保存済みの castId は同名が増えても変わらない');
      const blocked = await generate(page);
      assert.equal(blocked.disabled, true);
      assert.match(blocked.errors, /5行目「もも」: 同じ名前のキャストが複数います/);
      await shot(page, '03_manual_same_name');
      await page.selectOption('#manualList .manual-row:nth-child(5) .js-manual-candidate', other.data.castId);
      await waitIdle(page);
      assert.equal((await statuses(page))[4], 'registered');
      await generate(page);
      assert.deepEqual(await cellCenter(page, 5, 0), MOMO);
      assert.deepEqual(await cellCenter(page, 5, 4), MOMO2, '選んだ方の もも');
      await page.click('#manualSaveButton'); await waitIdle(page);
      const rows = h.ss.getSheetByName('手動シフト').rows.slice(1);
      assert.notEqual(rows[0][4], rows[4][4], '同名でも castId で区別して保存');
    });

    await t.test('保存の競合: 他の端末の保存後は上書きしない（入力は残る）', async () => {
      const current = await page.evaluate(() => ManualMode.state.revision);
      const other = callPost(h, 'saveManualShift', { store: 'KABUKI', date: DATE, expectedRevision: current, rows: [{ castName: '別端末' }] }, otherTerminal());
      assert.equal(other.success, true);
      await rowButton(page, 0, 'down');
      await page.click('#manualSaveButton'); await waitIdle(page);
      assert.match(await page.textContent('#alertArea'), /他の端末で同じ店舗・日付の手動シフトが更新されています/);
      assert.equal((await names(page)).length, 5, '画面の入力は残す');
      await page.click('#manualReloadButton'); await waitIdle(page);
      assert.deepEqual(await names(page), ['別端末']);
    });

    await t.test('人数別 3・9・13・20人: 確認 → 生成 → 1447 × 2048・重なりなし・行数', async () => {
      const expectRows = { 3: [3], 9: [3, 3, 3], 13: [5, 5, 3] };
      for (const n of [3, 9, 13, 20]) {
        await page.evaluate(() => { ManualMode.state.rows = []; });
        const list = Array.from({ length: n }, (_, i) => (i % 4 === 0 ? 'ちょこ' : i % 4 === 1 ? 'もも' : 'キャスト' + (i + 1)));
        // もも は同名2人のため除外し、写真あり（ちょこ）・なし（キャストN）を混在させる
        const safe = list.map(name => (name === 'もも' ? 'すず' : name));
        await bulk(page, safe.join('\n'));
        assert.equal((await names(page)).length, n);
        const c = await generate(page);
        assert.equal(c.disabled, false, c.errors);
        assert.equal(c.list.length, n);
        assert.equal(await page.isHidden('#generateError'), true, await page.textContent('#generateError'));
        assert.match(await page.textContent('#generateInfo'), new RegExp(`^1447 × 2048 px / 歌舞伎 ${n}人`));
        const info = await page.evaluate(n => {
          const layout = ImageGenerator.computeLayout(n, { area: readBackgroundSettingsFromForm().area });
          return { w: generatedCanvas.width, h: generatedCanvas.height, rows: layout.rows, ok: ImageGenerator.validateLayout(layout).ok };
        }, n);
        assert.deepEqual([info.w, info.h], [1447, 2048]);
        assert.equal(info.ok, true, n + '人で重なりなし');
        if (expectRows[n]) assert.deepEqual(info.rows, expectRows[n], n + '人の配置');
        assert.deepEqual(await cellCenter(page, n, 0), CHOCO, n + '人: 1人目の写真');
        if (n === 20) {
          const [download] = await Promise.all([page.waitForEvent('download'), page.click('#pngSaveButton')]);
          assert.deepEqual(pngSize(fs.readFileSync(await download.path())), { width: 1447, height: 2048 });
        }
      }
      await page.click('#manualReloadButton'); await waitIdle(page);   // 破棄して保存済みに戻す（confirm は自動で OK）
    });

    await t.test('秋葉原「せい」: 店舗フォルダの写真を自動表示 → 秋葉原の背景で生成・店舗を戻すと歌舞伎の写真', async () => {
      await clickStore(page, '秋葉原', 'AKIBA');
      await page.evaluate(() => { ManualMode.state.rows = []; });
      await addByEnter(page, 'せい');
      await addByEnter(page, 'ちょこ');
      assert.deepEqual(await statuses(page), ['registered', 'missing'], '秋葉原のフォルダに ちょこ は無い');
      assert.match(await page.textContent('#manualList .manual-row:nth-child(1)'), /写真あり（店舗フォルダ）/);
      const c = await generate(page);
      assert.equal(c.disabled, false, c.errors);
      assert.deepEqual(await cellCenter(page, 2, 0), SEI);
      assert.deepEqual(await pixel(page, 5, 5), [210, 240, 255], '秋葉原の背景');
      await page.click('#manualReloadButton'); await waitIdle(page);
      await clickStore(page, '歌舞伎', 'KABUKI');
    });

    await t.test('名前を続けて追加しても、先に追加した行が「写真を取得中…」のまま残らない', async () => {
      await clickStore(page, '歌舞伎', 'KABUKI');
      await page.evaluate(() => { ManualMode.state.rows = []; });
      LOOKUP_DELAY_MS = 700;
      try {
        await page.fill('#manualAddName', 'ちょこ'); await page.press('#manualAddName', 'Enter');
        await page.fill('#manualAddName', 'すず'); await page.press('#manualAddName', 'Enter');
        await page.waitForFunction(() => ManualMode.state.rows.length === 2 && !ManualMode.state.rows.some(r => r.status === 'checking'), null, { timeout: 8000 });
      } finally { LOOKUP_DELAY_MS = 0; }
      await waitIdle(page);
      assert.deepEqual(await names(page), ['ちょこ', 'すず']);
      assert.deepEqual(await statuses(page), ['registered', 'registered']);
      assert.equal(await page.locator('#manualList img.manual-thumb').count(), 2, '2人とも写真を表示');
      await page.click('#manualReloadButton'); await waitIdle(page);
    });

    await t.test('写真を再検索: フォルダに追加した写真を読み直して表示', async () => {
      await clickStore(page, '秋葉原', 'AKIBA');
      await addByEnter(page, 'みな');
      assert.equal((await statuses(page)).slice(-1)[0], 'missing');
      STORE_FOLDERS[A_FOLDER].files.push({ id: 'A_MINA', name: 'みな.png' });
      h.fakeDrive.photos.A_MINA = { mimeType: 'image/png', bytes: makePng(300, 400, color([10, 120, 10])) };
      await page.click('#manualPhotoRefreshButton'); await waitIdle(page);
      assert.equal((await statuses(page)).slice(-1)[0], 'registered');
      await page.click('#manualReloadButton'); await waitIdle(page);
      await clickStore(page, '歌舞伎', 'KABUKI');
    });

    await t.test('自動モードへの影響なし: SIFT_DATA・シフト編集は不変／自動モードに切り替えて従来どおり表示', async () => {
      assert.equal(autoSheets(h), autoBefore, '手動モードの操作で自動モードのシートは変わらない');
      const manualSnap = JSON.stringify(h.ss.getSheetByName('手動シフト').rows);
      await page.click('label[for="modeAuto"]');
      await page.waitForFunction(() => document.querySelectorAll('#datePicker option').length > 1);
      assert.equal(await page.isHidden('#manualPanel'), true);
      await page.selectOption('#storePicker', 'KABUKI');
      await page.selectOption('#datePicker', '2026-11-16');
      await page.waitForFunction(() => state.selection.date === '2026-11-16' && bgState.store === 'KABUKI' && !!bgState.view);
      await waitIdle(page);
      const auto = await page.evaluate(() => state.current.editRows.map(r => r.castName));
      assert.deepEqual(auto, ['ちょこ', 'ぴょん', 'すず', 'るん', 'むぎ']);
      await page.click('#generateButton'); await waitIdle(page);
      assert.match(await page.textContent('#generateInfo'), /出勤 5人/, '自動モードの生成は保存済みシフトから');
      assert.equal(JSON.stringify(h.ss.getSheetByName('手動シフト').rows), manualSnap, '自動モードの操作で手動シフトは変わらない');
      await page.click('label[for="modeManual"]');
      await waitIdle(page);
      assert.equal(await page.isVisible('#manualPanel'), true);
      assert.deepEqual(await names(page), ['別端末'], '手動モードの内容は保持');
      assert.equal(await page.evaluate(() => bgState.store), 'KABUKI');
    });

    assert.deepEqual(log.filter(l => l.startsWith('pageerror')), []);
  } finally {
    await browser.close();
  }
});
