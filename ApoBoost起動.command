#!/bin/bash
# ApoBoost（Mac用）ダブルクリックで起動するファイル。
# 初回はこのファイルだけで、必要な部品の用意から起動まで全部やります（Node.js が無ければ、このフォルダの中に自動で用意します）。
# ※ このファイルはフォルダの中に置いたまま使ってください（移動すると起動できません）
# フォルダに入れないときは、何も出さずに終わらないよう理由を出す（「ダウンロード」等で、ターミナルのアクセスを「許可しない」にしたとき）
cd "$(dirname "$0")" || { echo "【準備が必要です】ApoBoost のフォルダを開けませんでした。"; echo "システム設定 →「プライバシーとセキュリティ」→「ファイルとフォルダ」で「ターミナル」をオンにしてから、もう一度このファイルを開いてください。"; read -r -p "returnキーでこの画面を閉じます… " _; exit 1; }
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

# ---- 自動で用意する Node.js（版とハッシュはここ1か所だけに書く）----
# 出どころ: https://nodejs.org/dist/index.json（22 系 LTS の最新）と https://nodejs.org/dist/v22.23.3/SHASUMS256.txt（2026-10-05 確認）。
# Windows 用の値は ApoBoost起動.bat と インストール（最初に1回）.bat の先頭にある。版を変えるときは3つとも同じ版にそろえ、
# better-sqlite3（package-lock.json の版）の GitHub Releases にその Node.js 用のビルド済み（node-v<番号>-darwin-arm64 等）があるかも確かめること
NODE_DIST_VER="v22.23.3"
NODE_SHA_ARM64="23b25245dcfb9af7262f8ff142e9e2e0af025368117329e7a7458a51e5922f53"  # node-v22.23.3-darwin-arm64.tar.gz
NODE_SHA_X64="8a677b0219178efd6eb0e475457c4afb452b521a92f6e67845a73bd85727f2a8"    # node-v22.23.3-darwin-x64.tar.gz
# 初回の準備で、パソコンに入っている Node.js をそのまま使ってよいメジャー版（これ以外は上の版を runtime/ に用意する）。
# better-sqlite3（package-lock.json の版 12.11.1）にビルド済みがあるもの。無い版だと部品の組み立て（コンパイル）になり、開発ツールの無いMacで失敗する。
# 出どころ: https://api.github.com/repos/WiseLibs/better-sqlite3/releases/tags/v12.11.1 の node-v127(22)・v137(24)・v141(25)・v147(26)（2026-10-05 確認）。
# 25 は奇数版で、サポートが終わっているので入れない。better-sqlite3 の版を上げたら確かめ直し、3つのファイルをそろえること
PREBUILT_MAJORS="22 24 26"

# Apple シリコンかどうか（Rosetta の下で動いていても 1 が返る）
if [ "$(sysctl -n hw.optional.arm64 2>/dev/null)" = "1" ]; then NODE_ARCH=arm64; NODE_SHA="$NODE_SHA_ARM64"; else NODE_ARCH=x64; NODE_SHA="$NODE_SHA_X64"; fi
NODE_NAME="node-$NODE_DIST_VER-darwin-$NODE_ARCH"

close_wait() { echo ""; read -r -p "returnキーでこの画面を閉じます… " _; }

clear
echo "============================================"
echo "  ApoBoost を起動します"
echo "============================================"
echo ""

# zip の中から直接開いた・ファイルが欠けている場合は、部品の用意に進まずに止める（途中で英語のエラーになるため）
if [ ! -f package.json ] || [ ! -f scripts/run.mjs ]; then
  echo "【準備が必要です】ApoBoost のファイルがそろっていません。"
  echo "zip をダブルクリックして展開（解凍）し、できたフォルダの中の「ApoBoost起動.command」を開いてください。"
  case "$PWD" in
    "$HOME/Downloads"*|"$HOME/Desktop"*|"$HOME/Documents"*)
      echo "（展開したフォルダから開いてもこの表示が出るときは、「ターミナル」がこのフォルダを読めていません。"
      echo "  システム設定 →「プライバシーとセキュリティ」→「ファイルとフォルダ」で「ターミナル」をオンにしてください）" ;;
  esac
  close_wait
  exit 1
fi

# この起動ファイルを開けた（＝macOS の確認を一度通った）ら、フォルダの中の「インターネットから来た」印を外す。
# 外さないと、あとで ApoBoost.app やほかのファイルを開くたびに、同じ確認がもう一度出る
xattr -dr com.apple.quarantine "$PWD" 2>/dev/null || true

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
# 1. このフォルダの中に用意した Node.js（runtime/）が上の版なら、それを使う（部品はその Node.js に合わせて用意してあるため）
#    前の版（上の版を上げる前に用意したもの）しか無ければ、上の版を取りに行き、できたら前の版を消す。取れなければ前の版のまま起動する
# 2. 無ければ、パソコンに入っている Node.js（20 以上。初回の準備では、部品のビルド済みがある版 = PREBUILT_MAJORS）
# 3. どちらも使えないときは、nodejs.org の公式の配布物を runtime/ に落として使う。失敗したら、これまでどおり nodejs.org を案内する
rt_ok() { [ -x "$1/bin/node" ] && "$1/bin/node" -v >/dev/null 2>&1; }
prebuilt_ok() { case " $PREBUILT_MAJORS " in *" $1 "*) return 0 ;; esac; return 1; }
# 既定の 3210 番で ApoBoost が動いているか（動いている方が使っている Node.js を消さないため）。
# /healthz の無い古い版でも、返ってくる画面に ApoBoost の名前が入るので、大文字・小文字を問わずに名前で見る
ab_running() { curl -s --max-time 3 "http://127.0.0.1:3210/healthz" 2>/dev/null | grep -qi 'apoboost'; }

fetch_fail() {
  echo "→ Node.js を自動で用意できませんでした（$1）。"
  rm -rf runtime/.extract "runtime/$NODE_NAME.tar.gz.part"
  rmdir runtime 2>/dev/null
  return 1
}

# 引数 quick: 前の版の Node.js があって、取れなくても起動できるとき。つながらない回線で毎回長く待たせないよう、試し直さない
fetch_node() {
  local url="https://nodejs.org/dist/$NODE_DIST_VER/$NODE_NAME.tar.gz" part="runtime/$NODE_NAME.tar.gz.part" got retry=2 ct=20
  [ "$1" = quick ] && { retry=0; ct=10; }
  echo "Node.js（$NODE_DIST_VER）をこのフォルダの中に用意します（約50MB。数分かかることがあります）"
  mkdir -p runtime || { fetch_fail "フォルダを作れませんでした"; return 1; }
  rm -rf runtime/.extract "$part"
  # 途中で止まる回線で永久に待たないよう、1分間ほとんど進まなければ・全体で10分かかったら、あきらめる
  curl -fL --retry "$retry" --connect-timeout "$ct" --speed-limit 1024 --speed-time 60 --max-time 600 --progress-bar -o "$part" "$url" || { fetch_fail "ダウンロードできませんでした。インターネットにつながっているか確かめてください"; return 1; }
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
  # 前の版の Node.js は消す（約100MB）。自動起動の登録が前の版を指していても、このあと起動したときに ApoBoost が書き直す
  for d in runtime/node-v*-darwin-*; do [ -d "$d" ] && [ "$d" != "runtime/$NODE_NAME" ] && rm -rf "$d"; done
  echo "→ 用意できました（Node.js $NODE_DIST_VER）"
  echo ""
  return 0
}

RT=""
RT_OLD=""
if rt_ok "runtime/$NODE_NAME"; then RT="runtime/$NODE_NAME"
else
  for d in runtime/node-v*-darwin-"$NODE_ARCH"; do [ "$d" != "runtime/$NODE_NAME" ] && rt_ok "$d" && RT_OLD="$d"; done
fi
if [ -n "$RT_OLD" ]; then
  OLD_VER="$("$RT_OLD/bin/node" -v 2>/dev/null)"
  if ab_running; then
    # 動いている ApoBoost がこの Node.js を使っているので、入れ替えは止まっているときの起動に回す
    RT="$RT_OLD"
  else
    echo "このフォルダの中の Node.js（$OLD_VER）を、新しい版に入れ替えます。"
    if fetch_node quick; then RT="runtime/$NODE_NAME"
    else
      echo "→ これまでの Node.js（$OLD_VER）で、このまま起動します（次の起動のときに、もう一度試します）。"
      echo ""
      RT="$RT_OLD"
    fi
  fi
fi

SYS_VER=""
command -v node >/dev/null 2>&1 && SYS_VER="$(node -v 2>/dev/null)"
SYS_MAJOR="${SYS_VER#v}"
SYS_MAJOR="${SYS_MAJOR%%.*}"
case "$SYS_MAJOR" in ''|*[!0-9]*) SYS_MAJOR=0 ;; esac

if [ -z "$RT" ]; then
  NEED=0
  if [ "$SYS_MAJOR" -lt 20 ]; then NEED=1
  elif [ ! -f "$READY" ] && ! prebuilt_ok "$SYS_MAJOR"; then NEED=1
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
      echo "Node.js のインストーラーをダウンロードします。開いたら案内どおりに入れて、もう一度このファイルをダブルクリックしてください。"
      echo "（会社のパソコンでは、ネットワークの制限で自動の用意が止められていることがあります。その場合は社内のご担当にご相談ください）"
      open "https://nodejs.org/dist/$NODE_DIST_VER/node-$NODE_DIST_VER.pkg"
      close_wait
      exit 1
    else
      # Node.js 20 未満では部品（better-sqlite3 など）が動かないため、入れ直してもらう
      echo ""
      echo "【準備が必要です】Node.js が古いため動きません（いま: ${SYS_VER:-不明} / 必要: 20 以上）。"
      echo "Node.js のインストーラーをダウンロードします。開いたら案内どおりに入れ直して、もう一度このファイルをダブルクリックしてください。"
      open "https://nodejs.org/dist/$NODE_DIST_VER/node-$NODE_DIST_VER.pkg"
      close_wait
      exit 1
    fi
  fi
fi
[ -n "$RT" ] && export PATH="$PWD/$RT/bin:$PATH"

if [ ! -f "$READY" ]; then
  echo "部品を用意しています（1〜5分ほど。画面が止まって見えても動いています。そのままお待ちください）"
  # 英語の注意書き（部品の古さ・npm の新しい版の案内）は購入者には関係が無く、見て不安になって閉じる人がいるので出さない
  npm install --no-audit --no-fund --loglevel=error --no-update-notifier || { echo ""; echo "準備に失敗しました。インターネットにつながっているか確かめて、もう一度このファイルをダブルクリックしてください。"; echo "会社のパソコンでは、ネットワークの制限で止められていることがあります。社内のご担当に、github.com・nodejs.org・registry.npmjs.org・cdn.playwright.dev への接続の許可をご相談ください。"; echo "それでも失敗する場合は、この画面を写真に撮って配布元に送ってください。"; close_wait; exit 1; }
  date > "$READY"
  [ -n "$PLACE_SHOWN" ] && date > "$PLACE_NOTED"
fi

# 起動できたらアプリが自分でブラウザを開く（FO_OPEN=1）
export FO_OPEN=1

echo ""
echo "起動します（Node.js $(node -v 2>/dev/null)）。この黒い画面は閉じないでください（閉じると送信も止まります）。"
echo "止めるときは、この画面で control キーを押しながら C を押してください。"
echo ""
npm start

echo ""
echo "ApoBoostを終了しました。"
close_wait
