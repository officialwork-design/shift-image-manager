'use strict';
/**
 * ブラウザ E2E（Chromium / Playwright）
 * - index.html / app.js / api.js / shift-state.js を実際にブラウザで動かす
 * - GAS WebApp への通信は page.route で横取りし、モック GAS（gas-harness）の doGet / doPost に渡す
 * - Bootstrap / html2canvas は CDN の代わりにローカルの npm パッケージを返す（CDN_DIR）
 * 本番 GAS / Spreadsheet / Drive には一切接続しない。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { setup, secondTerminal } = require('./fixtures');
const { makeToken, USERS, KEYS } = require('./jwt-test-utils');

// Google Identity Services のモック（accounts.google.com/gsi/client の代わりに配信）
const MOCK_GIS = `
window.__gisCalls = [];
window.google = { accounts: { id: {
  initialize(cfg) { window.__gis = { cfg, autoSelectDisabled: false }; window.__gisCalls.push('initialize:' + cfg.client_id); },
  renderButton(el) { el.innerHTML = '<button type="button" class="mock-gsi-button">Google でログイン（モック）</button>'; },
  prompt() { window.__gisCalls.push('prompt'); if (window.__gisAutoToken && !window.__gis.autoSelectDisabled) setTimeout(() => window.__gis.cfg.callback({ credential: window.__gisAutoToken, select_by: 'auto' }), 0); },
  disableAutoSelect() { window.__gis.autoSelectDisabled = true; window.__gisCalls.push('disableAutoSelect'); }
} } };`;
const tokenOf = (user, claims, opts) => makeToken(Object.assign({ sub: USERS[user].sub, email: USERS[user].email }, claims || {}), opts);
async function signIn(page, token, expectView) {
  await page.evaluate(t => window.__gis.cfg.callback({ credential: t, select_by: 'btn' }), token);
  if (expectView) await page.waitForFunction(v => state.authView === v, expectView);
}

const ROOT = path.join(__dirname, '..');
const CDN_DIR = process.env.CDN_DIR || '/tmp/cdn/node_modules';
const GAS_URL = 'https://script.google.com/macros/s/AKfycbz-NSM70nThVEJkTZ3FUaf81pwZD-ykLvXbjfHOM_Nnf6sUSiHt8JK_D5TnQ4A9InU_/exec';
const APP = 'https://app.test/';
const hasCdn = fs.existsSync(path.join(CDN_DIR, 'bootstrap'));

async function openApp(browser, h, log, opts) {
  const page = await browser.newPage();
  if (opts && opts.autoToken) await page.addInitScript(t => { window.__gisAutoToken = t; }, opts.autoToken);
  page.on('pageerror', e => log.push('pageerror: ' + e.message));
  page.on('dialog', d => { log.push('dialog: ' + d.message()); d.accept(); });
  await page.route('**/*', async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.url().startsWith(GAS_URL)) {
      if (req.method() === 'POST') {
        const body = JSON.parse(req.postData());
        log.push('POST ' + body.action);
        if (url.search) log.push('URL_HAS_QUERY ' + url.search);
        if (h.delay && h.delay[body.action]) await new Promise(r => setTimeout(r, h.delay[body.action]));
        const out = h.gas.doPost({ parameter: {}, postData: { contents: req.postData() } });
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: out.body });
      }
      const params = Object.fromEntries(url.searchParams.entries());
      log.push('GET ' + params.action);
      const out = h.gas.doGet({ parameter: params });
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: out.body });
    }
    if (req.url() === 'https://accounts.google.com/gsi/client') {
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: MOCK_GIS });
    }
    if (url.hostname === 'cdn.jsdelivr.net') {
      const m = url.pathname.match(/\/npm\/(bootstrap|html2canvas)@[^/]+\/(.*)$/);
      return route.fulfill({ path: path.join(CDN_DIR, m[1], m[2]) });
    }
    if (url.hostname === 'app.test') {
      const file = path.join(ROOT, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
      return route.fulfill({ path: file });
    }
    if (url.hostname === 'drive.google.com') return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="40"/>' });
    return route.abort();
  });
  await page.goto(APP);
  await page.waitForFunction(() => window.__gis && ['signedOut', 'signedIn', 'verifying'].includes(state.authView));
  return page;
}

async function select(page, store, date) {
  await page.selectOption('#storePicker', store);
  await page.selectOption('#datePicker', date);
  await page.waitForFunction(() => document.getElementById('loading').classList.contains('d-none'));
}
const editNames = page => page.$$eval('#editTableArea [data-edit-row] .js-cast-name', els => els.map(e => e.value));
const editTimes = page => page.$$eval('#editTableArea [data-edit-row] .js-work-time', els => els.map(e => e.value));
const waitSelection = (page, store, date) => page.waitForFunction(([s, d]) => state.selection.store === s && state.selection.date === d && !state.isProcessing, [store, date]);
const waitIdle = page => page.waitForFunction(() => document.getElementById('loading').classList.contains('d-none'));

test('E2E: 店舗×日付の保存・切替・再読み込み・未保存警告・競合・休み・初期化', { skip: !hasCdn && 'CDN_DIR がありません' }, async (t) => {
  const h = setup({ realTime: true });
  const browser = await chromium.launch();
  const log = [];
  try {
    const page = await openApp(browser, h, log);
    await signIn(page, tokenOf('admin'), 'signedIn');

    await t.test('ADMIN でログイン済み: 利用者表示・初期化ボタン有効', async () => {
      assert.equal(await page.textContent('#userEmail'), 'admin@example.com');
      assert.equal(await page.textContent('#userRole'), 'ADMIN');
      assert.equal(await page.isDisabled('#resetFromSourceButton'), false);
      assert.equal(await page.isVisible('#appContent'), true);
    });

    await t.test('日付セレクトは YYYY-MM-DD 値・M月D日(曜) 表示', async () => {
      const opts = await page.$$eval('#datePicker option', os => os.map(o => [o.value, o.textContent.trim()]));
      assert.ok(opts.some(([v, l]) => v === '2026-11-16' && l === '11月16日(月)'));
      assert.ok(opts.some(([v, l]) => v === '2027-01-01' && l === '1月1日(金)'));
    });

    await t.test('KABUKI 11/16 初回読み込み → 初回作成（initializeShift）', async () => {
      await select(page, 'KABUKI', '2026-11-16');
      assert.deepEqual(await editNames(page), ['ちょこ', 'ぴょん', 'すず', 'るん', 'むぎ']);
      assert.match(await page.textContent('#saveState'), /保存済み rev 1/);
      assert.ok(log.includes('POST initializeShift'));
    });

    await t.test('編集 → 保存 → AKIBA 編集保存 → KABUKI に戻ると保存内容が表示される', async () => {
      await page.selectOption('#editTableArea [data-edit-row]:nth-child(1) .js-work-time', '21:00');
      assert.match(await page.textContent('#saveState'), /未保存の変更あり/);
      await page.click('#saveRowsButton'); await waitIdle(page);
      assert.match(await page.textContent('#saveState'), /保存済み rev 2/);

      await page.selectOption('#storePicker', 'AKIBA'); await waitIdle(page);
      assert.deepEqual(await editNames(page), ['ひめ', 'あみめ', 'みも', 'みな']);
      await page.click('#editTableArea [data-edit-row]:nth-child(4) button:has-text("削除")');
      await page.click('#saveRowsButton'); await waitIdle(page);

      const initCount = log.filter(l => l === 'POST initializeShift').length;
      await page.selectOption('#storePicker', 'KABUKI'); await waitIdle(page);
      assert.equal((await editTimes(page))[0], '21:00');
      assert.equal(log.filter(l => l === 'POST initializeShift').length, initCount, '保存済みなので初回作成しない');
    });

    await t.test('再読み込みボタン・ブラウザ再読み込みでも保存内容が残る', async () => {
      await page.click('#reloadButton'); await waitIdle(page);
      assert.equal((await editTimes(page))[0], '21:00');
      await page.reload();   // メモリ上のトークンは消える → 再ログインが必要
      await page.waitForFunction(() => window.__gis && state.authView === 'signedOut');
      assert.equal(await page.isVisible('#appContent'), false);
      await signIn(page, tokenOf('admin'), 'signedIn');
      await page.waitForFunction(() => document.querySelectorAll('#datePicker option').length > 1);
      await select(page, 'AKIBA', '2026-11-16');
      assert.deepEqual(await editNames(page), ['ひめ', 'あみめ', 'みも']);
    });

    await t.test('未保存変更あり → 切り替え時に確認（キャンセル / 保存せず移動 / 保存して移動）', async () => {
      await page.fill('#addCastName', '体入テスト'); await page.click('#addCastButton');
      await page.selectOption('#storePicker', 'KABUKI');
      await page.waitForSelector('#unsavedModal.show');
      await page.click('#unsavedModal [data-choice="cancel"]');
      await page.waitForSelector('#unsavedModal', { state: 'hidden' });
      await page.waitForTimeout(300);   // モーダルの hidden イベント後の処理を待つ
      assert.equal(await page.inputValue('#storePicker'), 'AKIBA', 'キャンセルで元の店舗に戻る');
      assert.deepEqual(await editNames(page), ['ひめ', 'あみめ', 'みも', '体入テスト'], '入力は残る');

      await page.selectOption('#storePicker', 'KABUKI');
      await page.waitForSelector('#unsavedModal.show');
      await page.click('#unsavedModal [data-choice="save"]');
      await waitSelection(page, 'KABUKI', '2026-11-16');
      assert.equal(h.gas.ShiftService.getSavedShift('AKIBA', '2026-11-16').editRows.length, 4, '保存して移動');

      await page.fill('#addCastName', '破棄される人'); await page.click('#addCastButton');
      await page.selectOption('#datePicker', '2026-11-17');
      await page.waitForSelector('#unsavedModal.show');
      await page.click('#unsavedModal [data-choice="discard"]');
      await waitSelection(page, 'KABUKI', '2026-11-17');
      assert.deepEqual(await editNames(page), ['ちょこ', 'しちみ']);
      assert.equal(h.gas.ShiftService.getSavedShift('KABUKI', '2026-11-16').editRows.some(r => r.castName === '破棄される人'), false);
    });

    await t.test('保存失敗時は移動しない（他の保存処理が実行中: LOCK_TIMEOUT）', async () => {
      await page.fill('#addCastName', '保存できない人'); await page.click('#addCastButton');
      h.lockState.forceTimeout = true;
      try {
        await page.selectOption('#datePicker', '2026-11-16');
        await page.waitForSelector('#unsavedModal.show');
        await page.click('#unsavedModal [data-choice="save"]');
        await page.waitForFunction(() => /他の保存処理が実行中/.test(document.getElementById('alertArea').textContent));
        await waitIdle(page);
        assert.equal(await page.inputValue('#datePicker'), '2026-11-17');
        assert.deepEqual(await page.evaluate(() => state.selection), { store: 'KABUKI', date: '2026-11-17' });
        assert.ok((await editNames(page)).includes('保存できない人'));
      } finally {
        h.lockState.forceTimeout = false;
      }
      await page.click('#saveRowsButton'); await waitIdle(page);
      assert.match(await page.textContent('#saveState'), /保存済み/);
    });

    await t.test('競合: 他端末が先に保存 → 競合メッセージ・入力保持・最新表示・置き換え', async () => {
      const other = secondTerminal(h).gas.ShiftService;
      const latest = other.getSavedShift('KABUKI', '2026-11-17');
      other.saveShift('KABUKI', '2026-11-17', latest.revision, JSON.parse(JSON.stringify(latest.editRows)).slice(0, 1), { user: 'other@example.com' });
      await page.selectOption('#editTableArea [data-edit-row]:nth-child(1) .js-work-time', '22:00');
      await page.click('#saveRowsButton'); await waitIdle(page);
      assert.equal(await page.isVisible('#conflictPanel'), true);
      assert.equal((await page.textContent('#conflictMessage')).trim(), '他の端末または画面で編集内容が更新されています。最新データを確認してから、もう一度保存してください。');
      assert.equal((await editTimes(page))[0], '22:00', '未保存の入力は残る');
      await page.click('#conflictShowLatestButton'); await waitIdle(page);
      assert.match(await page.textContent('#conflictLatestArea'), /ちょこ/);
      await page.click('#conflictReplaceButton');
      assert.deepEqual(await editNames(page), ['ちょこ']);
      assert.equal(await page.isVisible('#conflictPanel'), false);
    });

    await t.test('休み: 未保存変更がある時は画面上だけ変更（他の未保存入力を失わない）', async () => {
      await select(page, 'KABUKI', '2026-11-16');
      await page.selectOption('#editTableArea [data-edit-row]:nth-child(2) .js-work-time', '20:30');
      const posts = log.filter(l => l === 'POST setCastAbsent').length;
      await page.click('#activeList .js-toggle-absent >> nth=0');
      assert.equal(log.filter(l => l === 'POST setCastAbsent').length, posts, 'サーバーに送らない');
      assert.equal((await editTimes(page))[1], '20:30');
      const statuses = await page.$$eval('#editTableArea .js-status', els => els.map(e => e.value));
      assert.equal(statuses[0], '休み');
      await page.click('#saveRowsButton'); await waitIdle(page);
      const saved = h.gas.ShiftService.getSavedShift('KABUKI', '2026-11-16');
      assert.equal(saved.editRows[0].status, '休み'); assert.equal(saved.editRows[1].workTime, '20:30');
    });

    await t.test('休み: 未保存変更がない時はその1件を即時保存', async () => {
      await page.click('#absentList .js-toggle-absent >> nth=0'); await waitIdle(page);
      assert.equal(h.gas.ShiftService.getSavedShift('KABUKI', '2026-11-16').editRows[0].status, '出勤');
    });

    await t.test('元データから初期化: 確認入力が一致するまで実行不可・キャンセルで変更なし・実行で対象のみ', async () => {
      const revBefore = h.gas.ShiftService.getSavedShift('KABUKI', '2026-11-16').revision;
      await page.click('#resetFromSourceButton');
      await page.waitForSelector('#resetModal.show');
      assert.equal(await page.textContent('#resetTargetStore'), 'KABUKI');
      assert.match(await page.textContent('#resetTargetDate'), /11月16日\(月\)/);
      assert.equal(await page.isDisabled('#resetExecuteButton'), true);
      await page.click('#resetModal .btn-outline-secondary');
      await page.waitForSelector('#resetModal', { state: 'hidden' });
      assert.equal(h.gas.ShiftService.getSavedShift('KABUKI', '2026-11-16').revision, revBefore);
      await page.click('#resetFromSourceButton'); await page.waitForSelector('#resetModal.show');
      await page.fill('#resetConfirmInput', 'KABUKI:2026-11-16');
      await page.click('#resetExecuteButton'); await waitIdle(page);
      assert.match(await page.textContent('#alertArea'), /初期化しました/);
      assert.equal(h.gas.ShiftService.getSavedShift('KABUKI', '2026-11-16').revision, revBefore + 1);
      assert.equal(h.gas.ShiftService.getSavedShift('AKIBA', '2026-11-16').editRows.length, 4, '他店舗は不変');
    });

    await t.test('既存機能: 写真変更（差込画像）・並び順変更・画像確認・画像保存（PNG）', async () => {
      await page.selectOption('#editTableArea [data-edit-row]:nth-child(2) .js-image-file-id', 'IMG_HIME');
      await page.fill('#editTableArea [data-edit-row]:nth-child(5) .js-sort-order', '1');
      await page.dispatchEvent('#editTableArea [data-edit-row]:nth-child(5) .js-sort-order', 'change');
      await page.click('#saveRowsButton'); await waitIdle(page);
      const saved = h.gas.ShiftService.getSavedShift('KABUKI', '2026-11-16');
      assert.deepEqual(JSON.parse(JSON.stringify(saved.editRows.map(r => r.castName))), ['むぎ', 'ちょこ', 'ぴょん', 'すず', 'るん']);
      assert.equal(saved.editRows.find(r => r.castName === 'ぴょん').imageFileId, 'IMG_HIME');
      await page.click('#checkButton'); await waitIdle(page);
      assert.match(await page.textContent('#alertArea'), /画像未登録はありません|画像未登録:/);
      const [download] = await Promise.all([page.waitForEvent('download'), page.click('#exportButton')]);
      assert.equal(download.suggestedFilename(), 'shift-image_KABUKI_2026-11-16.png');
    });

    assert.deepEqual(log.filter(l => l.startsWith('pageerror')), []);
    assert.equal(log.filter(l => /^GET /.test(l)).length, 0, 'GAS への通信はすべて POST');
    assert.equal(log.filter(l => l.startsWith('URL_HAS_QUERY')).length, 0, 'URL にパラメータ（トークン等）を載せない');
  } finally {
    await browser.close();
  }
});

test('E2E: Google ログイン・許可リスト・ロール・期限切れ・タイムアウト・再読み込み・ログアウト', { skip: !hasCdn && 'CDN_DIR がありません' }, async (t) => {
  const h = setup({ realTime: true });
  const browser = await chromium.launch();
  const log = [];
  try {
    const page = await openApp(browser, h, log);

    await t.test('未ログイン: ログイン画面のみ表示・シフトAPIを呼ばない', async () => {
      await page.waitForFunction(() => state.authView === 'signedOut');
      assert.equal(await page.isVisible('#authPanel'), true);
      assert.equal(await page.isVisible('#appContent'), false);
      assert.equal(await page.isVisible('.mock-gsi-button'), true);
      assert.deepEqual(log.filter(l => l.startsWith('POST')), ['POST getPublicConfig']);
      assert.ok((await page.evaluate(() => window.__gisCalls)).includes('initialize:123456789012-testclient.apps.googleusercontent.com'));
    });

    await t.test('ログイン失敗: 壊れた credential・サーバーで検証できないトークン', async () => {
      await page.evaluate(() => window.__gis.cfg.callback({ credential: 'broken' }));
      await page.waitForFunction(() => /利用できません/.test(document.getElementById('authMessage').textContent));
      assert.equal(await page.evaluate(() => state.authView), 'signedOut');
      await signIn(page, tokenOf('admin', {}, { key: KEYS.attacker }));   // 署名が不正（画面上は有効に見える）
      await page.waitForFunction(() => state.authView === 'signedOut' && /ログインが必要/.test(document.getElementById('authMessage').textContent));
      assert.equal(await page.isVisible('#appContent'), false);
    });

    await t.test('未許可ユーザー: 利用者IDを表示し、シフトを表示しない', async () => {
      await signIn(page, tokenOf('stranger'), 'forbidden');
      assert.equal(await page.textContent('#authDetailSub'), USERS.stranger.sub);
      assert.equal(await page.textContent('#authDetailEmail'), USERS.stranger.email);
      assert.equal(await page.isVisible('#appContent'), false);
      assert.equal(await page.isVisible('#logoutButton'), true);
      const before = log.length;
      await page.selectOption('#storePicker', 'AKIBA').catch(() => {});
      assert.equal(log.slice(before).filter(l => l === 'POST getSavedShift').length, 0);
    });

    await t.test('EDITOR: 編集・保存は可能、初期化ボタンは無効・サーバーでも拒否', async () => {
      await signIn(page, tokenOf('editor'), 'signedIn');
      assert.equal(await page.textContent('#userRole'), 'EDITOR');
      await page.waitForFunction(() => document.querySelectorAll('#datePicker option').length > 1);
      await select(page, 'KABUKI', '2026-11-16');
      assert.equal(await page.isDisabled('#resetFromSourceButton'), true);
      assert.equal(await page.isVisible('#resetAdminNote'), true);
      await page.selectOption('#editTableArea [data-edit-row]:nth-child(1) .js-work-time', '19:00');
      await page.click('#saveRowsButton'); await waitIdle(page);
      assert.match(await page.textContent('#saveState'), /保存済み rev 2/);
      const rejected = await page.evaluate(async () => { try { await Api.call('resetShiftFromSource', { store: 'KABUKI', date: '2026-11-16', expectedRevision: 2, confirmation: 'KABUKI:2026-11-16' }); return 'ok'; } catch (e) { return e.code + ':' + (e.details && e.details.reason); } });
      assert.equal(rejected, 'FORBIDDEN:ROLE');
    });

    await t.test('保存中表示・通信タイムアウト（入力は保持）', async () => {
      h.delay = { saveShift: 1500 };
      await page.selectOption('#editTableArea [data-edit-row]:nth-child(2) .js-work-time', '20:00');
      await page.click('#saveRowsButton');
      await page.waitForFunction(() => document.getElementById('saveState').textContent.includes('保存中'));
      await waitIdle(page);
      assert.match(await page.textContent('#saveState'), /保存済み rev 3/);
      h.delay = { saveShift: 3000 };
      await page.evaluate(() => { window.APP_CONFIG.API_TIMEOUT_MS = 800; });
      await page.selectOption('#editTableArea [data-edit-row]:nth-child(2) .js-work-time', '21:00');
      await page.click('#saveRowsButton'); await waitIdle(page);
      assert.match(await page.textContent('#alertArea'), /タイムアウト/);
      assert.equal((await editTimes(page))[1], '21:00');
      await page.evaluate(() => { window.APP_CONFIG.API_TIMEOUT_MS = 60000; });
      h.delay = {};
      await new Promise(r => setTimeout(r, 2500));   // 遅延中のリクエストの完了を待つ
    });

    await t.test('トークン期限切れ: 送信せず再ログイン案内 → 再ログインで入力を残したまま保存', async () => {
      await page.click('#reloadButton').catch(() => {});
      await page.waitForFunction(() => !document.querySelector('.modal.show') || true);
      const now = Math.floor(Date.now() / 1000);
      await signIn(page, tokenOf('editor', { iat: now - 3530, exp: now + 64 }), 'signedIn');
      await page.selectOption('#editTableArea [data-edit-row]:nth-child(3) .js-work-time', '22:00');
      await new Promise(r => setTimeout(r, 5000));   // 残り60秒未満になるのを待つ
      const posts = log.filter(l => l === 'POST saveShift').length;
      await page.click('#saveRowsButton'); await waitIdle(page);
      await page.waitForFunction(() => state.authView === 'expired');
      assert.equal(log.filter(l => l === 'POST saveShift').length, posts, '期限切れトークンは送信しない');
      assert.equal(await page.isVisible('#reloginBanner'), true);
      assert.equal(await page.isVisible('#appContent'), true, '画面は残る');
      assert.equal((await editTimes(page))[2], '22:00', '入力は保持');
      await signIn(page, tokenOf('editor'), 'signedIn');
      assert.equal(await page.isVisible('#reloginBanner'), false);
      assert.match(await page.textContent('#alertArea'), /再ログインしました/);
      assert.equal((await editTimes(page))[2], '22:00');
      await page.click('#saveRowsButton'); await waitIdle(page);
      const saved = h.gas.ShiftService.getSavedShift('KABUKI', '2026-11-16');
      assert.equal(saved.editRows[2].workTime, '22:00');
    });

    await t.test('サーバー側で認証が無効になった場合（許可リストで無効化）は画面のデータを消して案内', async () => {
      h.ss.getSheetByName('アクセス権限').set(3, 4, 'FALSE');   // editor を無効化
      await page.selectOption('#editTableArea [data-edit-row]:nth-child(1) .js-work-time', '17:00');
      await page.click('#saveRowsButton'); await waitIdle(page);
      await page.waitForFunction(() => state.authView === 'forbidden');
      assert.equal(await page.isVisible('#appContent'), false);
      assert.equal(await page.evaluate(() => state.current), null);
      h.ss.getSheetByName('アクセス権限').set(3, 4, 'TRUE');
    });

    await t.test('ログアウト: データを消去し、自動ログインを無効化', async () => {
      await signIn(page, tokenOf('editor'), 'signedIn');
      await page.waitForFunction(() => document.querySelectorAll('#datePicker option').length > 1);
      await select(page, 'KABUKI', '2026-11-16');
      await page.click('#logoutButton');
      await page.waitForFunction(() => state.authView === 'signedOut');
      assert.equal(await page.isVisible('#appContent'), false);
      assert.equal(await page.evaluate(() => JSON.stringify({ c: state.current, s: state.selection, i: state.identity })), '{"c":null,"s":{"store":"","date":""},"i":null}');
      assert.equal(await page.evaluate(() => document.querySelectorAll('#editTableArea [data-edit-row]').length), 0);
      assert.ok((await page.evaluate(() => window.__gisCalls)).includes('disableAutoSelect'));
      const err = await page.evaluate(async () => { try { await Api.call('getSavedShift', { store: 'KABUKI', date: '2026-11-16' }); return 'sent'; } catch (e) { return e.code; } });
      assert.equal(err, 'AUTH_REQUIRED', 'ログアウト後は送信しない');
    });

    await t.test('ページ再読み込み: 自動ログイン（GIS auto_select）で復帰・保存内容を表示', async () => {
      const page2 = await openApp(browser, h, log, { autoToken: tokenOf('admin') });
      await page2.waitForFunction(() => state.authView === 'signedIn');
      await page2.waitForFunction(() => document.querySelectorAll('#datePicker option').length > 1);
      await select(page2, 'KABUKI', '2026-11-16');
      assert.equal((await editTimes(page2))[2], '22:00');
      assert.equal(await page2.evaluate(() => [localStorage.length, sessionStorage.length, document.cookie].join('|')), '0|0|', 'ブラウザにトークンを保存しない');
      await page2.close();
    });

    assert.deepEqual(log.filter(l => l.startsWith('pageerror')), []);
    assert.equal(log.filter(l => /^GET /.test(l)).length, 0, 'GAS への通信はすべて POST');
  } finally {
    await browser.close();
  }
});
