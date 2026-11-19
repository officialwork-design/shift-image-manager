# shift-image-manager

SIFT_DATA の投稿文から店舗・日付別の出勤キャストを抽出し、Google Drive の画像と紐付けて画像シフトを管理する Web システムです。

> **Phase 1.5（店舗×日付別の編集データ永続保存）・Phase 1.6（Google ログイン・許可リスト）・Phase 1.7（テスト環境分離・検証準備）はローカル実装のみで、本番（GAS / Spreadsheet / GitHub Pages / Google Cloud）には未反映です。**
> 実 GAS・実 Google ログインでの検証は未実施です（テスト環境の作成承認待ち）。詳細は下記「Phase 1.5」「Phase 1.6」と [docs/AUTH_DESIGN.md](docs/AUTH_DESIGN.md)。

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
│       ├── auth.js          # Google ログイン状態管理（Phase 1.6）
│       ├── api.js
│       ├── shift-state.js   # 未保存検出などの純粋ロジック（Phase 1.5）
│       └── app.js
├── docs/
│   ├── SPECIFICATION.md
│   ├── API.md
│   ├── SHEET.md
│   ├── FLOW.md
│   └── AUTH_DESIGN.md       # 認証・認可の設計・設定手順（Phase 1.6）
└── gas/
    ├── Code.gs
    ├── ApiRouter.gs
    ├── ConfigService.gs
    ├── SpreadsheetService.gs
    ├── SiftService.gs
    ├── ImageService.gs
    ├── ShiftService.gs
    ├── ShiftRepository.gs   # 店舗×日付別 保存層（Phase 1.5）
    ├── AuthService.gs           # 認証・認可の入口（Phase 1.6）
    ├── GoogleIdTokenVerifier.gs # Google ID トークン署名検証（Phase 1.6）
    ├── AccessControlService.gs  # 許可リスト（アクセス権限シート）（Phase 1.6）
    ├── MigrationService.gs  # 旧「画像生成」シートからの移行（Phase 1.5）
    ├── LogService.gs
    ├── Utils.gs
    └── appsscript.json
tests/                       # ローカルテスト（GAS モック・ブラウザ E2E・通信模擬）。本番には配置されない
tools/                       # テスト環境用ツール（clasp-test-push.sh / build-test-site.sh / cors-probe/）
deploy/test/                 # テスト環境の設定テンプレート（実値は書かない）
testdata/                    # 架空のテストデータ（画像）
package.json                 # テスト用スクリプトのみ
```

## ドキュメント

| ファイル | 内容 |
|---|---|
| docs/SPECIFICATION.md | システム仕様 |
| docs/API.md | API仕様 |
| docs/SHEET.md | Spreadsheet設計 |
| docs/FLOW.md | 処理フロー |
| docs/IMAGE_LAYOUT.md | 出勤キャスト画像のサイズ・配置アルゴリズム・人数別レイアウト |

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

**状態: ローカル実装・テスト完了 / 本番反映は未実施**（認証は Phase 1.6 で実装。下記 9・10 章は Phase 1.6 で置き換え）

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

Phase 1.6 で実装（下記「Phase 1.6」参照）。

## 10. Script Properties（キー名のみ）

Phase 1.6「7. Script Properties」参照（`SHIFT_EDITOR_EMAILS` は廃止）。

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

1. Phase 1.6 と同時に反映する（下記「Phase 1.6 本番反映手順」）。
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
| AUTH_* / FORBIDDEN | 認証・認可エラー | 下記「Phase 1.6 トラブルシュート」 |
| REVISION_CONFLICT | 他端末・他画面が先に保存 | 「最新データを表示」で比較 → 置き換えて再入力・保存 |
| LOCK_TIMEOUT | 他の保存処理が実行中 | 数秒待って再試行 |
| DATA_INCONSISTENT | 管理行の rowCount と行数が不一致（手作業編集など） | シートの版の履歴から復元、または管理者が管理行と行を確認 |
| WRITE_VERIFY_FAILED | 書き込み確認に失敗（保存は反映されていない） | 再保存（未コミット行は自動で掃除される） |
| SETUP_REQUIRED / SCHEMA_MISMATCH | 新シート未作成・ヘッダー不一致 | 「初期シート生成」を実行／ヘッダーを修正 |
| 日付が選択できない（年を確定できません） | SIFT_DATA の日付が今日±185日の範囲外、または曜日不一致 | SIFT_DATA の表記を確認 |
| 画像キャッシュの警告（IMAGE_CACHE_SKIPPED） | 画像索引が 100KB 超 | 動作は継続（Drive を毎回走査するため遅くなる）。画像フォルダ整理を検討 |


---

# Phase 1.6: Google ログイン認証・許可リスト認可

**状態: ローカル実装・モックテスト完了 / 実 GAS・実 Google ログインでの検証は未実施 / 本番未反映**

詳細設計は [docs/AUTH_DESIGN.md](docs/AUTH_DESIGN.md)。以下は運用手順の要約です（設定値の実値は記載しません）。

## 1. Google ログインの仕組み

GitHub Pages で Google Identity Services（Sign In With Google）によりログイン → ID トークン（約1時間有効）を POST 本文で GAS に送信 → GAS が Google 公開鍵で署名とクレームを検証 → 「アクセス権限」シートの googleSub と role で認可 → 処理。トークンはブラウザのメモリにのみ保持します。

## 2. Google Cloud OAuth 設定手順

Cloud Console →「API とサービス」→ OAuth 同意画面を設定 →「認証情報」→ OAuth クライアント ID（ウェブ アプリケーション）を作成。クライアントシークレットは使いません。テスト用と本番用でクライアントIDを分けます（AUTH_DESIGN 3 章）。

## 3. OAuth 同意画面

組織内のみなら「内部」、個人アカウントも使うなら「外部」。スコープの追加は不要（`openid email profile`）。外部・テスト中はテストユーザーを登録（AUTH_DESIGN 4 章）。

## 4. OAuth クライアントIDの設定

GAS の Script Properties `GOOGLE_OAUTH_CLIENT_ID` に設定。フロントは公開 API `getPublicConfig` から取得するため `config.js` への記載は不要（aud の不一致を防ぐため設定箇所は1か所）。

## 5. 承認済みの JavaScript 生成元

本番 `https://officialwork-design.github.io`（パスなし）。テスト用は別クライアントIDに登録。

## 6. GAS 側の設定

- `appsscript.json` に `script.external_request` スコープを追加（ローカル変更済み・反映時に再承認が必要）
- WebApp の公開設定は現状維持（全員・匿名／自分として実行）
- メニュー「初期シート生成」で「アクセス権限」シートを作成（空 = 全員拒否）

## 7. Script Properties（キー名のみ）

| キー | 値 |
|---|---|
| `AUTH_MODE` | `google_id_token`（未設定・他の値は全拒否） |
| `GOOGLE_OAUTH_CLIENT_ID` | OAuth クライアントID |

## 8. 許可リストのシート構成

「アクセス権限」: `googleSub | email | role | enabled | createdAt | updatedAt | note`（docs/SHEET.md 6-4）

## 9. 初期 ADMIN 登録手順

1. 管理者本人がログイン →「利用権限がありません」画面に表示されたメールと利用者ID（sub）を確認
2. スプレッドシートの編集者がメニュー「アクセス権限の追加」で sub・メール・ADMIN を登録
3. 再読み込みしてログイン

## 10. ADMIN / EDITOR の権限

| | ADMIN | EDITOR |
|---|:-:|:-:|
| 閲覧・編集保存・休み変更・画像選択・初回作成・画像未登録チェック | ○ | ○ |
| 元データから初期化・画像キャッシュ更新 | ○ | × |
| 許可リスト管理 | シートの編集権限による | |

## 11. ID トークンの検証方式

JWKS（`https://www.googleapis.com/oauth2/v3/certs`、CacheService でキャッシュ）を使った RS256 署名検証（RFC 8017、全バイト比較）＋ iss / aud / azp / exp / iat / sub / email / email_verified の検証（AUTH_DESIGN 11 章）。

## 12. API 通信方式

すべて POST・`text/plain`・本文に `auth.idToken`。独自ヘッダー・URL クエリ・Cookie は使わない。公開設定以外の GET は `METHOD_NOT_ALLOWED`。

## 13. CORS 制約

`Authorization` ヘッダーや `application/json` はプリフライトが発生し GAS では処理できないため使わない。GAS は 302 で googleusercontent.com に転送し `Access-Control-Allow-Origin: *` で応答するため、`credentials: 'omit'` の fetch で応答を読める（AUTH_DESIGN 13 章）。

## 14. GAS 公開設定

`ANYONE_ANONYMOUS` / `USER_DEPLOYING` を維持。アクセス制御は ID トークン検証と許可リストで行う。

## 15. テスト環境の構築手順（作成前に承認が必要）

テスト用 Spreadsheet・GAS・OAuth クライアントIDを用意し、テスト用 WebApp とテスト用ページで確認（AUTH_DESIGN 15 章）。

## 16. ローカルテスト手順

```bash
npm test                                                # 単体・API・認証（モック）
CDN_DIR=/path/to/node_modules npm run test:e2e          # Chromium E2E（GIS・GAS はモック）
```
E2E には playwright と `bootstrap@5.3.3` / `html2canvas@1.4.1` のローカルコピーが必要です。テストのトークンはテスト用に生成した RSA 鍵で署名したもので、本物の Google アカウントは使いません。

## 17. 本番反映手順（承認後に実施）

1. テスト環境で 15 章の確認を完了し、結果の承認を得る
2. 本番用 OAuth クライアントID を作成（生成元: GitHub Pages）
3. 本番スプレッドシートのバックアップ
4. `clasp push`（gas/ 一式。マニフェストのスコープ追加を含む）→ エディタで任意の関数を実行して再承認
5. Script Properties に `AUTH_MODE` / `GOOGLE_OAUTH_CLIENT_ID` を設定
6. メニュー「初期シート生成」→「アクセス権限」作成 → 初期 ADMIN 登録（9 章）→ 旧データ移行（Phase 1.5 14 章）
7. WebApp を新しいバージョンでデプロイ（既存デプロイの更新で URL を維持）
8. GitHub Pages（index.html / assets / config.js）を同時に反映
9. ADMIN・EDITOR・未登録アカウントで動作確認

## 18. ロールバック手順

1. GAS:「デプロイを管理」で直前のバージョンに戻す（URL 不変）
2. GitHub Pages: 直前のコミットに戻す
3. Script Properties の `AUTH_MODE` を削除すると、新しい版のままでも全 API が拒否される（緊急停止）
4. 追加したシート（アクセス権限・シフト編集等）は旧版に影響しないため残してよい
5. OAuth クライアントIDは削除不要（使われなくなるだけ）

## 19. 認証エラーのトラブルシュート

| 症状 / コード | 主な原因 | 対処 |
|---|---|---|
| ログインボタンが出ない | GIS スクリプトが読めない（広告ブロック・通信）、生成元未登録 | ブラウザ設定、OAuth クライアントの生成元を確認 |
| 「ログイン機能が利用できません」 | `AUTH_MODE` / `GOOGLE_OAUTH_CLIENT_ID` 未設定・形式不正 | Script Properties を確認 |
| AUTH_INVALID（このアプリ向けではない） | クライアントIDの不一致（テスト用と本番用の取り違え） | Script Properties とログイン画面のクライアントIDを一致させる |
| AUTH_EXPIRED | トークン期限切れ（約1時間） | 画面の再ログインボタン。入力は残る |
| AUTH_KEYS_UNAVAILABLE | Google 公開鍵の取得失敗、`script.external_request` 未承認 | 再承認・時間をおいて再試行 |
| AUTH_NOT_CONFIGURED（BigInt 未対応） | 実行環境が V8 でない | `appsscript.json` の `runtimeVersion: V8` を確認 |
| FORBIDDEN / NOT_REGISTERED・SUB_MISMATCH | 許可リスト未登録・sub の取り違え | 画面の利用者IDで登録（メールでは照合しない） |
| FORBIDDEN / DISABLED・DUPLICATE_SUB・INVALID_ROLE・INVALID_SUB | 許可リストの内容 | enabled・重複・role・A列の書式（書式なしテキスト）を確認 |
| FORBIDDEN / ROLE | EDITOR が ADMIN 専用操作 | ADMIN に依頼 |
| ACCESS_LIST_NOT_CONFIGURED / INVALID | シートなし・ヘッダー不正 | 「初期シート生成」・ヘッダー修正 |
| 再読み込み後に毎回ログインが必要 | ブラウザが自動選択（FedCM / サードパーティ Cookie）を制限 | 仕様。ボタンからログイン |


---

# Phase 1.7: 実通信検証の準備・独立テスト環境

**状態: 準備完了（コードレビュー・修正・テスト・ツール・手順）。外部リソースは未作成（承認待ち）。本番未変更。**

## 1. プロジェクト概要

店舗（KABUKI / AKIBA）×日付ごとのシフト編集データを、Google ログイン＋許可リストで保護して編集・保存する Web システム。Phase 1.7 では、実際の Google ログイン・GAS 通信を本番から独立したテスト環境で検証するための準備を行った。

## 2. 本番とテスト環境の構成図

[docs/TEST_ENVIRONMENT.md](docs/TEST_ENVIRONMENT.md) 1 章。本番とテストはスプレッドシート・GAS・Drive・OAuth クライアント・Web ページをすべて別にし、共有しない。取り違えはサーバー（`APP_ENV` と本番ID検査）とフロント（`APP_ENV` 一致確認）で停止する。

## 3. 必要な Google サービス

Google Cloud プロジェクト（OAuth のみ・無料）、Apps Script、スプレッドシート、Drive、HTTPS で公開できるテスト用ページ（TEST_ENVIRONMENT 2 章）。

## 4. OAuth クライアント作成手順

TEST_ENVIRONMENT 3-1（同意画面 → ウェブ アプリケーションのクライアントID。シークレットは使わない）。

## 5. JavaScript 生成元の登録

テスト用ページのオリジン（パスなし）。ローカル確認用に `http://localhost:8080` も可。本番の生成元とは別のクライアントに登録する。

## 6. テスト用 GAS 作成手順

TEST_ENVIRONMENT 3-3。**反映は `TEST_SCRIPT_ID=… tools/clasp-test-push.sh` のみ。リポジトリ直下の `clasp push` は本番に反映されるため使わない。**

## 7. テスト用 Spreadsheet 作成手順

新規作成（本番のコピーは使わない）→ `setupShiftImageManager` → ID管理にテスト用フォルダ → `setupTestFixtures`（TEST_ENVIRONMENT 3-2・3-3）。

## 8. Script Properties のキー名

| キー | 本番 | テスト |
|---|---|---|
| `APP_ENV` | 未設定（または `production`） | `test`（必須） |
| `SPREADSHEET_ID` | 未設定 | テスト用スプレッドシートID（必須・本番ID不可） |
| `AUTH_MODE` | `google_id_token` | `google_id_token` |
| `GOOGLE_OAUTH_CLIENT_ID` | 本番用クライアントID | テスト用クライアントID |

テンプレート: `deploy/test/script-properties.template.txt`

## 9. 許可リスト初期設定

テスターがログイン → 表示された利用者IDを管理者へ → メニュー「アクセス権限の追加」（`deploy/test/access-control.template.csv`）。空の間は全員拒否。

## 10. ADMIN / EDITOR の設定

ADMIN 1名・EDITOR 1名（＋任意で無効化確認用 1名）。未許可確認は登録しないアカウントで行う。

## 11. テスト用デプロイ手順

`authSelfTest` が全項目 ok を確認してから WebApp をデプロイ（実行ユーザー「自分」・アクセス「全員」）→ `TEST_GAS_WEB_APP_URL=… tools/build-test-site.sh` → `dist-test/` を公開。

## 12. 実ブラウザでのテスト手順

TEST_ENVIRONMENT 4 章（curl → `tools/cors-probe` → アプリ機能 16 項目）。記録は `deploy/test/real-env-test-record.template.md`。

## 13. CORS トラブルシュート

| 症状 | 確認 |
|---|---|
| 「通信に失敗しました（… CORS …）」 | curl で 302 応答と転送先の `Access-Control-Allow-Origin`。独自ヘッダー・`application/json` を送っていないか |
| `GAS_HTML_RESPONSE` | WebApp URL の誤り、アクセスが「全員」でない、デプロイが古い・無効 |
| DevTools に OPTIONS が出る | `Content-Type` が `text/plain` 以外、または独自ヘッダーがある |
| 応答が `opaque` | `no-cors` を使っている（使わない） |

## 14. 認証失敗時の確認方法

1. エディタで `authSelfTest` → 失敗項目を確認（環境・BigInt・JWKS・認証設定・許可リスト）
2. 画面のエラーコード（AUTH_* / FORBIDDEN の reason）と Phase 1.6 19 章の表
3. 「画像操作ログ」シートの監査ログ（拒否理由・sub。トークンは記録されない）

## 15. 署名検証のレビュー結果

docs/AUTH_DESIGN.md 20 章。セルフレビューで重大1件（テスト環境から本番を参照し得る設定。修正済み）、中1件・低5件を修正。**第三者レビューは未実施（本番利用前に必要）。**

## 16. 本番移行時の注意点

- 本番採用条件（AUTH_DESIGN 22 章）をすべて満たしてから
- 本番 GAS には `APP_ENV` / `SPREADSHEET_ID` を設定しない（設定すると停止する）
- 本番とテストで OAuth クライアントIDを分ける
- テスト用の許可リスト・データを本番へコピーしない
- GAS とフロントを同時に反映（Phase 1.6 17 章）

## 17. ロールバック手順

Phase 1.6 18 章（デプロイの版を戻す・Pages を戻す・緊急時は `AUTH_MODE` 削除で全停止）。テスト環境は本番と共有するものがないため、本番のロールバックに影響しない。

## 18. テスト環境の削除手順

TEST_ENVIRONMENT 5 章（デプロイのアーカイブ → GAS・スプレッドシート・Drive 削除 → OAuth クライアント削除 → Cloud プロジェクトのシャットダウン → テスト用ページ削除）。

## ローカルテスト

```bash
npm test                  # 単体・API・認証・セキュリティレビュー・環境分離
npm run test:transport    # Chromium + GAS 模擬サーバーでの通信方式検証
CDN_DIR=/path/to/node_modules npm run test:e2e   # Chromium E2E（GIS・GAS はモック）
```


---

# 背景画像固定・キャスト自動配置（出勤キャスト画像の生成）

仕様書: [docs/IMAGE_LAYOUT.md](docs/IMAGE_LAYOUT.md)（画像サイズ・配置アルゴリズム・写真枠・余白・文字サイズ・人数別レイアウト・Drive API・権限）

> 状態: ローカル実装・テスト済み。**テスト用 GAS / WebApp には未反映**（反映は承認後）。
> 配置領域の既定値は完成見本（KABUKI「本日の出勤キャスト」13人）の解析で**確定**（上 580 / 下 220 / 左右 33 px）。
> キャスト画像は店舗で作成済みの**名前入りカード画像**を使う（アプリは名前・枠を描かず、写真だけを並べる）。

## 1. 概要
- 店舗ごとに背景画像を 1 枚登録し、出勤キャストの人数に合わせて名前入りカード画像（写真）を自動で並べた PNG を作る。
- **完成画像は常に 1447 × 2048 px**。人数が少なくても多くても大きさは変わらない（カードと間隔だけが変わる）。

## 2. 背景画像のアップロード
1. 店舗・日付を選ぶ →「背景画像・画像生成」欄に、その店舗の背景が表示される。
2. 「背景画像を選択」で PNG / JPEG（8MB まで・短辺 200px 以上・長辺 8000px 以下）を選ぶ → プレビュー（配置領域は破線）。
3. 必要なら「余白の色」（自動 / 指定）と「配置領域」（上・下・左・右 px）を調整し、「背景・設定を保存」。
- 背景は**切り抜かない・変形しない**。縦横比を保って全体を収め、余った部分は余白色で塗る。
- 「変更を取り消す」で保存済みの状態に戻る。「背景を解除」は ADMIN のみ（Drive のファイルは削除しない）。

## 3. 店舗別管理
- 背景・余白色・配置領域は店舗ごと（KABUKI / AKIBA）に「背景設定」シートへ保存。店舗を切り替えると自動で読み込む。
- 背景ファイルは Drive の背景フォルダ（`DRIVE_BACKGROUND_FOLDER_ID`）に保存。古いファイルは残す。
- 背景の変更で**シフトデータは変更しない**。同時更新は revision で検出（`REVISION_CONFLICT` → 最新を読み込み直す）。
- 権限: 閲覧・変更は ADMIN / EDITOR、解除は ADMIN のみ。すべてログイン必須（既存の ID トークン検証・許可リスト）。

## 4. 自動配置
- 並べるのは、キャスト画像フォルダにある**名前入りカード画像**（写真・名前・白い枠が入った 1 枚。店舗で作成済み）。
  アプリは名前・枠を描かず、カード画像を切り抜かずにそのまま並べる（縦横比 1 : 1.567 推奨。違う比率でも切らずに収める）。

| 人数 | 配置（段ごとの人数） |
|---|---|
| 0 | 背景のみ |
| 1〜3 | 1 段・中央揃え |
| 4〜8 | 2 段（例 5 → 3/2、8 → 4/4） |
| 9〜10 | **3 段**（9 → 3/3/3、10 → 4/4/2。写真の視認性を優先） |
| 11〜13 | 3 段（13 → **5/5/3** = 完成見本と同じ） |
| 14〜 | 写真が最も大きくなる段数を自動で追加（16 → 6/6/4、20 → 5/5/5/5） |

- 上の段から詰め、最終段に残り。各段は中央揃えで、人数が足りない最終段は満員の段の幅の中に等間隔（完成見本どおり）。
- シフトの並び順を保持。休みのキャストは描画しない。カード画像が無いキャストは「準備中」画像、または NO PHOTO ＋ 名前のカードを描く。
- 配置はヘッダー・フッター・装飾を除いた「配置領域」の中だけ。人数が増えたらキャンバスではなくカードと間隔を縮める。

## 5. PNG 出力
- 「画像を生成」→ プレビュー →「PNG で保存」（`shift_<店舗>_<日付>_1447x2048.png`）。
- 生成は**保存済み**のシフトを使う。未保存の編集がある場合は先に「編集保存」、他端末で更新されていれば「再読み込み」。
- 背景・写真は GAS から data URL で受け取って描くため、Canvas が汚染されず PNG を保存できる。

## 6. 画像サイズ
| 項目 | 値 |
|---|---|
| 完成画像 | **1447 × 2048 px（固定）** |
| カード | 縦横比 1 : 1.567。人数に応じて幅 400〜80 px（13 人で 246 × 385 px = 完成見本と同じ） |
| 背景 | PNG / JPEG、8MB まで、短辺 200 px 以上・長辺 8000 px 以下（比率は任意。切り抜かずに収める） |
| 配置領域の既定値（確定） | 上 580 / 下 220 / 左 33 / 右 33 px = 1381 × 1248 px（完成見本のカード配置範囲。見出し下端 319 px・ロゴ上端 1868 px を避ける。最小 幅 400・高さ 400 px） |

## 7. エラー対応
| 表示 / コード | 対処 |
|---|---|
| 配置領域に収められません（LAYOUT_OVERFLOW） | 配置領域の上下左右の値を小さくして領域を広げる |
| 名前が長すぎて…（NAME_TOO_LONG） | カード画像が無いキャストの名前が長すぎる。カード画像を登録する、または配置領域を広げる |
| 未保存の変更があります | 「編集保存」してから生成 |
| シフトが他の端末で更新されています | 「再読み込み」してから生成 |
| 他の端末で背景設定が更新されています（REVISION_CONFLICT） | 最新の背景が読み込まれるので、必要なら選び直して保存 |
| PNG または JPEG… / 8MB 以下… / 200〜8000px…（INVALID_IMAGE_TYPE / IMAGE_TOO_LARGE / INVALID_IMAGE_SIZE / INVALID_IMAGE） | 画像の形式・大きさを確認 |
| BACKGROUND_FOLDER_NOT_CONFIGURED | 背景フォルダ未設定（本番）。ID管理シートか Script Properties に `DRIVE_BACKGROUND_FOLDER_ID` |
| DRIVE_WRITE_FAILED | drive.file の承認、背景フォルダがアプリで作成したものか（`backgroundSelfTest`）を確認 |
| BACKGROUND_UNAVAILABLE | 背景ファイルが背景フォルダにない。背景を登録し直す |
| PNG を保存できません（CANVAS_TAINTED） | 通常は発生しない。再読み込みして生成し直す |

## 8. GAS の設定・権限（テスト用 GAS 反映時）
- `appsscript.json` に `https://www.googleapis.com/auth/drive.file` を追加（ドライブ全体の書き込み権限 `drive` は要求しない）。
- 書き込み（背景フォルダ作成・背景アップロード）は Drive REST API（drive.file）、読み取りは DriveApp / Drive API（drive.readonly）。
- 反映後、**エディタから関数を一度実行して再承認**（ご本人の操作）→ `backgroundSelfTest()` で スコープ・背景フォルダ・背景設定シートを確認。
- テスト環境では背景フォルダが未設定なら最初の保存時に「Shift Image Manager TEST Backgrounds」を自動作成（Script Properties に記録）。
  本番では自動作成しない。キャスト画像フォルダや本番IDは指定できない。
- 詳細: docs/IMAGE_LAYOUT.md §11

## 9. テスト
```bash
npm test                 # 単体・GAS・権限（配置計算 17 / 背景 16 を含む）
npm run test:transport   # 通信方式
CDN_DIR=/path/to/node_modules npm run test:e2e   # Chromium（画像生成 11 を含む）
```

---

# テスト環境への反映（背景画像機能）— 手順と影響範囲

> 反映はご本人の承認後に実施する。本番 GAS / Spreadsheet / Drive / GitHub Pages には一切触れない。

## 0. 「背景画像が変わらない」原因（2026-11-18 確認）

| 確認項目 | 結果 |
|---|---|
| 表示中のページ | `dist-test/`（Phase 1.8 時点のビルド、`?v=20261116-p16`）。**背景設定 UI（`#bgSection`）・`image-generator.js` を含まない** |
| 接続先 GAS | テスト用 WebApp `AKfycbwF8osF…`（バージョン 1 = 背景機能より前のコード）。`getBackground` は `UNKNOWN_ACTION` |
| 白い背景・グレーのカード | 旧来の「写真プレビュー」欄。テスト用 GAS の `DRIVE_IMAGE_FOLDER_ID` が未設定（テスト画像未投入）のため全員が写真なし表示 |

→ 背景機能はローカルにだけあり、**ページ・GAS のどちらにも反映されていない**ことが原因（コードの不具合ではない）。
あわせて、`index.html` の `?v=` が一部古いままで、反映後もブラウザが古い `app.js` / `api.js` を使うおそれがあったため修正した
（全ファイルの `?v=` を統一し、`tools/build-test-site.sh` がビルドごとの値に置き換える）。

## 1. テスト用ページのビルドと起動（Mac）

```bash
# リポジトリで（テスト用 WebApp の URL を指定。本番 URL は拒否される）
TEST_GAS_WEB_APP_URL='https://script.google.com/macros/s/<テスト用デプロイID>/exec' tools/build-test-site.sh
cd dist-test && python3 -m http.server 8080      # → Chrome で http://localhost:8080/
```

- `dist-test/BUILD_INFO.txt` にコミット・ビルド日時・接続先が記録される。画面の版は `APP_CONFIG.VERSION`（`<commit>-<日時>-test`）。
- OAuth の「承認済みの JavaScript 生成元」は `http://localhost:8080`（テスト用 OAuth クライアント）。ポートを変える場合は生成元の追加が必要。
- 起動したターミナルはテスト中は閉じない。

## 2. テスト用 GAS への反映（どちらか）

| 方法 | 手順 |
|---|---|
| A. エディタに貼り付け | `tools/build-test-gas-bundle.sh` → `dist-gas-test/TestBundle.gs` の内容でテスト用 GAS のコードを置き換え、`appsscript.json` も同じ内容にして保存（`BUNDLE_INFO.txt` の sha256 で照合） |
| B. clasp | `TEST_SCRIPT_ID=… TEST_SPREADSHEET_ID=… TEST_DRIVE_FOLDER_ID=… tools/clasp-test-push.sh`（本番 ID は拒否。**リポジトリ直下で clasp push しない**） |

## 3. 権限の承認（drive.file の追加）

1. テスト用 GAS のエディタで `backgroundSelfTest` を選び「実行」→「権限を確認」→ 作業アカウント →「許可」（**ご本人の操作**）
2. 実行ログで `OAuth スコープ（トークン）` が OK になることを確認（Drive・シートには書き込まない）

## 4. WebApp の新バージョン公開（URL を変えない）

「デプロイ」→「デプロイを管理」→ テスト用デプロイ（`AKfycbwF8osF…`）の鉛筆 →「バージョン: 新バージョン」→「デプロイ」。
新しいデプロイを作ると URL が変わり、ページの再ビルドが必要になるため、既存デプロイの編集で行う。

## 5. 背景設定・確認手順（テスト用ページ）

1. ADMIN でログイン → 店舗・日付を選択 →「背景画像・画像生成」欄が表示されること
2. 背景画像（PNG / JPEG）を選択 → プレビュー →「背景・設定を保存」（初回はテスト用 Drive に「Shift Image Manager TEST Backgrounds」を自動作成）
3. 「画像を生成」→ 1447 × 2048 のプレビュー →「PNG で保存」
4. 店舗を切り替えて背景が店舗ごとに変わること、ブラウザ再読み込み後も残ること
5. （任意）キャストのカード画像を表示する場合は、テスト用 Drive の画像フォルダを用意し ID管理の `DRIVE_IMAGE_FOLDER_ID` に設定

## 6. 影響範囲

| 対象 | 変更 | 影響 |
|---|---|---|
| テスト用ページ（`dist-test/`、Mac ローカル） | 作り直し | 背景設定 UI・画像生成が追加。既存のシフト編集は変更なし |
| テスト用 GAS（コード・manifest） | 置き換え | API に `getBackground` / `saveBackground` / `clearBackground` / `getCastPhotos` を追加。既存 API は変更なし。`saveBackground` のみ本文 12MB まで |
| テスト用 GAS（権限） | `drive.file` 追加 | 再承認が必要（アプリが作成したファイル・フォルダだけ書き込み可） |
| テスト用 WebApp | 新バージョン | URL は不変 |
| テスト用 Spreadsheet | 「背景設定」シートを追加（初回保存または初期シート生成時）。ID管理に 2 行追加（`SHEET_BACKGROUND` / `DRIVE_BACKGROUND_FOLDER_ID`） | シフトデータは変更しない |
| テスト用 Drive | 「Shift Image Manager TEST Backgrounds」フォルダと背景画像 | テスト用アカウントの Drive のみ |
| 本番（GAS / Spreadsheet / Drive / Pages） | **なし** | – |

## 7. 戻し方

- ページ: 以前の `dist-test` に戻す（または以前のコミットでビルドし直す）。
- WebApp: 「デプロイを管理」で以前のバージョン（バージョン 1）を選び直す。
- 背景: ADMIN の「背景を解除」（Drive のファイルは残る）。

---

# 手動モード（キャスト名を手入力して画像を作る）

> シフトデータ（SIFT_DATA）の自動取得を一時的に使わず、キャスト名を入力して出勤画像を作るモード。
> 自動取得（SIFT_DATA 連携）は削除しておらず、画面上部の「自動取得（SIFT_DATA）」でいつでも戻せる。
> 本番 GAS / Spreadsheet / Drive / GitHub Pages への反映は承認後に行う（このドキュメントはテスト環境の手順）。

## 1. 仕組み

| 項目 | 内容 |
|---|---|
| 画面 | 上部の「手動入力 / 自動取得（SIFT_DATA）」で切り替え。**既定は手動入力**（`?mode=auto` を付けて開くと自動取得から開始） |
| 店舗 | 「歌舞伎」（KABUKI）「秋葉原」（AKIBA）の 2 ボタン。押すと背景もその店舗のものに自動で切り替わる |
| 対象日 | 日付欄で選ぶ（シフトの取得はしない。店舗×日付ごとに入力内容を保存するための区別） |
| 保存先 | Spreadsheet の「手動シフト」シート（店舗・対象日・並び順・キャスト名・キャストID・画像ID・更新日時・revision）。**SIFT_DATA・シフト編集・シフト編集管理は読み書きしない** |
| 写真 | 「キャスト画像」シートでキャストID（`c_…`）と写真を結び付ける。既存の画像フォルダ（`DRIVE_IMAGE_FOLDER_ID`）の「名前.png」も候補（キャストID `drive:<ファイルID>`） |
| 同名対策 | 写真は**キャストID**で紐付けて保存する。同じ名前の候補が 2 人以上いるときは、一覧で選ぶまで写真を使わない（生成もできない） |
| 画像生成 | 既存の背景合成（1447 × 2048 px・人数で自動配置・カード画像はそのまま並べ、名前や枠を描き足さない）を使用。写真が無い人だけ NO PHOTO ＋ 名前の仮カード |
| 競合 | 保存は revision で検知（他の端末が先に保存していたら上書きしない。画面の入力は残る） |

## 2. 操作手順

1. ログイン（ADMIN / EDITOR）→「手動入力」が選ばれていることを確認
2. 「歌舞伎」または「秋葉原」を押す → 対象日を選ぶ（保存済みなら内容が表示される）
3. キャスト名を入力して Enter（または「追加」）。複数人は「まとめて入力」に 1 行 1 人（「、」「,」区切りも可）→「まとめて追加」
4. 並び順は ▲▼、削除は「削除」。名前を直すと写真の候補を検索し直す
5. 写真の状態を確認
   - 「写真あり」…登録済みの写真を表示（そのまま使う）
   - 「同名あり・写真を選択」…下の選択欄でどのキャストか選ぶ
   - 「写真未登録」…「写真を登録」で写真を選ぶ（3 を参照）。登録しなくても仮カードで生成できる
6. 「編集保存」→ バッジが「保存済み（rev N）」になる。ブラウザを再読み込みしても同じ内容・順番で表示される
7. 下の「背景画像・画像生成」で「画像を生成」→ 確認画面（店舗・日付・人数・写真なしの人・並び順）→「この内容で生成」
8. プレビューを確認 →「PNG で保存」（`shift_<店舗>_<日付>_1447x2048.png`）

- 画像は画面の入力内容で作る（未保存でも生成できるが、確認画面に「まだ保存されていません」と表示）。入力を変えると生成済みの画像は消える（古い画像を保存しないため）。

## 3. 背景の登録（店舗ごとに 1 回）

1. 「歌舞伎」を選んだ状態で、「背景画像を選択」から PNG / JPEG（8MB まで）を選ぶ → プレビュー →「背景・設定を保存」
2. 「秋葉原」に切り替えて同じように登録
3. 以後は店舗ボタンを押すだけで背景が切り替わる（毎回の登録は不要）。手動・自動どちらのモードでも同じ背景を使う
- 背景は切り抜かずに全体を収める。配置領域・余白の色の詳細は「背景画像固定・キャスト自動配置」の章を参照。

## 4. キャスト画像（写真）の登録

1. 「写真未登録」の行の「写真を登録」→ 名前入りのカード画像（PNG / JPEG・3MB まで・100〜6000px）を選ぶ
2. テスト用 Drive の「Shift Image Manager TEST Cast Photos」フォルダに保存され、「キャスト画像」シートにキャストIDが記録される
3. 「編集保存」で、その日のシフトに紐付けを保存する
- 同じ名前が既に登録されている場合は確認が出る:「OK」= 登録済みの人の写真を差し替え／「キャンセル」→ 次の確認で「同じ名前の別のキャストとして登録」するか選ぶ
- 「写真を差し替え」（登録済みの人）は、その人を使っている他の日付の画像にも反映される（差し替え前に確認が出る）
- 既存の画像フォルダ（自動モードと共通）の画像は、この画面からは差し替えない（Drive 側で管理）

## 5. 必要な設定（Script Properties / ID管理。キー名のみ）

| キー | 用途 | テスト環境 | 本番 |
|---|---|---|---|
| `APP_ENV` / `SPREADSHEET_ID` | 環境ガード（既存） | `test` / テスト用 ID | 既存どおり |
| `DRIVE_CAST_PHOTO_FOLDER_ID` | 手動モードで登録する写真の保存先 | 未設定なら初回登録時に自動作成し記録 | **必須**（未設定は `CAST_PHOTO_FOLDER_NOT_CONFIGURED`。既存の画像フォルダ・本番IDは指定不可） |
| `DRIVE_BACKGROUND_FOLDER_ID` | 背景の保存先（既存） | 自動作成 | 必須 |
| `DRIVE_IMAGE_FOLDER_ID` | 既存の画像フォルダ（読み取りのみ。写真の候補に使う） | 任意 | 既存どおり |
| `SHEET_MANUAL_SHIFT` / `SHEET_CAST_REGISTRY` | シート名（省略時「手動シフト」「キャスト画像」） | 省略可 | 省略可 |

OAuth スコープの追加は**なし**（背景機能で追加済みの `drive.file` を使う）。

## 6. ローカルでの起動・テスト

```bash
npm test                                          # 単体・GAS（手動モード 17 / 画面ロジック 6 を含む）
npm run test:transport
CDN_DIR=/path/to/node_modules npm run test:e2e    # Chromium（手動モード 12 項目を含む）

# テスト用ページ（Mac）
TEST_GAS_WEB_APP_URL='https://script.google.com/macros/s/<テスト用デプロイID>/exec' tools/build-test-site.sh
cd dist-test && python3 -m http.server 8080       # → http://localhost:8080/
```

## 7. テスト環境への反映（承認後）

| 順番 | 対象 | 手順 |
|---|---|---|
| 1 | 控え | テスト用 GAS のコード・`appsscript.json`、WebApp のバージョン番号、`dist-test/` を控える |
| 2 | テスト用 GAS | `tools/build-test-gas-bundle.sh` → `dist-gas-test/TestBundle.gs` でコードを置き換え（sha256 照合）。`appsscript.json` は変更なし |
| 3 | 確認 | エディタで `backgroundSelfTest()` を実行（スコープ・フォルダ・シート）。新しい権限の承認は不要の見込み（表示されたらご本人が承認） |
| 4 | テスト用 WebApp | 「デプロイを管理」→ 既存のテスト用デプロイを新バージョンに更新（URL 不変） |
| 5 | テスト用ページ | `tools/build-test-site.sh` で作り直して `dist-test/` を置き換え |
| 6 | 動作確認 | 2 章の手順（店舗切替・背景切替・追加/削除/並べ替え・保存/再読み込み・写真登録・3/9/13/20 人の生成・PNG）と、自動取得モードの表示 |

影響範囲: テスト用 Spreadsheet に「手動シフト」「キャスト画像」シート（初回保存時または初期シート生成時に作成）、テスト用 Drive に「Shift Image Manager TEST Cast Photos」フォルダ。既存シート・SIFT_DATA・本番は変更しない。

## 8. 復旧手順

- WebApp: 「デプロイを管理」で以前のバージョンを選び直す（URL は不変）
- GAS コード: 控えたコード・`appsscript.json` に戻して保存
- ページ: 控えた `dist-test/` に戻す
- データ: 「手動シフト」「キャスト画像」シートは自動モードから参照されないため、残しても影響しない（不要なら手動で削除）。Drive の写真ファイルも同様

## 9. トラブルシュート

| 表示 / コード | 原因・対処 |
|---|---|
| 接続先の GAS が手動モードに対応していません（UNKNOWN_ACTION） | GAS が古いバージョン。7 章の 2・4 を実施 |
| 他の端末で同じ店舗・日付の手動シフトが更新されています（REVISION_CONFLICT） | 入力は残っている。「再読み込み」で最新を確認し、入力し直して保存 |
| 同じ名前のキャストが複数います。写真を選んでください | 一覧の選択欄で該当するキャストを選ぶ（選ぶまで生成不可） |
| 名前とキャストID が一致しません（CAST_MISMATCH） / キャストID が見つかりません（UNKNOWN_CAST） | 画面を再読み込みして写真を選び直す |
| 「○○」は既に登録されています（CAST_NAME_EXISTS） | 差し替えるか、同名の別キャストとして登録するかを確認画面で選ぶ |
| CAST_PHOTO_FOLDER_NOT_CONFIGURED | 本番で写真の保存先が未設定。`DRIVE_CAST_PHOTO_FOLDER_ID` を設定 |
| DRIVE_WRITE_FAILED | `drive.file` の承認、保存先フォルダがアプリで作成したものかを確認（`backgroundSelfTest`） |
| 写真は 3MB 以下… / 100〜6000px…（IMAGE_TOO_LARGE / INVALID_IMAGE_SIZE / INVALID_IMAGE） | 写真の形式・大きさを確認 |
| 写真を取得できなかった人 N 件 | Drive のファイルが削除・権限変更された。写真を登録し直す |
| キャストは 40 人まで（TOO_MANY_CASTS） | 1 枚の画像は 40 人まで |
| 画像フォルダを読み込めませんでした | 既存の画像フォルダ（`DRIVE_IMAGE_FOLDER_ID`）にアクセスできない。手動で登録した写真は使える |

---

# 店舗別 Drive 画像フォルダ（手動モードの写真の自動表示）

## 1. 仕組み
- 店舗ごとの Drive フォルダにあるキャスト画像（名前入りカード）を、入力したキャスト名と**ファイル名**で照合して自動表示する。
- 照合: 拡張子を除いたファイル名と名前が一致するもの（空白・`@` 以降・末尾の `(1)`／コピー／番号は無視）。**前方一致はしない**（「ももか.png」は「もも」に出ない）。
- 一致するファイルが2つ以上（例「るん.png」「るん(1).png」）なら、一覧で選ぶまで写真を使わない。
- 保存はファイルID（`drive:<fileId>`）で行う。同名・改名があっても保存済みの紐付けは変わらない。名前とファイルが一致しない保存は拒否（CAST_MISMATCH）。
- 店舗フォルダを設定した店舗では、既存の共通画像フォルダ（`DRIVE_IMAGE_FOLDER_ID`）は使わない（他店舗のキャストの写真を出さないため）。未設定の店舗は従来どおり。
- 画面で登録した写真（キャスト画像シート）も候補に含める。店舗フォルダと両方あれば一覧で選ぶ。
- Drive は**読み取りのみ**（drive.readonly）。元画像の移動・削除・上書き・共有設定の変更はしない。
- 画像は Drive のサムネイル（長辺 800px）を data URL で受け取る。3MB を超える元画像でも取得できる。
- 一覧は 10 分キャッシュ。写真を追加したら画面の「写真を再検索」で読み直す。

## 2. 表示
| 表示 | 意味・対応 |
|---|---|
| 写真あり（店舗フォルダ） | 店舗フォルダの写真を使う |
| 写真あり（登録写真）／（画像フォルダ） | 画面で登録した写真／既存の共通フォルダ |
| 同名あり・写真を選択 | 候補が複数。選択欄で選ぶ |
| 写真を取得中… | 検索中 |
| 写真未登録 | フォルダに同名のファイルがない → ファイル名をキャスト名にして店舗フォルダへ追加し「写真を再検索」、または「写真を登録」 |
| 写真の取得に失敗／写真を確認できません | 通信・権限の問題。「写真を再検索」。直らなければフォルダの共有設定を確認 |
| 黄色の警告「…写真フォルダが設定されていません／読み込めません」 | Script Properties・フォルダの共有を確認 |

## 3. Script Properties（キー名のみ。テスト用 GAS と本番 GAS に別々に設定）
| キー | 用途 |
|---|---|
| `DRIVE_KABUKI_CAST_FOLDER_ID` | 歌舞伎のキャスト画像フォルダ（ID またはフォルダ URL） |
| `DRIVE_AKIBA_CAST_FOLDER_ID` | 秋葉原のキャスト画像フォルダ |

GAS の実行ユーザー（WebApp の「次のユーザーとして実行: 自分」）がフォルダを閲覧できること。権限（スコープ）の追加はなし（drive.readonly は既存）。

## 4. API
- `lookupCasts { store, names[], refresh? }` … store 必須。`refresh=true` でフォルダ一覧を読み直す
- `getManualPhotos { store, fileIds[] }` … 店舗フォルダ・登録写真・共通フォルダにあるファイルだけ返す
- `refreshImageCache`（ADMIN）で店舗フォルダのキャッシュも破棄
