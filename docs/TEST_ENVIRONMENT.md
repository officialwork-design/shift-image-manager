# 独立テスト環境 構築・実通信検証手順（Phase 1.7）

> **状態: 手順・設定テンプレート・テストデータ・検証ツールを用意済み。外部リソースは未作成（承認待ち）。**
> 本番のスプレッドシート・GAS・Drive フォルダ・WebApp URL・OAuth クライアントは一切使わない。

## 1. 構成（本番と完全に分離）

```text
【本番】                                               【テスト】
GitHub Pages (officialwork-design.github.io)           テスト用ページ（dist-test/ を配置した HTTPS の URL）
   │ config.js APP_ENV=production                         │ config.js APP_ENV=test（tools/build-test-site.sh で生成）
   ▼                                                      ▼
本番 GAS（scriptId 1m0G…）                              テスト用 GAS（別プロジェクト）
   │ Script Properties: AUTH_MODE / CLIENT_ID             │ Script Properties: APP_ENV=test / SPREADSHEET_ID / AUTH_MODE / CLIENT_ID
   ▼                                                      ▼
本番 Spreadsheet / 本番 Drive                           テスト用 Spreadsheet / テスト用 Drive フォルダ
本番 OAuth クライアント                                  テスト用 Google Cloud プロジェクト・テスト用 OAuth クライアント
```

### 取り違え防止の仕組み（実装済み）

| 仕組み | 内容 |
|---|---|
| サーバー: 環境ガード（ConfigService） | 本番以外の GAS で `APP_ENV=test` が無い → 全 API 停止（本番の既定IDを使わせない）／本番 GAS に `APP_ENV=test` → 停止／テスト設定（Script Properties・ID管理シート）に本番のスプレッドシート・フォルダ・デプロイ・スクリプトIDが含まれる → 停止／テスト用スプレッドシートを開けない → 本番へフォールバックせず停止 |
| フロント: 環境一致確認 | `config.js` の `APP_ENV` とサーバーの `environment` が違えば画面を停止（ログインさせない） |
| 画面表示 | テスト環境ではナビゲーションに「テスト環境」バッジ |
| `tools/clasp-test-push.sh` | 一時ディレクトリにテスト用 `.clasp.json` を作って push。本番スクリプトIDなら中止。**リポジトリ直下の `clasp push` は本番に反映されるため使わない** |
| `tools/build-test-site.sh` | テスト用 `config.js` を生成。本番 WebApp URL なら中止 |
| `tools/cors-probe/*` | 本番 WebApp URL では実行しない |

## 2. 必要な Google サービスとアカウント

| 項目 | 用途 | 費用の目安 |
|---|---|---|
| Google Cloud プロジェクト（テスト専用） | OAuth 同意画面・OAuth クライアントID | 無料（課金アカウント不要。有料 API を有効化しない） |
| Apps Script プロジェクト（テスト専用） | テスト用 WebApp | 無料（UrlFetch 等は無料枠の範囲） |
| Google スプレッドシート（テスト専用） | テストデータ | 無料 |
| Google Drive フォルダ（テスト専用） | テスト用画像（`testdata/images`） | 無料 |
| テスト用ページの公開先（HTTPS） | 実ブラウザ・iOS からのアクセス | GitHub Pages（別の公開リポジトリ）なら無料。デスクトップのみなら `http://localhost` でも可（iOS は不可） |
| Google アカウント（オーナー） | 上記の作成者・WebApp の実行ユーザー | 組織の管理用アカウントを推奨（個人アカウント不可が望ましい） |
| Google アカウント（テスター） | ADMIN・EDITOR・未許可の確認（最低3アカウント。未許可は任意のアカウント） | ― |

## 3. 構築手順（承認後に実施）

### 3-1. Google Cloud（テスト専用プロジェクト）
1. Cloud Console で新規プロジェクトを作成（例: `shift-image-manager-test`）。
2. 「API とサービス」→「OAuth 同意画面」: ユーザーの種類（組織内なら「内部」、それ以外は「外部」＋テストユーザーにテスターを登録）、アプリ名・サポートメール。スコープは追加しない。
3. 「認証情報」→「OAuth クライアント ID」→「ウェブ アプリケーション」。
4. 「承認済みの JavaScript 生成元」にテスト用ページのオリジン（例 `https://<owner>.github.io`、ローカル確認用に `http://localhost:8080`）。リダイレクト URI は不要。
5. クライアントIDを控える（シークレットは使わない・保存しない）。

### 3-2. テスト用スプレッドシートと Drive
1. 新規スプレッドシートを作成（**本番のコピーは使わない**。ID管理シートに本番の値が持ち込まれると環境ガードで停止する）。
2. テスト用 Drive フォルダを作成し、`testdata/images/` の5枚をアップロード。共有設定は「リンクを知っている全員が閲覧可」（画面のサムネイル表示に必要。テスト用の架空画像のみ）。

### 3-3. テスト用 Apps Script
1. スプレッドシートとは別のスタンドアロン プロジェクトを作成（`clasp create --type standalone --title shift-image-manager-test` を空のディレクトリで実行、またはエディタで作成）し、スクリプトIDを控える。
2. ソースの反映: `TEST_SCRIPT_ID=<テスト用ID> tools/clasp-test-push.sh`（まず `--dry-run`）。
3. Script Properties（`deploy/test/script-properties.template.txt`）: `APP_ENV=test`、`SPREADSHEET_ID`、`AUTH_MODE=google_id_token`、`GOOGLE_OAUTH_CLIENT_ID`。
4. エディタで `setupShiftImageManager` を実行（初回は権限の承認。スコープ: スプレッドシート、Drive 読み取り、外部通信、UI）。
5. ID管理シートに `DRIVE_IMAGE_FOLDER_ID`（テスト用フォルダ）を入力（`deploy/test/id-management.template.csv`）。
6. `setupTestFixtures` を実行（SIFT_DATA に今日から7日分の架空シフトを作成）。
7. `authSelfTest` を実行し、実行ログで全項目 `ok: true` を確認（環境・BigInt・SHA-256・RS256 正/誤・JWKS 取得・Cache・Lock・認証設定・許可リスト）。
8. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」、実行ユーザー「自分」、アクセス「全員」。WebApp URL を控える。

### 3-4. テスト用ページ
1. `TEST_GAS_WEB_APP_URL=<テスト用 WebApp URL> tools/build-test-site.sh` → `dist-test/` を生成。
2. `dist-test/` を承認済みの公開先に配置（例: テスト用の別リポジトリの GitHub Pages）。ローカル確認だけなら `npx http-server dist-test -p 8080`。
3. ページを開き「テスト環境」バッジが出ることを確認。

### 3-5. 許可リスト
1. 各テスターがテスト用ページでログイン →「利用権限がありません」画面の利用者IDを管理者に連絡。
2. スプレッドシートのメニュー「アクセス権限の追加」で ADMIN・EDITOR を登録（`deploy/test/access-control.template.csv`）。未許可確認用のアカウントは登録しない。

## 4. 実通信テスト手順

### 4-1. HTTP レベル（curl）
`tools/cors-probe/curl-check.sh <テスト用 WebApp URL> <テスト用ページのオリジン>`

| # | 確認 | 期待値 |
|---|---|---|
| 1 | POST(text/plain) の応答 | 302 と `Location: https://script.googleusercontent.com/...`。**302 応答自体に `Access-Control-Allow-Origin`** があること（ブラウザは 302 にも CORS チェックを行う） |
| 2 | 転送先 | 200・JSON・`Access-Control-Allow-Origin: *` |
| 3 | OPTIONS | CORS 許可ヘッダーなし（＝プリフライトが必要な送り方は使えない） |
| 4 | 認証なし whoAmI | JSON の `AUTH_REQUIRED` |

### 4-2. ブラウザ（通信の成立条件）
テスト用ページの `tools/cors-probe/index.html` を Chrome・Safari（macOS）・iOS Safari で開き、「1. 基本検証」→「2. Google でログイン」→「3. 認証付き検証」。結果 JSON を保存して報告に添付。DevTools のネットワークで OPTIONS が出ていないことも確認。

成立の判定（**すべて**満たすこと）: ①POST 送信 ②GAS で受信 ③トークン検証 ④許可リスト照合 ⑤スプレッドシート更新 ⑥成功応答の取得 ⑦失敗応答の取得 ⑧画面へのエラー表示。`no-cors`（不透明レスポンス）は成功と判定しない。

### 4-3. アプリの機能（Chrome / Safari / iOS Safari）

| # | 操作 | 期待 |
|---|---|---|
| 1 | ログイン（ADMIN） | 利用者・ADMIN 表示 |
| 2 | KABUKI 日付を開く → 時間変更 → 保存 | 保存済み rev が上がる。スプレッドシート「シフト編集」に新しい revision の行 |
| 3 | AKIBA 別日 → 保存 → KABUKI に戻る | 保存内容が残る |
| 4 | 休み（画面）→ 保存 | 休み一覧に移る |
| 5 | 別ブラウザ（EDITOR）で同じ日を開き、片方で保存 → もう片方で保存 | 後の保存が競合表示・入力保持 |
| 6 | ADMIN で「元データから初期化」 | 確認入力後に再生成 |
| 7 | EDITOR で初期化 | ボタン無効（API も FORBIDDEN） |
| 8 | 未許可アカウントでログイン | 利用権限なし画面（利用者ID表示） |
| 9 | 1時間後（またはトークン期限切れ後）に保存 | 再ログイン帯 → 再ログイン後に保存できる |
| 10 | ログアウト | 画面のデータが消え、API を送らない |
| 11 | 再読み込み | 自動ログイン（できない環境ではボタン） |
| 12 | 許可リストで EDITOR を FALSE にして操作 | 利用権限なし画面 |
| 13 | 画像確認・差込画像 | テスト画像が表示・未登録（テストうみ等）が警告 |

結果は「PASS / FAIL / 未実施」で記録（`deploy/test/real-env-test-record.template.md`）。

## 5. テスト環境の削除手順
1. WebApp のデプロイをアーカイブ（Apps Script「デプロイを管理」）
2. テスト用 Apps Script プロジェクトを削除（ゴミ箱へ）
3. テスト用スプレッドシート・Drive フォルダを削除
4. OAuth クライアントIDを削除（Cloud Console「認証情報」）
5. Google Cloud プロジェクトをシャットダウン（30日後に完全削除）
6. テスト用ページ（別リポジトリ・Pages）を削除

本番には影響しない（共有している設定・データがないため）。
