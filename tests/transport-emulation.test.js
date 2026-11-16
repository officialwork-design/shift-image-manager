'use strict';
/**
 * 通信方式のブラウザ挙動検証（Chromium・ローカル模擬サーバー）
 *
 * GAS WebApp の既知の挙動を模擬した HTTP サーバーで、実際の assets/js/api.js を Chromium から動かす。
 *   - /exec への POST → 302 で別オリジン（googleusercontent.com 相当）の /echo へ転送
 *     ※ Fetch 仕様では CORS リクエストのリダイレクト応答（302）自体にも CORS チェックがかかるため、
 *       302 応答にも Access-Control-Allow-Origin が必要（実 GAS で要確認の重要項目）
 *   - /echo は GET で JSON を返し Access-Control-Allow-Origin: *
 *   - OPTIONS（プリフライト）には CORS ヘッダーなしで 405（GAS は OPTIONS を処理できない）
 * これは「ブラウザ側の CORS / リダイレクト処理」の検証であり、実際の GAS での成立を証明するものではない。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');

function listen(handler) {
  return new Promise(resolve => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('通信方式（模擬 GAS・Chromium）: text/plain POST・302 リダイレクト・応答の読み取り・失敗応答・プリフライト', async (t) => {
  const stats = { options: 0, posts: 0, echoGets: 0, echoMethods: [], cookies: [], lastBody: null };
  let mode = 'json';
  let redirectAcao = true;
  // 転送先（script.googleusercontent.com 相当）
  const echo = await listen((req, res) => {
    stats.echoGets += 1; stats.echoMethods.push(req.method);
    const id = new URL(req.url, 'http://x').searchParams.get('k');
    const payload = pending[id];
    if (mode === 'html') {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Access-Control-Allow-Origin': '*' });
      return res.end('<!DOCTYPE html><html><body>Google ログイン</body></html>');
    }
    if (mode === 'noacao') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, data: {} }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(payload));
  });
  const pending = {};
  let seq = 0;
  // /exec（script.google.com 相当）
  const gas = await listen((req, res) => {
    if (req.method === 'OPTIONS') { stats.options += 1; res.writeHead(405); return res.end(); }
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      if (req.method === 'POST') stats.posts += 1;
      if (req.headers.cookie) stats.cookies.push(req.headers.cookie);
      stats.lastBody = body;
      stats.lastUrl = req.url;
      stats.lastContentType = req.headers['content-type'];
      const parsed = (() => { try { return JSON.parse(body); } catch (e) { return {}; } })();
      let result;
      if (parsed.action === 'getPublicConfig') result = { success: true, data: { environment: 'test', authConfigured: true } };
      else if (!parsed.auth || !parsed.auth.idToken) result = { success: false, data: null, code: 'AUTH_REQUIRED', status: 401, message: 'ログインが必要です', error: { code: 'AUTH_REQUIRED' } };
      else result = { success: true, data: { echoedAction: parsed.action, tokenLength: parsed.auth.idToken.length } };
      const k = 'k' + (++seq);
      pending[k] = result;
      const headers = { Location: `http://127.0.0.1:${echo.address().port}/echo?k=${k}` };
      if (redirectAcao) headers['Access-Control-Allow-Origin'] = '*';
      res.writeHead(302, headers);
      res.end();
    });
  });
  // アプリのオリジン（GitHub Pages 相当）
  const app = await listen((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': 'pages_cookie=1' });
      return res.end(`<!doctype html><script>window.APP_CONFIG={GAS_WEB_APP_URL:'http://localhost:${gas.address().port}/exec',API_TIMEOUT_MS:5000};</script><script src="/api.js"></script>`);
    }
    if (url.pathname === '/api.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      return res.end(fs.readFileSync(path.join(ROOT, 'assets/js/api.js')));
    }
    res.writeHead(404); res.end();
  });

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // 127.0.0.1 と localhost は別オリジン（アプリ・GAS・転送先の3オリジン）
    await page.goto(`http://127.0.0.1:${app.address().port}/`);
    const run = fn => page.evaluate(fn);

    await t.test('公開 API: プリフライトなしで送信され、302 後の応答 JSON を読める', async () => {
      const r = await run(async () => { try { return { ok: true, data: await Api.publicCall('getPublicConfig') }; } catch (e) { return { ok: false, code: e.code, message: e.message }; } });
      assert.deepEqual(r, { ok: true, data: { environment: 'test', authConfigured: true } });
      assert.equal(stats.options, 0, 'OPTIONS（プリフライト）が発生しない');
      assert.equal(stats.posts, 1);
      assert.match(stats.lastContentType, /^text\/plain/);
      assert.deepEqual(stats.echoMethods, ['GET'], '302 の後は GET で転送先を取得');
      assert.deepEqual(stats.cookies, [], 'Cookie を送らない');
    });

    await t.test('認証付き API: トークンは本文で送信・URL に載らない・成功応答を読める', async () => {
      const r = await run(async () => { Api.setTokenProvider(() => 'header.payload.signature'); return Api.call('whoAmI', {}); });
      assert.deepEqual(r, { echoedAction: 'whoAmI', tokenLength: 24 });
      assert.match(stats.lastBody, /"idToken":"header\.payload\.signature"/);
      assert.equal(stats.lastUrl, '/exec', 'URL にクエリ（トークン等）が付かない');
      assert.equal(stats.options, 0);
    });

    await t.test('失敗応答（success:false）を読み取り、エラーコードとして扱える', async () => {
      const r = await run(async () => { Api.setTokenProvider(() => ''); try { await Api.call('whoAmI', {}); return 'no error'; } catch (e) { return [e.code, e.status, e.message]; } });
      assert.deepEqual(r, ['AUTH_REQUIRED', 401, 'ログインが必要です']);
    });

    await t.test('HTML 応答（ログイン画面など）は成功扱いせず GAS_HTML_RESPONSE', async () => {
      mode = 'html';
      const r = await run(async () => { try { await Api.publicCall('getPublicConfig'); return 'ok'; } catch (e) { return e.code; } });
      assert.equal(r, 'GAS_HTML_RESPONSE');
      mode = 'json';
    });

    await t.test('転送先に CORS ヘッダーが無い場合は NETWORK（応答を読めないものを成功扱いしない）', async () => {
      mode = 'noacao';
      const r = await run(async () => { try { await Api.publicCall('getPublicConfig'); return 'ok'; } catch (e) { return e.code; } });
      assert.equal(r, 'NETWORK');
      mode = 'json';
    });

    await t.test('302 応答に CORS ヘッダーが無い場合は NETWORK（実 GAS で必ず確認する前提条件）', async () => {
      redirectAcao = false;
      const r = await run(async () => { try { await Api.publicCall('getPublicConfig'); return 'ok'; } catch (e) { return e.code; } });
      assert.equal(r, 'NETWORK');
      redirectAcao = true;
    });

    await t.test('対照: application/json・Authorization ヘッダーはプリフライトになり失敗する（採用しない理由）', async () => {
      const before = stats.options;
      const url = `http://localhost:${gas.address().port}/exec`;
      const results = await page.evaluate(async (u) => {
        const out = {};
        for (const [name, init] of Object.entries({
          json: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
          bearer: { method: 'POST', headers: { 'Content-Type': 'text/plain', Authorization: 'Bearer x' }, body: '{}' }
        })) {
          try { await fetch(u, init); out[name] = 'ok'; } catch (e) { out[name] = 'TypeError'; }
        }
        return out;
      }, url);
      assert.deepEqual(results, { json: 'TypeError', bearer: 'TypeError' });
      assert.equal(stats.options - before, 2, 'どちらも OPTIONS が送られる');
    });

    await t.test('対照: no-cors は不透明レスポンスになり内容を読めない（成功判定に使わない）', async () => {
      const r = await page.evaluate(async (u) => {
        const res = await fetch(u, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'getPublicConfig', payload: {} }) });
        let parsed;
        try { parsed = await Api.parseResponse(res); } catch (e) { parsed = e.code; }
        return { type: res.type, status: res.status, parsed };
      }, `http://localhost:${gas.address().port}/exec`);
      assert.deepEqual(r, { type: 'opaque', status: 0, parsed: 'INVALID_RESPONSE' });
    });

    await t.test('対照: credentials: include は ACAO: * と両立せず読めない（Cookie 方式を採用しない理由）', async () => {
      const r = await page.evaluate(async (u) => {
        try { const res = await fetch(u, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'getPublicConfig', payload: {} }) }); return res.status; } catch (e) { return 'TypeError'; }
      }, `http://localhost:${gas.address().port}/exec`);
      assert.equal(r, 'TypeError');
    });

    await t.test('タイムアウト: 応答が遅い場合は TIMEOUT', async () => {
      const slow = await listen((req, res) => { setTimeout(() => { res.writeHead(200); res.end('{}'); }, 3000); });
      const r = await page.evaluate(async (u) => { window.APP_CONFIG.GAS_WEB_APP_URL = u; window.APP_CONFIG.API_TIMEOUT_MS = 500; try { await Api.publicCall('x'); return 'ok'; } catch (e) { return e.code; } }, `http://localhost:${slow.address().port}/exec`);
      assert.equal(r, 'TIMEOUT');
      slow.close();
    });
  } finally {
    await browser.close();
    [echo, gas, app].forEach(s => s.close());
  }
});

test('検証ページ tools/cors-probe（Chromium・モック GAS）: 基本検証の判定ロジック', async () => {
  const { createGasContext, FakeSpreadsheet, seedSpreadsheet } = require('./gas-harness');
  const { CLIENT_ID, jwksHandler, KEYS } = require('./jwt-test-utils');
  const ss = new FakeSpreadsheet(); ss.id = 'TEST_SS_PROBE';
  seedSpreadsheet(ss, { KABUKI: [], AKIBA: [] });
  const h = createGasContext({ spreadsheet: ss, scriptId: 'TEST_SCRIPT_PROBE', openableIds: ['TEST_SS_PROBE'],
    scriptProperties: { APP_ENV: 'test', SPREADSHEET_ID: 'TEST_SS_PROBE', AUTH_MODE: 'google_id_token', GOOGLE_OAUTH_CLIENT_ID: CLIENT_ID },
    urlFetch: jwksHandler({ keys: [KEYS.main] }) });
  h.gas.setupShiftImageManager();
  const GAS = 'https://script.google.com/macros/s/TESTDEPLOYMENT/exec';
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      if (req.url().startsWith(GAS)) {
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 405 });
        const out = req.method() === 'POST'
          ? h.gas.doPost({ parameter: {}, postData: { contents: req.postData() } })
          : h.gas.doGet({ parameter: Object.fromEntries(u.searchParams.entries()) });
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: out.body });
      }
      if (u.hostname === 'probe.test') return route.fulfill({ path: path.join(ROOT, 'tools/cors-probe/index.html') });
      return route.abort();
    });
    await page.goto('https://probe.test/');
    await page.fill('#url', 'https://script.google.com/macros/s/AKfycbz-NSM70nThVEJkTZ3FUaf81pwZD-ykLvXbjfHOM_Nnf6sUSiHt8JK_D5TnQ4A9InU_/exec');
    await page.click('#runBasic');
    await page.waitForFunction(() => document.querySelectorAll('#rows tr').length >= 7);
    assert.match(await page.textContent('#rows'), /本番の WebApp URL は使用できません/, '本番 URL は拒否');
    await page.evaluate(() => { document.getElementById('rows').innerHTML = ''; });
    await page.fill('#url', GAS);
    await page.click('#runBasic');
    await page.waitForFunction(() => document.querySelectorAll('#rows tr').length >= 7);
    const report = JSON.parse(await page.textContent('#report'));
    const byName = Object.fromEntries(report.results.slice(-7).map(r => [r.name, r.status]));
    assert.equal(byName['POST 送信と成功応答の読み取り（getPublicConfig）'], 'PASS');
    assert.equal(byName['サーバー環境が test であること'], 'PASS');
    assert.equal(byName['失敗応答の読み取り（認証なし whoAmI → AUTH_REQUIRED）'], 'PASS');
    assert.equal(byName['不正なトークン → AUTH_INVALID'], 'PASS');
    assert.equal(byName['保護 API を GET で呼ぶ → METHOD_NOT_ALLOWED'], 'PASS');
  } finally {
    await browser.close();
  }
});
