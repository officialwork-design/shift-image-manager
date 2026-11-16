// テスト環境用 config.js のテンプレート（tools/build-test-site.sh が __TEST_GAS_WEB_APP_URL__ を置き換える）
// 本番の WebApp URL を入れないこと。APP_ENV はサーバー（getPublicConfig.environment）と一致しないと画面が停止する。
window.APP_CONFIG = {
  APP_NAME: 'shift-image-manager (TEST)',
  GAS_WEB_APP_URL: '__TEST_GAS_WEB_APP_URL__',
  API_MODE: 'post',
  APP_ENV: 'test',
  DEFAULT_STORE: 'KABUKI',
  STORES: ['KABUKI', 'AKIBA'],
  VERSION: '0.1.7-test'
};
