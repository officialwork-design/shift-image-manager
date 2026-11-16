# 認証・認可 設計案（Phase 1.5 / 承認待ち）

> **状態: 設計承認待ち。** 現在のコードは更新系 API をすべて拒否する「フェイルクローズ」実装です（`gas/AuthService.gs`）。
> 本番で更新を有効にするには、以下のいずれかの方式の承認と、Google Cloud 側の設定が必要です。

## 1. 現在の構成で安全な認証が成立しない理由

| 前提 | 内容 |
|---|---|
| フロント | GitHub Pages（公開静的サイト・オリジン `officialwork-design.github.io`） |
| API | GAS WebApp `access: ANYONE_ANONYMOUS` / `executeAs: USER_DEPLOYING` |
| 通信 | 読み取りは JSONP（`<script>`）、更新は POST（`text/plain`） |

- `ANYONE_ANONYMOUS` では `Session.getActiveUser()` が空になり、GAS 側で利用者を特定できない。
- WebApp を `ANYONE`（Google ログイン必須）にしても、GitHub Pages からのクロスオリジン呼び出しでは Google の Cookie が送られない／CORS で読めない（GAS の応答は `Access-Control-Allow-Origin: *` のため資格情報付き fetch が不可。Safari 等はサードパーティ Cookie も遮断）。
- `config.js` に共有トークンを置く方式は公開サイトのため秘密にならない（禁止事項）。
- GAS には RSA 署名検証の組み込み関数がないため、ID トークン（JWT）をオフライン検証するには Google の公開鍵取得（`UrlFetchApp`）が必要 → `script.external_request` スコープの追加が必要。

## 2. 候補の比較

| 案 | 概要 | 必要な追加設定 | 長所 | 短所 |
|---|---|---|---|---|
| **A. Google ID トークン（推奨）** | ブラウザで Google Identity Services により ID トークン取得 → POST 本文で送信 → GAS が `https://oauth2.googleapis.com/tokeninfo` または公開鍵で検証（`aud`/`iss`/`exp`/`email_verified`）→ Script Properties の許可リストで認可 | Google Cloud で OAuth クライアント ID（ウェブ）作成、承認済み JavaScript 生成元に GitHub Pages を登録、`appsscript.json` に `script.external_request` 追加（再承認）、Script Properties 設定 | GitHub Pages を維持。サーバー側で本人確認。秘密情報をブラウザに置かない | GCP 設定が必要。トークン検証の外部通信（数百ms） |
| B. 画面を GAS HtmlService へ移設 | WebApp を `ANYONE`/ドメイン限定 + `executeAs: USER_ACCESSING` などにし、`google.script.run` で呼ぶ | ホスティング変更（GitHub Pages は案内ページのみ）、各利用者の OAuth 同意、Drive/Sheet の共有設定見直し | Google が認証を担保。トークン処理不要 | UI のホスティング変更。iframe 内表示・URL 変更。利用者全員に Spreadsheet/Drive 権限が必要（USER_ACCESSING の場合） |
| C. Firebase Authentication | Firebase で Google ログイン → ID トークンを GAS で検証 | Firebase プロジェクト作成、外部サービス追加、公開鍵検証 | 他ログイン方式にも拡張可 | 外部サービス追加。GAS 検証の手間は A と同等以上 |

## 3. 推奨（案 A）の詳細

1. **クライアント**: `index.html` に GIS ライブラリを追加し、`Api.setAuthProvider(async () => ({ idToken }))` を設定（`assets/js/api.js` は対応済み）。トークンはメモリのみで保持し、localStorage に保存しない。
2. **サーバー**: `AuthService.verifyIdentity_` に `AUTH_MODE = google_id_token` の検証器を実装。
   - `aud` = Script Properties `GOOGLE_OAUTH_CLIENT_ID`、`iss` ∈ {`accounts.google.com`, `https://accounts.google.com`}、`exp` > 現在、`email_verified = true`
   - 検証結果のメールアドレスを `SHIFT_EDITOR_EMAILS` と照合（クライアント送信のメールは使わない）
3. **ログ**: トークン実値は `LogService.redact` で伏字（実装済み）。
4. **読み取り API**: 現状どおり匿名可。シフト情報の閲覧も制限する場合は読み取りも POST + 認証へ移行する（JSONP 廃止）。

## 4. 承認が必要な事項

- 案 A / B / C のどれを採用するか
- Google Cloud プロジェクトでの OAuth クライアント ID 作成（案 A）
- `appsscript.json` への `https://www.googleapis.com/auth/script.external_request` 追加と再承認（案 A）
- 更新を許可する利用者（`SHIFT_EDITOR_EMAILS`）の確定
- 読み取り API を匿名公開のまま残すか

## 5. Script Properties（キー名のみ。値はドキュメントに書かない）

| キー | 用途 | 状態 |
|---|---|---|
| `AUTH_MODE` | 認証方式（未設定 = 更新拒否） | 承認後に設定 |
| `SHIFT_EDITOR_EMAILS` | 更新を許可するメールアドレス（カンマ/改行区切り） | 承認後に設定 |
| `GOOGLE_OAUTH_CLIENT_ID` | ID トークンの `aud` 検証（案 A） | 承認後に設定 |
