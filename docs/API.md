# API仕様書（Phase 1.6）

> **本番反映: 未実施。** 本書はローカル実装（ブランチ `local/phase1.6-google-auth`）の仕様です。
> 認証・認可の詳細は [AUTH_DESIGN.md](AUTH_DESIGN.md)。

## 1. 基本方針

- エンドポイント: GAS WebApp の `/exec`（`config.js` の `GAS_WEB_APP_URL`）
- **すべての API は POST**（`Content-Type: text/plain;charset=utf-8`、本文は JSON）。独自ヘッダー・URL クエリは使わない。
- **公開 API**（`getPublicConfig` / `getConfig`）のみ認証不要。GET（JSONP）でも取得可。
- **それ以外はすべて Google ID トークン必須**（読み取りを含む）。トークンは本文の `auth.idToken`。GET で呼ぶと `METHOD_NOT_ALLOWED`。
- 認証（署名検証）→ 認可（許可リスト・ロール）→ 入力検証 → 処理 の順。認可が完了するまで読み書きは一切行わない。
- 日付は `YYYY-MM-DD`、店舗は `KABUKI` / `AKIBA` の完全一致のみ。

## 2. リクエスト形式

```json
{
  "action": "saveShift",
  "payload": { "store": "KABUKI", "date": "2026-11-16", "expectedRevision": 3, "rows": [] },
  "auth": { "idToken": "（Google Identity Services の credential。ログには残さない）" },
  "requestId": "再送判定用のID（同じ内容の再送は同じ値）"
}
```

## 3. レスポンス形式

```json
{ "success": true, "data": {}, "error": null, "elapsedMs": 120, "timestamp": "2026/11/16 12:00:00" }
```
```json
{ "success": false, "data": null, "code": "REVISION_CONFLICT", "status": 409, "message": "…",
  "error": { "code": "REVISION_CONFLICT", "message": "…", "action": "saveShift", "details": { "expectedRevision": 3, "currentRevision": 4 } } }
```

`status` は GAS が HTTP ステータスを返せないための「相当値」です（401 再ログイン、403 権限なし、409 競合 など）。HTTP 自体は常に 200。

## 4. Action 一覧

| action | 必要なロール | 状態 | 概要 |
|---|---|---|---|
| getPublicConfig | 公開 | **新規** | ログイン前に必要な公開設定（`environment`, `authConfigured`, `googleClientId`, 店舗, 時間候補） |
| getConfig | 公開 | 変更 | `getPublicConfig` と同じ（Spreadsheet ID・フォルダID は返さない） |
| whoAmI | ADMIN / EDITOR | **新規** | 検証済みの `{ sub, email, role }` |
| getDateList | ADMIN / EDITOR | 認証必須化 | SIFT_DATA の `M月D日(曜)` 一覧（年なし） |
| getDateOptions | ADMIN / EDITOR | 認証必須化 | 年付き日付一覧 `[{label, date, ok, reason}]` |
| getSiftPreview | ADMIN / EDITOR | 認証必須化 | `date` は YYYY-MM-DD |
| getSavedShift | ADMIN / EDITOR | 認証必須化 | 店舗×日付の保存データ（画面表示用） |
| getShiftSnapshot | ADMIN / EDITOR | 認証必須化 | 投稿文・画像生成用の読み取り専用スナップショット |
| getImageList | ADMIN / EDITOR | 認証必須化 | `getSavedShift` と同じ。store / date 必須（旧シート参照なし） |
| initializeShift | ADMIN / EDITOR | 維持 | 保存データが無い場合のみ SIFT_DATA から作成 |
| saveShift | ADMIN / EDITOR | 維持 | 店舗×日付の編集内容を保存（revision 検証） |
| setCastAbsent | ADMIN / EDITOR | 維持 | recordId 指定で休み/出勤を変更（revision 検証） |
| resetShiftFromSource | **ADMIN** | ADMIN 限定化 | 明示確認付きで SIFT_DATA から再生成 |
| refreshImageCache | **ADMIN** | ADMIN 限定化 | Drive 画像キャッシュ更新 |
| checkImages | ADMIN / EDITOR | 維持 | store / date 必須。画像チェックシートへ追記 |
| changeDateAndStore | ADMIN / EDITOR | 互換 | `initializeShift` と同じ（**既存データを消さない**） |
| updateShiftRows | – | **廃止** | `LEGACY_API_REMOVED`。`saveShift` を使用 |

## 5. 読み取り API（すべて認証必須・POST）

### getDateOptions
- payload: `{}`
- data: `[{ "label": "11月16日(月)", "date": "2026-11-16", "ok": true, "reason": "" }, { "label": "3月3日(火)", "date": "", "ok": false, "reason": "AMBIGUOUS_DATE" }]`
- 年の確定ルール: 今日（JST）±185日以内で、曜日が一致する年が **ちょうど1つ** の場合のみ。それ以外は `ok:false`（画面では選択不可）。

### getSavedShift / getImageList
- payload: `{ "store": "KABUKI", "date": "2026-11-16" }`
- data:
```json
{
  "store": "KABUKI", "date": "2026-11-16", "dateLabel": "11月16日(月)",
  "revision": 3, "initialized": true, "savedAt": "2026/11/16 12:00:00",
  "editRows": [{ "recordId": "uuid", "sortOrder": 1, "castName": "ちょこ", "workTime": "18:00", "status": "出勤",
                 "imageStatus": "登録済み", "imageFileId": "", "imageName": "", "imageSource": "auto" }],
  "activeCastList": [], "absentCastList": [], "imageOptions": [], "missingImages": [], "updatedAt": "12:00:00"
}
```
- 保存データが無い場合: `initialized:false`, `revision:0`, `editRows:[]`（作成はしない）
- `activeCastList` には画像が無いキャストも含む（`imageUrl:""`）。

### getShiftSnapshot
```json
{ "store": "KABUKI", "date": "2026-11-16", "dateLabel": "11月16日(月)", "revision": 3, "initialized": true,
  "casts": [{ "recordId": "uuid", "sortOrder": 1, "castName": "ちょこ", "workTime": "18:00", "status": "出勤",
              "imageFileId": "", "imageSource": "auto", "resolvedImageFileId": "drive-file-id" }] }
```
`imageSource`: `manual`（差込画像）→ `auto`（名前一致）→ `preparing`（準備中画像）→ `none`

## 6. 更新 API

共通: 認証（ID トークン署名検証）・認可（許可リスト・ロール）→ 入力検証 → `LockService`（最大10秒）→ ロック内で最新 revision を再取得・検証 → 書き込み。

| action | payload | 成功時 data |
|---|---|---|
| initializeShift | `store, date` | getSavedShift と同じ + `created`（既存データがあれば `false` で上書きしない） |
| saveShift | `store, date, expectedRevision, rows[]` | getSavedShift と同じ + `replayed` |
| setCastAbsent | `store, date, recordId, isAbsent, expectedRevision` | 同上 |
| resetShiftFromSource | `store, date, expectedRevision, confirmation` | 同上。`confirmation` は `KABUKI:2026-11-16` 形式で完全一致 |
| checkImages | `store, date` | `{ missingCount, missingNames }` |
| refreshImageCache | `{}` | `{ imageCount, cached, cacheReason, ... }` |

`saveShift.rows[]`: `{ recordId?, castName, workTime, status, sortOrder, imageFileId }`
- `recordId` 省略 = 新規追加。対象店舗×日付に存在しない recordId は `RECORD_NOT_FOUND`。
- rows に含まれない既存キャストは削除扱い。0件も保存可能。
- `workTime` は 17:00〜22:00 の30分刻みまたは空、`status` は `出勤`/`休み`、`imageFileId` は画像フォルダ内のファイルIDのみ。最大78件。

## 7. エラーコード

| code | 意味 | 画面の扱い |
|---|---|---|
| AUTH_NOT_CONFIGURED (503) | 認証が未設定（AUTH_MODE / クライアントID）・BigInt 非対応 | ログイン機能が利用できない旨を表示 |
| AUTH_REQUIRED (401) | トークンなし | ログインボタン |
| AUTH_INVALID (401) | 形式・署名・iss・aud・azp・iat・sub・email・email_verified が不正 | 再ログイン |
| AUTH_EXPIRED (401) | 有効期限切れ | 再ログイン（入力は保持） |
| AUTH_KEYS_UNAVAILABLE (503) | Google 公開鍵を取得できない | 時間をおいて再試行 |
| FORBIDDEN (403) | 許可リスト未登録・無効・sub 不一致・重複・不正ロール・ロール不足（`details.reason`） | 権限なし画面（本人の利用者IDを表示）／ロール不足は警告のみ |
| ACCESS_LIST_NOT_CONFIGURED / ACCESS_LIST_INVALID (403)、ACCESS_LIST_UNAVAILABLE (503) | 許可リストのシートなし・列構成不正・読み取り失敗（全員拒否） | 管理者対応 |
| METHOD_NOT_ALLOWED (405) | 保護 API を GET で呼んだ | – |
| METHOD_NOT_ALLOWED | 更新 API を GET で呼んだ | – |
| LEGACY_API_REMOVED | 廃止 API | – |
| INVALID_STORE / INVALID_DATE / AMBIGUOUS_DATE | 入力不正 | エラー表示 |
| INVALID_REVISION / INVALID_ROWS / INVALID_IMAGE / INVALID_RECORD_ID / TOO_MANY_ROWS | 入力不正 | エラー表示 |
| REVISION_CONFLICT | 他端末・他画面が先に保存 | 競合パネル（入力は保持・最新を比較表示） |
| LOCK_TIMEOUT | 他の保存処理が実行中 | 少し待って再試行 |
| NOT_INITIALIZED / RECORD_NOT_FOUND | 対象データなし | エラー表示 |
| SIFT_NOT_FOUND | SIFT_DATA に投稿がない | 警告表示 |
| CONFIRMATION_REQUIRED | 初期化の確認不一致 | – |
| WRITE_VERIFY_FAILED / DATA_INCONSISTENT | 書き込み検証失敗／保存データ不整合 | エラー表示（README のトラブルシュート参照） |
| SETUP_REQUIRED / SCHEMA_MISMATCH | シート未作成／列構成不一致 | 管理者対応 |
| CONFIG_ENV_REQUIRED / CONFIG_ENV_MISMATCH / CONFIG_PRODUCTION_ID_IN_TEST / CONFIG_INVALID / CONFIG_UNAVAILABLE | 環境ガード（Phase 1.7）。全 API を停止 | 「安全のため停止しています」 |

## 7-2. 通信失敗時の扱い（フロント `assets/js/api.js`、Phase 1.7）

成功・失敗の判定は **応答 JSON の `success`（真偽値）だけ** で行う。読めない応答は成功扱いにしない。

| code | 状況 | 画面 |
|---|---|---|
| `NETWORK` | 通信できない、または CORS で応答を読めない（ブラウザは区別できない） | 「通信に失敗しました」。入力は保持 |
| `TIMEOUT` | 既定60秒（`APP_CONFIG.API_TIMEOUT_MS`）で中断 | 保存操作は「保存されたか確認」を案内 |
| `GAS_HTML_RESPONSE` | GAS が HTML（エラーページ・ログイン画面）を返した | WebApp URL・公開設定の確認を案内 |
| `INVALID_RESPONSE` | 不透明レスポンス（no-cors）、JSON でない、`success` が真偽値でない、HTTP 異常 | 失敗として表示 |
| `CONFIG_*` | サーバーの環境ガードで停止（本番ID混入・環境の取り違え・設定不足） | 「安全のため停止しています」 |

公開設定の `environment`（`production` / `test`）と `config.js` の `APP_ENV` が一致しない場合、フロントは停止する。

## 8. 互換性・移行計画

| 旧 API | 対応 |
|---|---|
| changeDateAndStore | 維持（認証・POST・ADMIN/EDITOR 必須）。**「無ければ作成」**（保存データを消さない） |
| getImageList | 維持（認証必須・POST）。store / date 必須 |
| getDateList / getSiftPreview 等の GET（JSONP） | **廃止**（Phase 1.6）。POST＋認証に移行 |
| updateShiftRows | 廃止。店舗・日付・revision を持たず安全に維持できないため |
| setCastAbsent（row 指定） | 廃止。recordId / store / date / expectedRevision 必須 |
| refreshImageCache / checkImages | 維持（認証・POST 必須）。checkImages は store / date 必須 |

旧フロント（Phase 1.5 以前の `app.js`）は認証を送らないため、新 GAS では読み取りもできない。GAS とフロントは **同時に** 反映する。
