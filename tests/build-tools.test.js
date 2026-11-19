'use strict';
// テスト環境への反映用ツール（ページのビルド・GAS 一括ファイル）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TEST_URL = 'https://script.google.com/macros/s/AKfycbTESTONLY0000000000000000000000000000000000000000000000000000/exec';
const PROD_URL = 'https://script.google.com/macros/s/AKfycbz-NSM70nThVEJkTZ3FUaf81pwZD-ykLvXbjfHOM_Nnf6sUSiHt8JK_D5TnQ4A9InU_/exec';

test('index.html: ローカルの JS / CSS はすべて同じ ?v= を持ち、背景機能（image-generator.js・背景設定 UI）を読み込む', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const local = [...html.matchAll(/(?:src|href)="((?:assets\/|config\.js)[^"]*)"/g)].map(m => m[1]);
  assert.ok(local.length >= 7, local.join(','));
  const versions = new Set(local.map(u => (u.match(/\?v=([^"&]+)/) || [])[1]));
  assert.equal(versions.size, 1, '版の不一致はブラウザに古いファイルを使わせる: ' + [...versions].join(','));
  assert.ok(local.some(u => u.startsWith('assets/js/image-generator.js')));
  assert.ok(html.indexOf('image-generator.js') < html.indexOf('assets/js/app.js'), 'app.js より先に読み込む');
  assert.match(html, /id="bgSection"/);
  assert.match(html, /id="generateButton"/);
  assert.match(html, /id="bgFileInput"/);
});

test('build-test-site.sh: テスト URL で作成・?v= をビルドごとに置換・BUILD_INFO・本番 URL は中止', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'site-'));
  const dir = path.join(out, 'site');
  execFileSync('bash', [path.join(ROOT, 'tools/build-test-site.sh')], { env: Object.assign({}, process.env, { TEST_GAS_WEB_APP_URL: TEST_URL, TEST_SITE_OUT: dir }), stdio: 'pipe' });
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const tags = new Set([...html.matchAll(/\?v=([A-Za-z0-9._-]+)/g)].map(m => m[1]));
  assert.equal(tags.size, 1);
  const tag = [...tags][0];
  assert.notEqual(tag, '20261118-bg2', 'ビルドごとの値に置換');
  const config = fs.readFileSync(path.join(dir, 'config.js'), 'utf8');
  assert.match(config, new RegExp(TEST_URL.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')));
  assert.match(config, /APP_ENV: 'test'/);
  assert.match(config, new RegExp("VERSION: '" + tag + "-test'"));
  assert.ok(fs.existsSync(path.join(dir, 'assets/js/image-generator.js')));
  assert.match(fs.readFileSync(path.join(dir, 'BUILD_INFO.txt'), 'utf8'), /gas:\s+https:\/\/script\.google\.com\/macros\/s\/AKfycbTESTONLY/);
  const prod = spawnSync('bash', [path.join(ROOT, 'tools/build-test-site.sh')], { env: Object.assign({}, process.env, { TEST_GAS_WEB_APP_URL: PROD_URL, TEST_SITE_OUT: path.join(out, 'prod') }) });
  assert.equal(prod.status, 2);
  assert.equal(fs.existsSync(path.join(out, 'prod')), false);
});

test('build-test-gas-bundle.sh: gas/*.gs を 1 ファイルに連結（構文 OK・背景機能を含む）・manifest に drive.file', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gas-'));
  execFileSync('bash', [path.join(ROOT, 'tools/build-test-gas-bundle.sh')], { env: Object.assign({}, process.env, { TEST_GAS_OUT: out }), stdio: 'pipe' });
  const bundle = fs.readFileSync(path.join(out, 'TestBundle.gs'), 'utf8');
  for (const name of ['BackgroundService', 'backgroundSelfTest', 'authSelfTest', 'doPost', 'getCastPhotos']) assert.ok(bundle.includes(name), name);
  const files = fs.readdirSync(path.join(ROOT, 'gas')).filter(f => f.endsWith('.gs'));
  files.forEach(f => assert.ok(bundle.includes('// ===== gas/' + f + ' =====')));
  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'appsscript.json'), 'utf8'));
  assert.ok(manifest.oauthScopes.includes('https://www.googleapis.com/auth/drive.file'));
  assert.match(fs.readFileSync(path.join(out, 'BUNDLE_INFO.txt'), 'utf8'), /sha256: [0-9a-f]{64}/);
});

test('build-prod-gas-bundle.sh: 本番用 1 ファイル版（Code.gs・構文 OK・セットアップ関数を含む）・テスト用 ID は含まない', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'pgas-'));
  const r = spawnSync('bash', [path.join(ROOT, 'tools/build-prod-gas-bundle.sh')], { env: Object.assign({}, process.env, { PROD_GAS_OUT: out }) });
  if (r.status === 2 && /未コミット/.test(String(r.stderr))) return;   // 作業中（gas/ 未コミット）は対象外
  assert.equal(r.status, 0, String(r.stderr));
  const bundle = fs.readFileSync(path.join(out, 'Code.gs'), 'utf8');
  for (const name of ['setupDriveFolders', 'importStoreBackgrounds', 'accessControlAddFromProperties', 'doPost', 'StoreImageService']) assert.ok(bundle.includes(name), name);
  assert.ok(!/apps\.googleusercontent\.com/.test(bundle));
  assert.ok(!/localhost:\d+/.test(bundle));
  assert.match(fs.readFileSync(path.join(out, 'BUNDLE_INFO.txt'), 'utf8'), /sha256: [0-9a-f]{64}/);
});

test('build-prod-site.sh: 本番 WebApp に接続・APP_ENV=production・?v= を置換／確認用デプロイ URL も指定できる', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'psite-'));
  const dir = path.join(out, 'site');
  execFileSync('bash', [path.join(ROOT, 'tools/build-prod-site.sh')], { env: Object.assign({}, process.env, { PROD_SITE_OUT: dir }), stdio: 'pipe' });
  const config = fs.readFileSync(path.join(dir, 'config.js'), 'utf8');
  assert.ok(config.includes(PROD_URL));
  assert.match(config, /APP_ENV: 'production'/);
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const versions = new Set([...html.matchAll(/\?v=([^"&]+)/g)].map(m => m[1]));
  assert.equal(versions.size, 1);
  const staging = 'https://script.google.com/macros/s/AKfycbSTAGING000000000000000000000000000000000000000000000000000000/exec';
  const dir2 = path.join(out, 'staging');
  execFileSync('bash', [path.join(ROOT, 'tools/build-prod-site.sh')], { env: Object.assign({}, process.env, { PROD_SITE_OUT: dir2, PROD_GAS_WEB_APP_URL: staging }), stdio: 'pipe' });
  assert.ok(fs.readFileSync(path.join(dir2, 'config.js'), 'utf8').includes(staging));
  const bad = spawnSync('bash', [path.join(ROOT, 'tools/build-prod-site.sh')], { env: Object.assign({}, process.env, { PROD_SITE_OUT: path.join(out, 'bad'), PROD_GAS_WEB_APP_URL: 'http://localhost:8080/exec' }) });
  assert.equal(bad.status, 2);
});
