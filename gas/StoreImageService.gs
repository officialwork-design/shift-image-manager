/**
 * 店舗別キャスト画像フォルダ（手動モードの写真の自動表示）
 *
 * - フォルダは Script Properties で店舗ごとに指定する（テスト用 GAS と本番 GAS で別々に設定する）
 *     DRIVE_KABUKI_CAST_FOLDER_ID … 歌舞伎（KABUKI）
 *     DRIVE_AKIBA_CAST_FOLDER_ID  … 秋葉原（AKIBA）
 *   フォルダの URL を貼っても ID を取り出す。
 * - Drive は読み取りのみ（DriveApp / drive.readonly）。ファイルの移動・削除・名前変更・共有設定の変更はしない。
 * - ファイル名（拡張子を除く）とキャスト名を照合する。照合は「名前が一致するもの」だけ:
 *     そのまま / 空白・@以降・記号の除去 / 末尾の (1)・コピー・番号の除去
 *   既存の画像フォルダで使っている「キャスト名マスタの前方一致」は使わない（「ももか」が「もも」に誤って紐付くのを防ぐ）。
 *   同じ名前に一致するファイルが2つ以上ある場合は候補を全部返し、画面で選ぶまで写真を使わない。
 * - 一覧は CacheService に店舗ごとに保存（IMAGE_CACHE_SECONDS、既定600秒）。refresh=true で読み直す。
 * - 写真は店舗別に管理する（createLookup）: 出勤先店舗のフォルダだけを検索し、もう一方の店舗のフォルダは読まない。
 *   出勤先店舗に無ければ「写真未登録」（他店舗の写真を候補に混ぜない）。
 *   ※ 2026-11-19 の 08aaa9a で一時的に店舗横断検索にしたが、運用に合わせて店舗別に戻した（PNG 保存名の改善は維持）。
 * - 既存の共通画像フォルダ（DRIVE_IMAGE_FOLDER_ID(S)）の中に店舗フォルダが入っている構成でも他店舗の写真を使わないよう、
 *   共通フォルダの結果から「もう一方の店舗のフォルダにあるファイル」を除く（excludesFileId）。
 *   そのためだけに、もう一方の店舗のフォルダ一覧（キャッシュ）を読む。読めない場合は除外なし（従来どおり）。
 */
const STORE_CAST_FOLDER_KEYS = { KABUKI: 'DRIVE_KABUKI_CAST_FOLDER_ID', AKIBA: 'DRIVE_AKIBA_CAST_FOLDER_ID' };
const STORE_IMAGE_CACHE_PREFIX = 'STORE_CAST_IMAGES_V1:';
const STORE_IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|gif|heic|heif)$/i;

const StoreImageService = {
  // 店舗のフォルダID（未設定は ''）。テスト環境で本番の既存フォルダ等が指定されていたら停止
  getFolderId(store) {
    const s = BackgroundService.requireStore_(store);
    const key = STORE_CAST_FOLDER_KEYS[s];
    let raw = '';
    try { raw = String(PropertiesService.getScriptProperties().getProperty(key) || '').trim(); } catch (err) { raw = ''; }
    const id = ImageService.extractFolderId_(raw);
    if (id && ConfigService.isTestEnvironment() && PRODUCTION_RESOURCE_IDS.indexOf(id) !== -1) {
      throw Utils.apiError('CONFIG_PRODUCTION_ID_IN_TEST', 'テスト環境の ' + key + ' に本番のIDが指定されています');
    }
    return id;
  },

  /**
   * 店舗フォルダの画像一覧
   * @return {{store, configured, folderId, files:[{fileId,name}], keyMap:{key:[fileId]}, warning}}
   */
  getImages(store, options) {
    const s = BackgroundService.requireStore_(store);
    const opts = options || {};
    const folderId = this.getFolderId(s);
    if (!folderId) {
      return { store: s, configured: false, folderId: '', files: [], keyMap: {},
        warning: (s === 'KABUKI' ? '歌舞伎' : '秋葉原') + 'の写真フォルダ（' + STORE_CAST_FOLDER_KEYS[s] + '）が設定されていません' };
    }
    const cacheKey = STORE_IMAGE_CACHE_PREFIX + s + ':' + folderId;
    const cache = CacheService.getScriptCache();
    if (!opts.refresh) {
      const hit = cache.get(cacheKey);
      if (hit) {
        try { return this.withKeyMap_(Object.assign({ store: s, configured: true, folderId, warning: '' }, JSON.parse(hit))); } catch (err) { /* 読み直す */ }
      }
    }
    let scanned;
    try {
      scanned = this.scan_(folderId);
    } catch (err) {
      LogService.error('StoreImageService.scan', err, { store: s });
      return { store: s, configured: true, folderId, files: [], keyMap: {}, error: true,
        warning: (s === 'KABUKI' ? '歌舞伎' : '秋葉原') + 'の写真フォルダを読み込めません（共有設定・フォルダIDを確認してください）' };
    }
    const json = JSON.stringify({ files: scanned });
    try {
      if (json.length < IMAGE_CACHE_MAX_BYTES) {
        const config = ConfigService.getConfig();
        cache.put(cacheKey, json, Number(config.IMAGE_CACHE_SECONDS || DEFAULT_CONFIG.IMAGE_CACHE_SECONDS));
      }
    } catch (err) { /* キャッシュできなくても続行 */ }
    return this.withKeyMap_({ store: s, configured: true, folderId, files: scanned, warning: '' });
  },

  // 検索対象: 出勤先店舗のフォルダだけ（他店舗のフォルダは検索しない）
  searchOrder(store) {
    const s = BackgroundService.requireStore_(store);
    return [s];
  },

  /**
   * 店舗別の検索器（1リクエストの間だけ使う。出勤先店舗のフォルダ一覧だけを読む）
   *  images(store)   … その店舗の getImages の結果（メモ化）
   *  matches(name)   … 出勤先店舗のフォルダで一致したファイル { store, files }（無ければ store '' / files []）
   *  storeOf(fileId) … そのファイルが出勤先店舗のフォルダにあれば店舗名（無ければ ''）
   *  allFiles()      … 出勤先店舗のファイル（店舗付き）
   *  warnings()      … 追加の警告（店舗別検索では常に空。出勤先店舗の警告は images(store).warning）
   *  excludesFileId(fileId) … もう一方の店舗のフォルダにあるファイルか（共通画像フォルダの結果から除くため。出勤先店舗のフォルダにもあれば除かない）
   */
  createLookup(store, options) {
    const self = this;
    const order = this.searchOrder(store);
    const memo = {};
    const images = s => {
      if (!memo[s]) memo[s] = self.getImages(s, options);
      return memo[s];
    };
    const usable = imgs => imgs && imgs.configured && !imgs.error;
    let otherIds = null;
    return {
      store: order[0],
      order,
      images,
      matches(castName) {
        for (let i = 0; i < order.length; i += 1) {
          const imgs = images(order[i]);
          if (!usable(imgs)) continue;
          const files = self.findFiles(imgs, castName);
          if (files.length) return { store: order[i], files };
        }
        return { store: '', files: [] };
      },
      storeOf(fileId) {
        for (let i = 0; i < order.length; i += 1) {
          if (self.hasFile(images(order[i]), fileId)) return order[i];
        }
        return '';
      },
      allFiles() {
        const out = [];
        order.forEach(s => { (images(s).files || []).forEach(f => out.push({ fileId: f.fileId, name: f.name, store: s })); });
        return out;
      },
      warnings() {
        return order.slice(1).filter(s => memo[s] && memo[s].error && memo[s].warning).map(s => memo[s].warning);
      },
      excludesFileId(fileId) {
        if (!fileId) return false;
        if (!otherIds) {
          otherIds = {};
          STORE_NAMES.filter(s => s !== order[0]).forEach(s => {
            try {
              (self.getImages(s, options).files || []).forEach(f => { otherIds[f.fileId] = true; });
            } catch (err) {
              LogService.error('StoreImageService.excludesFileId', err, { store: s });   // 読めない・設定エラーは除外なし
            }
          });
        }
        if (!otherIds[fileId]) return false;
        return !self.hasFile(images(order[0]), fileId);
      }
    };
  },

  clearCache() {
    const cache = CacheService.getScriptCache();
    STORE_NAMES.forEach(s => {
      try {
        const id = this.getFolderId(s);
        if (id) cache.remove(STORE_IMAGE_CACHE_PREFIX + s + ':' + id);
      } catch (err) { /* 設定エラーは無視 */ }
    });
  },

  // フォルダ（サブフォルダ5階層まで）の画像ファイル。「準備中」は除外
  scan_(folderId) {
    const files = [];
    const seen = {};
    const walk = (folder, depth) => {
      const id = folder.getId();
      if (seen[id]) return;
      seen[id] = true;
      const it = folder.getFiles();
      while (it.hasNext()) {
        const f = it.next();
        const name = String(f.getName() || '');
        const mime = typeof f.getMimeType === 'function' ? String(f.getMimeType() || '') : '';
        if (!STORE_IMAGE_EXTENSIONS.test(name) && mime.indexOf('image/') !== 0) continue;
        const base = Utils.stripExtension(name).trim();
        if (!base || ImageService.normalizeImageKey_(base).indexOf('準備中') === 0) continue;
        files.push({ fileId: f.getId(), name: base });
      }
      if (depth >= IMAGE_FOLDER_MAX_DEPTH || typeof folder.getFolders !== 'function') return;
      const sub = folder.getFolders();
      while (sub.hasNext()) walk(sub.next(), depth + 1);
    };
    walk(DriveApp.getFolderById(folderId), 0);
    files.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    return files;
  },

  withKeyMap_(data) {
    const keyMap = {};
    (data.files || []).forEach(f => {
      this.keysForFileName_(f.name).forEach(k => {
        if (!keyMap[k]) keyMap[k] = [];
        if (keyMap[k].indexOf(f.fileId) === -1) keyMap[k].push(f.fileId);
      });
    });
    data.keyMap = keyMap;
    return data;
  },

  // ファイル名の照合キー（前方一致は使わない）
  keysForFileName_(base) {
    const keys = [];
    const add = v => { const k = this.nameKey_(v); if (k && keys.indexOf(k) === -1) keys.push(k); };
    const n = ImageService.normalizeImageKey_(base);
    [base, n, ImageService.stripImageMetaSuffix_(base), ImageService.stripImageMetaSuffix_(n)].forEach(add);
    return keys;
  },

  nameKey_(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return (SiftService.normalizeCastName(raw) || ImageService.normalizeImageKey_(raw) || raw).normalize('NFKC');
  },

  // キャスト名に一致するファイル（0件・1件・複数件）
  findFiles(images, castName) {
    const k = this.nameKey_(castName);
    if (!k || !images || !images.keyMap) return [];
    const ids = images.keyMap[k] || [];
    return ids.map(id => images.files.find(f => f.fileId === id)).filter(Boolean);
  },

  hasFile(images, fileId) {
    return !!(images && images.files && images.files.some(f => f.fileId === fileId));
  }
};
