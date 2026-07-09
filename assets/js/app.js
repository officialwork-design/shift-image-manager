const state = {
  current: null,
  isProcessing: false
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

// 名前select用のoption群を生成（value=名前・表示=「名前 @id」・先頭に未選択）
function buildCastOptions(selected) {
  const sel = String(selected || '');
  let html = '<option value="">選択してください</option>';

  // 既存データで一覧に無い名前も選択状態を保持できるように追加
  if (sel && !Object.prototype.hasOwnProperty.call(CAST_OPTIONS, sel)) {
    html += `<option value="${escapeHtml(sel)}" selected>${escapeHtml(sel)}</option>`;
  }

  html += Object.keys(CAST_OPTIONS).map(name => {
    const id = CAST_OPTIONS[name];
    const selectedAttr = name === sel ? ' selected' : '';
    return `<option value="${escapeHtml(name)}"${selectedAttr}>${escapeHtml(name)} ${escapeHtml(id)}</option>`;
  }).join('');

  return html;
}

window.addEventListener('DOMContentLoaded', boot);

async function boot() {
  renderStoreOptions();
  renderAddWorkTimeOptions();
  renderAddCastOptions();
  bindEvents();
  await loadDateList();
  setStatus('準備完了', 'success');
}

function renderAddCastOptions() {
  const select = document.getElementById('addCastName');
  if (select) select.innerHTML = buildCastOptions('');
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
  document.getElementById('storePicker').addEventListener('change', loadShift);
  document.getElementById('datePicker').addEventListener('change', loadShift);
  document.getElementById('reloadButton').addEventListener('click', loadShift);
  document.getElementById('saveRowsButton').addEventListener('click', saveEditRows);
  document.getElementById('addCastButton').addEventListener('click', addCastRow);
  document.getElementById('checkButton').addEventListener('click', checkImages);
  document.getElementById('exportButton').addEventListener('click', exportImage);
  document.getElementById('siftPreviewSelect').addEventListener('change', onPreviewChange);
  document.getElementById('resetFromSourceButton').addEventListener('click', resetFromSource);

  // 編集テーブルの変更を検知（イベント委譲で再描画後も有効）
  document.getElementById('editTableArea').addEventListener('change', event => {
    // 並び順変更 → 自動繰り上げ・繰り下げ（テーブル再描画を伴う）
    if (event.target.classList.contains('js-sort-order')) {
      handleSortOrderChange(event.target);
    }
    // 名前・時間・状態・並び順のいずれの変更でも編集SIFTプレビューを更新（保存前でも反映）
    renderEditableSiftPreview();
  });
}

async function loadDateList() {
  const fallbackDates = getCurrentMonthDatesJst();
  renderDateOptions(fallbackDates);

  const gasUrl = (window.APP_CONFIG && window.APP_CONFIG.GAS_WEB_APP_URL) || '';
  if (!gasUrl) {
    setStatus('日付は日本時間で生成 / GAS未設定', 'warning');
    showAlert('GAS_WEB_APP_URL が未設定のため、日付は日本時間の今月分を表示しています。', 'warning');
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
  picker.innerHTML = '<option value="">日付選択</option>' + dates
    .map(date => `<option value="${escapeHtml(date)}">${escapeHtml(date)}</option>`)
    .join('');
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

  return formatter.formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});
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

// 元データから初期化：SIFT_DATA原本を再解析して編集テーブル・画像生成シートH:Lを戻す
async function resetFromSource() {
  const store = document.getElementById('storePicker').value;
  const date = document.getElementById('datePicker').value;

  if (!store || !date) {
    showAlert('店舗と日付を選択してください。', 'warning');
    return;
  }

  if (!window.confirm('現在の編集内容を破棄して、SIFT_DATA原本から初期化します。よろしいですか？')) {
    return;
  }

  try {
    setProcessing(true, '元データから初期化中');
    // changeDateAndStore がSIFT_DATA原本を再解析し、画像生成シートH:Lを元データで上書きする
    await Api.request('changeDateAndStore', { store, date });
    const data = await Api.request('getImageList', { store, date });
    state.current = data;
    render(data);
    await loadSiftPreview(store, date);
    showAlert('SIFT_DATA原本から初期化しました。', 'success');
    setStatus(`初期化 ${data.updatedAt || ''}`, 'success');
  } catch (err) {
    showAlert(err.message, 'danger');
    setStatus('エラー', 'danger');
  } finally {
    setProcessing(false);
  }
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
    <tr data-edit-row data-row-id="${Number(row.row || 0)}" data-image-status="${escapeHtml(String(row.imageStatus || '未登録'))}">
      <td>
        <input class="form-control form-control-sm js-sort-order" type="number" min="1" value="${Number(row.sortOrder || 1)}">
      </td>
      <td>
        <select class="form-select form-select-sm js-cast-name">
          ${buildCastOptions(row.castName || row.name || '')}
        </select>
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
        ${renderImageStatusBadge(row.imageStatus)}
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
    <div class="mobile-edit-card" data-edit-row data-row-id="${Number(row.row || 0)}" data-image-status="${escapeHtml(String(row.imageStatus || '未登録'))}">
      <div class="mobile-edit-grid">
        <div class="mobile-edit-field mobile-edit-field--name">
          <label>名前</label>
          <select class="form-select js-cast-name">
            ${buildCastOptions(row.castName || row.name || '')}
          </select>
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
          ${renderImageStatusBadge(row.imageStatus)}
        </div>
        <div class="mobile-edit-field">
          <label>削除</label>
          <button type="button" class="btn btn-outline-danger" onclick="removeEditRow(this)">削除</button>
        </div>
      </div>
    </div>
  `;
}

function renderImageStatusBadge(status) {
  const value = String(status || '未登録');
  if (value === '登録済み') return '<span class="badge text-bg-success">登録済み</span>';
  if (value === '準備中') return '<span class="badge text-bg-warning">準備中</span>';
  return '<span class="badge text-bg-secondary">未登録</span>';
}

function addCastRow() {
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
    sortOrder: rows.length + 1,
    castName,
    workTime: workTimeInput.value,
    status: statusInput.value,
    imageStatus: '未登録'
  });

  state.current = state.current || {};
  state.current.editRows = rows;
  renderEditTable(rows);
  renderEditableSiftPreview();

  nameInput.value = '';
}

function removeEditRow(button) {
  const row = button.closest('[data-edit-row]');
  if (row) row.remove();
  renderEditableSiftPreview();
}

function collectEditRows() {
  const rows = [];
  // table・mobile card 両方の行を対象にする
  document.querySelectorAll('#editTableArea [data-edit-row]').forEach((el, index) => {
    const nameEl = el.querySelector('.js-cast-name');
    if (!nameEl) return;
    rows.push({
      sortOrder: Number(el.querySelector('.js-sort-order').value) || index + 1,
      castName: nameEl.value.trim(),
      workTime: el.querySelector('.js-work-time').value,
      status: el.querySelector('.js-status').value,
      imageStatus: el.dataset.imageStatus || '未登録'
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
    rows.push({
      el,
      row: Number(el.dataset.rowId || 0),
      sortOrder: Number(el.querySelector('.js-sort-order').value) || 0,
      castName: nameEl ? nameEl.value.trim() : '',
      workTime: el.querySelector('.js-work-time').value,
      status: el.querySelector('.js-status').value,
      imageStatus: el.dataset.imageStatus || '未登録'
    });
  });
  return rows;
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
    row: item.row,
    sortOrder: index + 1, // 必ず1から連番に正規化
    castName: item.castName,
    workTime: item.workTime,
    status: item.status,
    imageStatus: item.imageStatus
  }));

  state.current = state.current || {};
  state.current.editRows = normalized;
  renderEditTable(normalized);
}

async function saveEditRows() {
  const rows = collectEditRows();

  if (!rows.length) {
    showAlert('保存する行がありません。', 'warning');
    return;
  }

  try {
    setProcessing(true, '編集内容を保存中');
    await Api.request('updateShiftRows', { rows });
    await refreshCurrentShift();
    showAlert('編集内容を保存しました。', 'success');
  } catch (err) {
    showAlert(err.message, 'danger');
  } finally {
    setProcessing(false);
  }
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
      <span class="fw-bold ${active ? '' : 'text-decoration-line-through text-secondary'}">
        ${escapeHtml(c.name)}
        ${c.workTime ? `<span class="badge text-bg-light border ms-1">${escapeHtml(c.workTime)}</span>` : ''}
      </span>
      <button class="btn btn-sm ${active ? 'btn-outline-secondary' : 'btn-primary'} rounded-pill" onclick="toggleAbsent(${Number(c.row)}, ${active})">
        ${active ? '休み' : '戻す'}
      </button>
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
    showAlert(
      result.missingCount ? `画像未登録: ${result.missingNames.join('、')}` : '画像未登録はありません。',
      result.missingCount ? 'warning' : 'success'
    );
  } catch (err) {
    showAlert(err.message, 'danger');
  } finally {
    setProcessing(false);
  }
}

async function exportImage() {
  const target = document.getElementById('captureArea');
  const canvas = await html2canvas(target, {
    backgroundColor: '#ffffff',
    scale: 2,
    useCORS: true
  });

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