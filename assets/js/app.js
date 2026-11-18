const state = {
  current: null,          // 最後に読み込んだ保存データ（store / date / revision / initialized / editRows ...）
  selection: { store: '', date: '' },  // 現在表示している店舗・日付（date は YYYY-MM-DD）
  savedSignature: null,   // 保存済み内容の署名（未保存変更の検出用）
  pendingSave: null,      // 再送時に同じ requestId を使うための情報
  conflictLatest: null,
  isProcessing: false,
  identity: null,         // サーバーで検証済みの利用者 { sub, email, role }（Phase 1.6）
  authView: 'loading',
  datesLoaded: false
};

const WORK_TIME_OPTIONS = [
  '',
  '17:00',
  '17:30',
  '18:00',
  '18:30',
  '19:00',
  '19:30',
  '20:00',
  '20:30',
  '21:00',
  '21:30',
  '22:00'
];

const SHIFT_STATUSES = ['出勤', '休み'];

// キャスト名 → SNS ID（表示は「名前 @id」、保存値は名前のみ）
const CAST_OPTIONS = {
  "ひめる": "@himeru_oshiose",
  "るん": "@run__oshiose",
  "えりか": "@erika_oshiose",
  "ななせ": "@nanase_oshiose",
  "しゅしゅ": "@shushu_oshiose",
  "こん": "@kon_oshiose",
  "すず": "@suzu_oshiose",
  "とおる": "@toru_oshiose",
  "もも": "@momo_oshiose",
  "あいな": "@aina__oshiose",
  "めう": "@meu_oshiose",
  "むぎ": "@mugi_oshiose2",
  "ここね": "@kokone_oshiose",
  "るう": "@ruu_oshiose",
  "ちょこ": "@ciocco_oshiose",
  "ゆきの": "@yukino_oshiose",
  "まゆ": "@mayu_oshiose",
  "乖離": "@kairi_oshiose",
  "青葉": "@aoba_oshiose",
  "りさ": "@risa_oshiose",
  "ゆる": "@yuru_oshiose",
  "せい": "@sei_oshiose",
  "さな": "@sana_oshiose",
  "りと": "@rito_oshiose_",
  "めえ": "@mee_oshiose",
  "ましろ": "@mashiro_oshiose",
  "るり": "@ruri_oshiose",
  "かなの": "@kanano_oshiose",
  "ねぎたろう": "@negi_oshiose",
  "いおり": "@iori_oshiose",
  "るか": "@ruka_oshiose",
  "まにゃ": "@manya_oshiose",
  "あおい": "@aoi_oshiose",
  "なつめ": "@natsume_oshiose",
  "ゆりあ": "@yuria_oshiose",
  "かれん": "@karen_oshiose",
  "ちゃま": "@chama_oshiose",
  "さおりん": "@saorin_oshiose",
  "たると": "@taruto_oshiose",
  "まいか": "@maika_oshiose",
  "ここみ": "@cocomi_oshiose",
  "ひめ": "@himeA_oshiose",
  "ことり": "@kotori_oshiose",
  "ここ": "@coco_oshiose",
  "るな": "@runa_oshiose",
  "ゆあ": "@yua_oshiose",
  "ひかり": "@hikari_oshiose",
  "ころも": "@coromo_oshiose",
  "みらい": "@mirai_oshiose",
  "ひよ": "@hiyo_oshiose",
  "ラミエル": "@ramiel_oshiose",
  "そら": "@sora_oshiose",
  "しちみ": "@7chimi_oshiose",
  "リア": "@ria_oshiose",
  "恋富子": "@kotomiko_oshiose"
};

function buildCastDatalistOptions() {
  return Object.keys(CAST_OPTIONS).map(name => {
    const id = CAST_OPTIONS[name];
    return `<option value="${escapeHtml(name)}" label="${escapeHtml(`${name} ${id}`)}"></option>`;
  }).join('');
}

function renderCastNameInput(value, sizeClass = 'form-control-sm') {
  return `
    <input
      class="form-control ${sizeClass} js-cast-name"
      list="castNameOptions"
      autocomplete="off"
      value="${escapeHtml(value || '')}"
    >
  `;
}

window.addEventListener('DOMContentLoaded', boot);

async function boot() {
  renderStoreOptions();
  renderAddWorkTimeOptions();
  renderAddCastOptions();
  bindEvents();
  window.addEventListener('beforeunload', event => {
    if (!isDirty()) return;
    event.preventDefault();
    event.returnValue = '';
  });
  Api.setTokenProvider(() => Auth.getToken());
  Auth.onChange(onAuthChange);
  updateSaveState();
  await startAuth();
}

// ===== Google ログイン（Phase 1.6） =====
async function startAuth() {
  setAuthView('loading');
  try {
    const config = await Api.publicCall('getPublicConfig');
    const expectedEnv = (window.APP_CONFIG && window.APP_CONFIG.APP_ENV) || 'production';
    if ((config.environment || 'production') !== expectedEnv) {
      setAuthView('blocked', `接続先の環境が一致しません（画面: ${expectedEnv} / サーバー: ${config.environment || '不明'}）。config.js の GAS_WEB_APP_URL を確認してください。`);
      return;
    }
    document.getElementById('envBadge').classList.toggle('d-none', config.environment !== 'test');
    if (!config.authConfigured || !config.googleClientId) {
      setAuthView('notConfigured', 'ログイン機能が設定されていません。管理者に連絡してください。');
      return;
    }
    await Auth.init({ clientId: config.googleClientId, buttonElement: document.getElementById('gsiButton') });
    if (!Auth.hasToken() && state.authView === 'loading') setAuthView('signedOut');
    setStatus('準備完了', 'success');
  } catch (err) {
    // サーバー設定の安全装置（本番ID混入・環境の取り違え）で停止している場合はログインさせない
    setAuthView(String(err.code || '').indexOf('CONFIG_') === 0 ? 'blocked' : 'error', err.message || 'ログイン機能を読み込めませんでした。');
    setStatus('エラー', 'danger');
  }
}

async function onAuthChange(event, detail) {
  if (event === 'signedIn') {
    if (detail.accountChanged) {
      if (isDirty()) showAlert('別のアカウントでログインしたため、未保存の変更を破棄しました。', 'warning');
      clearShiftData();
      state.identity = null;
    }
    await verifySignIn();
  } else if (event === 'expired') {
    if (state.identity) setAuthView('expired');
    else setAuthView('signedOut');
  } else if (event === 'signedOut') {
    state.identity = null;
    clearShiftData();
    setAuthView('signedOut', 'ログアウトしました。');
  } else if (event === 'error') {
    setAuthView(state.identity ? 'expired' : 'signedOut', detail && detail.message);
  }
}

// サーバーで ID トークンの署名・許可リスト・ロールを確認する
async function verifySignIn() {
  const resumeAfterExpiry = state.authView === 'expired' && !!state.identity;
  setAuthView(resumeAfterExpiry ? 'expired' : 'verifying');
  try {
    const me = await Api.call('whoAmI');
    if (state.identity && state.identity.sub !== me.sub) clearShiftData();
    state.identity = me;
    setAuthView('signedIn');
    if (resumeAfterExpiry) showAlert('再ログインしました。入力中の内容はそのまま残っています。必要に応じて保存してください。', 'success');
    if (manualModeActive()) ManualMode.onSignedIn();      // 手動モード: SIFT_DATA の日付・シフトは取得しない
    else if (!state.datesLoaded) await loadDateList();
  } catch (err) {
    handleAuthFailure(err);
  }
}

function handleAuthFailure(err) {
  const info = ShiftState.classifyError(err);
  if (info.kind === 'relogin') {
    Auth.expire();
    setAuthView(state.identity ? 'expired' : 'signedOut', info.message);
  } else if (info.kind === 'forbidden') {
    state.identity = null;
    clearShiftData();
    setAuthView('forbidden', info.message, err.details);
  } else {
    setAuthView(state.identity ? 'expired' : 'error', info.message);
  }
}

// 認証状態に応じて画面を切り替える
// loading / signedOut / verifying / signedIn / expired / forbidden / notConfigured / error / blocked
function setAuthView(view, message, details) {
  state.authView = view;
  const showApp = view === 'signedIn' || view === 'expired';
  document.getElementById('appContent').classList.toggle('d-none', !showApp);
  document.getElementById('authPanel').classList.toggle('d-none', showApp);
  document.getElementById('reloginBanner').classList.toggle('d-none', view !== 'expired');

  const titles = {
    loading: 'ログイン機能を読み込み中…',
    signedOut: 'Google アカウントでログインしてください',
    verifying: 'ログイン情報を確認中…',
    forbidden: 'このアカウントには利用権限がありません',
    notConfigured: 'ログイン機能が利用できません',
    error: 'ログイン機能が利用できません',
    blocked: '安全のため停止しています'
  };
  if (!showApp) {
    document.getElementById('authTitle').textContent = titles[view] || '';
    document.getElementById('authSpinner').classList.toggle('d-none', !(view === 'loading' || view === 'verifying'));
    document.getElementById('gsiButtonWrap').classList.toggle('d-none', !(view === 'signedOut' || view === 'forbidden' || view === 'error'));
    document.getElementById('authRetryButton').classList.toggle('d-none', view !== 'error');
  }
  const messageEl = document.getElementById(view === 'expired' ? 'reloginMessage' : 'authMessage');
  if (messageEl) messageEl.textContent = message || (view === 'expired' ? 'ログインの有効期限が切れました。もう一度ログインしてください（入力中の内容は残っています）。' : '');
  if (view !== 'expired') document.getElementById('authMessage').textContent = message || defaultAuthMessage(view);

  const detailEl = document.getElementById('authDetails');
  if (view === 'forbidden' && details && details.sub) {
    detailEl.innerHTML = `
      <div class="small">管理者に次の情報を伝えて登録を依頼してください。</div>
      <dl class="row small mb-0 mt-2">
        <dt class="col-4">メール</dt><dd class="col-8 text-break" id="authDetailEmail">${escapeHtml(details.email || '')}</dd>
        <dt class="col-4">利用者ID</dt><dd class="col-8 text-break font-monospace" id="authDetailSub">${escapeHtml(details.sub)}</dd>
      </dl>`;
    detailEl.classList.remove('d-none');
  } else {
    detailEl.innerHTML = '';
    detailEl.classList.add('d-none');
  }

  if (view === 'signedOut' || view === 'forbidden' || view === 'error') Auth.renderButton(document.getElementById('gsiButton'));
  if (view === 'expired') Auth.renderButton(document.getElementById('gsiButtonRelogin'));

  const signedIn = view === 'signedIn' || view === 'expired';
  const userBadge = document.getElementById('userBadge');
  userBadge.classList.toggle('d-none', !signedIn || !state.identity);
  if (state.identity) {
    document.getElementById('userEmail').textContent = state.identity.email;
    document.getElementById('userRole').textContent = state.identity.role;
  }
  document.getElementById('logoutButton').classList.toggle('d-none', !signedIn && view !== 'forbidden');
  applyRoleUi();
}

function defaultAuthMessage(view) {
  if (view === 'signedOut') return 'シフトの閲覧・編集には、管理者に登録された Google アカウントでのログインが必要です。';
  if (view === 'verifying') return 'しばらくお待ちください。';
  return '';
}

function applyRoleUi() {
  const perms = ShiftState.permissionsFor(state.identity && state.identity.role);
  const resetButton = document.getElementById('resetFromSourceButton');
  resetButton.disabled = !perms.canReset;
  resetButton.title = perms.canReset ? '' : '元データからの初期化は ADMIN のみ実行できます';
  document.getElementById('resetAdminNote').classList.toggle('d-none', perms.canReset || !state.identity);
  if (typeof updateBackgroundButtons === 'function') updateBackgroundButtons();
}

// 手動モード（manual-mode.js）が有効か。読み込まれていない場合は自動モードとして動く
function manualModeActive() {
  return typeof ManualMode !== 'undefined' && !!ManualMode && ManualMode.isManual();
}

function logout() {
  const manualDirty = typeof ManualMode !== 'undefined' && !!ManualMode && ManualMode.isDirty();
  if ((isDirty() || manualDirty) && !window.confirm('未保存の変更があります。ログアウトすると失われます。ログアウトしますか？')) return;
  state.savedSignature = null;   // 確認済みのため以降の警告を出さない
  Auth.signOut();
}

// ログアウト・アカウント切替時に画面上のシフトデータを消す
function clearShiftData() {
  state.current = null;
  state.selection = { store: '', date: '' };
  state.savedSignature = null;
  state.pendingSave = null;
  state.conflictLatest = null;
  state.datesLoaded = false;
  hideConflict();
  document.getElementById('editTableArea').innerHTML = '<div class="text-secondary text-center py-4">店舗と日付を選択してください</div>';
  document.getElementById('photoGrid').innerHTML = '<div class="text-secondary text-center py-4">店舗と日付を選択してください</div>';
  document.getElementById('activeList').innerHTML = '';
  document.getElementById('absentList').innerHTML = '';
  document.getElementById('editSiftTableArea').innerHTML = '';
  document.getElementById('editSiftPostPreview').textContent = '';
  document.getElementById('siftPreviewSelect').innerHTML = '';
  document.getElementById('siftPreviewBody').textContent = '';
  document.getElementById('alertArea').innerHTML = '';
  document.getElementById('datePicker').innerHTML = '<option value="">ログイン後に表示</option>';
  resetBackgroundUi();
  if (typeof ManualMode !== 'undefined' && ManualMode) ManualMode.reset();
  updateSaveState();
}

// API エラー共通処理。認証系なら再ログイン導線を出して true を返す（画面の入力は消さない）
function handleAuthErrorIfAny(err) {
  const info = ShiftState.classifyError(err);
  if (info.kind === 'relogin') {
    Auth.expire();
    setAuthView(state.identity ? 'expired' : 'signedOut', info.message);
    return true;
  }
  if (info.kind === 'forbidden') {
    handleAuthFailure(err);
    return true;
  }
  return false;
}

function renderAddCastOptions() {
  const datalist = document.getElementById('castNameOptions');
  if (datalist) datalist.innerHTML = buildCastDatalistOptions();
}

function renderStoreOptions() {
  const picker = document.getElementById('storePicker');
  picker.innerHTML = (APP_CONFIG.STORES || [])
    .map(store => `<option value="${escapeHtml(store)}">${escapeHtml(store)}</option>`)
    .join('');
  picker.value = APP_CONFIG.DEFAULT_STORE || 'KABUKI';
}

function renderAddWorkTimeOptions() {
  const select = document.getElementById('addWorkTime');
  select.innerHTML = WORK_TIME_OPTIONS
    .map(time => `<option value="${escapeHtml(time)}">${time ? escapeHtml(time) : '未設定'}</option>`)
    .join('');
  select.value = '18:00';
}

function bindEvents() {
  document.getElementById('storePicker').addEventListener('change', onSelectionChange);
  document.getElementById('datePicker').addEventListener('change', onSelectionChange);
  document.getElementById('reloadButton').addEventListener('click', reloadCurrentShift);
  document.getElementById('saveRowsButton').addEventListener('click', saveEditRows);
  document.getElementById('addCastButton').addEventListener('click', addCastRow);
  document.getElementById('checkButton').addEventListener('click', checkImages);
  document.getElementById('exportButton').addEventListener('click', exportImage);
  document.getElementById('siftPreviewSelect').addEventListener('change', onPreviewChange);
  document.getElementById('resetFromSourceButton').addEventListener('click', openResetDialog);
  document.getElementById('resetConfirmInput').addEventListener('input', onResetConfirmInput);
  document.getElementById('resetExecuteButton').addEventListener('click', resetFromSource);
  document.getElementById('conflictShowLatestButton').addEventListener('click', showLatestForComparison);
  document.getElementById('conflictReplaceButton').addEventListener('click', replaceWithLatest);
  document.getElementById('conflictCloseButton').addEventListener('click', hideConflict);
  document.getElementById('logoutButton').addEventListener('click', logout);
  document.getElementById('authRetryButton').addEventListener('click', startAuth);

  // 出勤中 / 休み一覧のボタン（イベント委譲・recordId で対象を特定）
  ['activeList', 'absentList'].forEach(id => {
    document.getElementById(id).addEventListener('click', event => {
      const button = event.target.closest('.js-toggle-absent');
      if (!button) return;
      toggleAbsent(button.dataset.recordId, button.dataset.toAbsent === 'true');
    });
  });

  // 編集テーブルの変更を検知（イベント委譲で再描画後も有効）
  document.getElementById('editTableArea').addEventListener('change', event => {
    if (event.target.classList.contains('js-sort-order')) {
      handleSortOrderChange(event.target);
      return;
    }
    if (event.target.classList.contains('js-image-file-id')) {
      const rows = collectEditRows();
      state.current = state.current || {};
      state.current.editRows = rows;
      renderEditTable(rows);
    }
    renderEditableSiftPreview();
    updateSaveState();
  });

  document.getElementById('editTableArea').addEventListener('input', event => {
    if (event.target.classList.contains('js-cast-name')) {
      renderEditableSiftPreview();
      updateSaveState();
    }
  });
}

// ===== 日付一覧（値は YYYY-MM-DD、表示は M月D日(曜)） =====
async function loadDateList() {
  const fallback = getCurrentMonthDateOptionsJst();
  renderDateOptions(fallback);

  const gasUrl = (window.APP_CONFIG && window.APP_CONFIG.GAS_WEB_APP_URL) || '';
  if (!gasUrl) {
    setStatus('日付は日本時間で生成 / GAS未設定', 'warning');
    showAlert('GAS_WEB_APP_URL が未設定のため、日付は日本時間の今月分を表示しています。', 'warning');
    return;
  }

  try {
    setStatus('日付取得中', 'secondary');
    const options = await Api.call('getDateOptions');
    state.datesLoaded = true;
    renderDateOptions(Array.isArray(options) && options.length ? options : fallback);
    const ambiguous = (options || []).filter(o => !o.ok);
    if (ambiguous.length) {
      showAlert(`年を確定できない日付があるため選択できません: ${ambiguous.map(o => o.label).join('、')}`, 'warning');
    }
  } catch (err) {
    if (handleAuthErrorIfAny(err)) return;
    renderDateOptions(fallback);
    showAlert('APIから日付を取得できなかったため、日本時間の今月分を表示しています。' + err.message, 'warning');
    setStatus('日付は日本時間で生成', 'warning');
  }
}

function renderDateOptions(options) {
  const picker = document.getElementById('datePicker');
  picker.innerHTML = '<option value="">日付選択</option>' + options
    .map(o => o.ok
      ? `<option value="${escapeHtml(o.date)}">${escapeHtml(o.label)}</option>`
      : `<option value="" disabled>${escapeHtml(o.label)}（年を確定できません）</option>`)
    .join('');
  picker.value = state.selection.date || '';
}

function getCurrentMonthDateOptionsJst() {
  const nowParts = getJapanDateParts(new Date());
  const year = Number(nowParts.year);
  const month = Number(nowParts.month);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const options = [];

  for (let day = 1; day <= lastDay; day++) {
    const date = new Date(Date.UTC(year, month - 1, day));
    options.push({
      ok: true,
      date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      label: `${month}月${day}日(${weekdays[date.getUTCDay()]})`
    });
  }
  return options;
}

function getJapanDateParts(date) {
  const formatter = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric' });
  return formatter.formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});
}

// ===== 店舗・日付の切り替え =====
function getPickerSelection() {
  return {
    store: document.getElementById('storePicker').value,
    date: document.getElementById('datePicker').value
  };
}

function revertPickers() {
  document.getElementById('storePicker').value = state.selection.store || APP_CONFIG.DEFAULT_STORE || 'KABUKI';
  document.getElementById('datePicker').value = state.selection.date || '';
}

async function onSelectionChange() {
  const next = getPickerSelection();
  if (state.isProcessing || state.authView !== 'signedIn') {   // 未ログイン・再ログイン待ちの間は切り替えない           // 処理中の切り替えは受け付けない（画面と表示データの不一致を防ぐ）
    revertPickers();
    return;
  }
  if (!next.store || !next.date || ShiftState.sameSelection(next, state.selection)) return;

  if (isDirty()) {
    const choice = await askUnsavedChoice();
    if (choice === 'cancel') {
      revertPickers();
      return;
    }
    if (choice === 'save') {
      revertPickers();                // 保存は現在の店舗・日付に対して行う
      const saved = await saveEditRows();
      if (!saved) return;             // 保存失敗時は移動しない
      document.getElementById('storePicker').value = next.store;
      document.getElementById('datePicker').value = next.date;
    }
  }
  await loadShift(next);
}

// 保存データを優先して読み込む。保存データが無い場合のみ初回作成（initializeShift）を行う。
async function loadShift(selection) {
  try {
    setProcessing(true, `${selection.store} / ${selection.date} 読み込み中`);
    hideConflict();
    let data = await Api.call('getSavedShift', selection);
    if (!data.initialized) {
      try {
        setProcessing(true, `${selection.store} / ${selection.date} 初回データ作成中`);
        data = await Api.call('initializeShift', selection, { requestId: Api.newRequestId() });
      } catch (err) {
        if (handleAuthErrorIfAny(err)) throw err;
        const info = ShiftState.classifyError(err);
        if (err.code === 'SIFT_NOT_FOUND') showAlert('SIFT_DATAにこの店舗・日付の投稿がありません。キャストを追加して保存できます。', 'warning');
        else showAlert(`保存データがありません。${info.message}`, 'warning');
      }
    }
    assertDataMatches(data, selection);
    state.selection = { store: selection.store, date: selection.date };
    applyData(data);
    await loadSiftPreview(selection);
    setStatus(`同期 ${data.updatedAt || ''}`, 'success');
    if (bgState.generated && (bgState.generated.store !== selection.store || bgState.generated.date !== selection.date)) clearGeneratedImage();
    ensureBackgroundLoaded(selection.store);   // 背景は店舗ごと（読み込み失敗してもシフト表示は続ける）
  } catch (err) {
    if (!handleAuthErrorIfAny(err)) showAlert(err.message, 'danger');
    setStatus('エラー', 'danger');
    revertPickers();
  } finally {
    setProcessing(false);
  }
}

function assertDataMatches(data, selection) {
  if (!data || data.store !== selection.store || data.date !== selection.date) {
    throw new Error('取得したデータの店舗・日付が選択と一致しません。再読み込みしてください。');
  }
}

async function reloadCurrentShift() {
  const selection = state.selection.store ? state.selection : getPickerSelection();
  if (!selection.store || !selection.date) return;
  if (isDirty() && !window.confirm('未保存の変更を破棄して、保存済みの最新データを読み込みます。よろしいですか？')) return;
  await loadShift(selection);
}

function applyData(data) {
  state.current = data;
  state.pendingSave = null;
  render(data);
  state.savedSignature = ShiftState.rowsSignature(collectEditRows());
  updateSaveState();
}

async function loadSiftPreview(selection) {
  const select = document.getElementById('siftPreviewSelect');
  const body = document.getElementById('siftPreviewBody');
  let posts = [];
  try {
    const data = await Api.call('getSiftPreview', selection);
    posts = data.posts || [];
  } catch (err) {
    posts = [];
  }

  if (!posts.length) {
    select.innerHTML = '<option value="">SIFT_DATAなし</option>';
    select.dataset.posts = '[]';
    body.textContent = '';
    return;
  }

  select.dataset.posts = JSON.stringify(posts);
  select.innerHTML = posts
    .map((post, index) => `<option value="${index}">${escapeHtml(post.label)}</option>`)
    .join('');
  select.value = '0';
  body.textContent = posts[0].text || '';
}

function onPreviewChange() {
  const select = document.getElementById('siftPreviewSelect');
  const posts = JSON.parse(select.dataset.posts || '[]');
  document.getElementById('siftPreviewBody').textContent = (posts[Number(select.value)] || {}).text || '';
}

function render(data) {
  renderWarnings(data.missingImages || []);
  renderEditTable(data.editRows || []);
  renderEditableSiftPreview();
  renderPhotos(data.activeCastList || []);
  renderList('activeList', data.activeCastList || [], true);
  renderList('absentList', data.absentCastList || [], false);
}

// ===== 保存状態 =====
function isDirty() {
  if (!state.current || !state.selection.store) return false;
  return ShiftState.isDirty(collectEditRows(), state.savedSignature);
}

function updateSaveState() {
  const el = document.getElementById('saveState');
  if (!el) return;
  if (!state.current || !state.selection.store) {
    el.className = 'badge text-bg-secondary save-state';
    el.textContent = '未読み込み';
  } else if (!state.current.initialized) {
    el.className = 'badge text-bg-warning save-state';
    el.textContent = isDirty() ? '未保存（保存データなし）' : '保存データなし';
  } else if (isDirty()) {
    el.className = 'badge text-bg-danger save-state';
    el.textContent = `未保存の変更あり（rev ${state.current.revision}）`;
  } else {
    el.className = 'badge text-bg-success save-state';
    el.textContent = `保存済み rev ${state.current.revision}${state.current.savedAt ? ' / ' + state.current.savedAt : ''}`;
  }
  const target = document.getElementById('saveTarget');
  if (target) target.textContent = state.selection.store ? `${state.selection.store} / ${formatDateLabel(state.selection.date)}` : '';
}

function formatDateLabel(iso) {
  if (state.current && state.current.date === iso && state.current.dateLabel) return state.current.dateLabel;
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso || '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return `${Number(m[2])}月${Number(m[3])}日(${['日', '月', '火', '水', '木', '金', '土'][d.getUTCDay()]})`;
}

// 未保存変更がある状態で移動するときの確認（保存して移動 / 保存せず移動 / キャンセル）
function askUnsavedChoice() {
  const modalEl = document.getElementById('unsavedModal');
  if (!modalEl || !window.bootstrap) {
    if (window.confirm('未保存の変更があります。保存してから移動しますか？\n（キャンセルを押すと保存せず移動するか確認します）')) return Promise.resolve('save');
    return Promise.resolve(window.confirm('保存せずに移動しますか？未保存の変更は失われます。') ? 'discard' : 'cancel');
  }
  document.getElementById('unsavedTarget').textContent = `${state.selection.store} / ${formatDateLabel(state.selection.date)}`;
  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  return new Promise(resolve => {
    let choice = 'cancel';
    const onClick = event => {
      const button = event.target.closest('[data-choice]');
      if (!button) return;
      choice = button.dataset.choice;
      modal.hide();
    };
    const onHidden = () => {
      modalEl.removeEventListener('click', onClick);
      modalEl.removeEventListener('hidden.bs.modal', onHidden);
      resolve(choice);
    };
    modalEl.addEventListener('click', onClick);
    modalEl.addEventListener('hidden.bs.modal', onHidden);
    modal.show();
  });
}

// ===== 保存 =====
async function saveEditRows() {
  if (!state.current || !state.selection.store) {
    showAlert('店舗と日付を選択してください。', 'warning');
    return false;
  }
  if (!state.current.initialized) {
    showAlert('この店舗・日付の保存データがまだ作成されていません。再読み込みしてから保存してください。', 'warning');
    return false;
  }
  const selection = Object.assign({}, state.selection);
  const payload = ShiftState.buildSavePayload(selection, state.current.revision, collectEditRows());
  const key = `${selection.store}:${selection.date}:${payload.expectedRevision}:${ShiftState.rowsSignature(payload.rows)}`;
  state.pendingSave = ShiftState.requestIdFor(state.pendingSave, key, Api.newRequestId);

  try {
    setProcessing(true, '編集内容を保存中');
    setSavingBadge();
    const data = await Api.call('saveShift', payload, { requestId: state.pendingSave.requestId });
    assertDataMatches(data, selection);
    applyData(data);
    hideConflict();
    showAlert(`保存しました（${selection.store} / ${formatDateLabel(selection.date)} / ${data.editRows.length}人 / rev ${data.revision}）。`, 'success');
    return true;
  } catch (err) {
    handleWriteError(err);
    return false;
  } finally {
    setProcessing(false);
    updateSaveState();
  }
}

function setSavingBadge() {
  const el = document.getElementById('saveState');
  if (!el) return;
  el.className = 'badge text-bg-info save-state';
  el.textContent = '保存中…';
}

function handleWriteError(err) {
  if (handleAuthErrorIfAny(err)) return;
  const info = ShiftState.classifyError(err);
  if (info.kind === 'conflict') {
    showConflict(info.message);
    return;
  }
  showAlert(info.message, info.kind === 'lock' ? 'warning' : 'danger');
}

// ===== 競合 =====
function showConflict(message) {
  const panel = document.getElementById('conflictPanel');
  document.getElementById('conflictMessage').textContent = message;
  document.getElementById('conflictLatestArea').innerHTML = '';
  document.getElementById('conflictReplaceButton').disabled = true;
  panel.classList.remove('d-none');
  panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function hideConflict() {
  const panel = document.getElementById('conflictPanel');
  if (panel) panel.classList.add('d-none');
  state.conflictLatest = null;
}

// 最新データを別欄に表示（画面上の未保存入力はそのまま残す）
async function showLatestForComparison() {
  try {
    setProcessing(true, '最新データを取得中');
    const latest = await Api.call('getSavedShift', state.selection);
    assertDataMatches(latest, state.selection);
    state.conflictLatest = latest;
    const rows = latest.editRows || [];
    document.getElementById('conflictLatestArea').innerHTML = rows.length ? `
      <div class="small text-secondary mb-1">保存済みの最新データ（rev ${latest.revision}${latest.savedAt ? ' / ' + escapeHtml(latest.savedAt) : ''}）</div>
      <table class="table table-sm mb-0">
        <thead class="table-light"><tr><th>順</th><th>名前</th><th>時間</th><th>状態</th><th>差込画像</th></tr></thead>
        <tbody>${rows.map(r => `<tr class="${r.status === '休み' ? 'text-secondary' : ''}">
          <td>${Number(r.sortOrder)}</td><td>${escapeHtml(r.castName)}</td><td>${escapeHtml(r.workTime || '未設定')}</td>
          <td>${escapeHtml(r.status)}</td><td>${escapeHtml(r.imageName || (r.imageFileId ? '選択あり' : '自動'))}</td></tr>`).join('')}</tbody>
      </table>` : `<div class="text-secondary">最新データ: キャストなし（rev ${latest.revision}）</div>`;
    document.getElementById('conflictReplaceButton').disabled = false;
  } catch (err) {
    if (!handleAuthErrorIfAny(err)) showAlert(err.message, 'danger');
  } finally {
    setProcessing(false);
  }
}

function replaceWithLatest() {
  if (!state.conflictLatest) return;
  if (!window.confirm('画面上の未保存の入力を破棄して、最新データに置き換えます。よろしいですか？')) return;
  applyData(state.conflictLatest);
  hideConflict();
  showAlert('最新データを表示しました。必要な変更を入力し直して保存してください。', 'info');
}

// ===== 元データから初期化（明示操作のみ） =====
function openResetDialog() {
  if (!ShiftState.permissionsFor(state.identity && state.identity.role).canReset) {
    showAlert('元データからの初期化は ADMIN のみ実行できます。', 'warning');
    return;
  }
  if (!state.current || !state.selection.store) {
    showAlert('店舗と日付を選択してください。', 'warning');
    return;
  }
  const key = `${state.selection.store}:${state.selection.date}`;
  document.getElementById('resetTargetStore').textContent = state.selection.store;
  document.getElementById('resetTargetDate').textContent = `${formatDateLabel(state.selection.date)}（${state.selection.date}）`;
  document.getElementById('resetConfirmKey').textContent = key;
  document.getElementById('resetConfirmInput').value = '';
  document.getElementById('resetExecuteButton').disabled = true;
  document.getElementById('resetDirtyNote').classList.toggle('d-none', !isDirty());
  bootstrap.Modal.getOrCreateInstance(document.getElementById('resetModal')).show();
}

function onResetConfirmInput() {
  const key = `${state.selection.store}:${state.selection.date}`;
  document.getElementById('resetExecuteButton').disabled = document.getElementById('resetConfirmInput').value.trim() !== key;
}

async function resetFromSource() {
  const selection = Object.assign({}, state.selection);
  const confirmation = document.getElementById('resetConfirmInput').value.trim();
  bootstrap.Modal.getOrCreateInstance(document.getElementById('resetModal')).hide();
  if (confirmation !== `${selection.store}:${selection.date}`) return;   // キャンセル・不一致では何も送らない

  try {
    setProcessing(true, '元データから初期化中');
    const data = await Api.call('resetShiftFromSource', {
      store: selection.store,
      date: selection.date,
      expectedRevision: state.current.revision,
      confirmation
    }, { requestId: Api.newRequestId() });
    assertDataMatches(data, selection);
    applyData(data);
    await loadSiftPreview(selection);
    showAlert(`${selection.store} / ${formatDateLabel(selection.date)} をSIFT_DATA原本から初期化しました（${data.editRows.length}人 / rev ${data.revision}）。`, 'success');
    setStatus(`初期化 ${data.updatedAt || ''}`, 'success');
  } catch (err) {
    handleWriteError(err);
    setStatus('エラー', 'danger');
  } finally {
    setProcessing(false);
  }
}

// ===== キャスト追加 =====
function addCastRow() {
  if (!state.current || !state.selection.store) {
    showAlert('店舗と日付を選択してください。', 'warning');
    return;
  }
  const nameInput = document.getElementById('addCastName');
  const workTimeInput = document.getElementById('addWorkTime');
  const statusInput = document.getElementById('addStatus');

  const castName = nameInput.value.trim();
  if (!castName) {
    showAlert('追加するキャスト名を入力してください。', 'warning');
    return;
  }

  const rows = collectEditRows();
  rows.push({
    recordId: '',
    sortOrder: rows.length + 1,
    castName,
    workTime: workTimeInput.value,
    status: statusInput.value,
    imageStatus: '未登録',
    imageFileId: ''
  });

  state.current.editRows = rows;
  renderEditTable(rows);
  renderEditableSiftPreview();
  updateSaveState();

  nameInput.value = '';
}


// ==== 編集SIFT_DATA確認（編集テーブルの内容から生成） ====
function renderEditableSiftPreview() {
  const rows = collectEditRows(); // 並び順昇順・空名は除外
  renderEditSiftTable(rows);
  renderEditSiftPost(rows);
}

function renderEditSiftTable(rows) {
  const area = document.getElementById('editSiftTableArea');
  if (!area) return;

  if (!rows.length) {
    area.innerHTML = '<div class="text-secondary text-center py-3">編集データなし</div>';
    return;
  }

  area.innerHTML = `
    <table class="table table-sm align-middle mb-0 edit-sift-table">
      <thead class="table-light">
        <tr>
          <th>時間</th>
          <th>名前</th>
          <th>ID</th>
          <th>状態</th>
          <th>並び順</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(row => {
          const id = CAST_OPTIONS[row.castName] || '';
          const absent = row.status === '休み';
          return `
            <tr class="${absent ? 'table-secondary text-secondary' : ''}">
              <td>${escapeHtml(row.workTime || '未設定')}</td>
              <td class="fw-bold">${escapeHtml(row.castName)}</td>
              <td class="text-secondary">${escapeHtml(id)}</td>
              <td>${escapeHtml(row.status)}</td>
              <td>${Number(row.sortOrder)}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

function renderEditSiftPost(rows) {
  const body = document.getElementById('editSiftPostPreview');
  if (!body) return;

  // 状態=休み は投稿風テキストから除外
  const active = rows.filter(row => row.status !== '休み');
  if (!active.length) {
    body.textContent = '';
    return;
  }

  // 時間ごとにグループ化（並び順はcollectEditRowsで既に昇順）
  const groups = new Map();
  active.forEach(row => {
    const key = row.workTime || '未設定';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });

  const times = [...groups.keys()].sort(compareWorkTime);
  const lines = [];
  times.forEach(time => {
    lines.push(time);
    groups.get(time).forEach(row => {
      const id = CAST_OPTIONS[row.castName] || '';
      lines.push(id ? `${row.castName}　${id}` : row.castName);
    });
  });

  body.textContent = lines.join('\n');
}

// "HH:MM" は昇順、"未設定" は末尾
function compareWorkTime(a, b) {
  if (a === b) return 0;
  if (a === '未設定') return 1;
  if (b === '未設定') return -1;
  return a < b ? -1 : 1;
}

function renderWarnings(names) {
  const area = document.getElementById('alertArea');
  if (!names.length) {
    area.innerHTML = '';
    return;
  }

  area.innerHTML = `<div class="alert alert-warning">画像未登録: ${names.map(escapeHtml).join('、')}</div>`;
}

function renderEditTable(rows) {
  const area = document.getElementById('editTableArea');

  if (!rows.length) {
    area.innerHTML = '<div class="text-secondary text-center py-4">編集データなし</div>';
    return;
  }

  // スマホ（576px未満）はカード表示、PCは従来のテーブル表示
  area.innerHTML = window.innerWidth < 576
    ? renderMobileEditCards(rows)
    : renderDesktopEditTable(rows);
}

function renderDesktopEditTable(rows) {
  return `
    <div class="table-responsive">
      <table class="table table-sm align-middle mb-0 edit-table">
        <thead class="table-light">
          <tr>
            <th style="width:72px;">順</th>
            <th>名前</th>
            <th style="width:110px;">時間</th>
            <th style="width:110px;">状態</th>
            <th style="width:90px;">画像</th>
            <th style="width:200px;">差込画像</th>
            <th style="width:64px;"></th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(row => renderEditRow(row)).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderEditRow(row) {
  return `
    <tr
      data-edit-row
      data-row-id="${Number(row.row || 0)}"
      data-record-id="${escapeHtml(String(row.recordId || ''))}"
      data-image-status="${escapeHtml(String(row.imageStatus || '未登録'))}"
      data-image-file-id="${escapeHtml(String(row.imageFileId || ''))}"
    >
      <td>
        <input class="form-control form-control-sm js-sort-order" type="number" min="1" value="${Number(row.sortOrder || 1)}">
      </td>
      <td>
        ${renderCastNameInput(row.castName || row.name || '')}
      </td>
      <td>
        <select class="form-select form-select-sm js-work-time">
          ${WORK_TIME_OPTIONS.map(time => `
            <option value="${escapeHtml(time)}" ${String(row.workTime || '') === time ? 'selected' : ''}>
              ${time ? escapeHtml(time) : '未設定'}
            </option>
          `).join('')}
        </select>
      </td>
      <td>
        <select class="form-select form-select-sm js-status">
          ${SHIFT_STATUSES.map(status => `
            <option value="${escapeHtml(status)}" ${String(row.status || '出勤') === status ? 'selected' : ''}>
              ${escapeHtml(status)}
            </option>
          `).join('')}
        </select>
      </td>
      <td>
        ${renderImageStatusBadge(row.imageStatus, row.imageSource)}
      </td>
      <td>
        ${renderImageOverrideControl(row, 'form-select-sm')}
      </td>
      <td>
        <button type="button" class="btn btn-sm btn-outline-danger rounded-pill" onclick="removeEditRow(this)">削除</button>
      </td>
    </tr>
  `;
}

function renderMobileEditCards(rows) {
  return `
    <div class="mobile-edit-list">
      ${rows.map(row => renderMobileEditCard(row)).join('')}
    </div>
  `;
}

function renderMobileEditCard(row) {
  const workTimeOptions = WORK_TIME_OPTIONS.map(time => `
    <option value="${escapeHtml(time)}" ${String(row.workTime || '') === time ? 'selected' : ''}>
      ${time ? escapeHtml(time) : '未設定'}
    </option>
  `).join('');

  const statusOptions = SHIFT_STATUSES.map(status => `
    <option value="${escapeHtml(status)}" ${String(row.status || '出勤') === status ? 'selected' : ''}>
      ${escapeHtml(status)}
    </option>
  `).join('');

  return `
    <div
      class="mobile-edit-card"
      data-edit-row
      data-row-id="${Number(row.row || 0)}"
      data-record-id="${escapeHtml(String(row.recordId || ''))}"
      data-image-status="${escapeHtml(String(row.imageStatus || '未登録'))}"
      data-image-file-id="${escapeHtml(String(row.imageFileId || ''))}"
    >
      <div class="mobile-edit-grid">
        <div class="mobile-edit-field mobile-edit-field--name">
          <label>名前</label>
          ${renderCastNameInput(row.castName || row.name || '', '')}
        </div>
        <div class="mobile-edit-field">
          <label>状態</label>
          <select class="form-select js-status">${statusOptions}</select>
        </div>
        <div class="mobile-edit-field">
          <label>時間</label>
          <select class="form-select js-work-time">${workTimeOptions}</select>
        </div>
        <div class="mobile-edit-field">
          <label>並び順</label>
          <input class="form-control js-sort-order" type="number" min="1" value="${Number(row.sortOrder || 1)}">
        </div>
        <div class="mobile-edit-field">
          <label>画像状態</label>
          ${renderImageStatusBadge(row.imageStatus, row.imageSource)}
        </div>
        <div class="mobile-edit-field mobile-edit-field--wide">
          <label>差込画像</label>
          ${renderImageOverrideControl(row, '')}
        </div>
        <div class="mobile-edit-field">
          <label>削除</label>
          <button type="button" class="btn btn-outline-danger" onclick="removeEditRow(this)">削除</button>
        </div>
      </div>
    </div>
  `;
}

function renderImageStatusBadge(status, imageSource) {
  if (imageSource === 'manual') return '<span class="badge text-bg-info">差込</span>';
  const value = String(status || '未登録');
  if (value === '登録済み') return '<span class="badge text-bg-success">登録済み</span>';
  if (value === '準備中') return '<span class="badge text-bg-warning">準備中</span>';
  return '<span class="badge text-bg-secondary">未登録</span>';
}

function renderImageOverrideControl(row, sizeClass) {
  const selectedId = String(row.imageFileId || '');
  const selectedOption = findImageOption(selectedId);
  const thumb = selectedOption ? `<img class="manual-image-thumb" src="${escapeHtml(selectedOption.imageUrl)}" alt="">` : '';

  return `
    <div class="manual-image-control">
      ${thumb}
      <select class="form-select ${sizeClass} js-image-file-id">
        ${buildImageOptionTags(selectedId)}
      </select>
    </div>
  `;
}

function buildImageOptionTags(selectedId) {
  const imageOptions = getImageOptions();
  let html = `<option value="" ${selectedId ? '' : 'selected'}>自動</option>`;

  if (selectedId && !imageOptions.some(option => option.fileId === selectedId)) {
    html += `<option value="${escapeHtml(selectedId)}" selected>選択中の画像</option>`;
  }

  html += imageOptions.map(option => `
    <option value="${escapeHtml(option.fileId)}" ${option.fileId === selectedId ? 'selected' : ''}>
      ${escapeHtml(option.name)}
    </option>
  `).join('');

  return html;
}

function getImageOptions() {
  return (state.current && Array.isArray(state.current.imageOptions)) ? state.current.imageOptions : [];
}

function findImageOption(fileId) {
  const target = String(fileId || '');
  if (!target) return null;
  return getImageOptions().find(option => option.fileId === target) || null;
}

function removeEditRow(button) {
  const row = button.closest('[data-edit-row]');
  if (row) row.remove();
  renderEditableSiftPreview();
  updateSaveState();
}

function collectEditRows() {
  const rows = [];
  // table・mobile card 両方の行を対象にする
  document.querySelectorAll('#editTableArea [data-edit-row]').forEach((el, index) => {
    const nameEl = el.querySelector('.js-cast-name');
    if (!nameEl) return;
    const imageFileId = getImageFileIdFromRow(el);
    rows.push({
      recordId: String(el.dataset.recordId || ''),
      sortOrder: Number(el.querySelector('.js-sort-order').value) || index + 1,
      castName: nameEl.value.trim(),
      workTime: el.querySelector('.js-work-time').value,
      status: el.querySelector('.js-status').value,
      imageStatus: imageFileId ? '登録済み' : (el.dataset.imageStatus || '未登録'),
      imageFileId,
      imageSource: imageFileId ? 'manual' : 'auto'
    });
  });

  return rows
    .filter(row => row.castName)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

// DOM表示順のまま全行を読む（フィルタ・ソートしない：並び替え計算用）
function readEditRowsInDomOrder() {
  const rows = [];
  document.querySelectorAll('#editTableArea [data-edit-row]').forEach(el => {
    const nameEl = el.querySelector('.js-cast-name');
    const imageFileId = getImageFileIdFromRow(el);
    rows.push({
      el,
      recordId: String(el.dataset.recordId || ''),
      row: Number(el.dataset.rowId || 0),
      sortOrder: Number(el.querySelector('.js-sort-order').value) || 0,
      castName: nameEl ? nameEl.value.trim() : '',
      workTime: el.querySelector('.js-work-time').value,
      status: el.querySelector('.js-status').value,
      imageStatus: imageFileId ? '登録済み' : (el.dataset.imageStatus || '未登録'),
      imageFileId,
      imageSource: imageFileId ? 'manual' : 'auto'
    });
  });
  return rows;
}

function getImageFileIdFromRow(el) {
  const select = el.querySelector('.js-image-file-id');
  return select ? select.value.trim() : String(el.dataset.imageFileId || '').trim();
}

// 並び順inputの変更で対象を指定位置へ移動し、全体を1..nに正規化して再描画
function handleSortOrderChange(target) {
  const changedEl = target.closest('[data-edit-row]');
  if (!changedEl) return;

  const items = readEditRowsInDomOrder();
  const total = items.length;
  if (!total) return;

  const fromIndex = items.findIndex(item => item.el === changedEl);
  if (fromIndex < 0) return;

  let newPos = Math.round(Number(target.value)) || 1;
  newPos = Math.min(Math.max(newPos, 1), total); // 1..n にクランプ

  const [moved] = items.splice(fromIndex, 1);
  items.splice(newPos - 1, 0, moved);

  const normalized = items.map((item, index) => ({
    recordId: item.recordId,
    row: item.row,
    sortOrder: index + 1, // 必ず1から連番に正規化
    castName: item.castName,
    workTime: item.workTime,
    status: item.status,
    imageStatus: item.imageStatus,
    imageFileId: item.imageFileId,
    imageSource: item.imageSource
  }));

  state.current = state.current || {};
  state.current.editRows = normalized;
  renderEditTable(normalized);
  renderEditableSiftPreview();
  updateSaveState();
}

function renderPhotos(list) {
  const grid = document.getElementById('photoGrid');

  if (!list.length) {
    grid.innerHTML = '<div class="text-secondary text-center py-4">画像なし</div>';
    return;
  }

  grid.innerHTML = list.map(c => `
    <article class="photo-card shadow-sm">
      ${c.imageUrl
        ? `<img src="${escapeHtml(c.imageUrl)}" alt="${escapeHtml(c.name)}" loading="lazy">`
        : `<div class="photo-placeholder"><span>${escapeHtml(c.name)}</span></div>`}
      ${c.usedPreparing ? '<span class="badge text-bg-warning">準備中</span>' : ''}
    </article>
  `).join('');
}

function renderList(id, list, active) {
  const target = document.getElementById(id);

  if (!list.length) {
    target.innerHTML = '<div class="list-group-item text-secondary">対象なし</div>';
    return;
  }

  target.innerHTML = list.map(c => `
    <div class="list-group-item d-flex justify-content-between align-items-center gap-2">
      <span class="fw-bold ${active ? '' : 'text-decoration-line-through text-secondary'}">
        ${escapeHtml(c.name)}
        ${c.workTime ? `<span class="badge text-bg-light border ms-1">${escapeHtml(c.workTime)}</span>` : ''}
      </span>
      <button type="button" class="btn btn-sm ${active ? 'btn-outline-secondary' : 'btn-primary'} rounded-pill js-toggle-absent"
        data-record-id="${escapeHtml(String(c.recordId || ''))}" data-to-absent="${active ? 'true' : 'false'}" ${c.recordId ? '' : 'disabled'}>
        ${active ? '休み' : '戻す'}
      </button>
    </div>
  `).join('');
}

// 休み切り替え
// - 未保存の変更がある場合: サーバーに送らず画面上だけ変更（他の未保存入力を失わない）。「編集保存」で確定。
// - 未保存の変更がない場合: その1件だけを即時保存（revision 検証あり）。
async function toggleAbsent(recordId, toAbsent) {
  if (!recordId || !state.current) return;

  if (isDirty()) {
    const rows = ShiftState.applyStatusLocally(collectEditRows(), recordId, toAbsent);
    state.current.editRows = rows;
    renderEditTable(rows);
    renderEditableSiftPreview();
    renderListsFromRows(rows);
    updateSaveState();
    showAlert('未保存の変更があるため、画面上で休み設定を変更しました。「編集保存」で確定してください。', 'info');
    return;
  }

  const selection = Object.assign({}, state.selection);
  try {
    setProcessing(true, '更新中');
    const data = await Api.call('setCastAbsent', {
      store: selection.store,
      date: selection.date,
      recordId,
      isAbsent: toAbsent,
      expectedRevision: state.current.revision
    }, { requestId: Api.newRequestId() });
    assertDataMatches(data, selection);
    applyData(data);
  } catch (err) {
    handleWriteError(err);
  } finally {
    setProcessing(false);
  }
}

// 画面上の編集行から出勤中 / 休み一覧を再描画（画像URLは最後に読み込んだデータを流用）
function renderListsFromRows(rows) {
  const known = {};
  [].concat((state.current && state.current.activeCastList) || [], (state.current && state.current.absentCastList) || [])
    .forEach(item => { if (item.recordId) known[item.recordId] = item; });
  const view = rows.map(r => Object.assign({}, known[r.recordId] || {}, {
    recordId: r.recordId, name: r.castName, castName: r.castName, workTime: r.workTime, status: r.status
  }));
  renderList('activeList', view.filter(v => v.status !== '休み'), true);
  renderList('absentList', view.filter(v => v.status === '休み'), false);
}

async function checkImages() {
  if (!state.selection.store) {
    showAlert('店舗と日付を選択してください。', 'warning');
    return;
  }
  try {
    setProcessing(true, '画像確認中');
    const result = await Api.call('checkImages', { store: state.selection.store, date: state.selection.date }, { requestId: Api.newRequestId() });
    showAlert(
      result.missingCount ? `画像未登録: ${result.missingNames.join('、')}` : '画像未登録はありません。',
      result.missingCount ? 'warning' : 'success'
    );
  } catch (err) {
    handleWriteError(err);
  } finally {
    setProcessing(false);
  }
}


async function exportImage() {
  try {
    setProcessing(true, '画像出力中');
    const target = document.getElementById('captureArea');
    await waitForImages(target);

    const canvas = await html2canvas(target, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true
    });

    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = state.selection.store && state.selection.date
      ? `shift-image_${state.selection.store}_${state.selection.date}.png`
      : 'shift-image.png';
    a.click();
  } catch (err) {
    showAlert(err.message, 'danger');
  } finally {
    setProcessing(false);
  }
}

function waitForImages(target) {
  const images = Array.from(target.querySelectorAll('img'));
  return Promise.all(images.map(waitForImage));
}

function waitForImage(image) {
  if (image.complete && image.naturalWidth > 0) {
    return image.decode ? image.decode().catch(() => undefined) : Promise.resolve();
  }

  return new Promise(resolve => {
    const done = () => {
      image.removeEventListener('load', done);
      image.removeEventListener('error', done);
      resolve();
    };

    image.addEventListener('load', done);
    image.addEventListener('error', done);
    setTimeout(done, 8000);
  });
}

function setProcessing(value, text = '処理中') {
  state.isProcessing = value;
  document.getElementById('loading').classList.toggle('d-none', !value);
  document.getElementById('loadingText').textContent = text;
}

function setStatus(text, type) {
  const el = document.getElementById('appStatus');
  el.textContent = text;
  el.className = `badge text-bg-${type}`;
}

function showAlert(message, type) {
  document.getElementById('alertArea').innerHTML = `
    <div class="alert alert-${type} alert-dismissible fade show">
      <span>${escapeHtml(message)}</span>
      <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    </div>
  `;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, s => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#039;',
    '"': '&quot;'
  }[s]));
}

// ===== 背景画像・出勤キャスト画像の生成（1447 × 2048 px 固定・人数で自動配置） =====
// - 背景は店舗ごと。差し替え・設定変更はシフトデータに影響しない（別シート・別 API）
// - 画像は data URL で受け取り Canvas に描く（Drive の URL を直接描くと Canvas が汚染され PNG 保存できない）
// - 生成は「保存済み」のシフトを使う（未保存の変更がある場合は保存を促す）
const bgState = {
  store: '',
  view: null,          // サーバーの背景設定（revision / settings / configured ...）
  image: null,         // 表示中の背景（HTMLImageElement）
  pending: null,       // 未保存の新しい背景 { dataBase64, mimeType, fileName, image }
  generated: null,     // 最後に生成した { store, date, count }
  loading: false
};
const BG_MAX_BYTES = 8 * 1024 * 1024;

// 接続先の GAS が背景機能より古い（UNKNOWN_ACTION）場合は、原因が分かるメッセージにする
function backgroundErrorMessage(err) {
  if (err && err.code === 'UNKNOWN_ACTION') {
    return '接続先の GAS が背景画像機能に対応していません（GAS の新しいバージョンのデプロイが必要です）';
  }
  return err && err.message ? err.message : String(err);
}

function bindBackgroundEvents() {
  document.getElementById('bgFileInput').addEventListener('change', onBackgroundFileSelected);
  document.getElementById('bgSaveButton').addEventListener('click', saveBackgroundSettings);
  document.getElementById('bgRevertButton').addEventListener('click', revertBackgroundChanges);
  document.getElementById('bgClearButton').addEventListener('click', clearBackgroundImage);
  document.getElementById('generateButton').addEventListener('click', generateShiftImage);
  document.getElementById('pngSaveButton').addEventListener('click', saveGeneratedPng);
  document.getElementById('bgFillColor').addEventListener('input', () => { document.getElementById('bgFillAuto').checked = false; onBackgroundSettingsInput(); });
  document.getElementById('bgFillAuto').addEventListener('change', onBackgroundSettingsInput);
  document.querySelectorAll('.js-bg-area').forEach(el => el.addEventListener('input', onBackgroundSettingsInput));
}
window.addEventListener('DOMContentLoaded', () => { bindBackgroundEvents(); resetBackgroundUi(); });

function readBackgroundSettingsFromForm() {
  const num = id => Number(document.getElementById(id).value);
  return {
    fillColor: document.getElementById('bgFillAuto').checked ? '' : document.getElementById('bgFillColor').value.toLowerCase(),
    area: { top: num('bgAreaTop'), bottom: num('bgAreaBottom'), left: num('bgAreaLeft'), right: num('bgAreaRight') }
  };
}

function writeBackgroundSettingsToForm(settings) {
  const s = settings || { fillColor: '', area: ImageGenerator.DEFAULT_AREA };
  document.getElementById('bgFillAuto').checked = !s.fillColor;
  document.getElementById('bgFillColor').value = s.fillColor || '#ffffff';
  document.getElementById('bgAreaTop').value = s.area.top;
  document.getElementById('bgAreaBottom').value = s.area.bottom;
  document.getElementById('bgAreaLeft').value = s.area.left;
  document.getElementById('bgAreaRight').value = s.area.right;
}

function backgroundSettingsChanged() {
  if (!bgState.view) return false;
  const a = readBackgroundSettingsFromForm();
  const b = bgState.view.settings;
  return a.fillColor !== (b.fillColor || '') || ['top', 'bottom', 'left', 'right'].some(k => a.area[k] !== b.area[k]);
}

function validateBackgroundSettings(settings) {
  const a = settings.area;
  if (['top', 'bottom', 'left', 'right'].some(k => !Number.isInteger(a[k]) || a[k] < 0)) return '配置領域は 0 以上の整数で入力してください。';
  if (ImageGenerator.CANVAS.width - a.left - a.right < 400 || ImageGenerator.CANVAS.height - a.top - a.bottom < 400) {
    return '配置領域が狭すぎます（幅・高さ 400px 以上にしてください）。';
  }
  return '';
}

function updateBackgroundButtons() {
  const dirty = !!bgState.pending || backgroundSettingsChanged();
  const ready = !!bgState.view && !bgState.loading;
  document.getElementById('bgSaveButton').disabled = !ready || !dirty;
  document.getElementById('bgRevertButton').disabled = !ready || !dirty;
  const perms = ShiftState.permissionsFor(state.identity && state.identity.role);
  const clearBtn = document.getElementById('bgClearButton');
  clearBtn.disabled = !ready || !perms.canReset || !(bgState.view && bgState.view.configured);
  clearBtn.classList.toggle('d-none', !perms.canReset);
}

function resetBackgroundUi() {
  Object.assign(bgState, { store: '', view: null, image: null, pending: null, generated: null, loading: false });
  document.getElementById('bgStoreLabel').textContent = '';
  document.getElementById('bgStatus').textContent = '店舗と日付を選択してください';
  document.getElementById('bgFileInput').value = '';
  writeBackgroundSettingsToForm(null);
  drawBackgroundPreview();
  clearGeneratedImage();
  updateBackgroundButtons();
}

async function ensureBackgroundLoaded(store, force) {
  if (!store || (!force && bgState.store === store && bgState.view)) return;
  bgState.loading = true;
  bgState.store = store;
  bgState.pending = null;
  document.getElementById('bgStoreLabel').textContent = store;
  document.getElementById('bgStatus').textContent = '背景を読み込み中…';
  document.getElementById('bgFileInput').value = '';
  clearGeneratedImage();
  updateBackgroundButtons();
  try {
    const view = await Api.background.get(store);
    if (bgState.store !== store) return;   // 読み込み中に店舗が切り替わった
    bgState.view = view;
    bgState.image = view.dataUrl ? await ImageGenerator.loadImage(view.dataUrl) : null;
    writeBackgroundSettingsToForm(view.settings);
    document.getElementById('bgStatus').textContent = describeBackground(view);
  } catch (err) {
    if (bgState.store !== store) return;
    bgState.view = null;
    bgState.image = null;
    if (!handleAuthErrorIfAny(err)) document.getElementById('bgStatus').textContent = '背景を読み込めませんでした: ' + backgroundErrorMessage(err);
  } finally {
    if (bgState.store === store) bgState.loading = false;
    drawBackgroundPreview();
    updateBackgroundButtons();
  }
}

function describeBackground(view) {
  if (!view || !view.configured) return '背景は未登録です（白い背景で生成します）。';
  return `登録済み: ${view.width} × ${view.height} px（${view.mimeType === 'image/png' ? 'PNG' : 'JPEG'}）${view.updatedAt ? ' / 更新 ' + view.updatedAt : ''}`;
}

async function onBackgroundFileSelected(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const fail = message => { event.target.value = ''; showAlert(message, 'warning'); };
  if (!bgState.view) return fail('先に店舗と日付を選択してください。');
  if (['image/png', 'image/jpeg'].indexOf(file.type) === -1) return fail('背景画像は PNG または JPEG を選択してください。');
  if (file.size > BG_MAX_BYTES) return fail('背景画像は 8MB 以下にしてください。');
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('ファイルを読み込めませんでした'));
      reader.readAsDataURL(file);
    });
    const image = await ImageGenerator.loadImage(dataUrl);
    const w = image.naturalWidth, h = image.naturalHeight;
    if (Math.min(w, h) < 200 || Math.max(w, h) > 8000) return fail('背景画像の大きさは 200〜8000px にしてください。');
    bgState.pending = { dataBase64: dataUrl.split(',')[1], mimeType: file.type, fileName: file.name, image };
    document.getElementById('bgStatus').textContent = `未保存の背景: ${file.name}（${w} × ${h} px）`;
    drawBackgroundPreview();
    updateBackgroundButtons();
  } catch (err) {
    fail(err.message);
  }
}

function onBackgroundSettingsInput() {
  drawBackgroundPreview();
  updateBackgroundButtons();
}

function revertBackgroundChanges() {
  bgState.pending = null;
  document.getElementById('bgFileInput').value = '';
  writeBackgroundSettingsToForm(bgState.view && bgState.view.settings);
  document.getElementById('bgStatus').textContent = describeBackground(bgState.view);
  drawBackgroundPreview();
  updateBackgroundButtons();
}

// 背景プレビュー（縮小）。背景は切り抜かずに全体を収め、配置領域を破線で表示
function drawBackgroundPreview() {
  const canvas = document.getElementById('bgPreviewCanvas');
  const ctx = canvas.getContext('2d');
  const scale = canvas.width / ImageGenerator.CANVAS.width;
  const image = bgState.pending ? bgState.pending.image : bgState.image;
  const settings = readBackgroundSettingsFromForm();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = settings.fillColor || (image ? ImageGenerator.sampleEdgeColor(image) : '#ffffff');
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (image) {
    const f = ImageGenerator.fitBackground(image.naturalWidth, image.naturalHeight);
    ctx.drawImage(image, f.x * scale, f.y * scale, f.w * scale, f.h * scale);
  }
  if (!validateBackgroundSettings(settings)) {
    const a = settings.area;
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#0d6efd';
    ctx.lineWidth = 2;
    ctx.strokeRect(a.left * scale, a.top * scale, (ImageGenerator.CANVAS.width - a.left - a.right) * scale, (ImageGenerator.CANVAS.height - a.top - a.bottom) * scale);
    ctx.restore();
  }
}

async function saveBackgroundSettings() {
  if (!bgState.view || state.isProcessing) return;
  const settings = readBackgroundSettingsFromForm();
  const invalid = validateBackgroundSettings(settings);
  if (invalid) { showAlert(invalid, 'warning'); return; }
  const store = bgState.store;
  const image = bgState.pending ? { dataBase64: bgState.pending.dataBase64, mimeType: bgState.pending.mimeType, fileName: bgState.pending.fileName } : null;
  try {
    setProcessing(true, image ? '背景画像を保存中' : '背景設定を保存中');
    const view = await Api.background.save(store, bgState.view.revision, image, settings);
    if (bgState.store !== store) return;
    if (bgState.pending) bgState.image = bgState.pending.image;
    bgState.pending = null;
    bgState.view = view;
    document.getElementById('bgFileInput').value = '';
    writeBackgroundSettingsToForm(view.settings);
    document.getElementById('bgStatus').textContent = describeBackground(view);
    clearGeneratedImage();
    showAlert(`${store} の背景を保存しました（シフトデータは変更していません）。`, 'success');
  } catch (err) {
    if (handleAuthErrorIfAny(err)) return;
    if (err.code === 'REVISION_CONFLICT') {
      showAlert('他の端末で背景が更新されています。最新の背景を読み込みました。必要なら選択し直して保存してください。', 'warning');
      await ensureBackgroundLoaded(store, true);
    } else {
      showAlert('背景を保存できませんでした: ' + backgroundErrorMessage(err), 'danger');
    }
  } finally {
    setProcessing(false);
    drawBackgroundPreview();
    updateBackgroundButtons();
  }
}

async function clearBackgroundImage() {
  if (!bgState.view || !bgState.view.configured) return;
  if (!window.confirm(`${bgState.store} の背景の登録を解除します（Drive のファイルは削除しません）。よろしいですか？`)) return;
  const store = bgState.store;
  try {
    setProcessing(true, '背景を解除中');
    const view = await Api.background.clear(store, bgState.view.revision);
    if (bgState.store !== store) return;
    Object.assign(bgState, { view, image: null, pending: null });
    writeBackgroundSettingsToForm(view.settings);
    document.getElementById('bgStatus').textContent = describeBackground(view);
    clearGeneratedImage();
  } catch (err) {
    if (handleAuthErrorIfAny(err)) return;
    if (err.code === 'REVISION_CONFLICT') await ensureBackgroundLoaded(store, true);
    showAlert('背景を解除できませんでした: ' + backgroundErrorMessage(err), 'danger');
  } finally {
    setProcessing(false);
    drawBackgroundPreview();
    updateBackgroundButtons();
  }
}

function clearGeneratedImage() {
  bgState.generated = null;
  const canvas = document.getElementById('generatedCanvas');
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  canvas.classList.add('is-empty');
  document.getElementById('pngSaveButton').disabled = true;
  document.getElementById('generateInfo').textContent = '';
  const errorEl = document.getElementById('generateError');
  errorEl.textContent = '';
  errorEl.classList.add('d-none');
}

async function generateShiftImage() {
  if (manualModeActive()) { ManualMode.openConfirm(); return; }   // 手動モード: 入力内容を確認してから生成
  const selection = Object.assign({}, state.selection);
  if (!selection.store || !selection.date || !state.current) { showAlert('店舗と日付を選択してください。', 'warning'); return; }
  if (isDirty()) { showAlert('未保存の変更があります。「編集保存」してから画像を生成してください（画像は保存済みのシフトから作ります）。', 'warning'); return; }
  if (bgState.store !== selection.store || !bgState.view) await ensureBackgroundLoaded(selection.store, true);
  if (bgState.pending || backgroundSettingsChanged()) {
    showAlert('背景の変更が保存されていません。現在の画面の背景・設定で生成します（保存するまで他の端末には反映されません）。', 'info');
  }
  clearGeneratedImage();
  const errorEl = document.getElementById('generateError');
  try {
    setProcessing(true, '写真を取得中');
    const data = await Api.background.castPhotos(selection.store, selection.date);
    if (data.store !== selection.store || data.date !== selection.date) throw new Error('取得したデータの店舗・日付が選択と一致しません。');
    if (data.revision !== state.current.revision) {
      throw new Error('シフトが他の端末で更新されています。「再読み込み」してから生成してください。');
    }
    setProcessing(true, '画像を生成中');
    const images = {};
    await Promise.all(Object.keys(data.photos || {}).map(async id => {
      try { images[id] = await ImageGenerator.loadImage(data.photos[id]); } catch (err) { images[id] = null; }
    }));
    const casts = data.casts.map(c => ({ name: c.name, image: (c.fileId && images[c.fileId]) || null }));
    const settings = readBackgroundSettingsFromForm();
    const invalid = validateBackgroundSettings(settings);
    if (invalid) throw Object.assign(new Error(invalid), { code: 'INVALID_AREA' });
    const canvas = document.getElementById('generatedCanvas');
    ImageGenerator.render(canvas, {
      background: bgState.pending ? bgState.pending.image : bgState.image,
      fillColor: settings.fillColor,
      area: settings.area,
      casts
    });
    canvas.classList.remove('is-empty');
    const noPhoto = casts.filter(c => !c.image).length;
    bgState.generated = { store: selection.store, date: selection.date, count: casts.length };
    document.getElementById('generateInfo').textContent =
      `${canvas.width} × ${canvas.height} px / 出勤 ${casts.length}人${noPhoto ? `（写真なし ${noPhoto}人）` : ''}${(bgState.pending ? bgState.pending.image : bgState.image) ? '' : ' / 背景未登録'}`;
    document.getElementById('pngSaveButton').disabled = false;
  } catch (err) {
    if (handleAuthErrorIfAny(err)) return;
    clearGeneratedImage();
    errorEl.textContent = '画像を生成できませんでした: ' + backgroundErrorMessage(err);
    errorEl.classList.remove('d-none');
  } finally {
    setProcessing(false);
  }
}

async function saveGeneratedPng() {
  if (!bgState.generated) return;
  try {
    const canvas = document.getElementById('generatedCanvas');
    const blob = await ImageGenerator.toPngBlob(canvas);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shift_${bgState.generated.store}_${bgState.generated.date}_${canvas.width}x${canvas.height}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (err) {
    showAlert('PNG を保存できませんでした: ' + err.message, 'danger');
  }
}
