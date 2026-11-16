#!/usr/bin/env bash
# テスト用フロント（静的ファイル）を dist-test/ に作る。config.js はテスト用に差し替える。
#   usage: TEST_GAS_WEB_APP_URL=<テスト用 WebApp URL> tools/build-test-site.sh
set -euo pipefail
PROD_DEPLOYMENT='AKfycbz-NSM70nThVEJkTZ3FUaf81pwZD-ykLvXbjfHOM_Nnf6sUSiHt8JK_D5TnQ4A9InU_'
URL="${TEST_GAS_WEB_APP_URL:?TEST_GAS_WEB_APP_URL を指定してください}"
if [[ "$URL" == *"$PROD_DEPLOYMENT"* ]]; then echo "本番の WebApp URL です。中止しました。" >&2; exit 2; fi
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$REPO_DIR/dist-test"
rm -rf "$OUT"; mkdir -p "$OUT"
cp "$REPO_DIR/index.html" "$OUT/"
cp -R "$REPO_DIR/assets" "$OUT/"
sed "s#__TEST_GAS_WEB_APP_URL__#${URL}#" "$REPO_DIR/deploy/test/config.test.js" > "$OUT/config.js"
if grep -q "$PROD_DEPLOYMENT" "$OUT/config.js"; then echo "本番URLが含まれています。中止しました。" >&2; exit 2; fi
mkdir -p "$OUT/tools" && cp -R "$REPO_DIR/tools/cors-probe" "$OUT/tools/"
echo "作成しました: $OUT（テスト用の公開先に配置してください）"
