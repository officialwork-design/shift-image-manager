/**
 * 許可リスト（アクセス権限シート）による認可（Phase 1.6）
 *
 * - 照合は Google アカウントの sub（googleSub 列）で行う。メールアドレスは表示・確認用の補助情報。
 * - sub が一致しない場合は、メールアドレスが一致しても許可しない。
 * - シートが無い・空・読み取り失敗・不正データ（重複 sub / 不正ロール / 数値化された sub）はすべて拒否側に倒す。
 * - 許可リストの追加・変更は API からは行えない（スプレッドシートの編集者がシートまたはメニューで行う）。
 */
const ACCESS_CONTROL_HEADERS = ['googleSub', 'email', 'role', 'enabled', 'createdAt', 'updatedAt', 'note'];
const ACCESS_ROLES = ['ADMIN', 'EDITOR'];

const AccessControlService = {
  /**
   * @param {{sub:string,email:string}} identity 署名検証済みのトークンから得た利用者
   * @return {{sub:string,email:string,role:string,emailMismatch:boolean}}
   */
  authorize(identity) {
    const list = this.readList_();
    const sub = String(identity.sub);
    const matches = list.entries.filter(e => e.googleSub === sub);

    if (!list.entries.length) {
      throw this.forbidden_('ACCESS_LIST_EMPTY', '許可リストに利用者が登録されていません', identity);
    }
    if (!matches.length) {
      const sameEmail = list.entries.some(e => e.email && e.email === String(identity.email || '').toLowerCase());
      throw this.forbidden_(sameEmail ? 'SUB_MISMATCH' : 'NOT_REGISTERED',
        'このアカウントは許可されていません。管理者に登録を依頼してください', identity);
    }
    if (matches.length > 1 || list.duplicateSubs.indexOf(sub) !== -1) {
      throw this.forbidden_('DUPLICATE_SUB', '許可リストに同じ利用者が重複して登録されています。管理者に確認してください', identity);
    }
    const entry = matches[0];
    if (!entry.valid) {
      throw this.forbidden_(entry.problem || 'INVALID_ENTRY', '許可リストの登録内容に不備があります。管理者に確認してください', identity);
    }
    if (!entry.enabled) {
      throw this.forbidden_('DISABLED', 'このアカウントは無効化されています', identity);
    }
    return {
      sub,
      email: String(identity.email || '').toLowerCase(),
      role: entry.role,
      emailMismatch: !!entry.email && entry.email !== String(identity.email || '').toLowerCase()
    };
  },

  hasRole(role, allowedRoles) {
    return ACCESS_ROLES.indexOf(role) !== -1 && allowedRoles.indexOf(role) !== -1;
  },

  readList_() {
    const config = ConfigService.getConfig();
    const name = config.SHEET_ACCESS_CONTROL || DEFAULT_CONFIG.SHEET_ACCESS_CONTROL;
    let sheet;
    try {
      sheet = SpreadsheetService.getSchemaSheet(name, ACCESS_CONTROL_HEADERS);
    } catch (err) {
      if (err.code === 'SETUP_REQUIRED') throw Utils.apiError('ACCESS_LIST_NOT_CONFIGURED', '許可リスト（' + name + '）が未作成のため、すべての操作を拒否しています');
      if (err.code === 'SCHEMA_MISMATCH') throw Utils.apiError('ACCESS_LIST_INVALID', '許可リスト（' + name + '）の列構成が不正なため、すべての操作を拒否しています');
      throw Utils.apiError('ACCESS_LIST_UNAVAILABLE', '許可リストを読み取れないため、操作を拒否しました');
    }

    let raw;
    try {
      const lastRow = sheet.getLastRow();
      raw = lastRow < 2 ? [] : sheet.getRange(2, 1, lastRow - 1, ACCESS_CONTROL_HEADERS.length).getValues();
    } catch (err) {
      throw Utils.apiError('ACCESS_LIST_UNAVAILABLE', '許可リストを読み取れないため、操作を拒否しました');
    }

    const entries = [];
    const count = {};
    raw.forEach(row => {
      if (row.every(v => v === '' || v === null || v === undefined)) return;
      const entry = this.parseEntry_(row);
      entries.push(entry);
      if (entry.googleSub) count[entry.googleSub] = (count[entry.googleSub] || 0) + 1;
    });
    return { entries, duplicateSubs: Object.keys(count).filter(k => count[k] > 1) };
  },

  parseEntry_(row) {
    const rawSub = row[0];
    const role = String(row[2] || '').trim().toUpperCase();
    const enabledRaw = row[3];
    const entry = {
      googleSub: typeof rawSub === 'string' ? rawSub.trim() : String(rawSub),
      email: String(row[1] || '').trim().toLowerCase(),
      role,
      enabled: enabledRaw === true || String(enabledRaw).trim().toUpperCase() === 'TRUE',
      valid: true,
      problem: ''
    };
    // 21桁の sub が数値として保存されると精度が落ちるため、文字列以外は不正として扱う
    if (typeof rawSub !== 'string' || !/^[0-9]{1,255}$/.test(entry.googleSub)) {
      entry.valid = false;
      entry.problem = 'INVALID_SUB';
    } else if (ACCESS_ROLES.indexOf(role) === -1) {
      entry.valid = false;
      entry.problem = 'INVALID_ROLE';
    }
    return entry;
  },

  forbidden_(reason, message, identity) {
    // 本人が管理者に登録を依頼できるよう、本人の sub とメールを返す（他人の情報は返さない）
    return Utils.apiError('FORBIDDEN', message, {
      reason,
      sub: identity && identity.sub ? String(identity.sub) : '',
      email: identity && identity.email ? String(identity.email) : ''
    });
  },

  // ===== スプレッドシートのメニューから実行する登録（API からは呼べない） =====
  addEntry(sub, email, role, note) {
    const s = String(sub || '').trim();
    const r = String(role || '').trim().toUpperCase();
    if (!/^[0-9]{1,255}$/.test(s)) throw Utils.apiError('INVALID_SUB', 'googleSub は数字のみです（画面の「利用者ID」を入力してください）');
    if (ACCESS_ROLES.indexOf(r) === -1) throw Utils.apiError('INVALID_ROLE', 'role は ADMIN または EDITOR です');
    return ShiftService.withLock_(() => {
      const list = this.readList_();
      if (list.entries.some(e => e.googleSub === s)) throw Utils.apiError('DUPLICATE_SUB', 'この googleSub は登録済みです');
      const config = ConfigService.getConfig();
      const sheet = SpreadsheetService.getSchemaSheet(config.SHEET_ACCESS_CONTROL || DEFAULT_CONFIG.SHEET_ACCESS_CONTROL, ACCESS_CONTROL_HEADERS);
      const now = Utils.now();
      SpreadsheetService.appendTextRows(sheet, [[s, String(email || '').trim().toLowerCase(), r, 'TRUE', now, now, String(note || '')]], ACCESS_CONTROL_HEADERS.length);
      LogService.audit({ action: 'アクセス権限追加', user: 'menu', result: '成功', detail: 'role=' + r + ' sub=' + s });
      return { sub: s, role: r };
    });
  }
};

function accessControlAddUser() {
  const ui = SpreadsheetApp.getUi();
  const sub = ui.prompt('アクセス権限の追加 (1/3)', '利用者の googleSub（画面に表示された「利用者ID」・数字のみ）', ui.ButtonSet.OK_CANCEL);
  if (sub.getSelectedButton() !== ui.Button.OK) return null;
  const email = ui.prompt('アクセス権限の追加 (2/3)', 'メールアドレス（確認用）', ui.ButtonSet.OK_CANCEL);
  if (email.getSelectedButton() !== ui.Button.OK) return null;
  const role = ui.prompt('アクセス権限の追加 (3/3)', 'role（ADMIN または EDITOR）', ui.ButtonSet.OK_CANCEL);
  if (role.getSelectedButton() !== ui.Button.OK) return null;
  const result = AccessControlService.addEntry(sub.getResponseText(), email.getResponseText(), role.getResponseText(), '');
  showMenuMessage_('アクセス権限の追加', '登録しました: ' + result.role);
  return result;
}
