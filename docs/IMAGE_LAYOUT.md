# 出勤キャスト画像 仕様書（背景画像固定・キャスト自動配置）

| 項目 | 内容 |
|---|---|
| 対象 | 店舗別の背景画像管理・出勤キャスト画像（PNG）の生成 |
| 実装 | `assets/js/image-generator.js`（配置計算・描画）／`assets/js/app.js`（画面）／`assets/js/api.js`（通信）／`gas/BackgroundService.gs`（背景の保存・取得・写真取得・自己診断） |
| テスト | `tests/image-generator.test.js`（配置計算）／`tests/background.test.js`（GAS・権限）／`tests/e2e-image.test.js`（Chromium） |
| 状態 | ローカル実装・テスト済み。**テスト用 GAS / WebApp には未反映**。実 Google 環境では未検証（§12） |
| 配置領域 | **確定**: 上 580 / 下 220 / 左 33 / 右 33 px（完成見本「本日の出勤キャスト」KABUKI 13人の解析による。§4） |
| 配置方式 | **card（既定）**: 店舗が作成した「名前入りカード画像」をそのまま並べる（アプリは名前・枠を描かない）。§5 |

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

## 4. 配置領域（ヘッダー・フッター・装飾を除いた中央部分）

見出し（「本日の出勤キャスト」）・店舗ロゴ・上下のレースに写真が重ならないよう、キャンバスの上下左右の端から
指定した px を除いた範囲にだけ配置する。店舗ごとに画面から変更・保存もできる。

### 4-1. 確定値（既定値）

| 項目 | 確定値 | 根拠（完成見本・キャンバス換算） |
|---|---|---|
| 上 | **580 px** | 見本の 1 段目カード上端 y≈581。見出し下端 y≈319 との間（リボン柄 1 列分）は空ける |
| 下 | **220 px** | 見本の最終段カード下端 y≈1825（下端から 223）。ロゴ上端 y≈1868 まで 40 px |
| 左・右 | **33 px** | 見本の 5 枚の並び（幅 約 1381 px）を左右中央に置いた余白 |
| 配置領域 | x 33〜1414、y 580〜1828（**1381 × 1248 px**） | |
| 最小 | 幅 400 px・高さ 400 px | これより狭い設定は保存できない |

### 4-2. 参考資料の解析

| 資料 | ファイル | 用途 |
|---|---|---|
| 背景（写真なし） | `reference/reference_KABUKI_background.png`（2480 × 3508） | 見出し・ロゴ・レースの位置。**背景素材**として使用可 |
| 完成見本（13人・写真と名前入り） | `reference/completed_sample_KABUKI_13casts.jpg`（2480 × 3508） | カードの大きさ・間隔・段構成・配置範囲。**完成見本としてのみ使用**（背景素材にはしない・写真を重ねない） |

背景の構成（2480 × 3508 → 1447 × 2046.8、倍率 0.58347、上下に各 0.6 px の余白）:

| 部分 | 元画像 | キャンバス換算 |
|---|---|---|
| 上端のレース・白帯 | y 0〜約 175 | y 0〜約 103 |
| 見出し（吹き出し・白い縁取りを含む） | y 約 175〜545 | y 約 103〜**319** |
| 中央（チェック柄・リボンのみ） | y 約 545〜3200 | y 約 319〜**1868** |
| 店舗ロゴ（推しは推せる時に推せっ！ TOKYO） | y 約 3200〜3405（x 約 900〜1590） | y 約 **1868**〜1987 |
| 下端のレース・白帯 | y 約 3300〜3508 | y 約 1926〜2048 |

完成見本のカード（キャンバス換算）:

| 項目 | 値 |
|---|---|
| カード | 約 247 × 387 px（縦横比 1 : 1.567）。白いカードに写真と名前が入った 1 枚の画像 |
| 段構成 | 5 / 5 / 3（上の段から詰め、最終段に残り） |
| 横の間隔 | 約 37 px（カード幅の 0.15 倍） |
| 段の間隔 | 約 38 px（カード幅の 0.15 倍） |
| 最終段（3 枚） | 満員の段と同じ幅の中に**等間隔**（左端 約 170 / 604 / 994 px） |
| 範囲 | 上端 約 581・下端 約 1825 |

### 4-3. 確認結果

- 計算した 13 人の配置を完成見本に重ねると、カードの位置・大きさが一致する（`samples/KABUKI_cards/overlay_13casts_on_completed_sample.png`。
  赤枠 = 計算結果、緑線 = 配置領域、橙線 = 見出し下端・ロゴ上端）。差はカード幅 ±1 px、最終段の位置 ±25 px 以内。
- 0・1・3・4・5・8・9・10・13・16・20 人のサンプル（`samples/KABUKI_cards/KABUKI_NNcasts_1447x2048.png`）で、背景のみの画像と
  画素単位で比較し、**見出し（y < 319）とロゴ（y > 1868）の範囲で変化した画素が 0** であることを確認（`verification.json`）。
- テストで、1〜40 人のすべてでカードが y 580〜1828 に収まり、見出し・ロゴから 30 px 以上離れることを確認。

## 5. カード（写真）

### 5-1. card 方式（既定）

| 項目 | 仕様 |
|---|---|
| 入力 | キャスト画像フォルダの**名前入りカード画像**（店舗で作成済み。写真・名前・白い枠を含む）。ファイル名はキャスト名（既存の画像照合ルール） |
| 推奨の縦横比 | 1 : 1.567（完成見本と同じ。例 430 × 674、860 × 1348） |
| 枠 | 縦横比 **1 : 1.567** の枠に、画像を**切り抜かず・加工せず**収める（contain・中央）。比率が違う画像は枠の中で余白ができる |
| アプリが描くもの | **なし**（名前・白枠・影は描かない。名前はカード画像に入っているため） |
| 写真なし（画像フォルダに無い） | 「準備中」画像があればそれ。無ければアプリが白いカード（NO PHOTO ＋ 名前）を描く |
| 幅 W | 配置領域に収まる最大の整数。上限 400 px・下限 80 px |
| 横の間隔 | max(W × 0.15, 12 px) |
| 段の間隔 | max(W × 0.15, 12 px) |

### 5-2. photo 方式（名前入りカードが無い場合の予備）

写真（3:4・枠を埋めるように中央で切り抜き）＋白い縁・角丸・影＋写真の下に名前ラベル。上限 520 px、横の間隔 W × 0.10、
写真〜名前 W × 0.04、名前の高さ W × 0.22、段の間隔 W × 0.10。段の人数は差 1 人以内（13 人 → 5/4/4）。
`ImageGenerator.render(canvas, { mode: 'photo', ... })` で使用（画面の既定は card）。

## 6. 人数別レイアウト（card 方式）

| 人数 | 段 | 段ごとの人数 | カード幅 W | 備考 |
|---|---|---|---|---|
| 0 | – | 背景のみ | – | |
| 1 | 1 | 1 | 400 | 中央 |
| 2〜3 | 1 | 2〜3 | 400 | 中央揃え |
| 4 | 2 | 2/2 | 380 | |
| 5 | 2 | 3/2 | 380 | 最終段は等間隔 |
| 6 | 2 | 3/3 | 380 | |
| 7〜8 | 2 | 4/3・4/4 | 310 | |
| **9〜10** | **3** | 3/3/3・4/4/2 | 249 | 写真の視認性を優先して 3 段 |
| 11〜12 | 3 | 4/4/3・4/4/4 | 249 | |
| **13** | 3 | **5/5/3** | 246 | **完成見本と同じ** |
| 14 | 3 | 5/5/4 | 246 | |
| 16 | 3 | 6/6/4 | 204 | 14 人以上は写真が最も大きくなる段数を自動選択 |
| 20 | 4 | 5/5/5/5 | 185 | |
| 25 | 4 | 7/7/7/4 | 174 | |
| 30 | 4 | 8/8/8/6 | 152 | |

- 段の人数: 1 段あたり ceil(人数 ÷ 段数) 人ずつ上の段から詰め、最終段に残り（完成見本どおり）。
- **各段は左右中央**。人数が足りない段は、満員の段と同じ幅の中に等間隔で並べる（完成見本の最終段と同じ）。1 段だけのときは通常の間隔で中央。
- 段のまとまりは配置領域の上下中央。**シフトの並び順を保持**（左上から右へ、上の段から順）。**休みのキャストは描画しない**。
- 9〜10 人を 2 段（5/4・5/5）にした場合の W は 246 px。3 段では 249 px。

## 7. 名前の文字

- **card 方式では名前を描かない**（カード画像に入っている）。写真なしでアプリがカードを描くときだけ、カード下部（高さの 16%）に水色・太字で描く。
- photo 方式では写真の下のラベル内に描く。
- どちらも、1 行で入る最大の文字サイズを探し、小さくなりすぎる場合は 2 行に分ける。**名前は省略しない**。
  最小 10 px でも入らない場合は `NAME_TOO_LONG` で生成を中止する（文字を重ねて描かない）。

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
| 配置計算（Node） | 17 | 0〜40 人で 1447×2048、段数ルール（9〜10 人は 3 段）、上から詰める段構成（13 → 5/5/3）、完成見本のカード寸法・範囲・最終段の等間隔、各段中央、並び順、縦横比、重なりなし、見出し・ロゴとの距離、名前の省略なし、背景 contain |
| GAS（Node・模擬 GAS） | 16 | 背景の保存・取得・差し替え・revision 競合・形式/実寸検証・シフト不変・認可（未ログイン/EDITOR/ADMIN）・本番での自動作成禁止・本番ID拒否・背景フォルダ外拒否・Drive 書き込み失敗・写真（出勤のみ・順序・画像フォルダ外拒否・s800）・スコープ（manifest・DriveApp 書き込み不使用・Bearer・Blob 本文・バイト不変）・自己診断 |
| ブラウザ E2E（Chromium） | 11 | 背景未登録/アップロード/保存/店舗切替/再読み込み、生成画像の画素（背景本体・余白・ヘッダー・写真色）、PNG 実寸 1447×2048、0/1/2/3/5/8/10/13/16/20 人、未保存時の生成拒否、休み除外、長い名前、Canvas 汚染 |

### 実 Google 環境で未検証の項目（テスト用 GAS 反映後に確認）

- `drive.file` スコープの追加と再承認、`backgroundSelfTest` の結果
- Drive REST API でのフォルダ作成・multipart アップロード（実際の 8 MB 近い画像を含む）・保存後のバイト一致
- `thumbnailLink`（`=s800`）の Bearer 付き取得、共有ドライブ上の画像
- 12 MB の POST 本文を GAS WebApp が受け付けるか・処理時間
- 実ブラウザ（Chrome / Safari / iOS）での生成・PNG 保存・日本語フォント
- AKIBA 店の背景（KABUKI 以外のデザイン）での配置領域の確認（店舗ごとに画面から調整可能）
