/**
 * 手動モード（キャスト名を手入力して画像を作る）
 *
 * - SIFT_DATA からシフトを取得しない。店舗（歌舞伎 / 秋葉原）と対象日を選び、キャスト名を入力する。
 * - 入力内容は「手動シフト」シートに店舗×日付ごとに保存（revision で競合検知）。自動モードのデータには触れない。
 * - 写真は castId（登録キャスト c_xxx / 画像フォルダ drive:<fileId>）で紐付ける。
 *     名前の候補が1件ならそのまま紐付け、同名が複数いる場合は画面で選ぶまで決めない。
 * - 背景（店舗別）・画像生成（1447 × 2048 px）・PNG 保存は既存の処理（app.js の背景セクション / ImageGenerator）を使う。
 *
 * ManualState: DOM に依存しない純粋な処理（Node のテストから読み込む）
 * ManualMode : 画面の処理（ブラウザのみ）
 */
(function (root) {
  const MAX_CASTS = 40;
  const MAX_NAME_LENGTH = 30;
  const STORE_LABELS = { KABUKI: '歌舞伎', AKIBA: '秋葉原' };

  let seq = 0;
  const newKey = () => 'm' + Date.now().toString(36) + '-' + (seq++);

  const ManualState = {
    MAX_CASTS,
    MAX_NAME_LENGTH,
    STORE_LABELS,

    cleanName(value) {
      return String(value === undefined || value === null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, '').trim();
    },

    // まとめて入力: 改行・読点・カンマ区切り。空行は無視。並び順は入力順のまま（重複も削らない）
    parseBulkNames(text) {
      return String(text || '')
        .split(/[\r\n、,，]+/)
        .map(s => this.cleanName(s))
        .filter(Boolean);
    },

    newRow(castName) {
      return { key: newKey(), castName: this.cleanName(castName), castId: '', imageFileId: '', castRevision: 0, status: 'checking', candidates: [] };
    },

    fromServer(rows) {
      return (rows || []).map(r => Object.assign(this.newRow(r.castName), { castId: r.castId || '', imageFileId: r.imageFileId || '' }));
    },

    move(rows, index, delta) {
      const to = index + delta;
      if (index < 0 || index >= rows.length || to < 0 || to >= rows.length) return rows.slice();
      const copy = rows.slice();
      const [item] = copy.splice(index, 1);
      copy.splice(to, 0, item);
      return copy;
    },

    remove(rows, index) {
      return rows.filter((_, i) => i !== index);
    },

    // 保存対象（名前・castId・並び順）だけの署名。写真の状態などは含めない
    signature(rows) {
      return JSON.stringify((rows || []).map(r => [this.cleanName(r.castName), r.castId || '']));
    },

    toPayload(rows) {
      return rows.map(r => ({ castName: this.cleanName(r.castName), castId: r.castId || '' }));
    },

    /**
     * 名前の検索結果（候補）を行に反映する
     *  - castId があり候補に含まれる → その写真（registered / 写真なしなら missing）
     *  - castId が候補に無い（名前を変えた・登録が消えた）→ castId を外して下の規則
     *  - 候補 1 件 → 自動で紐付け / 2 件以上 → ambiguous（選ぶまで写真を使わない）/ 0 件 → missing
     */
    applyCandidates(row, candidates) {
      const list = Array.isArray(candidates) ? candidates : [];
      const next = Object.assign({}, row, { candidates: list });
      let linked = next.castId ? list.find(c => c.castId === next.castId) : null;
      if (!linked && list.length === 1) linked = list[0];
      if (linked) {
        return Object.assign(next, { castId: linked.castId, imageFileId: linked.imageFileId || '', castRevision: linked.revision || 0,
          photoSource: linked.source || '', status: linked.imageFileId ? 'registered' : 'missing' });
      }
      return Object.assign(next, { castId: '', imageFileId: '', castRevision: 0, photoSource: '', status: list.length > 1 ? 'ambiguous' : 'missing' });
    },

    selectCandidate(row, castId) {
      const c = (row.candidates || []).find(x => x.castId === castId);
      if (!c) return Object.assign({}, row, { castId: '', imageFileId: '', castRevision: 0, status: (row.candidates || []).length > 1 ? 'ambiguous' : 'missing' });
      return Object.assign({}, row, { castId: c.castId, imageFileId: c.imageFileId || '', castRevision: c.revision || 0,
        photoSource: c.source || '', status: c.imageFileId ? 'registered' : 'missing' });
    },

    // 保存前の検証。errors があれば保存しない
    validateForSave(rows) {
      const errors = [];
      if (rows.length > MAX_CASTS) errors.push(`キャストは ${MAX_CASTS} 人までです（現在 ${rows.length} 人）。`);
      rows.forEach((r, i) => {
        const name = this.cleanName(r.castName);
        if (!name) errors.push(`${i + 1}行目: キャスト名を入力してください。`);
        else if (name.length > MAX_NAME_LENGTH) errors.push(`${i + 1}行目: キャスト名は ${MAX_NAME_LENGTH} 文字以内にしてください。`);
      });
      return errors;
    },

    // 生成前の確認内容。errors があれば生成しない（同名で写真が決まっていない・検索中）
    summarize(rows) {
      const errors = this.validateForSave(rows);
      if (!rows.length) errors.push('キャストを1人以上入力してください。');
      rows.forEach((r, i) => {
        if (r.status === 'ambiguous') errors.push(`${i + 1}行目「${this.cleanName(r.castName)}」: 同じ名前のキャストが複数います。写真を選んでください。`);
        if (r.status === 'checking') errors.push(`${i + 1}行目「${this.cleanName(r.castName)}」: 写真を確認中です。少し待ってから実行してください。`);
      });
      const missing = rows.filter(r => r.status === 'missing' || r.status === 'photo_error' || r.status === 'error' || (r.status === 'registered' && !r.imageFileId));
      return { count: rows.length, missingCount: missing.length, missingNames: missing.map(r => this.cleanName(r.castName)), errors };
    },

    // 写真の取得に失敗したファイルの行は「取得失敗」（写真なしのカードで生成できる）
    markPhotoFailures(rows, failedIds) {
      const failed = (failedIds || []).map(f => (typeof f === 'string' ? f : f.fileId));
      return rows.map(r => (r.status === 'registered' && r.imageFileId && failed.indexOf(r.imageFileId) !== -1
        ? Object.assign({}, r, { status: 'photo_error' }) : r));
    },

    storeLabel(store) {
      return STORE_LABELS[store] || store || '';
    }
  };

  root.ManualState = ManualState;
  if (typeof module === 'object' && module.exports) module.exports = { ManualState };
})(typeof window !== 'undefined' ? window : globalThis);

// ===== 画面（ブラウザのみ） =====
const ManualMode = (() => {
  if (typeof document === 'undefined') return null;
  const S = window.ManualState;

  const m = {
    mode: 'manual',          // 'manual' | 'auto'
    store: '',
    date: '',
    revision: 0,
    loaded: false,           // store / date の保存データを読み込んだか
    rows: [],
    savedSignature: S.signature([]),
    photoCache: {},          // fileId → data URL
    photoTarget: null,       // 写真登録の対象行 key
    lookupSeq: 0,
    busy: false
  };

  const $ = id => document.getElementById(id);

  function todayJst() {
    const parts = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date()).reduce((a, p) => { a[p.type] = p.value; return a; }, {});
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function isDirty() {
    return m.loaded && S.signature(m.rows) !== m.savedSignature;
  }

  function isManual() {
    return m.mode === 'manual';
  }

  // ===== モード切替（自動モードは削除せず、画面を切り替えるだけ） =====
  function setMode(mode) {
    m.mode = mode === 'auto' ? 'auto' : 'manual';
    $('modeManual').checked = isManual();
    $('modeAuto').checked = !isManual();
    $('manualModeArea').classList.toggle('d-none', !isManual());
    document.querySelectorAll('.js-auto-only').forEach(el => el.classList.toggle('d-none', isManual()));
    $('bgModeLabel').textContent = isManual() ? '手動入力' : '自動取得';
    clearGeneratedImage();
    if (state.authView !== 'signedIn' && state.authView !== 'expired') return;
    if (isManual()) {
      if (m.store) ensureBackgroundLoaded(m.store);
    } else {
      if (!state.datesLoaded) loadDateList();
      if (state.selection.store) ensureBackgroundLoaded(state.selection.store);
      else resetBackgroundUi();
    }
  }

  // ===== ログイン・ログアウト =====
  function onSignedIn() {
    if (!m.date) m.date = todayJst();
    $('manualDate').value = m.date;
    if (!m.store) selectStore(APP_CONFIG.DEFAULT_STORE || 'KABUKI', { force: true });
    else if (isManual()) ensureBackgroundLoaded(m.store);
  }

  function reset() {
    Object.assign(m, { store: '', revision: 0, loaded: false, rows: [], savedSignature: S.signature([]), photoCache: {}, photoTarget: null, busy: false });
    m.lookupSeq += 1;
    renderStoreButtons();
    render();
  }

  // ===== 店舗・日付 =====
  async function selectStore(store, options) {
    const opts = options || {};
    if (!opts.force && store === m.store) return;
    if (m.busy || state.isProcessing) return;
    if (isDirty() && !window.confirm(`${S.storeLabel(m.store)} / ${m.date} の編集内容が保存されていません。破棄して切り替えますか？`)) return;
    m.store = store;
    renderStoreButtons();
    if (isManual()) ensureBackgroundLoaded(store);   // 店舗を変えたら背景も自動で切り替える
    await load();
  }

  async function onDateChange() {
    const next = $('manualDate').value;
    if (!next || next === m.date) return;
    if (m.busy || state.isProcessing || (isDirty() && !window.confirm(`${m.date} の編集内容が保存されていません。破棄して切り替えますか？`))) {
      $('manualDate').value = m.date;
      return;
    }
    m.date = next;
    await load();
  }

  function renderStoreButtons() {
    document.querySelectorAll('.js-manual-store').forEach(btn => {
      const active = btn.dataset.store === m.store;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  // ===== 読み込み・保存 =====
  async function load() {
    if (!m.store || !m.date) return;
    const store = m.store, date = m.date;
    m.busy = true;
    try {
      setProcessing(true, `${S.storeLabel(store)} / ${date} 読み込み中`);
      const data = await Api.manual.get(store, date);
      if (data.store !== store || data.date !== date) throw new Error('取得したデータの店舗・日付が選択と一致しません。');
      if (m.store !== store || m.date !== date) return;
      applySaved(data);
      await refreshLinks();
    } catch (err) {
      if (!handleAuthErrorIfAny(err)) showAlert('手動シフトを読み込めませんでした: ' + manualErrorMessage(err), 'danger');
      m.loaded = false;
      render();
    } finally {
      m.busy = false;
      setProcessing(false);
    }
  }

  function applySaved(data) {
    m.folderWarning = data.folderWarning || '';
    m.revision = data.revision || 0;
    m.rows = S.fromServer(data.rows);
    m.savedSignature = S.signature(m.rows);
    m.loaded = true;
    clearGeneratedIfStale();
    render();
  }

  async function save() {
    if (!m.loaded || m.busy || state.isProcessing) return false;
    const errors = S.validateForSave(m.rows);
    if (errors.length) { showAlert(errors.join(' '), 'warning'); return false; }
    const store = m.store, date = m.date;
    m.busy = true;
    try {
      setProcessing(true, '手動シフトを保存中');
      const data = await Api.manual.save(store, date, m.revision, S.toPayload(m.rows));
      if (m.store !== store || m.date !== date) return false;
      const photos = m.photoCache;
      applySaved(data);
      m.photoCache = photos;
      await refreshLinks();
      showAlert(`${S.storeLabel(store)} / ${date} を保存しました（${data.rows.length}人）。`, 'success');
      return true;
    } catch (err) {
      if (handleAuthErrorIfAny(err)) return false;
      if (err.code === 'REVISION_CONFLICT') {
        showAlert('他の端末で同じ店舗・日付の手動シフトが更新されています。画面の入力は残しています。「再読み込み」で最新の内容を確認してから入力し直してください。', 'danger');
      } else {
        showAlert('保存できませんでした: ' + manualErrorMessage(err), 'danger');
      }
      return false;
    } finally {
      m.busy = false;
      setProcessing(false);
      render();
    }
  }

  async function reload() {
    if (isDirty() && !window.confirm('未保存の変更を破棄して、保存済みの内容を読み込みます。よろしいですか？')) return;
    await load();
  }

  // ===== 名前 → 写真の紐付け =====
  async function refreshLinks(keys, refresh) {
    const targets = m.rows.filter(r => !keys || keys.indexOf(r.key) !== -1).filter(r => S.cleanName(r.castName));
    if (!targets.length) { render(); return; }
    const mySeq = ++m.lookupSeq;
    targets.forEach(r => { r.status = 'checking'; });
    render();
    const names = targets.map(r => S.cleanName(r.castName)).filter((n, i, a) => a.indexOf(n) === i);
    try {
      const res = await Api.manual.lookup(names, m.store, !!refresh);
      if (mySeq !== m.lookupSeq) return;   // より新しい検索がある
      m.folderWarning = res.folderWarning || '';
      const byName = {};
      res.results.forEach(item => { byName[item.name] = item.candidates; });
      m.rows = m.rows.map(r => (targets.indexOf(r) !== -1 ? S.applyCandidates(r, byName[S.cleanName(r.castName)] || []) : r));
      const failed = await loadThumbnails();
      m.rows = S.markPhotoFailures(m.rows, failed);
    } catch (err) {
      if (mySeq !== m.lookupSeq) return;
      m.rows.forEach(r => { if (r.status === 'checking') r.status = 'error'; });
      if (!handleAuthErrorIfAny(err)) showAlert('写真の確認に失敗しました: ' + manualErrorMessage(err), 'warning');
    }
    render();
  }

  // 一覧の小さな写真（data URL。生成時にもそのまま使う）
  async function loadThumbnails() {
    const ids = [];
    m.rows.forEach(r => { if (r.imageFileId && !m.photoCache[r.imageFileId] && ids.indexOf(r.imageFileId) === -1) ids.push(r.imageFileId); });
    (m.rows.flatMap ? m.rows.flatMap(r => r.status === 'ambiguous' ? r.candidates : []) : []).forEach(c => {
      if (c.imageFileId && !m.photoCache[c.imageFileId] && ids.indexOf(c.imageFileId) === -1) ids.push(c.imageFileId);
    });
    if (!ids.length) return [];
    const res = await Api.manual.photos(ids.slice(0, 40), m.store);
    Object.assign(m.photoCache, res.photos || {});
    return res.failed || [];
  }

  // ===== 行の操作 =====
  function addNames(names) {
    const list = names.map(n => S.cleanName(n)).filter(Boolean);
    if (!list.length) return;
    if (m.rows.length + list.length > S.MAX_CASTS) {
      showAlert(`キャストは ${S.MAX_CASTS} 人までです。`, 'warning');
      return;
    }
    const tooLong = list.filter(n => n.length > S.MAX_NAME_LENGTH);
    if (tooLong.length) { showAlert(`キャスト名は ${S.MAX_NAME_LENGTH} 文字以内にしてください: ${tooLong.join('、')}`, 'warning'); return; }
    const added = list.map(n => S.newRow(n));
    m.rows = m.rows.concat(added);
    clearGeneratedIfStale(true);
    refreshLinks(added.map(r => r.key));
  }

  function onAdd() {
    if (!m.loaded) { showAlert('店舗と対象日を選んでください。', 'warning'); return; }
    const input = $('manualAddName');
    addNames([input.value]);
    input.value = '';
    input.focus();
  }

  function onBulkAdd() {
    if (!m.loaded) { showAlert('店舗と対象日を選んでください。', 'warning'); return; }
    const names = S.parseBulkNames($('manualBulkInput').value);
    if (!names.length) return;
    addNames(names);
    $('manualBulkInput').value = '';
  }

  function onListClick(event) {
    const btn = event.target.closest('[data-act]');
    if (!btn) return;
    const index = m.rows.findIndex(r => r.key === btn.closest('[data-key]').dataset.key);
    if (index === -1) return;
    const act = btn.dataset.act;
    if (act === 'up' || act === 'down') m.rows = S.move(m.rows, index, act === 'up' ? -1 : 1);
    else if (act === 'remove') m.rows = S.remove(m.rows, index);
    else if (act === 'photo') { openPhotoPicker(m.rows[index].key); return; }
    clearGeneratedIfStale(true);
    render();
  }

  function onListChange(event) {
    const el = event.target;
    const host = el.closest('[data-key]');
    if (!host) return;
    const row = m.rows.find(r => r.key === host.dataset.key);
    if (!row) return;
    if (el.classList.contains('js-manual-name')) {
      const name = S.cleanName(el.value);
      if (name === S.cleanName(row.castName)) return;
      row.castName = name;
      row.castId = '';
      row.imageFileId = '';
      clearGeneratedIfStale(true);
      refreshLinks([row.key]);
    } else if (el.classList.contains('js-manual-candidate')) {
      Object.assign(row, S.selectCandidate(row, el.value));
      clearGeneratedIfStale(true);
      render();
    }
  }

  // ===== 写真の登録 =====
  function openPhotoPicker(key) {
    m.photoTarget = key;
    const input = $('manualPhotoInput');
    input.value = '';
    input.click();
  }

  async function onPhotoSelected(event) {
    const file = event.target.files && event.target.files[0];
    const row = m.rows.find(r => r.key === m.photoTarget);
    event.target.value = '';
    if (!file || !row) return;
    const name = S.cleanName(row.castName);
    if (!name) { showAlert('先にキャスト名を入力してください。', 'warning'); return; }
    if (['image/png', 'image/jpeg'].indexOf(file.type) === -1) { showAlert('写真は PNG または JPEG を選択してください。', 'warning'); return; }
    if (file.size > 3 * 1024 * 1024) { showAlert('写真は 3MB 以下にしてください。', 'warning'); return; }
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('ファイルを読み込めませんでした'));
        reader.readAsDataURL(file);
      });
      const img = await ImageGenerator.loadImage(dataUrl);
      if (Math.min(img.naturalWidth, img.naturalHeight) < 100 || Math.max(img.naturalWidth, img.naturalHeight) > 6000) {
        showAlert('写真の大きさは 100〜6000px にしてください。', 'warning');
        return;
      }
      const image = { dataBase64: dataUrl.split(',')[1], mimeType: file.type, fileName: file.name };
      // 登録キャスト（c_）が紐付いていれば差し替え、それ以外は新規登録
      const replace = row.castId && row.castId.indexOf('c_') === 0;
      if (replace && !window.confirm(`「${name}」の写真を差し替えます。このキャストを使っている他の日付の画像にも反映されます。よろしいですか？`)) return;
      const entry = await registerPhoto(row, name, image, replace ? { castId: row.castId, expectedRevision: row.castRevision } : {});
      if (!entry) return;
      m.photoCache[entry.imageFileId] = dataUrl;
      const current = m.rows.find(r => r.key === row.key);
      if (current) {
        const others = (current.candidates || []).filter(c => c.castId !== entry.castId);
        Object.assign(current, S.selectCandidate(Object.assign({}, current, { candidates: others.concat([entry]) }), entry.castId));
      }
      // 同じ名前の他の行（未紐付け）にも候補を反映
      await refreshLinks(m.rows.filter(r => r.key !== row.key && S.cleanName(r.castName) === name && !r.castId).map(r => r.key));
      clearGeneratedIfStale(true);
      render();
      showAlert(`「${name}」の写真を${replace ? '差し替え' : '登録'}しました。「編集保存」で紐付けを保存してください。`, 'success');
    } catch (err) {
      if (!handleAuthErrorIfAny(err)) showAlert('写真を登録できませんでした: ' + manualErrorMessage(err), 'danger');
    }
  }

  async function registerPhoto(row, name, image, options) {
    try {
      setProcessing(true, '写真を登録中');
      return await Api.manual.registerPhoto(name, image, options);
    } catch (err) {
      if (err.code !== 'CAST_NAME_EXISTS') throw err;
      setProcessing(false);
      const existing = (err.details && err.details.candidates) || [];
      if (existing.length === 1 && window.confirm(`「${name}」は既に登録されています。\nOK: 登録済みの「${name}」の写真を差し替える\nキャンセル: 次の選択へ`)) {
        setProcessing(true, '写真を差し替え中');
        return Api.manual.registerPhoto(name, image, { castId: existing[0].castId, expectedRevision: existing[0].revision });
      }
      if (window.confirm(`同じ名前の別のキャストとして「${name}」を新しく登録しますか？\n（同じ人の場合はキャンセルし、一覧で写真を選んでから差し替えてください）`)) {
        setProcessing(true, '写真を登録中');
        return Api.manual.registerPhoto(name, image, { allowSameName: true });
      }
      return null;
    } finally {
      setProcessing(false);
    }
  }

  // ===== 画像生成（確認 → 生成） =====
  function openConfirm() {
    if (!m.loaded) { showAlert('店舗と対象日を選んでください。', 'warning'); return; }
    const sum = S.summarize(m.rows);
    const errorsEl = $('manualConfirmErrors');
    errorsEl.innerHTML = sum.errors.map(e => `<div>${escapeHtml(e)}</div>`).join('');
    errorsEl.classList.toggle('d-none', !sum.errors.length);
    $('manualConfirmTarget').textContent = `${S.storeLabel(m.store)}（${m.store}） / ${m.date}`;
    $('manualConfirmCount').textContent = `${sum.count}人${sum.missingCount ? `（写真なし ${sum.missingCount}人：${sum.missingNames.join('、')}）` : ''}`;
    $('manualConfirmBackground').textContent = describeBackground(bgState.store === m.store ? bgState.view : null);
    $('manualConfirmDirty').classList.toggle('d-none', !isDirty());
    $('manualConfirmList').innerHTML = m.rows.map((r, i) => `<li>${i + 1}. ${escapeHtml(S.cleanName(r.castName))} ${statusBadge(r)}</li>`).join('');
    $('manualConfirmRun').disabled = !!sum.errors.length;
    bootstrap.Modal.getOrCreateInstance($('manualConfirmModal')).show();
  }

  async function generate() {
    bootstrap.Modal.getOrCreateInstance($('manualConfirmModal')).hide();
    const sum = S.summarize(m.rows);
    if (sum.errors.length) { showAlert(sum.errors.join(' '), 'warning'); return; }
    const store = m.store, date = m.date;
    if (bgState.store !== store || !bgState.view) await ensureBackgroundLoaded(store, true);
    clearGeneratedImage();
    const errorEl = $('generateError');
    try {
      setProcessing(true, '写真を取得中');
      const failed = await loadThumbnails();
      m.rows = S.markPhotoFailures(m.rows, failed);
      setProcessing(true, '画像を生成中');
      const images = {};
      const ids = m.rows.map(r => r.imageFileId).filter((id, i, a) => id && a.indexOf(id) === i);
      await Promise.all(ids.map(async id => {
        try { images[id] = m.photoCache[id] ? await ImageGenerator.loadImage(m.photoCache[id]) : null; } catch (err) { images[id] = null; }
      }));
      const casts = m.rows.map(r => ({ name: S.cleanName(r.castName), image: (r.imageFileId && images[r.imageFileId]) || null }));
      const settings = readBackgroundSettingsFromForm();
      const invalid = validateBackgroundSettings(settings);
      if (invalid) throw new Error(invalid);
      const canvas = $('generatedCanvas');
      const background = bgState.pending ? bgState.pending.image : bgState.image;
      ImageGenerator.render(canvas, { background, fillColor: settings.fillColor, area: settings.area, casts });
      canvas.classList.remove('is-empty');
      const noPhoto = casts.filter(c => !c.image).length;
      bgState.generated = { store, date, count: casts.length, mode: 'manual', signature: S.signature(m.rows) };
      $('generateInfo').textContent = `${canvas.width} × ${canvas.height} px / ${S.storeLabel(store)} ${casts.length}人` +
        `${noPhoto ? `（写真なし ${noPhoto}人）` : ''}${background ? '' : ' / 背景未登録'}${failed.length ? ` / 写真を取得できなかった人 ${failed.length}件` : ''}`;
      $('pngSaveButton').disabled = false;
    } catch (err) {
      if (handleAuthErrorIfAny(err)) return;
      clearGeneratedImage();
      errorEl.textContent = '画像を生成できませんでした: ' + manualErrorMessage(err);
      errorEl.classList.remove('d-none');
    } finally {
      setProcessing(false);
    }
  }

  // 入力を変えたら古い生成画像は使えないようにする
  function clearGeneratedIfStale(changed) {
    if (!bgState.generated || bgState.generated.mode !== 'manual') return;
    if (changed || bgState.generated.store !== m.store || bgState.generated.date !== m.date) clearGeneratedImage();
  }

  // ===== 描画 =====
  function statusBadge(r) {
    switch (r.status) {
      case 'registered': return r.photoSource === 'store' ? '<span class="badge text-bg-success">写真あり（店舗フォルダ）</span>'
        : r.castId.indexOf('drive:') === 0 ? '<span class="badge text-bg-success">写真あり（画像フォルダ）</span>' : '<span class="badge text-bg-success">写真あり（登録写真）</span>';
      case 'ambiguous': return '<span class="badge text-bg-warning">同名あり・写真を選択</span>';
      case 'checking': return '<span class="badge text-bg-light border">写真を取得中…</span>';
      case 'error': return '<span class="badge text-bg-secondary">写真を確認できません（再検索してください）</span>';
      case 'photo_error': return '<span class="badge text-bg-secondary">写真の取得に失敗</span>';
      default: return '<span class="badge text-bg-danger">写真未登録</span>';
    }
  }

  function candidateLabel(c) {
    const where = c.source === 'store' ? `店舗フォルダ「${c.fileName || c.castName}」` : c.source === 'folder' ? '画像フォルダ' : `登録写真 ${c.updatedAt || ''}`;
    return `${c.castName}（${where}・${c.castId.slice(-6)}）`;
  }

  function renderRow(r, i, total) {
    const thumb = r.imageFileId && m.photoCache[r.imageFileId]
      ? `<img class="manual-thumb" src="${escapeHtml(m.photoCache[r.imageFileId])}" alt="${escapeHtml(r.castName)} の写真">`
      : '<div class="manual-thumb manual-thumb-empty">NO PHOTO</div>';
    const select = r.candidates && r.candidates.length > 1
      ? `<select class="form-select form-select-sm js-manual-candidate mt-1" aria-label="${escapeHtml(r.castName)} の写真を選択">
          <option value="">写真を選んでください（同名 ${r.candidates.length}人）</option>
          ${r.candidates.map(c => `<option value="${escapeHtml(c.castId)}" ${c.castId === r.castId ? 'selected' : ''}>${escapeHtml(candidateLabel(c))}</option>`).join('')}
        </select>` : '';
    const canPhoto = r.status !== 'checking' && r.castId.indexOf('drive:') !== 0;
    const photoLabel = r.castId && r.castId.indexOf('c_') === 0 ? '写真を差し替え' : '写真を登録';
    return `
      <div class="manual-row" data-key="${escapeHtml(r.key)}">
        <div class="manual-no">${i + 1}</div>
        ${thumb}
        <div class="manual-main">
          <input class="form-control form-control-sm js-manual-name" list="castNameOptions" maxlength="${S.MAX_NAME_LENGTH}" autocomplete="off"
            value="${escapeHtml(r.castName)}" aria-label="${i + 1}人目のキャスト名">
          <div class="mt-1 d-flex flex-wrap gap-1 align-items-center">${statusBadge(r)}
            ${canPhoto ? `<button type="button" class="btn btn-link btn-sm p-0 ms-1" data-act="photo">${photoLabel}</button>` : ''}</div>
          ${select}
        </div>
        <div class="manual-actions btn-group-vertical btn-group-sm">
          <button type="button" class="btn btn-outline-secondary" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="上へ">▲</button>
          <button type="button" class="btn btn-outline-secondary" data-act="down" ${i === total - 1 ? 'disabled' : ''} aria-label="下へ">▼</button>
        </div>
        <button type="button" class="btn btn-sm btn-outline-danger manual-remove" data-act="remove" aria-label="${escapeHtml(r.castName)} を削除">削除</button>
      </div>`;
  }

  function render() {
    const list = $('manualList');
    if (!m.loaded) {
      list.innerHTML = '<div class="text-secondary text-center py-4">店舗と対象日を選んでください</div>';
    } else if (!m.rows.length) {
      list.innerHTML = '<div class="text-secondary text-center py-4">キャストがいません。名前を入力して「追加」してください</div>';
    } else {
      list.innerHTML = m.rows.map((r, i) => renderRow(r, i, m.rows.length)).join('');
    }
    const dirty = isDirty();
    const badge = $('manualSaveState');
    if (!m.loaded) { badge.textContent = '未読み込み'; badge.className = 'badge text-bg-secondary'; }
    else if (dirty) { badge.textContent = '未保存の変更あり'; badge.className = 'badge text-bg-warning'; }
    else { badge.textContent = m.revision ? `保存済み（rev ${m.revision}）` : '未保存（新規）'; badge.className = m.revision ? 'badge text-bg-success' : 'badge text-bg-light border'; }
    $('manualTarget').textContent = m.store ? `${S.storeLabel(m.store)} / ${m.date || ''}` : '';
    $('manualSaveButton').disabled = !m.loaded || !dirty;
    const sum = S.summarize(m.rows);
    $('manualSummary').textContent = m.loaded
      ? `${m.rows.length}人${sum.missingCount ? ` / 写真なし ${sum.missingCount}人` : ''}${m.rows.some(r => r.status === 'ambiguous') ? ' / 写真の選択が必要な人がいます' : ''}`
      : '';
    const warn = $('manualFolderWarning');
    warn.textContent = m.loaded ? (m.folderWarning || '') : '';
    warn.classList.toggle('d-none', !(m.loaded && m.folderWarning));
  }

  function manualErrorMessage(err) {
    if (err && err.code === 'UNKNOWN_ACTION') return '接続先の GAS が手動モードに対応していません（GAS の新しいバージョンのデプロイが必要です）';
    return err && err.message ? err.message : String(err);
  }

  function bind() {
    document.querySelectorAll('input[name="appMode"]').forEach(el => el.addEventListener('change', () => { if (el.checked) setMode(el.value); }));
    document.querySelectorAll('.js-manual-store').forEach(btn => btn.addEventListener('click', () => selectStore(btn.dataset.store)));
    $('manualDate').addEventListener('change', onDateChange);
    $('manualReloadButton').addEventListener('click', reload);
    $('manualPhotoRefreshButton').addEventListener('click', () => {
      if (!m.loaded || m.busy || state.isProcessing) return;
      m.photoCache = {};
      refreshLinks(null, true);
    });
    $('manualSaveButton').addEventListener('click', save);
    $('manualAddButton').addEventListener('click', onAdd);
    $('manualAddName').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); onAdd(); } });
    $('manualBulkAddButton').addEventListener('click', onBulkAdd);
    $('manualList').addEventListener('click', onListClick);
    $('manualList').addEventListener('change', onListChange);
    $('manualPhotoInput').addEventListener('change', onPhotoSelected);
    $('manualConfirmRun').addEventListener('click', generate);
    window.addEventListener('beforeunload', event => {
      if (!isDirty()) return;
      event.preventDefault();
      event.returnValue = '';
    });
    m.date = todayJst();
    $('manualDate').value = m.date;
    // 既定は手動入力。?mode=auto で自動取得（SIFT_DATA）モードから始める
    const initial = new URLSearchParams(window.location.search).get('mode');
    setMode(initial === 'auto' ? 'auto' : 'manual');
    render();
  }

  window.addEventListener('DOMContentLoaded', bind);

  return { isManual, isDirty, setMode, onSignedIn, reset, openConfirm, state: m, selectStore, save, load };
})();
