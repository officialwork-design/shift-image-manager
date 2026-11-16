'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeToken, USERS } = require('./jwt-test-utils');

function freshAuth() {
  delete require.cache[require.resolve('../assets/js/auth.js')];
  return require('../assets/js/auth.js');
}

test('フロント認証: トークンはメモリのみ・期限切れ間近は送らず AUTH_EXPIRED', () => {
  const Auth = freshAuth();
  const events = [];
  Auth.onChange((e, d) => events.push([e, d]));
  assert.throws(() => Auth.getToken(), e => e.code === 'AUTH_REQUIRED');
  const now = Math.floor(Date.now() / 1000);
  const token = makeToken({ sub: USERS.editor.sub, email: USERS.editor.email, name: '編集 太郎' });
  assert.equal(Auth.setCredentialForTest(token), true);
  assert.equal(Auth.getToken(), token);
  assert.equal(Auth.getProfile().email, USERS.editor.email);
  assert.equal(Auth.getProfile().name, '編集 太郎');
  assert.equal(events[0][0], 'signedIn');

  const shortLived = makeToken({ sub: USERS.editor.sub, email: USERS.editor.email, iat: now - 3500, exp: now + 30 });
  assert.equal(Auth.setCredentialForTest(shortLived), false, '残り60秒未満は受け付けない');
  assert.equal(Auth.getToken(), token, '直前の有効なトークンは維持');
});

test('フロント認証: 期限切れで expired イベント・ログアウトで情報を消去・アカウント切替を検知', () => {
  const Auth = freshAuth();
  const events = [];
  Auth.onChange((e, d) => events.push([e, d]));
  const realNow = Date.now;
  try {
    Auth.setCredentialForTest(makeToken({ sub: USERS.editor.sub, email: USERS.editor.email }));
    Date.now = () => realNow() + 3600 * 1000;   // 1時間後
    assert.throws(() => Auth.getToken(), e => e.code === 'AUTH_EXPIRED');
    assert.equal(events.at(-1)[0], 'expired');
    assert.equal(Auth.hasToken(), false);
    assert.ok(Auth.getProfile(), '利用者情報は残す（再ログイン表示用）');
    Date.now = realNow;
    Auth.setCredentialForTest(makeToken({ sub: USERS.admin.sub, email: USERS.admin.email }));
    assert.equal(events.at(-1)[1].accountChanged, true);
    Auth.signOut();
    assert.equal(events.at(-1)[0], 'signedOut');
    assert.equal(Auth.getProfile(), null);
    assert.throws(() => Auth.getToken(), e => e.code === 'AUTH_REQUIRED');
  } finally {
    Date.now = realNow;
  }
});

test('フロント認証: 壊れたトークンは受け付けない', () => {
  const Auth = freshAuth();
  const events = [];
  Auth.onChange((e, d) => events.push([e, d]));
  assert.equal(Auth.setCredentialForTest('not.a.jwt'), false);
  assert.equal(Auth.setCredentialForTest('abc'), false);
  assert.equal(events.at(-1)[0], 'error');
  assert.equal(Auth.decodeClaims('x.' + Buffer.from('{"exp":1}').toString('base64url') + '.y').exp, 1);
});

test('フロント認証: トークンを Web Storage・Cookie・URL に保存するコードがない', () => {
  const fs = require('fs');
  const src = ['auth.js', 'api.js', 'app.js', 'shift-state.js'].map(f => fs.readFileSync(require('path').join(__dirname, '../assets/js', f), 'utf8')).join('\n');
  assert.doesNotMatch(src, /(localStorage|sessionStorage)\s*[.[]|document\.cookie|indexedDB\./);
  assert.doesNotMatch(src, /idToken[^\n]*(URLSearchParams|\?action=)/);
  const api = fs.readFileSync(require('path').join(__dirname, '../assets/js/api.js'), 'utf8');
  assert.doesNotMatch(api, /Authorization|createElement\('script'\)/, '独自ヘッダーと JSONP を使わない');
  assert.match(api, /credentials: 'omit'/);
});
