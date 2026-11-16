# shift-image-manager 仕様書

## 1. システム概要

shift-image-manager は、SIFT_DATA シートに保存された店舗別・日付別の投稿文から出勤キャストを抽出し、Google Drive 内の画像と紐付けて画像シフトを管理する Web システムです。

## 2. 基本構成

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

## 3. 今回の方針

- LIFF URL は現時点では使用しない。
- フロントエンドは GitHub Pages で公開する。
- バックエンドは独立 Google Apps Script プロジェクトで作成する。
- データは Google Spreadsheet に保存する。
- 画像は Google Drive の指定フォルダから取得する。
- UI は Bootstrap 5.3 以上を標準とする。
- `google.script.run` は使用しない。

## 4. 使用サービス

| 区分 | サービス | 用途 |
|---|---|---|
| ソース管理 | GitHub | HTML / CSS / JS / GAS の管理 |
| 公開 | GitHub Pages | フロントエンド公開 |
| API | Google Apps Script WebApp | Spreadsheet / Drive 操作 |
| DB | Google Spreadsheet | 設定・SIFT_DATA・ログ保存 |
| 画像 | Google Drive | キャスト画像保存 |

## 5. URL / ID

| 項目 | 値 |
|---|---|
| GitHub Repository | https://github.com/officialwork-design/shift-image-manager.git |
| GitHub Pages | https://officialwork-design.github.io/shift-image-manager/ |
| GAS Script ID | 1m0G9Y3ATR885RDD1LBEjp5Zsc5Ts4qv_hq1q9kFw3Xe0WmKy5DQVnATS |
| Spreadsheet ID | 1s-Ga2SpUWzoKQHSOymqo5MCO_wgdevFKrQWHUIKvct0 |
| Drive Image Folder ID | 1Ob0yiSr0yP_sHa72t9xg8xmGn5YEUYR- |
| Drive Additional Image Folder ID | 17zZbEhzgr3Fp_yfdox3zWLhO5kSUwvhZ |

## 6. ID管理方針

ID類は Spreadsheet の `ID管理` シートで管理します。

通常運用で変更する可能性がある値は、Script Properties ではなく `ID管理` シートから読み取ります。

外部公開したくない秘密情報が必要になった場合のみ Script Properties を使用します。

## 7. 主要機能

- Google アカウントでのログインと許可リストによる利用制限（Phase 1.6）

- 店舗×日付別の編集データ永続保存（Phase 1.5）
- revision による楽観的排他制御・LockService による直列化（Phase 1.5）
- 未保存変更の検出と切り替え時の確認（Phase 1.5）
- 店舗選択
- 日付選択
- SIFT_DATA 投稿文確認
- 出勤キャスト抽出
- Drive画像取得
- 出勤中一覧表示
- 休み設定
- 画像未登録チェック
- 画像キャッシュ更新
- 操作ログ記録
- エラーログ記録

## 8. 店舗仕様

初期対象店舗は以下です。

- KABUKI
- AKIBA

## 9. SIFT_DATA仕様

`SIFT_DATA` シートは以下の構成とします。

```text
1行目: KABUKI
2行目: AKIBA
列方向: 日付別投稿
```

例:

```text
A1: KABUKI 7月1日投稿
B1: KABUKI 7月2日投稿
A2: AKIBA 7月1日投稿
B2: AKIBA 7月2日投稿
```

## 10. 画像取得仕様

Google Drive の `DRIVE_IMAGE_FOLDER_ID` と `DRIVE_IMAGE_FOLDER_IDS` に設定されたフォルダから画像を取得します。

`DRIVE_IMAGE_FOLDER_IDS` はカンマ区切りまたは改行区切りで複数指定できます。フォルダーIDだけでなく、Google Drive のフォルダーURLも指定できます。指定フォルダー配下のサブフォルダーも画像取得対象です。

画像ファイル名から拡張子を除いた文字列をキャスト名として扱います。

例:

```text
ひめる.png → ひめる
りさ.jpg → りさ
準備中.png → 準備中
```

キャスト画像が見つからない場合、`準備中` 画像が存在すれば代替表示します。

画像の優先順位: 手動差込画像（シフト編集 H列）→ 名前一致 → 準備中画像 → なし（プレースホルダ表示。出勤者一覧からは除外しない）。

Drive 画像索引は CacheService に保存します（100KB 上限）。超過・保存失敗時はキャッシュせずに処理を続行し、エラーログに1時間1回だけ警告を記録します。

## 11. UI方針

- Bootstrap 5.3 以上を使用する。
- モバイルファーストで設計する。
- 横スクロールを発生させない。
- card / row / col / modal / toast / alert / spinner / table を優先使用する。
- 独自CSSは最小限にする。

## 12. GitHub運用

```text
GitHub
↓
社内PCに clone / pull
↓
VS Codeで編集
↓
commit / push
↓
GitHub Pages反映
```

## 13. GAS運用

README の「GAS反映フロー」「Phase 1.5 デプロイ手順」を参照（clasp 運用が基本）。

## 14. Phase 1.5 仕様（店舗×日付別保存・安全化）

> **本番反映: 未実施。** ローカル実装・テストのみ完了。

### 14-1. 保存方式
- 編集データは「シフト編集」（1行=1キャスト×1世代）と「シフト編集管理」（1行=1店舗×日付、revision=コミットマーカー）に保存する。
- 識別キーは `店舗:YYYY-MM-DD`。KABUKI と AKIBA、異なる日付は完全に独立。
- 初回のみ SIFT_DATA から作成。再読み込み・切り替えで SIFT_DATA から作り直さない。明示的な「元データから初期化」のみ再生成する。
- 0人のシフトも保存済みとして扱う（initialized=TRUE, rowCount=0）。
- 削除したキャストは次の世代に含まれないため復活しない。追加したキャストは新しい recordId で保存される。

### 14-2. 排他制御
- 更新はすべて `LockService.getScriptLock()`（最大10秒待機）の中で、管理行の revision を再取得して `expectedRevision` と比較する。不一致は `REVISION_CONFLICT`（自動上書きしない）。
- 書き込み途中の失敗は管理行が更新されないため旧世代が有効のまま。未コミット行は読み取り対象外で、次回保存時に削除。
- 同じ `requestId` の再送は二重更新しない。

### 14-3. 日付
- 内部・API は `YYYY-MM-DD`。画面は `M月D日(曜)`。
- SIFT_DATA の `M月D日(曜)` から年を決める場合は「今日±185日以内かつ曜日一致」の年が一つだけのときに限る。それ以外は選択不可（推測で保存しない）。

### 14-4. 認証・認可（Phase 1.6 で更新）
- Google ログイン（Google Identity Services）で取得した ID トークンを、GAS が Google 公開鍵で署名検証する。
- 「アクセス権限」シートの googleSub・enabled・role で認可（ADMIN / EDITOR）。初期化と画像キャッシュ更新は ADMIN のみ。
- 公開設定以外の API（読み取りを含む）はすべて POST＋認証必須。GET / JSONP は公開設定のみ。
- 詳細は [AUTH_DESIGN.md](AUTH_DESIGN.md)。
- 旧「画像生成」シートには書き込まない（移行元として読み取りのみ）。

## 15. 将来拡張

- LINEログイン
- LIFF
- 許可リストの管理画面（現在はシート／メニューで管理）
- LINE通知
- 画像アップロード
- CSV出力
- PDF出力
- PWA対応
- バックアップ処理
