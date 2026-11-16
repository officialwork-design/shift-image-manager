# Spreadsheet設計書

## 1. 基本方針

Google Spreadsheet は、このシステムの簡易データベースとして使用します。

コード側で固定値を持ちすぎず、運用変更しやすい値は `ID管理` シートで管理します。

## 2. Spreadsheet

| 項目 | 値 |
|---|---|
| ファイル名 | shift-image-manager |
| Spreadsheet ID | 1s-Ga2SpUWzoKQHSOymqo5MCO_wgdevFKrQWHUIKvct0 |

## 3. シート一覧

| シート名 | 用途 | 必須 |
|---|---|---:|
| ID管理 | URL / ID / シート名などの設定管理 | 必須 |
| 仕様書 | システム仕様の概要管理 | 必須 |
| 画像生成 | 選択中の店舗・日付、キャスト、休み設定を管理 | 必須 |
| SIFT_DATA | 外部から取得した投稿文データを保存 | 必須 |
| 画像操作ログ | 操作履歴を保存 | 必須 |
| 画像チェック | 画像未登録チェック結果を保存 | 任意 |
| エラーログ | GAS/APIエラーを保存 | 必須 |
| シフト編集 | 店舗×日付別の編集データ（Phase 1.5） | 必須 |
| シフト編集管理 | 店舗×日付別の保存状態・コミット済み revision（Phase 1.5） | 必須 |
| アクセス権限 | Google ログインの許可リスト（googleSub / role / enabled）（Phase 1.6） | 必須 |

## 4. ID管理

### 目的

GASやフロントで使用するID・URL・シート名を管理します。

### ヘッダー

| 列 | 項目 | 内容 |
|---|---|---|
| A | key | 設定キー |
| B | value | 設定値 |
| C | type | url / id / sheet / text など |
| D | description | 説明 |
| E | editable | 運用者が編集してよいか |
| F | updatedAt | 更新日時 |
| G | memo | メモ |

### 初期設定

| key | value | 用途 |
|---|---|---|
| GAS_WEB_APP_URL | 空欄 | GAS WebApp URL。デプロイ後に入力 |
| GITHUB_REPOSITORY | https://github.com/officialwork-design/shift-image-manager.git | GitHubリポジトリ |
| GITHUB_PAGES_URL | https://officialwork-design.github.io/shift-image-manager/ | GitHub Pages URL |
| SPREADSHEET_ID | 1s-Ga2SpUWzoKQHSOymqo5MCO_wgdevFKrQWHUIKvct0 | Spreadsheet ID |
| SCRIPT_ID | 1m0G9Y3ATR885RDD1LBEjp5Zsc5Ts4qv_hq1q9kFw3Xe0WmKy5DQVnATS | GAS Script ID |
| DRIVE_IMAGE_FOLDER_ID | 1Ob0yiSr0yP_sHa72t9xg8xmGn5YEUYR- | 画像取得フォルダ |
| DRIVE_IMAGE_FOLDER_IDS | 17zZbEhzgr3Fp_yfdox3zWLhO5kSUwvhZ | 追加画像取得フォルダ。カンマまたは改行区切りで複数指定可 |
| DRIVE_OUTPUT_FOLDER_ID | 空欄 | 現時点では未使用 |
| SHEET_IMAGE_GENERATION | 画像生成 | 画像生成シート名 |
| SHEET_SIFT_DATA | SIFT_DATA | SIFT_DATAシート名 |
| SHEET_OPERATION_LOG | 画像操作ログ | 操作ログシート名 |
| SHEET_IMAGE_CHECK | 画像チェック | 画像チェックシート名 |
| SHEET_ERROR_LOG | エラーログ | エラーログシート名 |
| TIMEZONE | Asia/Tokyo | タイムゾーン |
| APP_MODE | production | 動作モード |
| SHEET_SHIFT_EDIT | シフト編集 | 店舗×日付別 編集データ |
| SHEET_SHIFT_EDIT_MANAGE | シフト編集管理 | 店舗×日付別 保存状態 |
| SHEET_ACCESS_CONTROL | アクセス権限 | 許可リスト |
| LIFF_ID | 空欄 | 将来用 |

## 5. 仕様書

### 目的

Spreadsheet上でも構成・運用方針を確認できるようにするシートです。

### ヘッダー

| 列 | 項目 | 内容 |
|---|---|---|
| A | 章 | 章番号 |
| B | 項目 | 項目名 |
| C | 内容 | 説明 |

## 6. 画像生成（旧・Phase 1.5 以降は読み取り専用）

> Phase 1.5 以降、アプリはこのシートに**書き込みません**。旧データの移行元（`MigrationService`）としてのみ読み取ります。
> 編集データは「シフト編集」「シフト編集管理」に保存されます。

### 目的（旧仕様）

現在選択中の店舗・日付・抽出キャスト・休み設定を管理していました（1店舗・1日分のみ）。

### 使用セル

| セル / 範囲 | 内容 |
|---|---|
| A1 | 選択中の日付 |
| C1 | 選択中の店舗 |
| H3:H80 | 並び順 |
| I3:I80 | キャスト名 |
| J3:J80 | 出勤時間 |
| K3:K80 | 状態 |
| L3:L80 | 画像状態 |
| M3:M80 | 手動差し込み画像 fileId |

### 休み設定

| 値 | 意味 |
|---|---|
| 出勤 | 画像プレビューに表示 |
| 休み | 非表示 / 休み設定 |

## 6-2. シフト編集（Phase 1.5）

1行 = 1キャスト × 1世代。保存のたびに新しい revision の行一式を**追記**します（既存行は書き換えない）。
列はすべて「書式なしテキスト」（日付・時刻の自動変換を防ぐ）。

| 列 | 項目 | 内容 |
|---|---|---|
| A | recordId | キャストレコードの安定ID（UUID）。保存をまたいで維持 |
| B | store | `KABUKI` / `AKIBA` |
| C | date | `YYYY-MM-DD` |
| D | castName | キャスト名 |
| E | workTime | `HH:MM` または空 |
| F | status | `出勤` / `休み` |
| G | sortOrder | 1 から連番 |
| H | imageFileId | 手動差込画像の Drive ファイルID（空 = 自動照合） |
| I | createdAt | レコード作成日時 |
| J | updatedAt | この世代の保存日時 |
| K | revision | 世代番号 |

- 読み取り時は「シフト編集管理」の revision と一致する行だけを使う。
- 店舗×日付ごとに直近 `SHIFT_STORAGE.KEEP_GENERATIONS`（既定3）世代を保持し、それより古い行は保存時に削除。
- 管理行より新しい revision の行は「書き込み途中で失敗した未コミット行」で、読み取り対象外。次回保存時にロック内で削除。

## 6-3. シフト編集管理（Phase 1.5）

1行 = 1店舗×日付。**revision 列がコミットマーカー**です。

| 列 | 項目 | 内容 |
|---|---|---|
| A | key | `店舗:日付`（例 `KABUKI:2026-11-16`）。一意 |
| B | store | 店舗 |
| C | date | `YYYY-MM-DD` |
| D | revision | コミット済み世代（1以上） |
| E | initialized | `TRUE` = 保存データあり（0人でも TRUE） |
| F | rowCount | コミット済み世代の行数（整合性チェック用） |
| G | createdAt | 初回作成日時 |
| H | updatedAt | 最終更新日時 |
| I | updatedBy | 更新者（サーバー側で検証済みの利用者） |
| J | lastRequestId | 最後に成功した更新の requestId（再送の二重更新防止） |
| K | source | `sift` / `edit` / `absent` / `reset` / `migration` |

- この行が無い店舗×日付は「未保存」。0人保存は `initialized=TRUE, rowCount=0`。
- 手作業で編集しないこと（`DATA_INCONSISTENT` の原因になります）。

## 6-4. アクセス権限（Phase 1.6）

Google ログインした利用者のうち、ここに登録され有効な利用者だけが API を利用できます。**空 = 全員拒否。**

| 列 | 項目 | 内容 |
|---|---|---|
| A | googleSub | Google アカウントの不変ID（数字）。**書式なしテキスト**（数値で保存された行は無効） |
| B | email | 表示・確認用（照合には使わない） |
| C | role | `ADMIN` / `EDITOR` |
| D | enabled | `TRUE`（またはチェックボックスのオン）のみ有効 |
| E | createdAt | 登録日時 |
| F | updatedAt | 更新日時 |
| G | note | メモ |

- 照合は googleSub のみ。メールアドレスが一致しても sub が違えば拒否。
- 同じ googleSub が複数行ある場合、その利用者は拒否（他の利用者には影響しない）。
- 追加はメニュー「アクセス権限の追加」または手入力（A 列を書式なしテキストにしてから）。API からは変更できない。
- 初期シート生成ではヘッダーのみ作成し、既存の行は変更しない。

## 7. SIFT_DATA

### 目的

外部から取得した投稿文を保存します。

### 構造

```text
1行目: KABUKI
2行目: AKIBA
列方向: 日付別投稿
```

### 例

| セル | 内容 |
|---|---|
| A1 | KABUKI 7月1日投稿 |
| B1 | KABUKI 7月2日投稿 |
| A2 | AKIBA 7月1日投稿 |
| B2 | AKIBA 7月2日投稿 |

### 読み取りルール

1. 選択店舗から対象行を決定する。
2. 対象行の投稿文を左から右へ走査する。
3. 選択日付（`M月D日(曜)`）を含むセルを対象投稿として採用する。直前が数字の場合は一致としない（`11月1日` が `1月1日` に一致しない）。
   複数一致した場合は最も左の列を採用する。
4. 投稿文からキャスト名を抽出する。

### 店舗行

| 店舗 | 行 |
|---|---:|
| KABUKI | 1 |
| AKIBA | 2 |

上記以外の店舗名はエラー（以前は KABUKI 以外をすべて2行目として扱っていた）。

## 8. 画像操作ログ

### 目的

画面操作やデータ変更履歴を記録します。

### ヘッダー

| 列 | 項目 |
|---|---|
| A | 日時 |
| B | 操作種別 |
| C | 店舗 |
| D | 日付 |
| E | キャスト名 |
| F | 行番号 |
| G | 操作値 |
| H | userId |
| I | displayName |
| J | 結果 |
| K | 詳細 |

## 9. 画像チェック

### 目的

画像未登録チェックの結果を記録します。

### ヘッダー

| 列 | 項目 |
|---|---|
| A | 日時 |
| B | 種別 |
| C | キャスト名 |
| D | 詳細 |

## 10. エラーログ

### 目的

GAS/APIで発生したエラーを記録します。

### ヘッダー

| 列 | 項目 |
|---|---|
| A | 日時 |
| B | action |
| C | message |
| D | stack |
| E | payload |
| F | userAgent |

## 11. 初期生成ルール

必要なシートが存在しない場合、GAS側で初期生成できるようにします。

ただし、既存データを削除する処理は禁止します。

「シフト編集」「シフト編集管理」は、存在しなければヘッダー付きで作成し、存在すればヘッダーを検証するだけです（不一致は `SCHEMA_MISMATCH`、修復・クリアはしない）。

## 12. 注意事項

- `SIFT_DATA` の投稿文はセル内改行を許可します。
- 投稿文の表記ゆれを前提に、GAS側で名前抽出時に整形します。
- 画像ファイル名とキャスト名の一致が重要です。
- `ID管理` の key 名はコードから参照されるため、安易に変更しないでください。
