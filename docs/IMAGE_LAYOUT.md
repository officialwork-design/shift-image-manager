# 出勤キャスト画像 仕様書（背景画像固定・キャスト自動配置）

| 項目 | 内容 |
|---|---|
| 対象 | 店舗別の背景画像管理・出勤キャスト画像（PNG）の生成 |
| 実装 | `assets/js/image-generator.js`（配置計算・描画）／`assets/js/app.js`（画面）／`assets/js/api.js`（通信）／`gas/BackgroundService.gs`（背景の保存・取得・写真取得・自己診断） |
| テスト | `tests/image-generator.test.js`（配置計算）／`tests/background.test.js`（GAS・権限）／`tests/e2e-image.test.js`（Chromium） |
| 状態 | ローカル実装・テスト済み。**テスト用 GAS / WebApp には未反映**。実 Google 環境では未検証（§12） |
| 配置領域 | **確定**: 上 350 / 下 210 / 左 60 / 右 60 px（参考デザイン KABUKI 背景の解析による。§4） |

---

## 1. 画像サイズ・出力

| 項目 | 値 |
|---|---|
| 完成画像（キャンバス） | **常に 1447 × 2048 px**。人数・背景の大きさで変えない |
| 出力形式 | PNG（`canvas.toBlob('image/png')`） |
| ファイル名 | `shift_<店舗>_<YYYY-MM-DD>_1447x2048.png` |
| 人数が変わったとき | キャンバスは変えず、**写真枠と余白だけ**を縮める・広げる |

## 2. 背景画像

| 項目 | 仕様 |
|---|---|
| 管理単位 | 店舗ごとに 1 枚（KABUKI / AKIBA） |
| 形式 | PNG / JPEG（先頭バイトで判定。申告された MIME と実体が違えば拒否） |
| サイズ | 8MB まで。短辺 200px 以上・長辺 8000px 以下 |
| 当てはめ | **切り抜かない・変形しない**。縦横比を保ち、全体がキャンバスに収まる最大の大きさで中央に置く（contain） |
| 余白 | 比率が 1447:2048 と違う場合にできる余白は「余白の色」で塗る。自動 = 背景画像の外周の平均色、または `#RRGGBB` 指定 |
| 未登録 | 白（または指定色）一色の上に配置 |
| 履歴 | 差し替えても古いファイルは削除しない（設定の参照先だけを切り替える） |
| シフトへの影響 | **なし**。背景は「背景設定」シートと Drive の背景フォルダだけを変更する |

当てはめの例: 1447 × 2048 → 全面 / 1080 × 1920 → 1152 × 2048（左右に各 147.5px の余白）/ 2048 × 2048 → 1447 × 1447（上下に各 300.5px の余白）

## 3. 画面での操作

1. 店舗・日付を選ぶ（背景はその店舗のものを自動で読み込む）
2. 「背景画像を選択」→ プレビュー（縮小・配置領域を破線で表示）
3. 余白の色・配置領域を調整 →「背景・設定を保存」（「変更を取り消す」で保存済みに戻す）
4. 「画像を生成」… **保存済み**のシフトから出勤者と写真を取得して描画
   - 未保存のシフト編集がある → 生成せず「編集保存」を促す
   - 他の端末でシフトが更新済み（revision 不一致）→ 生成せず「再読み込み」を促す
   - 背景・設定が未保存 → 画面上の内容で生成し、未保存である旨を表示
5. 「PNG で保存」
6. 「背景を解除」（ADMIN のみ）… 登録を外すだけ。Drive のファイルは削除しない

## 4. 配置領域（ヘッダー・フッターを除いた中央部分）

背景のヘッダー（「本日の出勤キャスト」）とフッター（店舗ロゴ）に写真と名前が重ならないよう、
キャンバスの上下左右の端から指定した px を除いた範囲にだけ配置する。店舗ごとに画面から変更・保存もできる。

### 4-1. 確定値（既定値）

| 項目 | 確定値 | 根拠 |
|---|---|---|
| 上（ヘッダー） | **350 px** | 見出しの下端 y≈319 px ＋ 余裕 約 30 px |
| 下（フッター） | **210 px** | ロゴの上端 y≈1868 px（下端から 180 px）＋ 余裕 約 30 px |
| 左・右 | **60 px** | 左右には装飾が無い（チェック柄のみ）。写真の影・余白の確保 |
| 配置領域 | x 60〜1387、y 350〜1838（**1327 × 1488 px**） | |
| 最小 | 幅 400 px・高さ 400 px | これより狭い設定は保存できない |

### 4-2. 参考デザインの解析（KABUKI 背景）

参考資料: `reference/reference_KABUKI_background.png`（2480 × 3508 px・キャスト写真なしの背景）

| 部分 | 元画像（2480 × 3508） | キャンバス換算（1447 × 2048） | 内容 |
|---|---|---|---|
| 上端のレース・白帯 | y 0〜約 175 | y 0〜約 103 | 白地＋水色の点線レース |
| 見出し | y 約 175〜545（白い縁取り・吹き出しの尾を含む） | y 約 103〜**319** | 吹き出し「本日の」＋「出勤キャスト」 |
| 中央（柄のみ） | y 約 545〜3200 | y 約 319〜**1868** | 水色チェック柄＋リボン（写真を置ける範囲） |
| 店舗ロゴ | y 約 3200〜3405（x 約 900〜1590） | y 約 **1868**〜1987 | 「推しは推せる時に推せっ！ TOKYO」 |
| 下端のレース・白帯 | y 約 3300〜3508 | y 約 1926〜2048 | 白地＋水色の点線レース |

- 当てはめ: 2480 × 3508 → 1447 × 2046.8（倍率 0.58347、上下に各 0.6 px の余白。左右は全面）。比率がほぼ同じのため実質全面。
- 見出しの下端は、見出し文字（濃い青）と白い縁取りの画素の最下行から、ロゴの上端は「TOKYO」の光彩の最上行から測定した。
- この画像にはキャスト写真が含まれていないため、背景としてそのまま使用できる（写真入りの完成見本ではない）。

### 4-3. 確認結果

0・1・3・5・9・10・13・20 人のサンプル（`samples/KABUKI_NNcasts_1447x2048.png`）で、背景のみの画像との差分を画素単位で比較し、
**見出し（y < 319）とロゴ（y > 1868）の範囲で変化した画素が 0** であることを確認した（`samples/verification.json`）。
テスト `tests/image-generator.test.js` でも 1〜40 人で写真・名前が y 349〜1838 に収まることを確認している。

## 5. 写真枠・余白・名前（写真幅 W に比例）

| 項目 | 値 |
|---|---|
| 写真枠 | 縦横比 **3:4**（高さ = W × 4/3）。全員同じ大きさ |
| 写真の当てはめ | 枠を埋めるように拡大し中央で切り抜く（上下は上寄り 25%）※写真のみ。背景は切り抜かない |
| W の上限 / 下限 | 520 px（1 人でも大きくなりすぎない）/ 80 px（未満になる人数は配置不可） |
| 横の間隔 | max(W × 0.10, 12 px) |
| 写真〜名前 | max(W × 0.04, 6 px) |
| 名前の枠の高さ | max(W × 0.22, 34 px) |
| 段と段の間隔 | max(W × 0.10, 16 px) |
| 名前の枠の幅 | 写真幅 ＋ 左右の間隔の半分ずつ（隣の名前枠と重ならない・配置領域の外に出ない） |
| 写真の装飾 | 白い縁（W × 2%）・角丸（W × 5%）・影 |
| 写真なし | 店舗の画像フォルダに「準備中」画像があればそれ、無ければ「NO PHOTO」のプレースホルダー |

W は「配置領域に収まる最大の整数」（`maxPhotoWidthFor`）。

## 6. 人数別レイアウト（段数）

| 人数 | 段数 | 段ごとの人数 |
|---|---|---|
| 0 | – | 背景のみ |
| 1 | 1 | 中央に 1 人 |
| 2〜3 | 1 | 中央揃え |
| 4〜5 | 2 | 4 → 2/2、5 → 3/2 |
| 6〜8 | 2 | 6 → 3/3、7 → 4/3、8 → 4/4 |
| **9〜10** | **3** | 9 → 3/3/3、10 → 4/3/3（**写真の視認性を優先して 3 段**） |
| 11〜13 | 3 | 11 → 4/4/3、12 → 4/4/4、13 → 5/4/4 |
| 14〜 | 3 段以上 | 写真が最も大きくなる段数を自動選択（同じなら段数の少ない方） |

- 段ごとの人数は上の段から多めに割り振る（差は最大 1 人）。
- **各段を左右中央揃え**（最終段が少人数でも中央）。段のまとまりは配置領域の上下中央。
- **シフトの並び順を保持**（左上から右へ、上の段から順）。**休みのキャストは描画しない**。

既定の配置領域（確定値 1327 × 1488 px）での写真幅:

| 人数 | 1〜2 | 3 | 4 | 5〜6 | 7〜8 | 9〜12 | 13〜14 | 16〜20 | 25〜30 | 40 |
|---|---|---|---|---|---|---|---|---|---|---|
| W (px) | 520 | 414 | 452 | 414 | 308 | 298 | 245 | 222 | 177 | 152 |
| 段 | 1 | 1 | 2 | 2 | 2 | 3 | 3 | 4 | 5 | 5 |

9〜10 人を 2 段（5/4・5/5）にした場合の W は 245 px。3 段では 298 px（約 22% 大きい）。

## 7. 名前の文字

- 写真の下の名前枠（半透明の白いラベル）の中に、太字・中央揃え。
- 1 行で入る最大の文字サイズ（枠の高さの 72% から 1px ずつ）を探す。1 行だと枠の高さの 45% 未満になり、
  2 行のほうが 1.2 倍以上大きくなる場合は 2 行（文字数がなるべく均等になる位置で分割）にする。
- **名前は省略しない**。最小 10 px でも入らない場合は `NAME_TOO_LONG` で生成を中止する（文字を重ねて描かない）。
- フォント: Hiragino Kaku Gothic ProN / Hiragino Sans / Noto Sans JP / Yu Gothic / Meiryo / sans-serif（端末にあるもの）。

## 8. エラー（重ねて描かない）

| コード | 意味 | 対処 |
|---|---|---|
| LAYOUT_OVERFLOW | 写真が 80 px 未満になる | 配置領域の上下左右の値を小さくして領域を広げる |
| LAYOUT_OVERLAP | 写真・名前が重なる／領域外に出る（安全確認。通常は発生しない） | 配置領域を見直す |
| NAME_TOO_LONG | 名前が枠に入らない | 名前を短くする、配置領域を広げる |
| INVALID_AREA | 配置領域が不正 | 値を確認 |
| IMAGE_LOAD_FAILED | 背景・写真を読み込めない | 再読み込み |
| CANVAS_TAINTED | 外部 URL の画像を直接描いたため PNG を保存できない（アプリは data URL のみ使うため通常は発生しない） | 再読み込みして生成し直す |

サーバー側のエラーは §10 を参照。

## 9. 画像の受け渡し（CORS・Canvas 汚染対策）

- Drive のサムネイル URL（`drive.google.com/thumbnail`）を Canvas に描くと、CORS ヘッダーが無いため Canvas が汚染され
  `toBlob` / `toDataURL` が `SecurityError` になる（E2E で `CANVAS_TAINTED` を確認済み）。
- そのため背景・写真はすべて GAS から **base64（data URL）** で受け取り、ページと同じオリジンの画像として描画する。
- 写真は Drive API のサムネイル（長辺 800 px）を GAS が取得して返す。元画像が大きくても通信量を抑える。

## 10. API（GAS）

| action | ロール | 内容 |
|---|---|---|
| getBackground | ADMIN / EDITOR | `{ store, includeImage? }` → 背景設定・背景画像（data URL）。背景フォルダ外のファイルは返さない（`BACKGROUND_UNAVAILABLE`） |
| saveBackground | ADMIN / EDITOR | `{ store, expectedRevision, image?, settings? }` → 背景の差し替え・余白色・配置領域。LockService＋revision 検証 |
| clearBackground | **ADMIN** | `{ store, expectedRevision }` → 登録解除（ファイルは削除しない） |
| getCastPhotos | ADMIN / EDITOR | `{ store, date }` → 出勤キャスト（並び順・休み除外）と写真（data URL）。**画像フォルダ内のファイルだけ** |

- すべて POST・ID トークン必須（既存の署名検証・許可リストをそのまま使用）。GET では実行できない。
- 本文の上限: 通常 200 KB、`saveBackground` のみ 12 MB。
- エラー: `INVALID_IMAGE_TYPE` / `INVALID_IMAGE` / `IMAGE_TOO_LARGE` / `INVALID_IMAGE_SIZE` / `INVALID_SETTINGS` / `INVALID_BACKGROUND` / `INVALID_STORE` /
  `INVALID_REVISION` / `REVISION_CONFLICT` / `BACKGROUND_FOLDER_NOT_CONFIGURED` / `BACKGROUND_UNAVAILABLE` / `BACKGROUND_DUPLICATE` / `DRIVE_WRITE_FAILED` /
  `TOO_MANY_PHOTOS`（40 枚超）/ `CONFIG_PRODUCTION_ID_IN_TEST`
- 形式の詳細は docs/API.md。シートの列は docs/SHEET.md「背景設定」。

## 11. Drive API・権限（drive.file）

### 11-1. 必要なスコープ（`gas/appsscript.json`）

| スコープ | 用途 | 変更 |
|---|---|---|
| `https://www.googleapis.com/auth/spreadsheets` | シート（シフト・背景設定・ログ） | 既存 |
| `https://www.googleapis.com/auth/drive.readonly` | キャスト画像フォルダの一覧・背景ファイルの読み取り（DriveApp）・Drive API files.get | 既存 |
| `https://www.googleapis.com/auth/drive.file` | **背景フォルダの作成・背景画像のアップロード**（このアプリが作成したファイル・フォルダのみ） | **追加** |
| `https://www.googleapis.com/auth/script.external_request` | UrlFetchApp（Drive REST API・Google 公開鍵・tokeninfo） | 既存 |
| `https://www.googleapis.com/auth/script.container.ui` | スプレッドシートのメニュー | 既存 |

- ドライブ全体の書き込み権限（`https://www.googleapis.com/auth/drive`）は**要求しない**。
  DriveApp の書き込み系（`createFile` / `createFolder` 等）は `drive` スコープが必要なため使用しない（テストで静的に確認）。
- スコープ追加後は、デプロイ前に**エディタから関数を一度実行して再承認**する必要がある（ご本人の操作）。
- WebApp は「自分として実行（USER_DEPLOYING）」のため、背景はデプロイしたアカウントの Drive に保存される。

### 11-2. 使用する Drive API

| 処理 | 呼び出し | スコープ |
|---|---|---|
| 背景フォルダ作成（テスト環境で未設定のときのみ） | `POST https://www.googleapis.com/drive/v3/files?fields=id&supportsAllDrives=true`（mimeType = folder） | drive.file |
| 背景画像アップロード | `POST https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,parents&supportsAllDrives=true`（本文は Blob。`parents` = 背景フォルダ） | drive.file |
| 背景画像の取得 | `DriveApp.getFileById(id).getBlob()`（親フォルダが背景フォルダであることを確認） | drive.readonly |
| 写真のサムネイル | `GET .../drive/v3/files/{id}?fields=thumbnailLink,mimeType,size` → `thumbnailLink`（`=s800`）を Bearer 付きで取得。取得できなければ 3 MB 以下の PNG / JPEG のみ元画像 | drive.readonly |
| 自己診断 | `GET https://oauth2.googleapis.com/tokeninfo`（承認済みスコープ）・`files.get`（`capabilities.canAddChildren`） | – / drive.file |

認証はすべて `ScriptApp.getOAuthToken()`（manifest のスコープで承認されたトークン）を `Authorization: Bearer` で付与。

### 11-3. 背景フォルダ（`DRIVE_BACKGROUND_FOLDER_ID`）

- 読み込み順: ID管理シート → Script Properties。
- **テスト環境で未設定**: 最初の背景保存時に「Shift Image Manager TEST Backgrounds」を作成し、Script Properties に記録する。
- **本番で未設定**: `BACKGROUND_FOLDER_NOT_CONFIGURED`（本番 Drive に自動で作らない）。
- キャスト画像フォルダ・本番リソースID（`PRODUCTION_RESOURCE_IDS`）は指定不可（テスト環境では `CONFIG_PRODUCTION_ID_IN_TEST`）。
- drive.file では**このアプリが作成したフォルダにしか書き込めない**。手動で作ったフォルダを指定すると `DRIVE_WRITE_FAILED` になる。
  自動作成されたフォルダをそのまま使うこと（`backgroundSelfTest` の「背景フォルダ」で書き込み可否を確認できる）。

### 11-4. 自己診断 `backgroundSelfTest()`（読み取りのみ）

エディタから実行し、実行ログで確認する。Drive・シートには書き込まない。

| チェック | 内容 |
|---|---|
| 環境 | test / production |
| OAuth スコープ（トークン） | drive.file / drive.readonly / external_request / spreadsheets が承認済みか |
| 背景フォルダ | 未設定 / フォルダか / ゴミ箱でないか / 書き込めるか（canAddChildren） |
| 背景設定シート | ヘッダーが正しいか・登録店舗数 |

## 12. テスト

| 種類 | 件数 | 主な確認内容 |
|---|---|---|
| 配置計算（Node） | 14 | 0〜40 人で 1447×2048、段数ルール（9〜10 人は 3 段）、各段中央、並び順、3:4、重なりなし、名前の省略なし、背景 contain、写真の切り抜き範囲 |
| GAS（Node・模擬 GAS） | 16 | 背景の保存・取得・差し替え・revision 競合・形式/実寸検証・シフト不変・認可（未ログイン/EDITOR/ADMIN）・本番での自動作成禁止・本番ID拒否・背景フォルダ外拒否・Drive 書き込み失敗・写真（出勤のみ・順序・画像フォルダ外拒否・s800）・スコープ（manifest・DriveApp 書き込み不使用・Bearer・Blob 本文・バイト不変）・自己診断 |
| ブラウザ E2E（Chromium） | 11 | 背景未登録/アップロード/保存/店舗切替/再読み込み、生成画像の画素（背景本体・余白・ヘッダー・写真色）、PNG 実寸 1447×2048、0/1/2/3/5/8/10/13/16/20 人、未保存時の生成拒否、休み除外、長い名前、Canvas 汚染 |

### 実 Google 環境で未検証の項目（テスト用 GAS 反映後に確認）

- `drive.file` スコープの追加と再承認、`backgroundSelfTest` の結果
- Drive REST API でのフォルダ作成・multipart アップロード（実際の 8 MB 近い画像を含む）・保存後のバイト一致
- `thumbnailLink`（`=s800`）の Bearer 付き取得、共有ドライブ上の画像
- 12 MB の POST 本文を GAS WebApp が受け付けるか・処理時間
- 実ブラウザ（Chrome / Safari / iOS）での生成・PNG 保存・日本語フォント
- AKIBA 店の背景（KABUKI 以外のデザイン）での配置領域の確認（店舗ごとに画面から調整可能）
