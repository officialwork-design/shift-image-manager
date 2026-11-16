/**
 * Google ID トークン（Sign In With Google / Google Identity Services の credential）の検証（Phase 1.6）
 *
 * Google の推奨どおり、公開鍵（JWKS）を取得してサーバー側で署名を検証する。
 *  - 署名: RS256（RSASSA-PKCS1-v1_5 + SHA-256）
 *  - GAS には RSA 署名「検証」の組み込み関数が無いため、RFC 8017 §8.2.2 の手順をそのまま実装する。
 *    EMSA-PKCS1-v1_5 の期待値（00 01 FF.. 00 || DigestInfo || H）を組み立てて全バイト比較する方式で、
 *    ASN.1 の解析は行わない（解析の甘さによる署名偽造を避けるため）。
 *  - SHA-256 は Utilities.computeDigest（組み込み）、べき乗剰余は BigInt。秘密鍵は扱わない（検証のみ）。
 *  - 鍵は e=65537・2048bit 以上の RSA 鍵のみ受け付ける。alg は RS256 のみ（none / HS256 等は拒否）。
 * クレーム検証: iss / aud（OAuth クライアントIDと完全一致）/ azp / exp / iat / sub / email / email_verified
 */
const GOOGLE_ID_TOKEN = {
  ISSUERS: ['accounts.google.com', 'https://accounts.google.com'],
  JWKS_URL: 'https://www.googleapis.com/oauth2/v3/certs',
  JWKS_CACHE_KEY: 'GOOGLE_JWKS_V1',
  JWKS_REFRESH_FLAG: 'GOOGLE_JWKS_REFRESHED',
  JWKS_REFRESH_INTERVAL_SEC: 300,   // 未知の kid による再取得は5分に1回まで（取得回数の浪費対策）
  JWKS_MIN_TTL_SEC: 300,
  JWKS_MAX_TTL_SEC: 21600,          // CacheService の上限（6時間）
  MAX_TOKEN_LENGTH: 4096,
  CLOCK_SKEW_SEC: 60,
  MIN_MODULUS_BITS: 2048,
  // DER: SEQUENCE { SEQUENCE { OID sha256, NULL }, OCTET STRING (32) }
  SHA256_DIGEST_INFO: [0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00, 0x04, 0x20]
};

const GoogleIdTokenVerifier = {
  jwksMemo_: null,

  /**
   * @param {string} idToken
   * @param {string} clientId 許可する OAuth クライアントID（aud）
   * @param {number=} nowSec 検証時刻（テスト用）
   * @return {{sub:string,email:string,name:string}}
   */
  verify(idToken, clientId, nowSec) {
    if (typeof BigInt !== 'function') {
      throw Utils.apiError('AUTH_NOT_CONFIGURED', 'この実行環境ではトークン署名を検証できません（BigInt 未対応）');
    }
    if (!clientId) throw Utils.apiError('AUTH_NOT_CONFIGURED', 'OAuth クライアントIDが未設定です');
    if (idToken === undefined || idToken === null || idToken === '') {
      throw Utils.apiError('AUTH_REQUIRED', 'ログインが必要です');
    }
    if (typeof idToken !== 'string' || idToken.length > GOOGLE_ID_TOKEN.MAX_TOKEN_LENGTH ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(idToken)) {
      throw this.invalid_('トークンの形式が不正です');
    }

    const parts = idToken.split('.');
    const header = this.parseJsonPart_(parts[0]);
    const payload = this.parseJsonPart_(parts[1]);

    if (header.alg !== 'RS256') throw this.invalid_('署名方式が不正です');
    if (typeof header.kid !== 'string' || !header.kid) throw this.invalid_('鍵IDがありません');
    if (header.typ !== undefined && header.typ !== 'JWT') throw this.invalid_('トークン種別が不正です');
    if (header.crit !== undefined) throw this.invalid_('未対応のヘッダーがあります');

    const key = this.getKey_(header.kid);
    const signature = this.base64UrlToBytes_(parts[2]);
    if (!this.verifyRs256_(parts[0] + '.' + parts[1], signature, key)) {
      throw this.invalid_('署名を検証できません');
    }

    return this.validateClaims_(payload, clientId, nowSec === undefined ? Math.floor(Date.now() / 1000) : nowSec);
  },

  validateClaims_(p, clientId, now) {
    if (GOOGLE_ID_TOKEN.ISSUERS.indexOf(p.iss) === -1) throw this.invalid_('発行者が不正です');
    if (typeof p.aud !== 'string' || p.aud !== clientId) throw this.invalid_('このアプリ向けのトークンではありません');
    if (p.azp !== undefined && p.azp !== clientId) throw this.invalid_('このアプリ向けのトークンではありません');
    if (typeof p.exp !== 'number' || !isFinite(p.exp)) throw this.invalid_('有効期限がありません');
    if (p.exp <= now - GOOGLE_ID_TOKEN.CLOCK_SKEW_SEC) {
      throw Utils.apiError('AUTH_EXPIRED', 'ログインの有効期限が切れました。もう一度ログインしてください');
    }
    if (typeof p.iat !== 'number' || !isFinite(p.iat)) throw this.invalid_('発行時刻がありません');
    if (p.iat > now + GOOGLE_ID_TOKEN.CLOCK_SKEW_SEC) throw this.invalid_('発行時刻が不正です');
    if (p.exp <= p.iat) throw this.invalid_('有効期限が不正です');
    if (typeof p.sub !== 'string' || !/^[0-9]{1,255}$/.test(p.sub)) throw this.invalid_('利用者IDが不正です');
    if (typeof p.email !== 'string' || !p.email || p.email.length > 320) throw this.invalid_('メールアドレスがありません');
    if (p.email_verified !== true && p.email_verified !== 'true') {
      throw this.invalid_('メールアドレスが確認済みではありません');
    }
    return {
      sub: p.sub,
      email: p.email.toLowerCase(),
      name: typeof p.name === 'string' ? p.name.slice(0, 100) : ''
    };
  },

  // ===== 公開鍵（JWKS） =====
  getKey_(kid) {
    let jwks = this.loadJwks_(false);
    let key = this.findKey_(jwks, kid);
    if (!key && this.mayRefresh_()) {
      jwks = this.loadJwks_(true);
      key = this.findKey_(jwks, kid);
    }
    if (!key) throw this.invalid_('署名鍵が見つかりません');
    return key;
  },

  findKey_(jwks, kid) {
    const keys = jwks && Array.isArray(jwks.keys) ? jwks.keys : [];
    const jwk = keys.find(k => k && k.kid === kid);
    if (!jwk) return null;
    if (jwk.kty !== 'RSA') return null;
    if (jwk.alg !== undefined && jwk.alg !== 'RS256') return null;
    if (jwk.use !== undefined && jwk.use !== 'sig') return null;
    if (jwk.e !== 'AQAB') return null;   // 65537 のみ
    const nBytes = this.stripLeadingZeros_(this.base64UrlToBytes_(String(jwk.n || '')));
    const bits = this.bitLength_(nBytes);
    if (bits < GOOGLE_ID_TOKEN.MIN_MODULUS_BITS) return null;
    return { kid, nBytes };
  },

  loadJwks_(forceRefresh) {
    if (!forceRefresh && this.jwksMemo_) return this.jwksMemo_;
    const cache = CacheService.getScriptCache();
    if (!forceRefresh) {
      const cached = cache.get(GOOGLE_ID_TOKEN.JWKS_CACHE_KEY);
      if (cached) {
        try {
          this.jwksMemo_ = JSON.parse(cached);
          return this.jwksMemo_;
        } catch (err) {
          cache.remove(GOOGLE_ID_TOKEN.JWKS_CACHE_KEY);
        }
      }
    }

    let response;
    try {
      response = UrlFetchApp.fetch(GOOGLE_ID_TOKEN.JWKS_URL, { muteHttpExceptions: true, followRedirects: false });
    } catch (err) {
      throw Utils.apiError('AUTH_KEYS_UNAVAILABLE', 'Google の公開鍵を取得できませんでした。時間をおいて再度お試しください');
    }
    if (response.getResponseCode() !== 200) {
      throw Utils.apiError('AUTH_KEYS_UNAVAILABLE', 'Google の公開鍵を取得できませんでした（HTTP ' + response.getResponseCode() + '）');
    }
    let jwks;
    try {
      jwks = JSON.parse(response.getContentText());
    } catch (err) {
      throw Utils.apiError('AUTH_KEYS_UNAVAILABLE', 'Google の公開鍵の形式が不正です');
    }
    if (!jwks || !Array.isArray(jwks.keys)) {
      throw Utils.apiError('AUTH_KEYS_UNAVAILABLE', 'Google の公開鍵の形式が不正です');
    }
    const ttl = this.cacheTtlFromHeaders_(response.getHeaders ? response.getHeaders() : {});
    try {
      cache.put(GOOGLE_ID_TOKEN.JWKS_CACHE_KEY, JSON.stringify(jwks), ttl);
    } catch (err) {
      // キャッシュできなくても検証は続行（次回また取得する）
    }
    this.jwksMemo_ = jwks;
    return jwks;
  },

  mayRefresh_() {
    try {
      const cache = CacheService.getScriptCache();
      if (cache.get(GOOGLE_ID_TOKEN.JWKS_REFRESH_FLAG)) return false;
      cache.put(GOOGLE_ID_TOKEN.JWKS_REFRESH_FLAG, '1', GOOGLE_ID_TOKEN.JWKS_REFRESH_INTERVAL_SEC);
      return true;
    } catch (err) {
      return false;
    }
  },

  cacheTtlFromHeaders_(headers) {
    let value = '';
    Object.keys(headers || {}).forEach(k => { if (String(k).toLowerCase() === 'cache-control') value = String(headers[k]); });
    const m = value.match(/max-age=(\d+)/i);
    const ttl = m ? Number(m[1]) : GOOGLE_ID_TOKEN.JWKS_MIN_TTL_SEC;
    return Math.max(GOOGLE_ID_TOKEN.JWKS_MIN_TTL_SEC, Math.min(GOOGLE_ID_TOKEN.JWKS_MAX_TTL_SEC, ttl));
  },

  // ===== RS256 検証（RFC 8017 §8.2.2 RSASSA-PKCS1-V1_5-VERIFY） =====
  verifyRs256_(signingInput, signature, key) {
    const k = key.nBytes.length;
    if (signature.length !== k) return false;                     // 1. 長さ確認
    const n = this.bytesToBigInt_(key.nBytes);
    const s = this.bytesToBigInt_(signature);
    if (s >= n) return false;                                     // 2a. 範囲確認
    const m = this.modPow_(s, BigInt(65537), n);                  // 2b. RSAVP1
    const em = this.bigIntToBytes_(m, k);                         // 2c. I2OSP
    if (!em) return false;

    const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, signingInput, Utilities.Charset.US_ASCII)
      .map(b => (b + 256) % 256);
    const t = GOOGLE_ID_TOKEN.SHA256_DIGEST_INFO.concat(digest);
    const psLength = k - t.length - 3;
    if (psLength < 8) return false;
    const expected = [0x00, 0x01];                                // 3. EMSA-PKCS1-v1_5 の期待値
    for (let i = 0; i < psLength; i += 1) expected.push(0xff);
    expected.push(0x00);
    t.forEach(b => expected.push(b));

    let diff = 0;                                                 // 4. 全バイト比較
    for (let i = 0; i < k; i += 1) diff |= (em[i] ^ expected[i]);
    return diff === 0;
  },

  modPow_(base, exponent, modulus) {
    let result = BigInt(1);
    let b = base % modulus;
    let e = exponent;
    const zero = BigInt(0);
    const one = BigInt(1);
    while (e > zero) {
      if ((e & one) === one) result = (result * b) % modulus;
      e >>= one;
      b = (b * b) % modulus;
    }
    return result;
  },

  bytesToBigInt_(bytes) {
    let hex = '';
    for (let i = 0; i < bytes.length; i += 1) hex += ('0' + bytes[i].toString(16)).slice(-2);
    return hex ? BigInt('0x' + hex) : BigInt(0);
  },

  bigIntToBytes_(value, length) {
    let hex = value.toString(16);
    if (hex.length % 2) hex = '0' + hex;
    if (hex.length / 2 > length) return null;
    const bytes = [];
    for (let i = 0; i < length - hex.length / 2; i += 1) bytes.push(0);
    for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.substr(i, 2), 16));
    return bytes;
  },

  stripLeadingZeros_(bytes) {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i += 1;
    return bytes.slice(i);
  },

  bitLength_(bytes) {
    if (!bytes.length) return 0;
    return (bytes.length - 1) * 8 + bytes[0].toString(2).length * (bytes[0] ? 1 : 0);
  },

  // ===== base64url / JSON =====
  base64UrlToBytes_(text) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) throw this.invalid_('トークンの形式が不正です');
    const bytes = [];
    let buffer = 0;
    let bits = 0;
    for (let i = 0; i < text.length; i += 1) {
      buffer = (buffer << 6) | alphabet.indexOf(text[i]);
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((buffer >> bits) & 0xff);
      }
    }
    return bytes;
  },

  parseJsonPart_(part) {
    const bytes = this.base64UrlToBytes_(part);
    let text;
    try {
      text = decodeURIComponent(bytes.map(b => '%' + ('0' + b.toString(16)).slice(-2)).join(''));
    } catch (err) {
      throw this.invalid_('トークンの形式が不正です');
    }
    let value;
    try {
      value = JSON.parse(text);
    } catch (err) {
      throw this.invalid_('トークンの形式が不正です');
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw this.invalid_('トークンの形式が不正です');
    return value;
  },

  invalid_(message) {
    return Utils.apiError('AUTH_INVALID', message || '認証情報を確認できません');
  }
};
