# shift-image-manager

SIFT_DATA の投稿文から店舗・日付別の出勤キャストを抽出し、Google Drive の画像と紐付けて画像シフトを管理する Web システムです。

> **Phase 1.5（店舗×日付別の編集データ永続保存・安全化）はローカル実装のみで、本番（GAS / Spreadsheet / GitHub Pages）には未反映です。**
> 更新系 API は認証方式の承認まで拒否される設計です。詳細は下記「Phase 1.5」と [docs/AUTH_DESIGN.md](docs/AUTH_DESIGN.md)。

## 構成

```text
GitHub
↓
GitHub Pages
↓
HTML / CSS / JavaScript / Bootstrap 5.3
↓
Google Apps Script WebApp
↓
Google Spreadsheet
↓
Google Drive
```

## 公開URL

```text
https://officialwork-design.github.io/shift-image-manager/
```

## 関連URL

| 種別 | URL / ID |
|---|---|
| GitHub | https://github.com/officialwork-design/shift-image-manager.git |
| GitHub Pages | https://officialwork-design.github.io/shift-image-manager/ |
| GAS Script ID | 1m0G9Y3ATR885RDD1LBEjp5Zsc5Ts4qv_hq1q9kFw3Xe0WmKy5DQVnATS |
| Spreadsheet ID | 1s-Ga2SpUWzoKQHSOymqo5MCO_wgdevFKrQWHUIKvct0 |
| Drive Image Folder ID | 1Ob0yiSr0yP_sHa72t9xg8xmGn5YEUYR- |
| Drive Additional Image Folder ID | 17zZbEhzgr3Fp_yfdox3zWLhO5kSUwvhZ |

## 方針

- LIFF URL は現時点では使用しない。
- フロントエンドは GitHub Pages で公開する。
- バックエンドは Google Apps Script WebApp とする。
- データは Google Spreadsheet で管理する。
- 画像は Google Drive の指定フォルダから取得する。追加取得フォルダは `DRIVE_IMAGE_FOLDER_IDS` で複数指定できる。
- UI は Bootstrap 5.3 以上を標準とする。
- GitHub Pages では `google.script.run` を使用しない。

## ディレクトリ構成

```text
shift-image-manager/
├── index.html
├── config.js
├── .clasp.json
├── README.md
├── assets/
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── api.js
│       ├── shift-state.js   # 未保存検出などの純粋ロジック（Phase 1.5）
│       └── app.js
├── docs/
│   ├── SPECIFICATION.md
│   ├── API.md
│   ├── SHEET.md
│   ├── FLOW.md
│   └── AUTH_DESIGN.md       # 認証・認可の設計案（承認待ち）
└── gas/
    ├── Code.gs
    ├── ApiRouter.gs
    ├── ConfigService.gs
    ├── SpreadsheetService.gs
    ├── SiftService.gs
    ├── ImageService.gs
    ├── ShiftService.gs
    ├── ShiftRepository.gs   # 店舗×日付別 保存層（Phase 1.5）
    ├── AuthService.gs       # 更新系の認証・認可（Phase 1.5・フェイルクローズ）
    ├── MigrationService.gs  # 旧「画像生成」シートからの移行（Phase 1.5）
    ├── LogService.gs
    ├── Utils.gs
    └── appsscript.json
tests/                       # ローカルテスト（GAS モック・ブラウザ E2E）。本番には配置されない
package.json                 # テスト用スクリプトのみ
```

## ドキュメント

| ファイル | 内容 |
|---|---|
| docs/SPECIFICATION.md | システム仕様 |
| docs/API.md | API仕様 |
| docs/SHEET.md | Spreadsheet設計 |
| docs/FLOW.md | 処理フロー |

## 開発フロー

```text
GitHub
↓
社内PCに clone / pull
↓
VS Codeで編集
↓
git add .
↓
git commit
↓
git push
↓
GitHub Pages反映
```

## GAS反映フロー

```text
社内PCで gas/*.gs / gas/appsscript.json を編集
↓
clasp push
↓
Apps Script エディタで反映内容を確認
↓
新しいバージョンを作成
↓
Webアプリをデプロイ
↓
GAS_WEB_APP_URL を ID管理 / config.js に反映
```

手動コピーが必要な場合のみ、以下の流れを使います。

```text
GitHub の gas/*.gs を確認
↓
Apps Script エディタを開く
↓
対象ファイルへコピー&ペースト
↓
保存
↓
新しいバージョンを作成
↓
Webアプリをデプロイ
↓
GAS_WEB_APP_URL を ID管理 / config.js に反映
```

## 初回セットアップ

```bash
git clone https://github.com/officialwork-design/shift-image-manager.git
cd shift-image-manager
```

GitHub Pages は `main` ブランチのルートを公開対象にします。

## clasp 運用

このリポジトリは `.clasp.json` で `rootDir` を `gas` に設定しています。

```bash
clasp login
clasp status
clasp push
clasp deploy
```

- GAS側へ反映するファイルは `gas/` 配下のみです。
- `appsscript.json` は `gas/appsscript.json` を正とします。
- WebアプリURLは公開前提の値として `ID管理` シートと `config.js` に設定します。
- 秘密情報が必要になった場合のみ、Apps Script の Script Properties を使用します。
- GitHub Pages からは JSONP / WebApp API を呼び、`google.script.run` は使用しません。

## Spreadsheet

使用する主なシートは以下です。

- ID管理
- 仕様書
- 画像生成
- SIFT_DATA
- 画像操作ログ
- 画像チェック
- エラーログ

## SIFT_DATA 形式

```text
1行目: KABUKI
2行目: AKIBA
列方向: 日付別投稿
```

## 画像取得フォルダー

画像取得元は `ID管理` シートの `DRIVE_IMAGE_FOLDER_ID` を主フォルダーとして使用します。

追加フォルダーは `DRIVE_IMAGE_FOLDER_IDS` にカンマ区切りまたは改行区切りで指定できます。フォルダーIDだけでなく、Google Drive のフォルダーURLも指定できます。指定フォルダー配下のサブフォルダーも画像取得対象です。

```text
17zZbEhzgr3Fp_yfdox3zWLhO5kSUwvhZ
```

## 実装順

1. README / docs 整備
2. GAS API基盤
3. getConfig
4. getDateList
5. getSiftPreview
6. changeDateAndStore
7. getImageList
8. 休み設定
9. 画像未登録チェック
10. 画像キャッシュ更新
11. UI改善

## 注意事項

- GitHub Pages側に秘密情報を置かない。
- GAS WebApp URL は公開前提で扱う。
- 秘密情報が必要な場合は Script Properties を使う。
- 運用で変更するIDやシート名は Spreadsheet の ID管理シートを優先する。


---

# Phase 1.5: 店舗×日付別の編集データ永続保存・安全化

**状態: ローカル実装・テスト完了 / 本番反映は未実施 / 認証方式は設計承認待ち**

## 1. システム構成（Phase 1.5）

```text
GitHub Pages（index.html / api.js / shift-state.js / app.js）
  │ 読み取り: JSONP(GET)      更新: POST(text/plain) + 認証情報
  ▼
GAS WebApp ApiRouter ──▶ AuthService（更新系のみ・現在は全拒否）
  ├─ ShiftService ──▶ LockService ──▶ ShiftRepository ──▶ シフト編集 / シフト編集管理
  ├─ SiftService（SIFT_DATA 読み取り）
  ├─ ImageService（Drive 読み取り・CacheService）
  └─ LogService（画像操作ログ=監査 / エラーログ）
旧「画像生成」シート: MigrationService から読み取りのみ
```

## 2. 店舗×日付別の保存方式

- キーは `店舗:YYYY-MM-DD`（例 `KABUKI:2026-11-16`）。
- 「シフト編集」に1キャスト1行で保存。保存ごとに revision を1つ上げた行一式を追記（既存行は書き換えない）。
- 「シフト編集管理」の revision が**コミットマーカー**。読み取りはこの revision の行だけを使う。
- 保存データが無い店舗×日付だけ SIFT_DATA から初回作成。再読み込みや切り替えでは作り直さない。

## 3. `シフト編集` の列

`recordId | store | date | castName | workTime | status | sortOrder | imageFileId | createdAt | updatedAt | revision`（詳細は docs/SHEET.md 6-2）

## 4. `シフト編集管理` の列

`key | store | date | revision | initialized | rowCount | createdAt | updatedAt | updatedBy | lastRequestId | source`（詳細は docs/SHEET.md 6-3）

## 5. revision の管理

- 店舗×日付ごとに 1 から始まる整数。保存・休み変更・初期化のたびに +1。
- 画面は読み込んだ revision を `expectedRevision` として送る。サーバーで現在値と異なれば `REVISION_CONFLICT`。
- 競合時の画面表示: 「他の端末または画面で編集内容が更新されています。最新データを確認してから、もう一度保存してください。」入力は残し、最新データを別欄で比較できる。
- 直近3世代（`SHIFT_STORAGE.KEEP_GENERATIONS`）を保持。

## 6. LockService

- `ShiftService.withLock_` で `LockService.getScriptLock().tryLock(10000)`。取得できなければ `LOCK_TIMEOUT`（書き込みなし）。
- 対象: 初回作成・編集保存・休み変更・初期化・移行・移行ロールバック。
- ロック取得後に管理行と revision を再取得してから検証・書き込み。

## 7. 新規 API

`getDateOptions` / `getSavedShift` / `getShiftSnapshot`（読み取り）、`initializeShift` / `saveShift` / `setCastAbsent` / `resetShiftFromSource`（更新）。詳細は docs/API.md。

## 8. 既存 API の互換性

- `changeDateAndStore` は「無ければ作成」に変更（既存データを消さない）。認証・POST 必須。
- `updateShiftRows`・行番号指定の `setCastAbsent` は廃止（`LEGACY_API_REMOVED`）。
- `getImageList` は読み取り専用で store / date 必須。
- **GAS とフロントは同時に反映すること**（旧フロントは新 GAS で更新できない）。

## 9. 認証・認可

- 更新系 API は POST のみ。`AuthService.requireEditor` でサーバー側の本人確認 → 許可リストで認可。
- 現在は検証器が未実装のため **すべての更新を `AUTH_NOT_CONFIGURED` で拒否**（フェイルクローズ）。
- GitHub Pages + GAS の現構成では安全な本人確認が成立しないため、方式は承認待ち（推奨: Google ID トークン検証）。docs/AUTH_DESIGN.md 参照。
- クライアントが送るメールアドレスは信用しない。トークン実値はログで伏字。

## 10. Script Properties（キー名のみ）

| キー | 用途 |
|---|---|
| `AUTH_MODE` | 認証方式（未設定 = 更新拒否） |
| `SHIFT_EDITOR_EMAILS` | 更新を許可する利用者（カンマ/改行区切り） |
| `GOOGLE_OAUTH_CLIENT_ID` | ID トークン検証用（承認後） |

## 11. 初回データ生成

画面で店舗・日付を選ぶ → `getSavedShift` が `initialized:false` → `initializeShift`（ロック内で再確認、無い場合のみ SIFT_DATA を解析して revision 1 を作成）。同時に2端末が初回作成しても重複しない。SIFT_DATA に投稿がない日付は作成しない。

## 12. 保存・再読み込み

- 「編集保存」→ `saveShift`。成功で revision が上がり「保存済み rev N」。
- 「再読み込み」は保存済みデータを読み直すだけ（SIFT_DATA から作り直さない）。
- 未保存の変更がある状態で店舗・日付を切り替えると「保存して移動 / 保存せず移動 / キャンセル」を確認。保存に失敗したら移動しない。ブラウザを閉じる際も警告。
- 未保存の変更がある時の「休み」ボタンは画面上だけ変更（他の入力を失わない）。

## 13. 初期化手順

「元データから初期化」→ 確認画面で対象の店舗・日付を確認 → 確認欄に `店舗:日付` を入力 → 実行。対象の店舗×日付だけが SIFT_DATA から再生成されます（直前の世代は保持期間内ならシートに残ります）。

## 14. 旧データの移行手順（本番での実行は承認後）

旧「画像生成」シートに残っている **1店舗・1日分のみ** が移行対象です。それ以外の過去の編集内容は保存されていないため復元できません。

1. スプレッドシート全体のバックアップ（ファイル → コピーを作成）を手動で取得
2. メニュー「画像シフト管理 → 旧データ移行: バックアップ作成」（`BK_画像生成_日時` シートを作成）
3. 「旧データ移行: dry-run」で店舗・日付・件数・移行先の既存データ有無を確認（書き込みなし）
4. 「旧データ移行: 実行」でバックアップシート名を入力 → dry-run と内容が変わっていないこと（checksum）を確認して移行 → 自動検証
5. 移行先に既存データがある場合はスキップ（上書きしない）。再実行しても重複しない
6. A1 の日付から年を確定できない場合は、エディタで `MigrationService.migrate({ backupSheetName, date: 'YYYY-MM-DD' })` を実行（A1 と一致しない日付は拒否）

ロールバック: `MigrationService.rollback('KABUKI', 'YYYY-MM-DD')`（移行直後 rev 1・source=migration のデータのみ削除。旧シートは変更していないため元の状態に戻る）。

## 15. バックアップ手順

- 本番反映前: スプレッドシートのコピーを作成（Drive 上の別ファイル）。
- 運用中: 「シフト編集」は直近3世代を保持。重大な障害時はスプレッドシートの版の履歴から復元。

## 16. テスト手順

```bash
npm test            # GAS モック単体テスト + フロント状態テスト（Node 18 以上）
CDN_DIR=/path/to/node_modules npm run test:e2e   # Chromium E2E（playwright と bootstrap@5.3.3 / html2canvas@1.4.1 のローカルコピーが必要）
```
テストは本番 GAS / Spreadsheet / Drive に接続しません（`tests/gas-harness.js` のモック）。

## 17. デプロイ手順（承認後に実施）

1. 認証方式の承認と設定（docs/AUTH_DESIGN.md）。承認前に本番へ反映すると、更新操作がすべて拒否されます。
2. スプレッドシートのバックアップ作成。
3. テスト用コピー（スプレッドシート + GAS）で `clasp push` → テストデプロイで動作確認。
4. 本番: `clasp push` → メニュー「初期シート生成」（シフト編集 / シフト編集管理 を作成。既存シートは変更しない）→ 移行（14章）。
5. 新しいバージョンで WebApp をデプロイ（既存デプロイの更新で URL を維持）。
6. GitHub Pages（index.html / assets / config.js）を同時に反映。
7. 動作確認: 保存 → 別店舗・別日付 → 戻る → 内容保持。

## 18. ロールバック手順

1. GAS: 「デプロイを管理」で直前のバージョンに戻す（URL 不変）。
2. GitHub Pages: 直前のコミットに戻して反映。
3. データ: 旧版は「画像生成」シートを使うため、新シート（シフト編集 / 管理）は残しても影響なし。旧シートは Phase 1.5 で変更していない。
4. 移行のみ取り消す場合は 14章のロールバック。

## 19. トラブルシュート

| 症状 / コード | 原因 | 対処 |
|---|---|---|
| AUTH_NOT_CONFIGURED | 認証方式が未設定（現状の既定） | 承認後に AUTH_MODE 等を設定 |
| REVISION_CONFLICT | 他端末・他画面が先に保存 | 「最新データを表示」で比較 → 置き換えて再入力・保存 |
| LOCK_TIMEOUT | 他の保存処理が実行中 | 数秒待って再試行 |
| DATA_INCONSISTENT | 管理行の rowCount と行数が不一致（手作業編集など） | シートの版の履歴から復元、または管理者が管理行と行を確認 |
| WRITE_VERIFY_FAILED | 書き込み確認に失敗（保存は反映されていない） | 再保存（未コミット行は自動で掃除される） |
| SETUP_REQUIRED / SCHEMA_MISMATCH | 新シート未作成・ヘッダー不一致 | 「初期シート生成」を実行／ヘッダーを修正 |
| 日付が選択できない（年を確定できません） | SIFT_DATA の日付が今日±185日の範囲外、または曜日不一致 | SIFT_DATA の表記を確認 |
| 画像キャッシュの警告（IMAGE_CACHE_SKIPPED） | 画像索引が 100KB 超 | 動作は継続（Drive を毎回走査するため遅くなる）。画像フォルダ整理を検討 |
