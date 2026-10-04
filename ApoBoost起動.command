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

# zip の中から直接開いた・ファイルが欠けている場合は、部品の用意に進まずに止める（途中で英語のエラーになるため）
if [ ! -f package.json ] || [ ! -f scripts/run.mjs ]; then
  echo "【準備が必要です】ApoBoost のファイルがそろっていません。"
  echo "zip をダブルクリックして展開（解凍）し、できたフォルダの中の「ApoBoost起動.command」を開いてください。"
  echo ""
  read -r -p "Enterキーでこの画面を閉じます… " _
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "【準備が必要です】Node.js が入っていません。"
  echo "ブラウザで https://nodejs.org/ を開きます。"
  echo "「LTS」と書かれた方をダウンロードして入れたあと、もう一度このファイルをダブルクリックしてください。"
  open "https://nodejs.org/"
  echo ""
  read -r -p "Enterキーでこの画面を閉じます… " _
  exit 1
fi

# Node.js 20 未満では部品（better-sqlite3 など）が動かないため、入れ直してもらう
NODE_VER="$(node -v 2>/dev/null)"
NODE_MAJOR="${NODE_VER#v}"
NODE_MAJOR="${NODE_MAJOR%%.*}"
case "$NODE_MAJOR" in ''|*[!0-9]*) NODE_MAJOR=0 ;; esac
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "【準備が必要です】Node.js が古いため動きません（いま: ${NODE_VER:-不明} / 必要: 20 以上）。"
  echo "ブラウザで https://nodejs.org/ を開きます。"
  echo "「LTS」と書かれた方をダウンロードして入れ直したあと、もう一度このファイルをダブルクリックしてください。"
  open "https://nodejs.org/"
  echo ""
  read -r -p "Enterキーでこの画面を閉じます… " _
  exit 1
fi

# 準備ができたかどうかは、準備が最後まで通ったときに置く目印で見る。
# node_modules があるかだけで見ると、準備の途中で画面を閉じた場合に「済み」と扱われ、起動のたびに英語のエラーで止まっていた
READY=node_modules/.apoboost-ready
# 以前の版で準備を済ませたフォルダには目印が無い。npm が準備を最後まで終えたときに作るファイルがあれば、済みとみなす
# （そうしないと、アップデート後の最初の起動で準備をやり直し、ネットにつながっていないと起動できなくなる）
if [ ! -f "$READY" ] && [ -f node_modules/.package-lock.json ] && [ -d node_modules/tsx ]; then date > "$READY"; fi
if [ ! -f "$READY" ]; then
  echo "部品を用意しています（初回は3〜5分かかります。たくさん文字が流れますが、そのままお待ちください）"
  npm install --no-audit --no-fund || { echo ""; echo "準備に失敗しました。インターネットにつながっているか確かめて、もう一度このファイルをダブルクリックしてください。"; echo "それでも失敗する場合は、この画面を写真に撮って配布元に送ってください。"; read -r -p "Enterキーで閉じます… " _; exit 1; }
  echo ""
  echo "フォーム操作用のブラウザを用意します（失敗しても、Google Chrome が入っていれば動きます）"
  npx playwright install chromium || echo "→ Playwright のブラウザは入れられませんでした。Google Chrome を使います。"
  date > "$READY"
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
