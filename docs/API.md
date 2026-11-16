# API仕様書（Phase 1.5）

> **本番反映: 未実施。** 本書はローカル実装（ブランチ `local/phase1.5-shift-persistence`）の仕様です。
> 更新系 API は認証方式の承認まで **すべて `AUTH_NOT_CONFIGURED` で拒否** されます（[AUTH_DESIGN.md](AUTH_DESIGN.md)）。

## 1. 基本方針

- エンドポイント: GAS WebApp の `/exec`（`config.js` の `GAS_WEB_APP_URL`）
- **読み取り API**: GET（JSONP）または POST。副作用なし。認証不要。
- **更新 API**: **POST のみ**。GET / JSONP で呼ぶと `METHOD_NOT_ALLOWED`。サーバー側で認証・認可（`AuthService.requireEditor`）。
- 日付は内部・API とも **`YYYY-MM-DD`**。画面表示は `M月D日(曜)`（レスポンスの `dateLabel`）。
- 店舗は `KABUKI` / `AKIBA` の完全一致のみ。

## 2. リクエスト形式

### 読み取り（JSONP）
```text
{GAS_WEB_APP_URL}?action=getSavedShift&payload={"store":"KABUKI","date":"2026-11-16"}&callback=cb
```
GET では認証情報を受け付けません（URL・履歴・ログに残るため）。

### 更新（POST, Content-Type: text/plain）
```json
{
  "action": "saveShift",
  "payload": { "store": "KABUKI", "date": "2026-11-16", "expectedRevision": 3, "rows": [] },
  "auth": { "idToken": "（承認後の方式で取得。ログには残さない）" },
  "requestId": "再送判定用のID（同じ内容の再送は同じ値）"
}
```

## 3. レスポンス形式

```json
{ "success": true, "data": {}, "error": null, "elapsedMs": 120, "timestamp": "2026/11/16 12:00:00" }
```
```json
{ "success": false, "data": null, "code": "REVISION_CONFLICT", "message": "…",
  "error": { "code": "REVISION_CONFLICT", "message": "…", "action": "saveShift", "details": { "expectedRevision": 3, "currentRevision": 4 } } }
```

## 4. Action 一覧

| action | 種別 | 状態 | 概要 |
|---|---|---|---|
| getConfig | 読取 | 変更 | 公開設定（Spreadsheet ID・フォルダID は返さない） |
| getDateList | 読取 | 維持 | SIFT_DATA の `M月D日(曜)` 一覧（年なし） |
| getDateOptions | 読取 | **新規** | 年付き日付一覧 `[{label, date, ok, reason}]` |
| getSiftPreview | 読取 | 変更 | `date` は YYYY-MM-DD |
| getSavedShift | 読取 | **新規** | 店舗×日付の保存データ（画面表示用） |
| getShiftSnapshot | 読取 | **新規** | 投稿文・画像生成用の読み取り専用スナップショット |
| getImageList | 読取 | 互換 | `getSavedShift` と同じ。store / date 必須（旧シート参照なし） |
| initializeShift | 更新 | **新規** | 保存データが無い場合のみ SIFT_DATA から作成 |
| saveShift | 更新 | **新規** | 店舗×日付の編集内容を保存（revision 検証） |
| setCastAbsent | 更新 | 変更 | recordId 指定で休み/出勤を変更（revision 検証） |
| resetShiftFromSource | 更新 | **新規** | 明示確認付きで SIFT_DATA から再生成 |
| refreshImageCache | 更新 | 認証必須化 | Drive 画像キャッシュ更新 |
| checkImages | 更新 | 変更 | store / date 必須。画像チェックシートへ追記 |
| changeDateAndStore | 更新 | 互換 | `initializeShift` と同じ（**既存データを消さない**） |
| updateShiftRows | – | **廃止** | `LEGACY_API_REMOVED`。`saveShift` を使用 |

## 5. 読み取り API

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

共通: 認証・認可 → 入力検証 → `LockService`（最大10秒）→ ロック内で最新 revision を再取得・検証 → 書き込み。

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
| AUTH_NOT_CONFIGURED | 認証方式が未設定（現状の既定） | 「ログインが必要」と表示 |
| AUTH_REQUIRED / AUTH_INVALID | 認証情報なし／不正 | 同上 |
| FORBIDDEN | 許可リストにない利用者 | 権限なしと表示 |
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

## 8. 互換性・移行計画

| 旧 API | 対応 |
|---|---|
| changeDateAndStore | 維持（認証・POST 必須）。**初期化ではなく「無ければ作成」** に変更。旧フロントから呼ばれても保存データは消えない |
| getImageList | 維持（読み取り）。store / date 必須 |
| updateShiftRows | 廃止。店舗・日付・revision を持たず安全に維持できないため |
| setCastAbsent（row 指定） | 廃止。recordId / store / date / expectedRevision 必須 |
| refreshImageCache / checkImages | 維持（認証・POST 必須）。checkImages は store / date 必須 |

旧フロント（`app.js` 旧版）は更新操作ができなくなるため、GAS とフロントは **同時に** 反映する（README「デプロイ手順」）。
