#!/usr/bin/env bash
# テスト用フロント（静的ファイル）を dist-test/ に作る。config.js はテスト用に差し替える。
#   usage: TEST_GAS_WEB_APP_URL=<テスト用 WebApp URL> tools/build-test-site.sh
#   出力先を変える場合: TEST_SITE_OUT=<dir>
# - 本番の WebApp URL は使用不可（中止）
# - index.html の ?v=... をビルドごとの値（git のコミット＋時刻）に置き換え、ブラウザが古い JS / CSS を使わないようにする
# - BUILD_INFO.txt にビルド元（コミット・日時・接続先 WebApp）を記録する
set -euo pipefail
PROD_DEPLOYMENT='AKfycbz-NSM70nThVEJkTZ3FUaf81pwZD-ykLvXbjfHOM_Nnf6sUSiHt8JK_D5TnQ4A9InU_'
URL="${TEST_GAS_WEB_APP_URL:?TEST_GAS_WEB_APP_URL を指定してください}"
if [[ "$URL" == *"$PROD_DEPLOYMENT"* ]]; then echo "本番の WebApp URL です。中止しました。" >&2; exit 2; fi
if [[ ! "$URL" =~ ^https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec$ ]]; then echo "WebApp URL の形式が不正です。" >&2; exit 2; fi
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${TEST_SITE_OUT:-$REPO_DIR/dist-test}"
COMMIT="$(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || echo nogit)"
DIRTY="$(git -C "$REPO_DIR" status --porcelain 2>/dev/null | grep -qv '^??' && echo '-dirty' || true)"
STAMP="$(date +%Y%m%d%H%M%S)"
TAG="${COMMIT}${DIRTY}-${STAMP}"
rm -rf "$OUT"; mkdir -p "$OUT"
sed -E "s/\?v=[A-Za-z0-9._-]+/?v=${TAG}/g" "$REPO_DIR/index.html" > "$OUT/index.html"
cp -R "$REPO_DIR/assets" "$OUT/"
sed -e "s#__TEST_GAS_WEB_APP_URL__#${URL}#" -e "s#VERSION: '[^']*'#VERSION: '${TAG}-test'#" "$REPO_DIR/deploy/test/config.test.js" > "$OUT/config.js"
if grep -q "$PROD_DEPLOYMENT" "$OUT"/config.js "$OUT"/index.html; then echo "本番URLが含まれています。中止しました。" >&2; rm -rf "$OUT"; exit 2; fi
mkdir -p "$OUT/tools" && cp -R "$REPO_DIR/tools/cors-probe" "$OUT/tools/"
{
  echo "commit: ${COMMIT}${DIRTY}"
  echo "built:  ${STAMP}"
  echo "asset:  ?v=${TAG}"
  echo "gas:    ${URL}"
} > "$OUT/BUILD_INFO.txt"
echo "作成しました: $OUT（?v=${TAG}）"
echo "ローカル配信: cd \"$OUT\" && python3 -m http.server 8080 → http://localhost:8080/"
