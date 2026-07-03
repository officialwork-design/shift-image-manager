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
| DRIVE_OUTPUT_FOLDER_ID | 空欄 | 現時点では未使用 |
| SHEET_IMAGE_GENERATION | 画像生成 | 画像生成シート名 |
| SHEET_SIFT_DATA | SIFT_DATA | SIFT_DATAシート名 |
| SHEET_OPERATION_LOG | 画像操作ログ | 操作ログシート名 |
| SHEET_IMAGE_CHECK | 画像チェック | 画像チェックシート名 |
| SHEET_ERROR_LOG | エラーログ | エラーログシート名 |
| TIMEZONE | Asia/Tokyo | タイムゾーン |
| APP_MODE | production | 動作モード |
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

## 6. 画像生成

### 目的

現在選択中の店舗・日付・抽出キャスト・休み設定を管理します。

### 使用セル

| セル / 範囲 | 内容 |
|---|---|
| A1 | 選択中の日付 |
| C1 | 選択中の店舗 |
| H3:H80 | キャスト名 |
| I3:I80 | 休み設定 |

### 休み設定

| 値 | 意味 |
|---|---|
| 空欄 | 出勤 |
| 休み | 非表示 / 休み設定 |

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
3. 選択日付を含むセルを対象投稿として採用する。
4. 投稿文からキャスト名を抽出する。

### 店舗行

| 店舗 | 行 |
|---|---:|
| KABUKI | 1 |
| AKIBA | 2 |

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

## 12. 注意事項

- `SIFT_DATA` の投稿文はセル内改行を許可します。
- 投稿文の表記ゆれを前提に、GAS側で名前抽出時に整形します。
- 画像ファイル名とキャスト名の一致が重要です。
- `ID管理` の key 名はコードから参照されるため、安易に変更しないでください。
