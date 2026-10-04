#!/bin/bash
# ApoBoost（Mac用）ダブルクリックで起動するファイル。
# 初回はこのファイルだけで、必要な部品の用意から起動まで全部やります（Node.js が無ければ、このフォルダの中に自動で用意します）。
# ※ このファイルはフォルダの中に置いたまま使ってください（移動すると起動できません）
cd "$(dirname "$0")" || exit 1
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

# ---- 自動で用意する Node.js（版とハッシュはここ1か所だけに書く）----
# 出どころ: https://nodejs.org/dist/index.json（22 系 LTS の最新）と https://nodejs.org/dist/v22.23.3/SHASUMS256.txt（2026-10-05 確認）。
# Windows 用の値は ApoBoost起動.bat と インストール（最初に1回）.bat の先頭にある。版を変えるときは3つとも同じ版にそろえ、
# better-sqlite3（package-lock.json の版）の GitHub Releases にその Node.js 用のビルド済み（node-v<番号>-darwin-arm64 等）があるかも確かめること
NODE_DIST_VER="v22.23.3"
NODE_SHA_ARM64="23b25245dcfb9af7262f8ff142e9e2e0af025368117329e7a7458a51e5922f53"  # node-v22.23.3-darwin-arm64.tar.gz
NODE_SHA_X64="8a677b0219178efd6eb0e475457c4afb452b521a92f6e67845a73bd85727f2a8"    # node-v22.23.3-darwin-x64.tar.gz

# Apple シリコンかどうか（Rosetta の下で動いていても 1 が返る）
if [ "$(sysctl -n hw.optional.arm64 2>/dev/null)" = "1" ]; then NODE_ARCH=arm64; NODE_SHA="$NODE_SHA_ARM64"; else NODE_ARCH=x64; NODE_SHA="$NODE_SHA_X64"; fi
NODE_NAME="node-$NODE_DIST_VER-darwin-$NODE_ARCH"

close_wait() { echo ""; read -r -p "Enterキーでこの画面を閉じます… " _; }

clear
echo "============================================"
echo "  ApoBoost を起動します"
echo "============================================"
echo ""

# zip の中から直接開いた・ファイルが欠けている場合は、部品の用意に進まずに止める（途中で英語のエラーになるため）
if [ ! -f package.json ] || [ ! -f scripts/run.mjs ]; then
  echo "【準備が必要です】ApoBoost のファイルがそろっていません。"
  echo "zip をダブルクリックして展開（解凍）し、できたフォルダの中の「ApoBoost起動.command」を開いてください。"
  close_wait
  exit 1
fi

# 置き場所の注意（1回だけ）。「ダウンロード」「デスクトップ」「書類」は macOS が見張っている場所で、
# パソコンの起動時の自動起動（裏で動く node）が読めずに動かないことがある。iCloud で同期していると部品のファイルが壊れやすい
PLACE_NOTED=node_modules/.apoboost-place-noted
PLACE_SHOWN=""
case "$PWD/" in
  "$HOME/Downloads/"*|"$HOME/Desktop/"*|"$HOME/Documents/"*|"$HOME/Library/Mobile Documents/"*)
    if [ ! -f "$PLACE_NOTED" ]; then
      PLACE_SHOWN=1
      echo "【おすすめ】このフォルダは「ダウンロード」「デスクトップ」「書類」（または iCloud）の中にあります。"
      echo "  ここに置いたままだと、パソコンの起動時の自動起動が動かないことや、部品の用意が失敗しやすいことがあります。"
      echo "  ApoBoost を止めてから、フォルダごとホーム（$HOME）の直下に移して使うのがおすすめです。"
      echo "  （このまま使うこともできます。この案内は1回だけ出します）"
      echo ""
      [ -d node_modules ] && date > "$PLACE_NOTED"
      sleep 3
    fi ;;
esac

# 準備ができたかどうかは、npm install が最後まで通ったときに置く目印で見る（ブラウザの用意は起動のたびに scripts/run.mjs が確かめる）。
# node_modules があるかだけで見ると、準備の途中で画面を閉じた場合に「済み」と扱われ、起動のたびに英語のエラーで止まっていた
READY=node_modules/.apoboost-ready
# 以前の版で準備を済ませたフォルダには目印が無い。npm が準備を最後まで終えたときに作るファイルがあれば、済みとみなす
# （そうしないと、アップデート後の最初の起動で準備をやり直し、ネットにつながっていないと起動できなくなる）
if [ ! -f "$READY" ] && [ -f node_modules/.package-lock.json ] && [ -d node_modules/tsx ]; then date > "$READY"; fi

# ---- 使う Node.js を決める ----
# 1. このフォルダの中に用意した Node.js（runtime/）があれば、それを使う（部品はその Node.js に合わせて用意してあるため）
# 2. 無ければ、パソコンに入っている Node.js（20 以上。初回の準備では、部品のビルド済みがある 22 以上の偶数版）
# 3. どちらも使えないときは、nodejs.org の公式の配布物を runtime/ に落として使う。失敗したら、これまでどおり nodejs.org を案内する
rt_ok() { [ -x "$1/bin/node" ] && "$1/bin/node" -v >/dev/null 2>&1; }

fetch_fail() {
  echo "→ Node.js を自動で用意できませんでした（$1）。"
  rm -rf runtime/.extract "runtime/$NODE_NAME.tar.gz.part"
  rmdir runtime 2>/dev/null
  return 1
}

fetch_node() {
  local url="https://nodejs.org/dist/$NODE_DIST_VER/$NODE_NAME.tar.gz" part="runtime/$NODE_NAME.tar.gz.part" got
  echo "Node.js（$NODE_DIST_VER）をこのフォルダの中に用意します（約40MB。数分かかることがあります）"
  mkdir -p runtime || { fetch_fail "フォルダを作れませんでした"; return 1; }
  rm -rf runtime/.extract "$part"
  curl -fL --retry 2 --connect-timeout 20 --progress-bar -o "$part" "$url" || { fetch_fail "ダウンロードできませんでした"; return 1; }
  got="$(shasum -a 256 "$part" 2>/dev/null | awk '{print $1}')"
  [ "$got" = "$NODE_SHA" ] || { fetch_fail "ダウンロードしたファイルが壊れていました"; return 1; }
  mkdir -p runtime/.extract && tar -xzf "$part" -C runtime/.extract || { fetch_fail "展開できませんでした"; return 1; }
  rm -rf "runtime/$NODE_NAME"
  mv "runtime/.extract/$NODE_NAME" "runtime/$NODE_NAME" || { fetch_fail "展開できませんでした"; return 1; }
  if [ "$("runtime/$NODE_NAME/bin/node" -v 2>/dev/null)" != "$NODE_DIST_VER" ]; then
    rm -rf "runtime/$NODE_NAME"
    fetch_fail "このMacでは動きませんでした。macOS 11 以降が必要です"
    return 1
  fi
  rm -rf runtime/.extract "$part"
  echo "→ 用意できました（Node.js $NODE_DIST_VER）"
  echo ""
  return 0
}

RT=""
if rt_ok "runtime/$NODE_NAME"; then RT="runtime/$NODE_NAME"
else
  for d in runtime/node-v*-darwin-"$NODE_ARCH"; do rt_ok "$d" && RT="$d"; done
fi

SYS_VER=""
command -v node >/dev/null 2>&1 && SYS_VER="$(node -v 2>/dev/null)"
SYS_MAJOR="${SYS_VER#v}"
SYS_MAJOR="${SYS_MAJOR%%.*}"
case "$SYS_MAJOR" in ''|*[!0-9]*) SYS_MAJOR=0 ;; esac

if [ -z "$RT" ]; then
  NEED=0
  if [ "$SYS_MAJOR" -lt 20 ]; then NEED=1
  elif [ ! -f "$READY" ] && { [ "$SYS_MAJOR" -lt 22 ] || [ $((SYS_MAJOR % 2)) -eq 1 ]; }; then NEED=1
  fi
  if [ "$NEED" = 1 ]; then
    if fetch_node; then
      RT="runtime/$NODE_NAME"
    elif [ "$SYS_MAJOR" -ge 20 ]; then
      echo "→ パソコンに入っている Node.js（$SYS_VER）で、このまま進めます。"
      echo ""
    elif [ "$SYS_MAJOR" -eq 0 ]; then
      echo ""
      echo "【準備が必要です】Node.js が入っていません。"
      echo "ブラウザで https://nodejs.org/ を開きます。"
      echo "「LTS」と書かれた方をダウンロードして入れたあと、もう一度このファイルをダブルクリックしてください。"
      open "https://nodejs.org/"
      close_wait
      exit 1
    else
      # Node.js 20 未満では部品（better-sqlite3 など）が動かないため、入れ直してもらう
      echo ""
      echo "【準備が必要です】Node.js が古いため動きません（いま: ${SYS_VER:-不明} / 必要: 20 以上）。"
      echo "ブラウザで https://nodejs.org/ を開きます。"
      echo "「LTS」と書かれた方をダウンロードして入れ直したあと、もう一度このファイルをダブルクリックしてください。"
      open "https://nodejs.org/"
      close_wait
      exit 1
    fi
  fi
fi
[ -n "$RT" ] && export PATH="$PWD/$RT/bin:$PATH"

if [ ! -f "$READY" ]; then
  echo "部品を用意しています（初回は3〜5分かかります。たくさん文字が流れますが、そのままお待ちください）"
  npm install --no-audit --no-fund || { echo ""; echo "準備に失敗しました。インターネットにつながっているか確かめて、もう一度このファイルをダブルクリックしてください。"; echo "それでも失敗する場合は、この画面を写真に撮って配布元に送ってください。"; close_wait; exit 1; }
  date > "$READY"
  [ -n "$PLACE_SHOWN" ] && date > "$PLACE_NOTED"
fi

# 起動できたらアプリが自分でブラウザを開く（FO_OPEN=1）
export FO_OPEN=1

echo ""
echo "起動します（Node.js $(node -v 2>/dev/null)）。この黒い画面は閉じないでください（閉じると送信も止まります）。"
echo "止めるときは、この画面で Ctrl+C を押してください。"
echo ""
npm start

echo ""
echo "ApoBoostを終了しました。"
close_wait
