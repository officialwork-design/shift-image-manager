# 認証・認可 設計書（Phase 1.6 実装 / Phase 1.7 レビュー・検証準備）

> **状態: ローカル実装・モックテスト・Chromium での通信模擬検証まで完了。実 GAS・実 Google ログイン・Safari/iOS での検証は未実施（テスト環境の作成承認待ち）。本番未反映。**
> Phase 1.7 の追記: 19 章（通信方式の検証結果）、20 章（署名検証レビュー）、21 章（代替構成比較）、22 章（本番採用条件）。
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
| 302 応答の CORS（Phase 1.7 で判明） | **実 GAS で要確認** | Fetch 仕様ではリダイレクト応答（302）自体にも CORS チェックがかかる。GAS の 302 に `Access-Control-Allow-Origin` が無いと応答を読めない（模擬サーバーで再現確認済み）。curl で確認する（TEST_ENVIRONMENT 4-1） |

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


---

## 19. 通信方式の検証結果（Phase 1.7）

### 19-1. 実施済み（ローカル・Chromium・GAS 模擬サーバー）
`tests/transport-emulation.test.js`。実際の `assets/js/api.js` を Chromium で動かし、GAS の既知の挙動（POST → 302 → 別オリジンの GET 応答・`ACAO: *`・OPTIONS 非対応）を再現したサーバーに送信。

| 確認 | 結果 |
|---|---|
| `text/plain` POST でプリフライト（OPTIONS）が発生しない | PASS（OPTIONS 0 回） |
| 302 の後、ブラウザは転送先を GET で取得し、応答 JSON を読める | PASS |
| Cookie を送らない（`credentials: 'omit'`） | PASS |
| トークンは本文のみ（URL にクエリなし） | PASS |
| 失敗応答（`success:false`）をコード付きで読める | PASS |
| HTML 応答（GAS のエラー・ログイン画面）を成功扱いしない（`GAS_HTML_RESPONSE`） | PASS |
| 転送先に `ACAO` が無い → 読めない（`NETWORK`） | PASS |
| **302 応答に `ACAO` が無い → 読めない（`NETWORK`）** | PASS（＝実 GAS で 302 に ACAO があることが成立の前提） |
| 対照: `application/json`・`Authorization` ヘッダー → OPTIONS が発生し失敗 | PASS |
| 対照: `no-cors` → 不透明レスポンス（内容を読めない。成功判定に使わない） | PASS |
| 対照: `credentials: 'include'` → `ACAO: *` と両立せず失敗 | PASS |
| タイムアウト | PASS |
| 検証ページ `tools/cors-probe/index.html` の判定ロジック（モック GAS） | PASS |

### 19-2. 未実施（テスト環境の作成承認後）
実 GAS の 302 / 転送先の CORS ヘッダー、実 Google ログイン（GIS・FedCM・自動選択）、実 GAS の V8 で BigInt・`computeDigest`・`UrlFetchApp`（`authSelfTest`）、Safari（macOS）・iOS Safari、実行時間、スプレッドシート更新。手順は [TEST_ENVIRONMENT.md](TEST_ENVIRONMENT.md)。

**判定: 「成立する見込み」。実環境の確認が完了するまで「成立」とは判定しない。**

## 20. RSA 署名検証・JWT 処理のセキュリティレビュー（Phase 1.7）

> これは開発者（Claude）によるセルフレビューであり、**第三者による監査ではない**。

### 20-1. 確認した項目
RS256 検証手順（RFC 8017 §8.2.2）、公開鍵の検証（kty / e / 鍵長 / alg / use）、JWKS 取得（HTTPS・リダイレクト不可・形式）、kid 照合、鍵ローテーション、キャッシュと期限、署名対象バイト列（`header.payload` の ASCII そのもの）、base64url デコード、JWT 形式、アルゴリズム、iss / aud / azp / exp / iat / sub / email / email_verified。

### 20-2. 見つかった問題と修正

| 重大度 | 内容 | 対応 |
|---|---|---|
| **高**（設定） | テスト用に GAS をコピーすると、既定値で **本番のスプレッドシート・Drive フォルダを参照**する構成だった（`Code.gs` の既定ID、ID管理シートの読み取り失敗時の本番フォールバック） | 環境ガードを実装（TEST_ENVIRONMENT 1 章）。テスト環境では本番IDを含む設定で全停止 |
| 中 | JSON の重複キーを後勝ちで受け入れていた（`{"sub":"A",…,"sub":"B"}`） | 重複キー（エスケープ表記違いを含む）を拒否。※署名済みデータ内でしか起きないため、Google 発行トークンでの実害は想定しにくい |
| 低 | base64url の非正規形（余りビットが 0 でない表記）を受け入れていた | 拒否（同じバイト列に複数表記を許さない） |
| 低 | ヘッダーの `jku` / `jwk` / `x5u` / `x5c` を無視していた（使用はしていない） | 明示的に拒否 |
| 低 | 有効期間（exp − iat）の上限がなかった | 2時間を上限に（Google の ID トークンは1時間） |
| 低 | JWKS 内の kid 重複・鍵数を考慮していなかった | 重複 kid の鍵は使わない・鍵は20個まで・空の JWKS は取得失敗扱い |
| 低（UI） | GAS が HTML（エラーページ等）を返した場合の判別がなかった | `GAS_HTML_RESPONSE` として表示。不透明レスポンスも失敗扱い |

### 20-3. 問題なしと判断した項目
`alg=none` / `HS256` すり替え（RS256 以外拒否、鍵はサーバー保持の JWKS のみ）、別クライアント向け（aud 完全一致・azp 一致）、期限切れ・未来の iat、改ざん（payload・署名・1ビット反転・切り詰め・先頭 0 追加・法以上の値・0）、別鍵・未知 kid、SHA-1 / SHA-512 / PSS 署名、e=3・1024bit 鍵、JWKS 取得失敗・HTML 応答・キャッシュ期限切れ後の再取得、巨大 JWT（4096 文字上限）、不正 JSON・非 UTF-8、`email_verified=false`。比較は全バイト（ASN.1 を解析しない）。OpenSSL との一致をランダム 200 件で確認。

### 20-4. 残存リスク
| リスク | 内容 | 緩和 |
|---|---|---|
| 自前の暗号検証コード | 標準手順だが、専門家のレビューを受けていない | 第三者レビュー、または 21 章 B/C への移行 |
| 実行環境依存 | GAS の BigInt・`computeDigest` の挙動は未確認 | `authSelfTest`（固定ベクトルで正/誤を確認）を実 GAS で実行 |
| 鍵の再取得枠の消費 | 未知の kid を送ると再取得が5分間止まる。直後に Google が新しい鍵で署名を始めると最大5分ログインできない | Google は新しい鍵を使用前に JWKS へ公開するため影響は小さい。発生時は時間をおいて再ログイン |
| exp の猶予60秒 | 期限後60秒までは受け付ける | 時計ずれ対策として許容 |
| トークンの再利用 | 同じ ID トークンは期限まで何度でも使える（ベアラー） | HTTPS のみ・メモリのみ保持・ログに残さない |

### 20-5. 結論
- **自前実装の維持: 条件付きで可**（22 章の条件をすべて満たした場合）。
- **第三者レビュー: 必要**（本番利用前）。
- Google 提供ライブラリへの置き換え: GAS では公式ライブラリを利用できないため、置き換えるなら認証専用バックエンド（21 章 B）になる。
- 重大な未修正の問題は現時点で見つかっていないが、上記レビュー前は「本番利用可能」と判定しない。

## 21. 代替構成の比較（通信が成立しない場合・保守性を優先する場合）

| 観点 | A. 現行（Pages＋GAS＋自前検証） | B. Pages＋Cloud Run（検証・API）＋Sheets/GAS | C. Firebase Auth＋Cloud Run＋Sheets | D. GAS HtmlService へ移行 |
|---|---|---|---|---|
| セキュリティ | 中〜高（自前検証のレビュー次第） | 高（`google-auth-library` で検証） | 高（Firebase Admin SDK） | 高（Google が認証。アプリでの検証不要） |
| 実装工数 | 小（実装済み） | 中（API 移植 1〜2 週） | 大（認証基盤・API 移植） | 中（UI を HtmlService へ、`google.script.run` 化） |
| 維持費 | 0円 | 小（Cloud Run 無料枠内の見込み・課金アカウント必要） | 小〜中（同上＋Firebase） | 0円 |
| 既存コード再利用 | 高 | 中（GAS ロジックを Node へ移植、または GAS を内部 API 化） | 低〜中 | 中（GAS ロジックは再利用、フロントは改修） |
| Google ログイン | GIS | GIS | Firebase（Google プロバイダ） | Google アカウント（自動） |
| モバイル | GIS の制約（FedCM 等）あり | 同左 | Firebase の制約あり | Google のログイン画面。iframe 表示の制約あり |
| 運用負担 | 小（自前コードの保守） | 中（GCP 運用・IAM） | 中〜大 | 小（ただし利用者ごとの権限管理が Google 側に移る） |
| 本番移行リスク | 小 | 中 | 大 | 中（URL・画面の変更） |

**推奨**: まず A をテスト環境で実証する（最小変更）。A の通信が成立しない場合は **D**（追加費用なし・Google が認証を担保）を第一候補、外部公開 URL や GitHub Pages の維持が必須なら **B**。いずれも構成変更のため承認を得るまで実装しない。

## 22. 本番採用条件（すべて必須）

1. テスト環境で `authSelfTest` の全項目が ok
2. curl で 302 応答・転送先の CORS ヘッダーを確認
3. Chrome・Safari（macOS）・iOS Safari で、`tools/cors-probe` の基本検証・認証付き検証が PASS
4. TEST_ENVIRONMENT 4-3 のアプリ機能テストがすべて PASS（未実施なし）
5. RS256 検証の第三者レビュー完了（または B/C への切り替え決定）
6. 本番用 OAuth クライアントID・初期 ADMIN の確定
7. 本番反映手順・ロールバック手順の承認
