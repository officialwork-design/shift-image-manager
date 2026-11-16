/**
 * テスト環境用の診断・テストデータ（Phase 1.7）
 *
 * - API からは呼べない。Apps Script エディタから実行する（実行ログに結果を出力）。
 * - setupTestFixtures は APP_ENV=test のときだけ動く（本番では必ず停止）。
 * - authSelfTest は本番・テストのどちらでも「読み取りのみ」で実行できる（シートへの書き込みなし）。
 */

// 固定の検証ベクトル（テスト専用に生成した RSA-2048 公開鍵と、その鍵による RS256 署名）。秘密鍵は保持していない。
const AUTH_SELF_TEST_VECTOR = {
  n: 'rOvauvpL9cL9dJJTcs4KGA1_06Z1TxiB5JuozTmK2MSWuRjI1L9BZH2ommyqOYvULzJIMFRXYiSF4fvAAIdFGnfYVdP9f7FgZIgi4Sy_eBEJfgyOULyqFM5X0umzXuSekR96pNE-6m3GNz66pIO49vBVHjKQ2-uZ3JRni2KKWPHbPoQz6-Qti8PHfGWBeHNxk7JJ6zWZhMkd1Qvz7XD0BCsc0YbDrz_mlamhIltb7dM8YP4MMF2Zm5-aAydnKVYkHZm00ufB271QbvfHwP28LEZcDjHfPb6qRRzlg3VCHO0SNehYqJrwopoQxNP5JoUuO7NlFl6Vli3P833qb2tkjw',
  e: 'AQAB',
  input: 'eyJhbGciOiJSUzI1NiIsImtpZCI6InNlbGYtdGVzdCJ9.eyJzZWxmVGVzdCI6dHJ1ZX0',
  sig: 'NzAsd43sXmV-2TxiN6VxwIixwlrUy-XQGzyxiqj5SnfgJRZxrs3O-mUIR4hnvBeLVKyBvfEfrM6EPMVeZjg05pMuhcA5LiFe0xFwu5PWxPqlyBcHZClGJHuBBTDU1-3NEnNMg5oZcvRprKw1x18Rm-0XXJX1MI2B_QERjWQx5GqFCTL3eWEjcqP1jlyhVnQRCXWK5BXIZ7cXRxtpyb_Wv7fOXhEiwe72IU9_BuIYYSJQqyINYygLaA6MUpTPzfRi5yhxePiH1dJa3vIlvsp_z6lnydAroJGAYd10tQG7OulZ8XMQMS5P1223KKW3T0xc5C1h3jMnWF4LR23HmvWUwA'
};

function authSelfTest() {
  const checks = [];
  const add = (name, fn) => {
    try {
      const detail = fn();
      checks.push({ name, ok: true, detail: detail === undefined ? '' : String(detail) });
    } catch (err) {
      checks.push({ name, ok: false, detail: (err && err.code ? '[' + err.code + '] ' : '') + Utils.errorMessage(err) });
    }
  };
  const assert = (cond, message) => { if (!cond) throw new Error(message); };

  add('環境', () => {
    const env = ConfigService.getEnvironment();
    return env.env + (env.env === 'test' ? '（テスト用スプレッドシート設定済み）' : '');
  });
  add('V8 BigInt', () => { assert(typeof BigInt === 'function', 'BigInt がありません'); return 'OK'; });
  add('SHA-256（Utilities.computeDigest）', () => {
    const hex = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'abc', Utilities.Charset.US_ASCII)
      .map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join('');
    assert(hex === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'SHA-256 の結果が想定と異なります');
    return 'OK';
  });
  add('RS256 検証（正しい署名 → true）', () => {
    const V = GoogleIdTokenVerifier;
    const key = V.findKey_({ keys: [{ kid: 'self', kty: 'RSA', e: AUTH_SELF_TEST_VECTOR.e, n: AUTH_SELF_TEST_VECTOR.n }] }, 'self');
    assert(key, '検証用の鍵を読み込めません');
    const started = Date.now();
    assert(V.verifyRs256_(AUTH_SELF_TEST_VECTOR.input, V.base64UrlToBytes_(AUTH_SELF_TEST_VECTOR.sig), key) === true, '正しい署名を検証できません');
    return (Date.now() - started) + 'ms';
  });
  add('RS256 検証（改ざん → false）', () => {
    const V = GoogleIdTokenVerifier;
    const key = V.findKey_({ keys: [{ kid: 'self', kty: 'RSA', e: AUTH_SELF_TEST_VECTOR.e, n: AUTH_SELF_TEST_VECTOR.n }] }, 'self');
    const sig = V.base64UrlToBytes_(AUTH_SELF_TEST_VECTOR.sig);
    assert(V.verifyRs256_(AUTH_SELF_TEST_VECTOR.input + 'x', sig, key) === false, '改ざんした入力を通してしまいました');
    sig[10] ^= 1;
    assert(V.verifyRs256_(AUTH_SELF_TEST_VECTOR.input, sig, key) === false, '改ざんした署名を通してしまいました');
    return 'OK';
  });
  add('Google 公開鍵（JWKS）取得', () => {
    const jwks = GoogleIdTokenVerifier.loadJwks_(true);
    const usable = jwks.keys.filter(k => GoogleIdTokenVerifier.findKey_(jwks, k.kid));
    assert(usable.length > 0, '使用できる鍵がありません');
    return '鍵 ' + usable.length + ' 件';
  });
  add('CacheService', () => {
    const cache = CacheService.getScriptCache();
    cache.put('AUTH_SELF_TEST', '1', 60);
    assert(cache.get('AUTH_SELF_TEST') === '1', 'キャッシュに保存できません');
    return 'OK';
  });
  add('LockService', () => {
    const lock = LockService.getScriptLock();
    assert(lock.tryLock(5000), 'ロックを取得できません');
    lock.releaseLock();
    return 'OK';
  });
  add('認証設定（Script Properties）', () => {
    const s = AuthService.getSettings();
    assert(s.mode === AUTH_MODE_GOOGLE_ID_TOKEN, 'AUTH_MODE が google_id_token ではありません');
    assert(!!s.clientId, 'GOOGLE_OAUTH_CLIENT_ID が未設定または形式不正です');
    return 'OK（クライアントIDは表示しません）';
  });
  add('許可リスト（アクセス権限シート）', () => {
    const list = AccessControlService.readList_();
    const enabled = list.entries.filter(e => e.valid && e.enabled);
    return '登録 ' + list.entries.length + ' 件 / 有効 ' + enabled.length + ' 件 / ADMIN ' + enabled.filter(e => e.role === 'ADMIN').length +
      ' 件 / 不正 ' + list.entries.filter(e => !e.valid).length + ' 件 / 重複 sub ' + list.duplicateSubs.length + ' 件';
  });

  const result = { ok: checks.every(c => c.ok), checks };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

// テスト用スプレッドシートに架空キャストの SIFT_DATA を作る（今日から7日分 × KABUKI / AKIBA）
// options.overwrite = true のときのみ既存の SIFT_DATA を上書きする
function setupTestFixtures(options) {
  if (!ConfigService.isTestEnvironment()) {
    throw Utils.apiError('CONFIG_ENV_MISMATCH', 'setupTestFixtures はテスト環境（APP_ENV=test）でのみ実行できます');
  }
  const opts = options || {};
  const config = ConfigService.getConfig();
  const ss = SpreadsheetService.getSpreadsheet();
  const sheet = ss.getSheetByName(config.SHEET_SIFT_DATA) || ss.insertSheet(config.SHEET_SIFT_DATA);
  if (sheet.getLastRow() > 0 && !opts.overwrite) {
    throw Utils.apiError('FIXTURE_EXISTS', 'SIFT_DATA にデータがあります。上書きする場合は setupTestFixtures({ overwrite: true }) を実行してください');
  }
  const posts = TestFixtures.buildPosts(Utils.todayIso(), 7);
  sheet.clearContents();
  sheet.getRange(1, 1, 2, posts.KABUKI.length).setValues([posts.KABUKI, posts.AKIBA]);
  SpreadsheetService.ensureInitialSheets();
  LogService.audit({ action: 'テストデータ作成', user: 'editor', result: '成功', detail: 'days=' + posts.KABUKI.length });
  return { days: posts.KABUKI.length, stores: ['KABUKI', 'AKIBA'] };
}

const TestFixtures = {
  // 写真あり: テストあい / テストいち / テストかな / テストきり（テスト用 Drive フォルダに同名画像を置く）
  // 写真なし: テストうみ / テストくう（準備中画像で表示される）
  KABUKI_ROTATION: [
    ['18:00', ['テストあい', 'テストいち']],
    ['19:00', ['テストうみ']],
    ['20:00', ['テスト体入おと🔰']]
  ],
  AKIBA_ROTATION: [
    ['17:00', ['テストかな', 'テストきり']],
    ['18:30', ['テストくう💗']]
  ],

  buildPosts(startIso, days) {
    const start = Utils.requireIsoDate(startIso).split('-').map(Number);
    const result = { KABUKI: [], AKIBA: [] };
    for (let i = 0; i < days; i += 1) {
      const d = new Date(Date.UTC(start[0], start[1] - 1, start[2] + i));
      const iso = d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
      const label = Utils.isoToLabel(iso);
      result.KABUKI.push(this.post_('📢推し推せっ！KABUKI店 📢', '　　　✨テスト✨', '💙' + label + 'の出勤キャスト💙', '⏰営業時間18:00〜23:30🫶🏼', this.KABUKI_ROTATION, i));
      result.AKIBA.push(this.post_('📣推し推せっ！AKIBA店 📣', '　　　✨テスト✨', '💗' + label + 'の出勤キャスト💗', '⏰営業時間17:00〜23:00🫶🏼', this.AKIBA_ROTATION, i));
    }
    return result;
  },

  post_(title, concept, dateLine, hours, rotation, dayIndex) {
    const lines = [title, concept, dateLine, hours, '', '今日会える女の子たちはこちら🎀', ''];
    rotation.forEach(([time, names], j) => {
      if ((dayIndex + j) % 4 === 3) return;   // 日によって出勤する時間帯を変える
      lines.push(time);
      names.forEach(n => lines.push('♡' + n));
      lines.push('');
    });
    lines.push('気になるキャストのXアカウントは返信欄へ👇');
    return lines.join('\n');
  }
};
