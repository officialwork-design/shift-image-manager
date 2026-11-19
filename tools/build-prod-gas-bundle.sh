#!/usr/bin/env bash
# 本番 GAS にエディタから反映するための 1 ファイル版を dist-gas-prod/ に作る（Google には接続しない）。
#   usage: tools/build-prod-gas-bundle.sh
#   出力: dist-gas-prod/Code.gs（gas/*.gs を名前順に連結）・appsscript.json・BUNDLE_INFO.txt（sha256）
# 反映方法（README「本番デプロイ手順」）:
#   本番 GAS の Code.gs をこの内容に置き換え、それ以外の .gs（旧版の分割ファイル）は 1 行のコメントにする
#   （同じ名前の const が二重に定義されないようにするため）。WebApp は既存デプロイを新バージョンに更新（URL 不変）。
# 安全確認: テスト用の ID・URL・OAuth クライアントが含まれていたら中止する。
set -euo pipefail
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${PROD_GAS_OUT:-$REPO_DIR/dist-gas-prod}"
PROD_DEPLOYMENT='AKfycbz-NSM70nThVEJkTZ3FUaf81pwZD-ykLvXbjfHOM_Nnf6sUSiHt8JK_D5TnQ4A9InU_'
COMMIT="$(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || echo nogit)"
if git -C "$REPO_DIR" status --porcelain -- gas | grep -q .; then echo "gas/ に未コミットの変更があります。コミットしてから実行してください。" >&2; exit 2; fi
rm -rf "$OUT"; mkdir -p "$OUT"
{
  echo "// Shift Image Manager — 本番 GAS 一括ファイル（${COMMIT}）"
  echo "// gas/*.gs を名前順に連結したもの。このプロジェクトの他の .gs ファイルは空（コメントのみ）にすること。"
  for f in $(cd "$REPO_DIR/gas" && ls *.gs | LC_ALL=C sort); do
    echo; echo "// ===== gas/$f ====="; cat "$REPO_DIR/gas/$f"
  done
} > "$OUT/Code.gs"
cp "$REPO_DIR/gas/appsscript.json" "$OUT/appsscript.json"
node -e "new Function(require('fs').readFileSync(process.argv[1],'utf8'))" "$OUT/Code.gs"
# テスト用の ID・URL の混入チェック（本番のデプロイ以外の WebApp URL・OAuth クライアント ID・localhost）
if grep -oE 'AKfycb[A-Za-z0-9_-]+' "$OUT/Code.gs" | grep -v "^${PROD_DEPLOYMENT}\$" | grep -q .; then echo "本番以外の WebApp ID が含まれています。中止しました。" >&2; rm -rf "$OUT"; exit 2; fi
if grep -qE '[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com|localhost:[0-9]+' "$OUT/Code.gs"; then echo "OAuth クライアント ID または localhost が含まれています。中止しました。" >&2; rm -rf "$OUT"; exit 2; fi
{
  echo "commit: ${COMMIT}"
  echo "files:  $(cd "$REPO_DIR/gas" && ls *.gs | wc -l | tr -d ' ')"
  echo "sha256: $( (command -v sha256sum >/dev/null && sha256sum "$OUT/Code.gs" || shasum -a 256 "$OUT/Code.gs") | cut -d' ' -f1)"
  echo "chars:  $(wc -m < "$OUT/Code.gs" | tr -d ' ')"
} > "$OUT/BUNDLE_INFO.txt"
cat "$OUT/BUNDLE_INFO.txt"
