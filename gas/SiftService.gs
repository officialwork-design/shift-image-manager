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

  getPreview(store, date) {
    Utils.validateStoreAndDate(store, date);
    const posts = this.findSiftPosts(store, date).map(item => ({
      label: String(store).toUpperCase() + ' / ' + date + ' / ' + Utils.columnToLetter(item.column),
      cell: Utils.columnToLetter(item.column) + item.row,
      text: item.text
    }));

    return {
      store: String(store).toUpperCase(),
      date,
      posts,
      postText: posts.length ? posts[0].text : '',
      cell: posts.length ? posts[0].cell : ''
    };
  },

  getParsedShift(store, date) {
    const posts = this.findSiftPosts(store, date);
    if (!posts.length) throw new Error('SIFT_DATAに該当投稿が見つかりません: ' + store + ' / ' + date);
    return this.parsePostText(posts[0].text);
  },

  findSiftPosts(store, date) {
    Utils.validateStoreAndDate(store, date);
    const config = ConfigService.getConfig();
    const sheet = SpreadsheetService.getSheet(config.SHEET_SIFT_DATA);
    const row = this.getStoreRow_(store);
    const lastColumn = Math.max(sheet.getLastColumn(), 1);
    const values = sheet.getRange(row, 1, 1, lastColumn).getDisplayValues()[0];
    const posts = [];

    values.forEach((value, index) => {
      const post = String(value || '').trim();
      if (post && post.indexOf(date) !== -1) {
        posts.push({ row, column: index + 1, text: post });
      }
    });

    return posts;
  },

  parsePostText(postText) {
    const lines = String(postText || '').split(/\r?\n/);
    const castRows = [];
    const castNames = [];
    const unknownNames = []; // CAST_MASTER未登録（除外はしないが調査用に記録）
    let currentTime = '';

    lines.forEach(raw => {
      const text = String(raw || '').trim();
      if (!text) return;

      if (/^\d{1,2}月\d{1,2}日/.test(text)) {
        Logger.log('[parsePostText] 除外(日付行): "%s"', text); // 一時ログ（調査用）
        return;
      }

      if (/^\d{1,2}:\d{2}$/.test(text)) {
        currentTime = text;
        return;
      }

      if (/(営業時間|推し推せ|@oshiose_|http|https|#|OPEN|CLOSE|本日|出勤情報|七夕|海の日|推し握り|生誕|通常)/i.test(text)) {
        Logger.log('[parsePostText] 除外(フィルタ一致): "%s"', text); // 一時ログ（調査用）
        return;
      }

      const name = this.normalizeCastName(text);
      Logger.log('[parsePostText] 正規化: "%s" -> "%s"', text, name); // 一時ログ（調査用）

      if (!name) {
        Logger.log('[parsePostText] 除外(正規化後が空): "%s"', text); // 一時ログ（調査用）
        return;
      }
      if (castNames.indexOf(name) !== -1) {
        Logger.log('[parsePostText] 除外(重複): "%s"', name); // 一時ログ（調査用）
        return;
      }

      // CAST_MASTER未登録でも除外しない（体入・新人・表記ゆれを編集テーブルに残す）
      const knownCast = CAST_MASTER.indexOf(name) !== -1;
      if (!knownCast) {
        unknownNames.push(name);
        Logger.log('[parsePostText] CAST_MASTER未登録（保持）: "%s"', name); // 一時ログ（調査用）
      }

      castNames.push(name);
      castRows.push({
        castName: name,
        workTime: currentTime || '',
        knownCast: knownCast
      });
    });

    Logger.log('[parsePostText] castRows=%s / 未登録=%s', castRows.length, JSON.stringify(unknownNames)); // 一時ログ（調査用）

    return {
      eventName: '',
      castNames,
      castRows,
      unknownNames
    };
  },

  normalizeCastName(text) {
    let name = String(text || '')
      .replace(/[@＠][^\s　]+.*/, '')
      .replace(/[🔰💖🎀⚡️🫶🏼⭐️✨🌟🎪]/g, '')
      .replace(/（ゲスト）|\(ゲスト\)/g, '')
      .replace(/\s+/g, '')
      .replace(/　+/g, '')
      .trim();

    if (!name) return '';

    const aliases = {
      '恋富子': '恋富子',
      '体入恋富子': '体入恋富子',
      '体入らんこ': '体入らんこ',
      '体入リア': '体入リア',
      '体入アマ': '体入アマ',
      'みあは': 'みあは',
      '体入みあは': '体入みあは'
    };

    return aliases[name] || name;
  },

  getStoreRow_(store) {
    return String(store).toUpperCase() === 'KABUKI' ? 1 : 2;
  }
};