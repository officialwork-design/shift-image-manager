/**
 * 設定の解決（Phase 1.7: 本番 / テスト環境の分離）
 *
 * Script Properties
 *   APP_ENV        : 'test' のときテスト環境。未設定・'production' は本番。
 *   SPREADSHEET_ID : テスト環境で必須（テスト用スプレッドシート）。本番IDは不可。
 *
 * 安全装置（どれかに該当したら全 API を停止）
 *   - 本番以外の Apps Script プロジェクトで APP_ENV=test が設定されていない（＝本番の既定IDを使ってしまう構成）
 *   - 本番プロジェクトで APP_ENV=test が設定されている
 *   - テスト環境の設定（Script Properties / ID管理シート）に本番のスプレッドシート・フォルダ・デプロイIDが含まれる
 *   - テスト環境で ID管理シートを読めない（本番の既定値へフォールバックしない）
 */
const ConfigService = {
  envMemo_: null,

  getEnvironment() {
    if (this.envMemo_) return this.envMemo_;
    const props = this.getScriptProperties_();
    const appEnv = String(props.APP_ENV || '').trim().toLowerCase();
    const scriptId = this.getCurrentScriptId_();

    if (appEnv && appEnv !== 'test' && appEnv !== 'production') {
      throw Utils.apiError('CONFIG_INVALID', 'APP_ENV は test または production を指定してください');
    }
    if (appEnv === 'test') {
      if (scriptId === SCRIPT_ID) {
        throw Utils.apiError('CONFIG_ENV_MISMATCH', '本番の Apps Script プロジェクトに APP_ENV=test が設定されています');
      }
      const spreadsheetId = String(props.SPREADSHEET_ID || '').trim();
      if (!spreadsheetId) throw Utils.apiError('CONFIG_INVALID', 'テスト環境では Script Properties の SPREADSHEET_ID が必須です');
      this.assertNoProductionIds_({ SPREADSHEET_ID: spreadsheetId });
      this.envMemo_ = { env: 'test', spreadsheetId, scriptId };
      return this.envMemo_;
    }
    if (scriptId !== SCRIPT_ID) {
      throw Utils.apiError('CONFIG_ENV_REQUIRED',
        '本番以外の Apps Script プロジェクトです。Script Properties に APP_ENV=test と SPREADSHEET_ID（テスト用）を設定してください');
    }
    this.envMemo_ = { env: 'production', spreadsheetId: BOOTSTRAP_SPREADSHEET_ID, scriptId };
    return this.envMemo_;
  },

  isTestEnvironment() {
    return this.getEnvironment().env === 'test';
  },

  getConfig() {
    const env = this.getEnvironment();
    const defaults = this.getDefaultConfig();
    if (env.env === 'test') {
      // テスト環境では本番の既定ID（画像フォルダ等）を使わない
      Object.assign(defaults, {
        SPREADSHEET_ID: env.spreadsheetId, SCRIPT_ID: env.scriptId, GAS_WEB_APP_URL: '',
        DRIVE_IMAGE_FOLDER_ID: '', DRIVE_IMAGE_FOLDER_IDS: '', DRIVE_OUTPUT_FOLDER_ID: '', APP_MODE: 'test'
      });
    }
    const sheetConfig = this.readIdManagementConfig_(env.spreadsheetId, env.env === 'test');
    const merged = Object.assign({}, defaults, sheetConfig);
    // ID管理に空欄・未登録のシート名があっても既定値で動かす
    ['SHEET_SHIFT_EDIT', 'SHEET_SHIFT_EDIT_MANAGE', 'SHEET_ACCESS_CONTROL', 'SHEET_OPERATION_LOG', 'SHEET_ERROR_LOG', 'SHEET_IMAGE_CHECK', 'SHEET_SIFT_DATA', 'SHEET_IMAGE_GENERATION', 'SHEET_BACKGROUND']
      .forEach(key => { if (!merged[key]) merged[key] = DEFAULT_CONFIG[key]; });
    if (env.env === 'test') {
      this.assertNoProductionIds_(sheetConfig);   // ID管理シートに本番の値が持ち込まれていないか
      merged.SPREADSHEET_ID = env.spreadsheetId;   // シート側の値で接続先を変えさせない
      merged.SCRIPT_ID = env.scriptId;
      this.assertNoProductionIds_(merged);
    }
    return merged;
  },

  getDefaultConfig() {
    return Object.assign({}, DEFAULT_CONFIG);
  },

  getSpreadsheetId() {
    const env = this.getEnvironment();
    if (env.env === 'test') return env.spreadsheetId;
    const config = this.getConfig();
    return config.SPREADSHEET_ID || BOOTSTRAP_SPREADSHEET_ID;
  },

  // 設定値のどこかに本番IDが含まれていたら停止（URL・カンマ区切りの中も検査）
  assertNoProductionIds_(values) {
    const found = [];
    Object.keys(values || {}).forEach(key => {
      const text = String(values[key] == null ? '' : values[key]);
      PRODUCTION_RESOURCE_IDS.forEach(id => { if (id && text.indexOf(id) !== -1) found.push(key); });
    });
    if (found.length) {
      throw Utils.apiError('CONFIG_PRODUCTION_ID_IN_TEST',
        'テスト環境の設定に本番のIDが含まれています（' + found.filter((v, i, a) => a.indexOf(v) === i).join(', ') + '）。すべての処理を停止しました');
    }
  },

  getScriptProperties_() {
    try {
      return PropertiesService.getScriptProperties().getProperties() || {};
    } catch (err) {
      return {};
    }
  },

  getCurrentScriptId_() {
    try {
      return ScriptApp.getScriptId();
    } catch (err) {
      return '';
    }
  },

  // ログイン前に匿名で取得できる情報のみ（Phase 1.6）。
  // Spreadsheet ID・Script ID・Drive フォルダID・シート名・キャスト・シフトは返さない。
  // OAuth クライアントIDは公開識別子（ブラウザの Google ログインに必要）。
  getPublicConfig() {
    const config = this.getConfig();
    const auth = AuthService.getSettings();
    return {
      environment: this.getEnvironment().env,   // 'production' / 'test'（フロントの接続先確認用）
      appMode: config.APP_MODE || DEFAULT_CONFIG.APP_MODE,
      APP_MODE: config.APP_MODE || DEFAULT_CONFIG.APP_MODE,
      stores: STORE_NAMES.slice(),
      workTimeOptions: WORK_TIME_OPTIONS.slice(),
      TIMEZONE: config.TIMEZONE || DEFAULT_CONFIG.TIMEZONE,
      authMode: auth.configured ? auth.mode : '',
      authConfigured: auth.configured,
      googleClientId: auth.configured ? auth.clientId : ''
    };
  },

  readIdManagementConfig_(spreadsheetId, failClosed) {
    const values = {};
    try {
      const spreadsheet = SpreadsheetApp.openById(spreadsheetId || BOOTSTRAP_SPREADSHEET_ID);
      const sheet = spreadsheet.getSheetByName(DEFAULT_CONFIG.SHEET_ID_MANAGEMENT);
      if (!sheet || sheet.getLastRow() < 2) return values;

      const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getDisplayValues();
      rows.forEach(row => {
        const key = String(row[0] || '').trim();
        const value = String(row[1] || '').trim();
        if (key && value !== '') values[key] = value;
      });
    } catch (err) {
      if (failClosed) throw Utils.apiError('CONFIG_UNAVAILABLE', 'テスト用スプレッドシートを開けません。SPREADSHEET_ID と共有設定を確認してください');
      return values;
    }
    return values;
  }
};
