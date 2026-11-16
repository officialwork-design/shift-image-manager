// キャスト名に付く装飾記号（絵文字ではない記号）。♡ は新しい投稿テンプレートで名前の前に付く。
const CAST_NAME_DECORATION_PATTERN = /[♡♥❤❣☆★✩✪✫✬✭✮✯✰♪♫♬✿❀❁]/g;

// 絵文字（Unicode プロパティで判定。u フラグ必須＝サロゲートペアを壊さない）
// - Extended_Pictographic: 💗 💙 🐰 🔰 ✨ 🫶 など
// - Emoji_Modifier: 肌色修飾 🏼 など
// - 1\uFE0F\u20E3 のようなキーキャップは数字ごと除去
// - 国旗（Regional Indicator）
const CAST_NAME_EMOJI_PATTERN = /[0-9#*]\uFE0F?\u20E3|[\p{Extended_Pictographic}\p{Emoji_Modifier}\u200D\u20E3]|[\u{1F1E6}-\u{1F1FF}]/gu;

// 不可視・ゼロ幅・双方向制御・異体字セレクタ・BOM・ソフトハイフン・タグ文字
const CAST_NAME_INVISIBLE_PATTERN = /[\u00AD\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\uFE00-\uFE0F\uFEFF]|[\u{E0000}-\u{E007F}]/gu;

// 投稿文のうちキャスト名ではない行（既存キーワード + 新テンプレートの定型文）
const SIFT_EXCLUDE_LINE_PATTERN = /(営業時間|推し推せ|@oshiose_|http|https|#|OPEN|CLOSE|本日|出勤情報|七夕|海の日|推し握り|生誕|通常|出勤キャスト|今日会える|女の子たち|Xアカウント|返信欄|フォローしてね|Xはこちら)/i;

const SiftService = {
  getDateList() {
    const config = ConfigService.getConfig();
    const sheet = SpreadsheetService.getSheet(config.SHEET_SIFT_DATA);
    const lastColumn = Math.max(sheet.getLastColumn(), 1);
    const rows = sheet.getRange(1, 1, 2, lastColumn).getDisplayValues();
    const dates = [];

    rows.forEach(row => {
      row.forEach(cell => {
        const matches = String(cell || '').match(/\d{1,2}月\d{1,2}日\([日月火水木金土]\)/g);
        if (!matches) return;
        matches.forEach(date => {
          if (dates.indexOf(date) === -1) dates.push(date);
        });
      });
    });

    return dates.sort((a, b) => Utils.parseDate(a) - Utils.parseDate(b));
  },

  // Phase 1.5: 年付き日付（YYYY-MM-DD）を併記した日付一覧。年を確定できない日付は ok:false で返す。
  getDateOptions(todayIso) {
    const today = todayIso || Utils.todayIso();
    const options = this.getDateList().map(label => {
      try {
        return { label, date: Utils.resolveLabelToIso(label, today), ok: true, reason: '' };
      } catch (err) {
        return { label, date: '', ok: false, reason: err.code || 'INVALID_DATE' };
      }
    });
    return options.sort((a, b) => {
      if (a.ok && b.ok) return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
      if (a.ok !== b.ok) return a.ok ? -1 : 1;
      return Utils.parseDate(a.label) - Utils.parseDate(b.label);
    });
  },

  // date は YYYY-MM-DD
  getPreview(store, date) {
    const target = Utils.requireStoreAndIsoDate(store, date);
    const posts = this.findSiftPosts(target.store, target.date).map(item => ({
      label: target.store + ' / ' + item.label + ' / ' + Utils.columnToLetter(item.column),
      cell: Utils.columnToLetter(item.column) + item.row,
      text: item.text
    }));

    return {
      store: target.store,
      date: target.date,
      dateLabel: Utils.isoToLabel(target.date),
      posts,
      postText: posts.length ? posts[0].text : '',
      cell: posts.length ? posts[0].cell : ''
    };
  },

  getParsedShift(store, date) {
    const posts = this.findSiftPosts(store, date);
    if (!posts.length) {
      throw Utils.apiError('SIFT_NOT_FOUND', 'SIFT_DATAに該当投稿が見つかりません: ' + store + ' / ' + Utils.isoToLabel(date));
    }
    return this.parsePostText(posts[0].text);
  },

  // store: KABUKI/AKIBA, date: YYYY-MM-DD
  // 日付は「M月D日(曜)」の前に数字が無い場合のみ一致（11月1日 が 1月1日 に一致しない）
  findSiftPosts(store, date) {
    const target = Utils.requireStoreAndIsoDate(store, date);
    const label = Utils.isoToLabel(target.date);
    const pattern = this.buildDatePattern_(label);
    const config = ConfigService.getConfig();
    const sheet = SpreadsheetService.getSheet(config.SHEET_SIFT_DATA);
    const row = this.getStoreRow_(target.store);
    const lastColumn = Math.max(sheet.getLastColumn(), 1);
    const values = sheet.getRange(row, 1, 1, lastColumn).getDisplayValues()[0];
    const posts = [];

    values.forEach((value, index) => {
      const post = String(value || '').trim();
      if (post && pattern.test(post)) {
        posts.push({ row, column: index + 1, text: post, label });
      }
    });

    return posts;
  },

  buildDatePattern_(label) {
    const escaped = String(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(?<![0-9０-９])' + escaped);
  },

  parsePostText(postText) {
    const lines = String(postText || '').split(/\r?\n/);
    const castRows = [];
    const castNames = [];
    const unknownNames = []; // CAST_MASTER未登録（除外はしないが調査用に記録）
    let currentTime = '';

    lines.forEach(raw => {
      const text = String(raw || '').replace(CAST_NAME_INVISIBLE_PATTERN, '').trim();
      if (!text) return;

      if (/\d{1,2}月\d{1,2}日/.test(text)) return;          // 日付を含む行（見出し）
      if (/^\d{1,2}:\d{2}$/.test(text)) {                    // 時間見出し
        currentTime = text;
        return;
      }
      if (SIFT_EXCLUDE_LINE_PATTERN.test(text)) return;
      if (this.isDecoratedHeading_(text)) return;           // ✨マカロン✨ のような前後を絵文字で囲んだ見出し

      const name = this.normalizeCastName(text);
      if (!name) return;
      if (castNames.indexOf(name) !== -1) return;          // 重複は最初の行を採用

      // CAST_MASTER未登録でも除外しない（体入・新人・表記ゆれを編集テーブルに残す）
      const knownCast = CAST_MASTER.indexOf(name) !== -1;
      if (!knownCast) unknownNames.push(name);

      castNames.push(name);
      castRows.push({ castName: name, workTime: currentTime || '', knownCast });
    });

    return { eventName: '', castNames, castRows, unknownNames };
  },

  // 先頭と末尾がどちらも絵文字の行は見出し（コンセプト名など）として扱う。
  // キャスト名は「♡ちょこ」「ちょこ💗」「🔰新人」のように片側だけに装飾が付く想定。
  isDecoratedHeading_(text) {
    const value = String(text || '').replace(/[\s\u3000]+/g, '');
    const chars = Array.from(value);
    if (chars.length < 3) return false;
    const isEmoji = ch => /\p{Extended_Pictographic}/u.test(ch);
    return isEmoji(chars[0]) && isEmoji(chars[chars.length - 1]);
  },

  normalizeCastName(text) {
    const name = String(text || '')
      .replace(CAST_NAME_INVISIBLE_PATTERN, '')
      .replace(/[@＠].*$/, '')                 // Xアカウント（@/＠ 以降）を除去
      .replace(CAST_NAME_EMOJI_PATTERN, '')
      .replace(CAST_NAME_DECORATION_PATTERN, '')
      .replace(/（ゲスト）|\(ゲスト\)/g, '')
      .replace(/[\s　]+/g, '')
      .trim();

    const aliases = {
      '恋富子': '恋富子',
      '体入恋富子': '体入恋富子',
      '体入らんこ': '体入らんこ',
      '体入リア': '体入リア',
      '体入アマ': '体入アマ',
      'みあは': 'みあは',
      '体入みあは': '体入みあは'
    };

    return name ? (aliases[name] || name) : '';
  },

  getStoreRow_(store) {
    if (store === 'KABUKI') return 1;
    if (store === 'AKIBA') return 2;
    throw Utils.apiError('INVALID_STORE', '不正な店舗です: ' + store);
  }
};
