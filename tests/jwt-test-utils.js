'use strict';
// テスト専用: 本物の RSA 鍵で RS256 署名した Google ID トークン相当を作る（本番の鍵・トークンは使わない）
const crypto = require('crypto');

const CLIENT_ID = '123456789012-testclient.apps.googleusercontent.com';
const OTHER_CLIENT_ID = '999999999999-otherclient.apps.googleusercontent.com';

function makeKey(kid, bits) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: bits || 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  return { kid, privateKey, publicKey, jwk: Object.assign({ kid, alg: 'RS256', use: 'sig' }, jwk) };
}

const KEYS = { main: makeKey('test-kid-1'), rotated: makeKey('test-kid-2'), attacker: makeKey('test-kid-1') };

const b64u = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function makeToken(claims, opts) {
  const o = opts || {};
  const key = o.key || KEYS.main;
  const header = Object.assign({ alg: 'RS256', kid: key.kid, typ: 'JWT' }, o.header || {});
  const now = Math.floor((o.now !== undefined ? o.now : Date.now()) / 1000);
  const payload = Object.assign({
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    azp: CLIENT_ID,
    iat: now - 10,
    exp: now + 3600,
    email_verified: true
  }, claims);
  Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);
  const input = b64u(JSON.stringify(header)) + '.' + b64u(JSON.stringify(payload));
  const sig = o.signature !== undefined ? o.signature : crypto.sign('sha256', Buffer.from(input), key.privateKey);
  return input + '.' + b64u(sig);
}

// UrlFetchApp モック用（Google の JWKS エンドポイント相当）
function jwksHandler(state) {
  const st = state || { keys: [KEYS.main] };
  return (url) => {
    if (url !== 'https://www.googleapis.com/oauth2/v3/certs') return { status: 404, body: '' };
    if (st.fail) return { status: 503, body: 'unavailable' };
    return { status: 200, body: JSON.stringify({ keys: st.keys.map(k => k.jwk) }), headers: { 'Cache-Control': 'public, max-age=19000' } };
  };
}

const USERS = {
  admin: { sub: '100000000000000000001', email: 'admin@example.com', role: 'ADMIN' },
  editor: { sub: '100000000000000000002', email: 'editor@example.com', role: 'EDITOR' },
  disabled: { sub: '100000000000000000003', email: 'disabled@example.com', role: 'EDITOR', enabled: 'FALSE' },
  stranger: { sub: '100000000000000000009', email: 'stranger@example.com' }
};

module.exports = { CLIENT_ID, OTHER_CLIENT_ID, KEYS, makeToken, jwksHandler, USERS, b64u };
