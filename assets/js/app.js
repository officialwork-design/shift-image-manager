const state = { current: null, isProcessing: false };

window.addEventListener('DOMContentLoaded', boot);

async function boot() {
  renderStoreOptions();
  bindEvents();
  await loadDateList();
  setStatus('準備完了', 'success');
}

function renderStoreOptions() {
  const picker = document.getElementById('storePicker');
  picker.innerHTML = (APP_CONFIG.STORES || []).map(store => `<option value="${escapeHtml(store)}">${escapeHtml(store)}</option>`).join('');
  picker.value = APP_CONFIG.DEFAULT_STORE || 'KABUKI';
}

function bindEvents() {
  document.getElementById('storePicker').addEventListener('change', loadShift);
  document.getElementById('datePicker').addEventListener('change', loadShift);
  document.getElementById('reloadButton').addEventListener('click', loadShift);
  document.getElementById('checkButton').addEventListener('click', checkImages);
  document.getElementById('exportButton').addEventListener('click', exportImage);
  document.getElementById('siftPreviewSelect').addEventListener('change', onPreviewChange);
}

async function loadDateList() {
  const fallbackDates = getCurrentMonthDatesJst();
  renderDateOptions(fallbackDates);

  const gasUrl = (window.APP_CONFIG && window.APP_CONFIG.GAS_WEB_APP_URL) || '';
  if (!gasUrl) {
    setStatus('日付は日本時間で生成 / GAS未設定', 'warning');
    showAlert('GAS_WEB_APP_URL が未設定のため、日付は日本時間の今月分を表示しています。API連携には config.js へWebアプリURLを設定してください。', 'warning');
    return;
  }

  try {
    setStatus('日付取得中', 'secondary');
    const dates = await Api.request('getDateList');
    renderDateOptions(Array.isArray(dates) && dates.length ? dates : fallbackDates);
  } catch (err) {
    renderDateOptions(fallbackDates);
    showAlert('APIから日付を取得できなかったため、日本時間の今月分を表示しています。' + err.message, 'warning');
    setStatus('日付は日本時間で生成', 'warning');
  }
}

function renderDateOptions(dates) {
  const picker = document.getElementById('datePicker');
  picker.innerHTML = '<option value="">日付選択</option>' + dates.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
}

function getCurrentMonthDatesJst() {
  const nowParts = getJapanDateParts(new Date());
  const year = Number(nowParts.year);
  const month = Number(nowParts.month);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const dates = [];

  for (let day = 1; day <= lastDay; day++) {
    const date = new Date(Date.UTC(year, month - 1, day));
    dates.push(`${month}月${day}日(${weekdays[date.getUTCDay()]})`);
  }

  return dates;
}

function getJapanDateParts(date) {
  const formatter = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric'
  });
  const parts = formatter.formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});
  return parts;
}

async function loadShift() {
  const store = document.getElementById('storePicker').value;
  const date = document.getElementById('datePicker').value;
  if (!store || !date || state.isProcessing) return;

  try {
    setProcessing(true, `${store} / ${date} 読み込み中`);
    await Api.request('changeDateAndStore', { store, date });
    const data = await Api.request('getImageList', { store, date });
    state.current = data;
    render(data);
    await loadSiftPreview(store, date);
    setStatus(`同期 ${data.updatedAt || ''}`, 'success');
  } catch (err) {
    showAlert(err.message, 'danger');
    setStatus('エラー', 'danger');
  } finally {
    setProcessing(false);
  }
}

async function refreshCurrentShift() {
  const store = document.getElementById('storePicker').value;
  const date = document.getElementById('datePicker').value;
  if (!store || !date) return;

  const data = await Api.request('getImageList', { store, date });
  state.current = data;
  render(data);
  setStatus(`同期 ${data.updatedAt || ''}`, 'success');
}

async function loadSiftPreview(store, date) {
  const data = await Api.request('getSiftPreview', { store, date });
  const posts = data.posts || [];
  const select = document.getElementById('siftPreviewSelect');
  const body = document.getElementById('siftPreviewBody');
  if (!posts.length) {
    select.innerHTML = '<option value="">SIFT_DATAなし</option>';
    body.textContent = '';
    return;
  }
  select.dataset.posts = JSON.stringify(posts);
  select.innerHTML = posts.map((p, i) => `<option value="${i}">${escapeHtml(p.label)}</option>`).join('');
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
  renderPhotos(data.activeCastList || []);
  renderList('activeList', data.activeCastList || [], true);
  renderList('absentList', data.absentCastList || [], false);
}

function renderWarnings(names) {
  const area = document.getElementById('alertArea');
  if (!names.length) { area.innerHTML = ''; return; }
  area.innerHTML = `<div class="alert alert-warning">画像未登録: ${names.map(escapeHtml).join('、')}</div>`;
}

function renderPhotos(list) {
  const grid = document.getElementById('photoGrid');
  if (!list.length) {
    grid.innerHTML = '<div class="text-secondary text-center py-4">画像なし</div>';
    return;
  }
  grid.innerHTML = list.map(c => `
    <article class="photo-card shadow-sm">
      <img src="${escapeHtml(c.imageUrl)}" alt="${escapeHtml(c.name)}" loading="lazy">
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
      <span class="fw-bold ${active ? '' : 'text-decoration-line-through text-secondary'}">${escapeHtml(c.name)}</span>
      <button class="btn btn-sm ${active ? 'btn-outline-secondary' : 'btn-primary'} rounded-pill" onclick="toggleAbsent(${Number(c.row)}, ${active})">${active ? '休み' : '戻す'}</button>
    </div>
  `).join('');
}

async function toggleAbsent(row, toAbsent) {
  try {
    setProcessing(true, '更新中');
    await Api.request('setCastAbsent', { row, isAbsent: toAbsent });
    await refreshCurrentShift();
  } catch (err) {
    showAlert(err.message, 'danger');
  } finally {
    setProcessing(false);
  }
}

async function checkImages() {
  try {
    setProcessing(true, '画像確認中');
    const result = await Api.request('checkImages');
    showAlert(result.missingCount ? `画像未登録: ${result.missingNames.join('、')}` : '画像未登録はありません。', result.missingCount ? 'warning' : 'success');
  } catch (err) {
    showAlert(err.message, 'danger');
  } finally {
    setProcessing(false);
  }
}

async function exportImage() {
  const target = document.getElementById('captureArea');
  const canvas = await html2canvas(target, { backgroundColor: '#ffffff', scale: 2 });
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = 'shift-image.png';
  a.click();
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
  document.getElementById('alertArea').innerHTML = `<div class="alert alert-${type} alert-dismissible fade show"><span>${escapeHtml(message)}</span><button type="button" class="btn-close" data-bs-dismiss="alert"></button></div>`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[s]));
}
