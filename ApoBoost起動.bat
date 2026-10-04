@echo off
chcp 65001 >nul
rem ApoBoost（Windows用）ダブルクリックで起動するファイル。
rem 初回はこのファイルだけで、必要な部品の用意から起動まで全部やります。
rem ※ このファイルはフォルダの中に置いたまま使ってください（移動すると起動できません）
cd /d "%~dp0"
title ApoBoost

cls
echo ============================================
echo   ApoBoost を起動します
echo ============================================
echo.

rem zip の中から直接開いた場合（ファイルが一時フォルダに1つだけ取り出されて動く）や、ファイルが欠けている場合は止める
if not exist "package.json" goto :notextracted
if not exist "scripts\run.mjs" goto :notextracted

where node >nul 2>&1
if errorlevel 1 (
  echo 【準備が必要です】Node.js が入っていません。
  echo ブラウザで https://nodejs.org/ を開きます。
  echo 「LTS」と書かれた方をダウンロードして入れたあと、もう一度このファイルをダブルクリックしてください。
  start "" "https://nodejs.org/"
  echo.
  pause
  exit /b 1
)

rem Node.js 20 未満では部品（better-sqlite3 など）が動かないため、入れ直してもらう
set "NODE_MAJOR=0"
for /f "tokens=1 delims=v." %%a in ('node -v') do set "NODE_MAJOR=%%a"
if %NODE_MAJOR% LSS 20 (
  echo 【準備が必要です】Node.js が古いため動きません。いま: v%NODE_MAJOR% / 必要: 20 以上
  echo ブラウザで https://nodejs.org/ を開きます。
  echo 「LTS」と書かれた方をダウンロードして入れ直したあと、もう一度このファイルをダブルクリックしてください。
  start "" "https://nodejs.org/"
  echo.
  pause
  exit /b 1
)

rem 準備ができたかどうかは、準備が最後まで通ったときに置く目印で見る。
rem node_modules があるかだけで見ると、準備の途中で画面を閉じた場合に「済み」と扱われ、英語のエラーで止まり続けていた
rem 以前の版で準備を済ませたフォルダには目印が無いので、npm が準備を終えたときに作るファイルがあれば済みとみなす
if not exist "node_modules\.apoboost-ready" if exist "node_modules\.package-lock.json" if exist "node_modules\tsx" echo ok>"node_modules\.apoboost-ready"
if not exist "node_modules\.apoboost-ready" (
  echo 部品を用意しています（初回は3〜5分かかります。たくさん文字が流れますが、そのままお待ちください）
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo 準備に失敗しました。この画面を写真に撮って配布元に送ってください。
    pause
    exit /b 1
  )
  echo.
  echo フォーム操作用のブラウザを用意します（失敗しても、Google Chrome が入っていれば動きます）
  call npx playwright install chromium
  if errorlevel 1 echo → 入れられませんでした。Google Chrome が入っていればそちらを使います。
  echo ok>"node_modules\.apoboost-ready"
)

rem 起動できたらアプリが自分でブラウザを開く
set FO_OPEN=1

echo.
echo 起動します。この黒い画面は閉じないでください（閉じると送信も止まります）。
echo 止めるときは、この画面で Ctrl+C を押して Y を入力してください。
echo.
call npm start

echo.
echo ApoBoostを終了しました。
pause
exit /b 0

:notextracted
echo 【準備が必要です】ApoBoost のファイルがそろっていません。
echo zip の中から直接開いている可能性があります。
echo zip を右クリック →「すべて展開」で展開し、できたフォルダの中の「ApoBoost起動.bat」をダブルクリックしてください。
echo.
pause
exit /b 1
