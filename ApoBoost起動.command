#!/bin/bash
# ApoBoost（Mac用）ダブルクリックで起動するファイル。
# 初回はこのファイルだけで、必要な部品の用意から起動まで全部やります。
# ※ このファイルはフォルダの中に置いたまま使ってください（移動すると起動できません）
cd "$(dirname "$0")" || exit 1
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

clear
echo "============================================"
echo "  ApoBoost を起動します"
echo "============================================"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "【準備が必要です】Node.js が入っていません。"
  echo "ブラウザで https://nodejs.org/ を開きます。"
  echo "「LTS」と書かれた方をダウンロードして入れたあと、もう一度このファイルをダブルクリックしてください。"
  open "https://nodejs.org/"
  echo ""
  read -r -p "Enterキーでこの画面を閉じます… " _
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "初回の準備をしています（3〜5分かかります。たくさん文字が流れますが、そのままお待ちください）"
  npm install --no-audit --no-fund || { echo ""; echo "準備に失敗しました。この画面を写真に撮って配布元に送ってください。"; read -r -p "Enterキーで閉じます… " _; exit 1; }
  echo ""
  echo "フォーム操作用のブラウザを用意します（失敗しても、Google Chrome が入っていれば動きます）"
  npx playwright install chromium || echo "→ Playwright のブラウザは入れられませんでした。Google Chrome を使います。"
fi

# 起動できたらアプリが自分でブラウザを開く（FO_OPEN=1）
export FO_OPEN=1

echo ""
echo "起動します。この黒い画面は閉じないでください（閉じると送信も止まります）。"
echo "止めるときは、この画面で Ctrl+C を押してください。"
echo ""
npm start

echo ""
echo "ApoBoostを終了しました。"
read -r -p "Enterキーでこの画面を閉じます… " _
