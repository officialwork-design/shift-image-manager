'use strict';
// Phase 1.7: 本番 / テスト環境の分離・本番ID混入防止・自己診断・テストデータ
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createGasContext, FakeSpreadsheet, seedSpreadsheet } = require('./gas-harness');
const { setup, callPost, callGet, EDITOR, ADMIN, seedAccess } = require('./fixtures');
const { CLIENT_ID, jwksHandler, KEYS } = require('./jwt-test-utils');

const PROD_SS = '1s-Ga2SpUWzoKQHSOymqo5MCO_wgdevFKrQWHUIKvct0';
const PROD_SCRIPT = '1m0G9Y3ATR885RDD1LBEjp5Zsc5Ts4qv_hq1q9kFw3Xe0WmKy5DQVnATS';
const TEST_SS = 'TEST_SS_0000000000000000000000000000000000';
const TEST_SCRIPT = 'TEST_SCRIPT_00000000000000000000000000000000000000000';
const TEST_FOLDER = 'TEST_FOLDER_0000000000000000000';

function testEnv(props, opts) {
  const ss = new FakeSpreadsheet(); ss.id = TEST_SS;
  seedSpreadsheet(ss, { KABUKI: [], AKIBA: [] });
  const h = createGasContext(Object.assign({
    spreadsheet: ss, now: '2026-11-16T03:00:00Z', scriptId: TEST_SCRIPT, openableIds: [TEST_SS],
    scriptProperties: Object.assign({ APP_ENV: 'test', SPREADSHEET_ID: TEST_SS, AUTH_MODE: 'google_id_token', GOOGLE_OAUTH_CLIENT_ID: CLIENT_ID }, props || {}),
    urlFetch: jwksHandler({ keys: [KEYS.main] }),
    driveFolders: { [TEST_FOLDER]: { files: [{ id: 'T_IMG_1', name: 'テストあい.png' }, { id: 'T_PREP', name: '準備中.png' }] } }
  }, opts || {}));
  return h;
}
function writeIdManagement(h, rows) {
  const sheet = h.ss.getSheetByName('ID管理') || h.ss.insertSheet('ID管理');
  sheet.set(1, 1, 'key'); sheet.set(1, 2, 'value');
  rows.forEach(([k, v], i) => { sheet.set(i + 2, 1, k); sheet.set(i + 2, 2, v); });
}

test('環境: 本番プロジェクト（APP_ENV 未設定）は従来どおり本番設定で動く', () => {
  const h = setup();
  assert.equal(h.gas.ConfigService.getEnvironment().env, 'production');
  assert.equal(callPost(h, 'getPublicConfig', {}).data.environment, 'production');
});

test('環境: 本番以外のプロジェクトで APP_ENV が無い → 全 API 停止（本番スプレッドシートを開かない）', () => {
  const ss = new FakeSpreadsheet(); seedSpreadsheet(ss, { KABUKI: [], AKIBA: [] });
  const h = createGasContext({ spreadsheet: ss, scriptId: TEST_SCRIPT, scriptProperties: {} });
  for (const action of ['getPublicConfig', 'whoAmI', 'saveShift']) {
    assert.equal(callPost(h, action, {}, EDITOR).code, 'CONFIG_ENV_REQUIRED', action);
  }
  assert.ok(!h.openLog.includes(PROD_SS), '本番スプレッドシートを開いていない');
});

test('環境: 本番プロジェクトに APP_ENV=test → 停止', () => {
  const h = setup();
  h.props.APP_ENV = 'test'; h.props.SPREADSHEET_ID = TEST_SS;
  h.gas.ConfigService.envMemo_ = null;
  assert.equal(callPost(h, 'getPublicConfig', {}).code, 'CONFIG_ENV_MISMATCH');
});

test('環境: テスト環境は SPREADSHEET_ID 必須・本番IDは不可', () => {
  assert.equal(callPost(testEnv({ SPREADSHEET_ID: '' }), 'getPublicConfig', {}).code, 'CONFIG_INVALID');
  assert.equal(callPost(testEnv({ SPREADSHEET_ID: PROD_SS }), 'getPublicConfig', {}).code, 'CONFIG_PRODUCTION_ID_IN_TEST');
  assert.equal(callPost(testEnv({ APP_ENV: 'staging' }), 'getPublicConfig', {}).code, 'CONFIG_INVALID');
});

test('環境: テスト用 ID管理シートに本番の ID・URL が入っていたら停止（コピー元の値の持ち込み防止）', () => {
  const values = [
    ['DRIVE_IMAGE_FOLDER_ID', '1Ob0yiSr0yP_sHa72t9xg8xmGn5YEUYR-'],
    ['DRIVE_IMAGE_FOLDER_IDS', TEST_FOLDER + ',17zZbEhzgr3Fp_yfdox3zWLhO5kSUwvhZ'],
    ['DRIVE_IMAGE_FOLDER_IDS', 'https://drive.google.com/drive/folders/1Ob0yiSr0yP_sHa72t9xg8xmGn5YEUYR-'],
    ['GAS_WEB_APP_URL', 'https://script.google.com/macros/s/AKfycbz-NSM70nThVEJkTZ3FUaf81pwZD-ykLvXbjfHOM_Nnf6sUSiHt8JK_D5TnQ4A9InU_/exec'],
    ['SCRIPT_ID', PROD_SCRIPT]
  ];
  for (const row of values) {
    const h = testEnv();
    writeIdManagement(h, [row]);
    assert.equal(callPost(h, 'getPublicConfig', {}).code, 'CONFIG_PRODUCTION_ID_IN_TEST', row[0]);
  }
  // SPREADSHEET_ID の書き換えは無視され、常に Script Properties のテスト用を使う
  const h = testEnv();
  writeIdManagement(h, [['SPREADSHEET_ID', 'OTHER_SPREADSHEET']]);
  assert.equal(h.gas.ConfigService.getConfig().SPREADSHEET_ID, TEST_SS);
});

test('環境: テスト環境では画像フォルダが本番の既定値にフォールバックしない', () => {
  const h = testEnv();
  h.gas.setupShiftImageManager();
  assert.equal(h.gas.ConfigService.getConfig().DRIVE_IMAGE_FOLDER_ID, '');
  assert.deepEqual(JSON.parse(JSON.stringify(h.gas.ImageService.getImageFolderIds_(h.gas.ConfigService.getConfig()))), []);
  writeIdManagement(h, [['DRIVE_IMAGE_FOLDER_ID', TEST_FOLDER]]);
  h.gas.ConfigService.envMemo_ = null;
  assert.deepEqual(JSON.parse(JSON.stringify(h.gas.ImageService.getImageFolderIds_(h.gas.ConfigService.getConfig()))), [TEST_FOLDER]);
});

test('環境: テスト用スプレッドシートを開けない場合は本番へフォールバックせず停止', () => {
  const h = testEnv({}, { openableIds: [] });
  assert.equal(callPost(h, 'getPublicConfig', {}).code, 'CONFIG_UNAVAILABLE');
});

test('環境: テスト環境の公開設定は environment=test（フロントで一致を確認）', () => {
  const h = testEnv();
  h.gas.setupShiftImageManager();
  const cfg = callPost(h, 'getPublicConfig', {});
  assert.equal(cfg.data.environment, 'test');
  assert.equal(cfg.data.authConfigured, true);
});

test('テストデータ: setupTestFixtures はテスト環境のみ・既存データは上書きしない・架空キャストで7日分', () => {
  const prod = setup();
  assert.throws(() => prod.gas.setupTestFixtures(), e => e.code === 'CONFIG_ENV_MISMATCH');

  const h = testEnv();
  h.gas.setupShiftImageManager();
  h.ss.getSheetByName('SIFT_DATA').rows = [];
  const res = h.gas.setupTestFixtures();
  assert.equal(res.days, 7);
  assert.throws(() => h.gas.setupTestFixtures(), e => e.code === 'FIXTURE_EXISTS');
  assert.equal(h.gas.setupTestFixtures({ overwrite: true }).days, 7);
  const sift = h.ss.getSheetByName('SIFT_DATA').rows;
  assert.equal(sift[0].length, 7); assert.equal(sift[1].length, 7);
  assert.match(sift[0][0], /11月16日\(月\)/);
  // 登録した日付が年付きで選べ、店舗×日付の保存まで通る
  seedAccess(h.ss);
  const opts = callPost(h, 'getDateOptions', {}, EDITOR).data;
  assert.ok(opts.filter(o => o.ok).length >= 7);
  const init = callPost(h, 'initializeShift', { store: 'KABUKI', date: '2026-11-16' }, EDITOR);
  assert.equal(init.success, true, JSON.stringify(init.error));
  const names = init.data.editRows.map(r => r.castName);
  assert.ok(names.includes('テストあい') && names.includes('テスト体入おと'), names.join(','));
  assert.ok(!names.some(n => /マカロン|テスト✨|出勤キャスト/.test(n)), '見出し行はキャストにならない');
  const akiba = callPost(h, 'initializeShift', { store: 'AKIBA', date: '2026-11-17' }, EDITOR);
  assert.ok(akiba.data.editRows.some(r => r.castName === 'テストくう'));
});

test('自己診断: authSelfTest は書き込みなしで全項目を確認（テスト環境・モック）', () => {
  const h = testEnv();
  h.gas.setupShiftImageManager();
  seedAccess(h.ss);
  const before = JSON.stringify(Object.fromEntries(Object.entries(h.ss.sheets).map(([k, v]) => [k, v.rows])));
  const r = JSON.parse(JSON.stringify(h.gas.authSelfTest()));
  assert.equal(r.ok, true, JSON.stringify(r.checks.filter(c => !c.ok)));
  assert.equal(r.checks.length, 10);
  assert.match(r.checks.find(c => c.name.startsWith('許可リスト')).detail, /有効 2 件 \/ ADMIN 1 件/);
  assert.equal(JSON.stringify(Object.fromEntries(Object.entries(h.ss.sheets).map(([k, v]) => [k, v.rows]))), before);
  assert.ok(!JSON.stringify(r).includes(CLIENT_ID), 'クライアントIDを出力しない');
});

test('自己診断: BigInt なし・JWKS 取得失敗・認証未設定を検出', () => {
  const h = testEnv({ AUTH_MODE: '' }, { noBigInt: true, urlFetch: () => ({ status: 500, body: '' }) });
  h.gas.setupShiftImageManager();
  const r = JSON.parse(JSON.stringify(h.gas.authSelfTest()));
  assert.equal(r.ok, false);
  const failed = r.checks.filter(c => !c.ok).map(c => c.name);
  assert.ok(failed.includes('V8 BigInt'));
  assert.ok(failed.includes('Google 公開鍵（JWKS）取得'));
  assert.ok(failed.includes('認証設定（Script Properties）'));
});

test('静的確認: WebApp の入口は doGet / doPost のみ・全 action が公開/保護/廃止のいずれかに分類されている', () => {
  const gasDir = path.join(__dirname, '..', 'gas');
  const all = fs.readdirSync(gasDir).filter(f => f.endsWith('.gs')).map(f => fs.readFileSync(path.join(gasDir, f), 'utf8')).join('\n');
  assert.doesNotMatch(all, /HtmlService|google\.script\.run|doOptions/, 'google.script.run 経由の入口がない');
  const router = fs.readFileSync(path.join(gasDir, 'ApiRouter.gs'), 'utf8');
  const cases = [...router.matchAll(/case '([A-Za-z]+)':/g)].map(m => m[1]);
  const h = setup();
  const protectedActions = Object.keys(h.gas.API_PROTECTED_ACTIONS);
  for (const action of cases) assert.ok(protectedActions.includes(action), action + ' がロール表にない');
  for (const action of protectedActions) {
    assert.equal(callPost(h, action, { store: 'KABUKI', date: '2026-11-16' }).code, 'AUTH_REQUIRED', action);
    assert.equal(callGet(h, action, { store: 'KABUKI', date: '2026-11-16' }).code, 'METHOD_NOT_ALLOWED', action);
  }
  assert.equal(callPost(h, 'deleteEverything', {}, ADMIN).code, 'UNKNOWN_ACTION');
});
