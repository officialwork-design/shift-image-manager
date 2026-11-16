'use strict';
const { createGasContext, FakeSpreadsheet, seedSpreadsheet } = require('./gas-harness');

const FOLDERS = {
  '1Ob0yiSr0yP_sHa72t9xg8xmGn5YEUYR-': { files: [
    { id: 'IMG_CHOCO', name: 'ちょこ.png' }, { id: 'IMG_SUZU', name: 'すず.jpg' },
    { id: 'IMG_HIME', name: 'ひめ.png' }, { id: 'IMG_PREP', name: '準備中.png' }, { id: 'IMG_RUN', name: 'るん(1).png' }
  ] },
  '17zZbEhzgr3Fp_yfdox3zWLhO5kSUwvhZ': { files: [{ id: 'IMG_MUGI', name: 'むぎ.png' }] }
};

const KABUKI_1116 = [
  '📢推し推せっ！KABUKI店 📢', '　　　✨マカロン✨', '💙11月16日(月)の出勤キャスト💙', '⏰営業時間18:00〜23:30🫶🏼', '',
  '今日会える女の子たちはこちら🎀', '', '18:00', '♡ちょこ', '♡ぴょん', '', '19:00', '♡すず💗', '', '19:30', '♡るん🐰', '♡むぎ', '',
  '気になるキャストのXアカウントは返信欄へ👇'
].join('\n');
const KABUKI_1117 = ['11月17日(火)', '18:00', 'ちょこ @ciocco_oshiose', '20:00', 'しちみ'].join('\n');
const KABUKI_1101 = ['11月1日(日)', '18:00', 'ゆきの'].join('\n');
const AKIBA_1116 = ['📣推し推せっ！AKIBA店 📣', '💗11月16日(月)の出勤キャスト💗', '17:00', '♡ひめ', '♡あみめ', '18:00', '♡みも', '19:00', '♡みな'].join('\n');
const AKIBA_0101 = ['1月1日(金)', '17:00', 'みらい'].join('\n');  // 2027-01-01 は金曜

function setup(opts) {
  const o = opts || {};
  const ss = new FakeSpreadsheet();
  seedSpreadsheet(ss, {
    KABUKI: o.kabuki || [KABUKI_1101, KABUKI_1116, KABUKI_1117],
    AKIBA: o.akiba || [AKIBA_1116, AKIBA_0101]
  });
  const h = createGasContext(Object.assign({ spreadsheet: ss, now: '2026-11-16T03:00:00Z', driveFolders: FOLDERS }, o.context || {}));
  if (!o.skipSetup) h.gas.setupShiftImageManager();
  if (!o.noAuth) {
    h.props.AUTH_MODE = 'test';
    h.props.SHIFT_EDITOR_EMAILS = 'editor@example.com';
    h.gas.AuthService.setVerifierForTest(auth => {
      if (!auth || !auth.testUser) { const e = new Error('no auth'); e.code = 'AUTH_REQUIRED'; throw e; }
      return { email: auth.testUser };
    });
  }
  return h;
}

// 別端末（同じスプレッドシート・ロック・キャッシュを共有する別インスタンス）
function secondTerminal(h) {
  const t = createGasContext({ spreadsheet: h.ss, now: '2026-11-16T03:00:00Z', driveFolders: FOLDERS,
    cacheStore: h.cacheStore, lockState: h.lockState, scriptProperties: h.props });
  t.gas.AuthService.setVerifierForTest(auth => ({ email: auth.testUser }));
  return t;
}

// API 呼び出しヘルパー（doGet / doPost を通す）
function callGet(h, action, payload) {
  const out = h.gas.doGet({ parameter: { action, payload: JSON.stringify(payload || {}), callback: 'cb' } });
  const m = out.body.match(/^cb\(([\s\S]*)\);$/);
  return JSON.parse(m[1]);
}
function callPost(h, action, payload, extra) {
  const body = Object.assign({ action, payload: payload || {} }, extra || {});
  const out = h.gas.doPost({ parameter: {}, postData: { contents: JSON.stringify(body) } });
  return JSON.parse(out.body);
}
const EDITOR = { auth: { testUser: 'editor@example.com' } };

module.exports = { setup, secondTerminal, callGet, callPost, EDITOR, FOLDERS };
