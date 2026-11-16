# 認証・認可 設計書（Phase 1.6：Google ログイン＋ID トークン検証＋許可リスト）

> **状態: ローカル実装・モックテスト完了／実環境（実 GAS・実 Google ログイン）での検証は未実施／本番未反映。**
> 本書の設定値はすべてキー名のみ。実値（クライアントID・メールアドレス・sub）は記載しない。

## 1. Google ログインの仕組み

```text
ブラウザ（GitHub Pages）
  1. getPublicConfig（公開 API）で OAuth クライアントIDを取得
  2. Google Identity Services（Sign In With Google）でログイン → ID トークン（JWT, 有効期限 約1時間）を受け取る
  3. 以降の API はすべて POST 本文 { action, payload, auth: { idToken } } で送信
GAS WebApp（doPost）
  4. GoogleIdTokenVerifier: Google 公開鍵（JWKS）で RS256 署名を検証し、iss / aud / azp / exp / iat / sub / email / email_verified を確認
  5. AccessControlService: 「アクセス権限」シートを googleSub（= トークンの sub）で照合し、enabled と role を確認
  6. ApiRouter: action ごとの許可ロールを確認 → ここまで成功した場合のみ処理（読み取り・更新）を実行
```

- 本人確認はサーバー側の署名検証のみで行う。クライアントが送るメールアドレス等は使わない。
- Google ログインに成功しただけでは何もできない（許可リストに登録された sub だけが利用可能）。

## 2. 技術検証の結果（GitHub Pages ＋ GAS）

| 項目 | 結論 | 根拠・対応 |
|---|---|---|
| GIS の初期化・ID トークン取得 | 成立（実機未検証） | `google.accounts.id.initialize / renderButton / prompt`。callback の `credential` が ID トークン |
| トークン更新 | GIS の ID トークンにリフレッシュはない | 期限（約1時間）が近づいたら再ログイン（ボタン or 自動選択）。残り60秒未満のトークンは送信しない |
| doPost でのヘッダー取得 | **不可**（GAS のイベントオブジェクトに HTTP ヘッダーは含まれない） | トークンは **POST 本文** で受け渡す |
| `Authorization` ヘッダー | 使用不可 | 付けるとプリフライト（OPTIONS）が発生し、GAS は OPTIONS に応答できない |
| `Content-Type` | `text/plain;charset=utf-8` | CORS の「単純リクエスト」となりプリフライトなし（`application/json` は不可） |
| リダイレクト | GAS の `/exec` は 302 で `script.googleusercontent.com` に転送し、そこで `Access-Control-Allow-Origin: *` 付きで応答 | `fetch(..., { redirect: 'follow', credentials: 'omit' })` で応答を読める（Phase 1.5 以前から同方式の POST を利用） |
| WebApp 公開設定 | `ANYONE_ANONYMOUS` / `USER_DEPLOYING` を維持 | 「Google アカウント必須」にすると Cookie 前提のログイン転送になり、クロスオリジン fetch が失敗する。本人確認はアプリ側で行う |
| サーバー側のトークン検証 | 成立（ローカル） | GAS に RSA 検証関数がないため RFC 8017 の手順で検証（下記 11 章）。`UrlFetchApp` で JWKS 取得 → `script.external_request` スコープが必要 |
| URL へのトークン掲載 | しない | GET は公開設定のみ。保護 API を GET で呼ぶと `METHOD_NOT_ALLOWED` |

**判定: 技術的には成立する見込み。ただし実 GAS・実ブラウザでの疎通は未検証**（作業環境から Google / GAS へ接続できないため）。
実環境で成立しなかった場合の代替案は 17 章。

## 3. Google Cloud OAuth 設定手順（テスト用 → 本番の順に、承認後に実施）

1. Google Cloud Console でプロジェクトを選択（または作成）。GAS の既定プロジェクトとは別でもよい（ID トークンの aud は OAuth クライアントIDで決まる）。
2. 「API とサービス」→「OAuth 同意画面」（4 章）を設定。
3. 「認証情報」→「認証情報を作成」→「OAuth クライアント ID」→ 種類「**ウェブ アプリケーション**」。
4. 「承認済みの JavaScript 生成元」（5 章）を登録。リダイレクト URI は不要（ポップアップ／One Tap 方式）。
5. 作成されたクライアントID（`xxxxxxxx.apps.googleusercontent.com`）を GAS の Script Properties `GOOGLE_OAUTH_CLIENT_ID` に設定（6 章）。**クライアントシークレットは使わない・どこにも保存しない。**
6. テスト環境と本番で **別のクライアントID** を使う（aud が異なるため、テスト用トークンは本番で使えない）。

## 4. OAuth 同意画面

- ユーザーの種類: Google Workspace 組織内のみで使う場合は「内部」、個人の Google アカウントも使う場合は「外部」。
- スコープ: 追加不要（Sign In With Google の既定 `openid email profile` のみ）。機密スコープを使わないため Google の審査は不要。
- 「外部」でテスト段階のときは、テストユーザーに利用者を登録。運用開始時は「本番環境」に公開。
- アプリ名・サポートメール・ホームページ（GitHub Pages）を設定。

## 5. 承認済みの JavaScript 生成元

| 環境 | 生成元 |
|---|---|
| 本番 | `https://officialwork-design.github.io`（パスは含めない） |
| テスト（任意） | テスト用の公開 URL のオリジン、ローカル確認用に `http://localhost:ポート` |

## 6. GAS 側の設定

| 項目 | 設定 |
|---|---|
| `appsscript.json` | `oauthScopes` に `https://www.googleapis.com/auth/script.external_request` を追加（JWKS 取得用）。**ローカルのマニフェストは変更済み。反映時に再承認が必要** |
| WebApp | 実行ユーザー: 自分（USER_DEPLOYING）、アクセス: 全員（匿名を含む）＝現状維持 |
| Script Properties | 7 章 |
| シート | メニュー「初期シート生成」で「アクセス権限」を作成（ヘッダーのみ＝全員拒否） |

## 7. Script Properties（キー名のみ）

| キー | 値 | 備考 |
|---|---|---|
| `AUTH_MODE` | `google_id_token` | これ以外・未設定はすべての保護 API を拒否 |
| `GOOGLE_OAUTH_CLIENT_ID` | OAuth クライアントID | `….apps.googleusercontent.com` 形式以外は無効扱い |

Phase 1.5 の `SHIFT_EDITOR_EMAILS` は廃止（許可リストはシートで管理）。秘密情報（クライアントシークレット等）は不要。

## 8. 許可リスト（アクセス権限シート）

| 列 | 項目 | 内容 |
|---|---|---|
| A | googleSub | Google アカウントの不変ID（数字）。**書式なしテキストで保存**（数値にすると桁落ちするため数値は無効扱い） |
| B | email | 表示・確認用。照合には使わない |
| C | role | `ADMIN` / `EDITOR` |
| D | enabled | `TRUE` のみ有効（チェックボックス可）。それ以外は無効 |
| E | createdAt | 登録日時 |
| F | updatedAt | 更新日時 |
| G | note | メモ |

拒否条件（すべて「拒否側」に倒す）: シートなし（`ACCESS_LIST_NOT_CONFIGURED`）、列構成不正（`ACCESS_LIST_INVALID`）、読み取り失敗（`ACCESS_LIST_UNAVAILABLE`）、空（`FORBIDDEN/ACCESS_LIST_EMPTY`）、未登録（`NOT_REGISTERED`）、メールは一致するが sub 不一致（`SUB_MISMATCH`）、sub 重複（`DUPLICATE_SUB`）、不正ロール（`INVALID_ROLE`）、sub が数値・不正（`INVALID_SUB`）、無効（`DISABLED`）。

API から許可リストを追加・変更する機能はない（スプレッドシートの編集権限を持つ管理者のみが変更できる）。

## 9. 初期 ADMIN 登録手順（承認された管理者のみ）

1. 管理者本人が GitHub Pages で Google ログインする → 「このアカウントには利用権限がありません」画面に **メール** と **利用者ID（sub）** が表示される（本人の情報のみ。トークン署名検証済みの値）。
2. スプレッドシートの所有者（編集者）が、メニュー「画像シフト管理 → アクセス権限の追加」で sub・メール・`ADMIN` を入力（sub は文字列として保存され、重複は拒否）。
   - 手入力する場合は A 列を「書式なしテキスト」にしてから入力する。
3. 管理者が再読み込みしてログイン → 利用開始。
4. EDITOR の追加も同じ手順（本人がログインして表示された利用者IDを管理者に伝える）。
5. 削除・一時停止は enabled を `FALSE` にする（行を残すと履歴が分かる）。

## 10. ADMIN / EDITOR の権限

| 操作 | API | ADMIN | EDITOR | 未登録・未ログイン |
|---|---|:-:|:-:|:-:|
| 公開設定（ログイン前） | getPublicConfig / getConfig | ○ | ○ | ○ |
| ログイン確認 | whoAmI | ○ | ○ | × |
| 日付一覧・SIFT 原本・保存データ・スナップショット・画像一覧 | getDateOptions / getDateList / getSiftPreview / getSavedShift / getShiftSnapshot / getImageList | ○ | ○ | × |
| 初回作成・編集保存・休み変更・画像選択（保存に含む）・画像未登録チェック | initializeShift / changeDateAndStore / saveShift / setCastAbsent / checkImages | ○ | ○ | × |
| 元データから初期化 | resetShiftFromSource | ○ | × | × |
| 画像キャッシュ更新 | refreshImageCache | ○ | × | × |
| 許可リストの管理 | （API なし。シート／メニュー） | シート編集者のみ | | |

ロール追加は `ACCESS_ROLES`（AccessControlService.gs）と `API_PROTECTED_ACTIONS`（ApiRouter.gs）に追記する。

## 11. ID トークンの検証方式

Google の推奨（本番では公開鍵でローカル検証）に従う。`tokeninfo` エンドポイントは Google がデバッグ用途と位置付けており、レート制限・可用性・1リクエストごとの外部依存があるため採用しない。

| 手順 | 内容 |
|---|---|
| 形式 | 文字列・4096 文字以下・`xxx.yyy.zzz`（base64url）。JSON・UTF-8 として不正なら拒否 |
| ヘッダー | `alg = RS256` のみ（`none` / `HS256` 等は拒否）、`kid` 必須、`crit` は拒否 |
| 公開鍵 | `https://www.googleapis.com/oauth2/v3/certs` を `UrlFetchApp` で取得し、`Cache-Control: max-age`（5分〜6時間）で CacheService に保存。未知の `kid` は1回だけ再取得（5分に1回まで）。鍵は `kty=RSA`、`e=AQAB`（65537）、2048bit 以上のみ |
| 署名 | RFC 8017 §8.2.2 RSASSA-PKCS1-v1_5 検証。署名長＝法の長さ、`s < n`、`m = s^65537 mod n`（BigInt）、期待値 `00 01 FF… 00 ‖ DigestInfo(SHA-256) ‖ SHA-256(header.payload)` を組み立てて **全バイト比較**（ASN.1 を解析しない）。SHA-256 は `Utilities.computeDigest` |
| iss | `accounts.google.com` または `https://accounts.google.com` |
| aud | Script Properties のクライアントIDと完全一致（文字列のみ。配列は拒否）。`azp` がある場合も一致必須 |
| exp | 現在時刻（許容誤差60秒）より後。切れていれば `AUTH_EXPIRED` |
| iat | 数値・未来すぎない（+60秒まで）・exp より前 |
| sub | 数字のみ（1〜255桁） |
| email / email_verified | email 必須、`email_verified` が true（または "true"）のみ |
| BigInt 非対応環境 | 検証せず `AUTH_NOT_CONFIGURED`（フェイルクローズ） |

**自前実装の妥当性と残るリスク**: 秘密鍵を扱わない「検証のみ」の標準手順で、Node.js（OpenSSL）の検証結果とランダム入力200件で一致することを確認済み。ただし暗号処理の自前実装であるため、本番反映前に第三者レビューを推奨する。より保守しやすい構成が必要な場合は 17 章の認証専用バックエンド（公式ライブラリ `google-auth-library` 等）を検討する。

## 12. API 通信方式

- すべて `POST {GAS_WEB_APP_URL}`、`Content-Type: text/plain;charset=utf-8`、本文 JSON：`{ action, payload, auth: { idToken }, requestId }`
- `credentials: 'omit'`（Google の Cookie を送らない）、独自ヘッダーなし、URL クエリなし。
- GAS は HTTP ステータスを返せないため、応答 JSON の `code` と `status`（401/403/409 等の相当値）で判定。
- フロントのトークンはメモリのみ（Web Storage・Cookie に保存しない）。ページ再読み込み時は GIS の自動選択（`auto_select` + `prompt()`）で再取得、できない場合はログインボタン。

## 13. CORS 制約

| 送信内容 | プリフライト | GAS で可否 |
|---|---|---|
| POST + `text/plain` + 標準ヘッダーのみ | なし | ○（採用） |
| POST + `application/json` | あり | ×（GAS は OPTIONS 非対応） |
| `Authorization: Bearer` ヘッダー | あり | ×（同上。かつ doPost でヘッダーを読めない） |
| `credentials: 'include'` | － | ×（応答の `Access-Control-Allow-Origin: *` と両立しない） |
| JSONP（`<script>`） | － | 本文を送れずトークンが URL に載るため保護 API には使わない |

## 14. GAS 公開設定

`access: ANYONE_ANONYMOUS` / `executeAs: USER_DEPLOYING` を維持。WebApp URL を知っていれば誰でも呼べるが、公開設定以外の API は ID トークン検証と許可リスト照合を通過しない限り処理されない。

## 15. テスト環境の構築手順（作成前に承認が必要）

1. テスト用 Spreadsheet（本番のコピーまたは空のシート＋テスト用 SIFT_DATA）
2. テスト用 GAS プロジェクト（`clasp create` → `.clasp.json` の scriptId をテスト用に差し替えたローカルコピーで `clasp push`）
3. テスト用 OAuth クライアントID（生成元にテスト用 URL を登録）
4. Script Properties に `AUTH_MODE` / `GOOGLE_OAUTH_CLIENT_ID`（テスト用）
5. テスト用 WebApp をデプロイし、テスト用ページ（GitHub Pages のフォーク・別ブランチ、またはローカル配信）の `config.js` に URL を設定
6. 確認項目: 実ブラウザでのログイン（Chrome / Safari / iOS）、POST 疎通、JWKS 取得、BigInt・`Utilities.computeDigest` の動作、LockService、実行時間、期限切れ・未登録・無効化・ロール拒否

## 16. ローカルテスト手順

```bash
npm test                                         # GAS モック（実 RSA 鍵で署名したテスト用トークン）＋フロント単体
CDN_DIR=/path/to/node_modules npm run test:e2e   # Chromium E2E（GIS・GAS はモック）
```

## 17. 実環境で成立しなかった場合の代替案

| 案 | 概要 | 構成変更 |
|---|---|---|
| Firebase Authentication ＋ Cloud Run（または Cloud Functions） | ログインは Firebase、API は Cloud Run が `firebase-admin` / `google-auth-library` でトークン検証し、Sheets API で読み書き | 新規 GCP リソース・サービスアカウント。GAS は移行またはバックエンドから呼び出し |
| Cloud Run の認証専用 API ＋ 既存 GAS | Cloud Run がトークン検証・許可リスト照合を行い、GAS にはサーバー間認証で中継 | 新規 GCP リソース。GAS を匿名公開から限定公開へ |
| GAS HtmlService へ画面移行 | WebApp を `USER_ACCESSING` / Google アカウント必須にし `google.script.run` を利用 | ホスティング変更。利用者全員に Spreadsheet / Drive の権限が必要 |

## 18. 本番反映・ロールバック

README「Phase 1.6」の手順を参照。
