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

if not exist node_modules (
  echo 初回の準備をしています（3〜5分かかります。たくさん文字が流れますが、そのままお待ちください）
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
