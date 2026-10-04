@echo off
chcp 65001 >nul
rem ApoBoost Windows用インストーラー（最初に1回だけ実行してください）。
rem Node.js の確認 → 必要な部品の用意 → デスクトップとスタートメニューにショートカットを作成 まで行います。
cd /d "%~dp0"
title ApoBoost インストール

cls
echo ============================================
echo   ApoBoost インストール
echo ============================================
echo.
echo このフォルダ: %cd%
echo.

rem zip の中から直接開いた場合（ファイルが一時フォルダに1つだけ取り出されて動く）や、ファイルが欠けている場合は止める
if not exist "package.json" goto :notextracted
if not exist "scripts\run.mjs" goto :notextracted

where node >nul 2>&1
if errorlevel 1 (
  echo 【準備が必要です】Node.js が入っていません。
  echo ブラウザで https://nodejs.org/ を開きます。「LTS」をダウンロードして入れたあと、
  echo このファイルをもう一度ダブルクリックしてください。
  start "" "https://nodejs.org/"
  echo.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do echo Node.js: %%v
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

echo.
echo [1/3] 必要な部品をダウンロードしています（3〜5分かかります）
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo.
  echo 失敗しました。この画面を写真に撮って配布元に送ってください。
  pause
  exit /b 1
)

echo.
echo [2/3] フォーム操作用のブラウザを用意しています
call npx playwright install chromium
if errorlevel 1 echo → 入れられませんでした。Google Chrome が入っていればそちらを使います。
rem 準備が最後まで通った目印。ApoBoost起動.bat はこれを見て、準備をやり直すかどうかを決める
echo ok>"node_modules\.apoboost-ready"

echo.
echo [3/3] ショートカットを作成しています
set "TARGET=%cd%\ApoBoost起動.bat"
rem デスクトップの場所は Windows に聞く。OneDrive にデスクトップを移したPCでは、ユーザーフォルダの Desktop が実際のデスクトップと別の場所で、
rem ショートカットが見えない所に作られていた。1つでも作れなければ失敗として扱う（以前は最後の1つが通れば「作りました」と出ていた）
powershell -NoProfile -Command ^
  "$ErrorActionPreference = 'Stop';" ^
  "$ws = New-Object -ComObject WScript.Shell;" ^
  "foreach ($dir in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {" ^
  "  $lnk = $ws.CreateShortcut((Join-Path $dir 'ApoBoost.lnk'));" ^
  "  $lnk.TargetPath = '%TARGET%';" ^
  "  $lnk.WorkingDirectory = '%cd%';" ^
  "  $lnk.Description = 'フォーム＆メール営業の自動送信ツール';" ^
  "  $lnk.Save() }"
if errorlevel 1 (echo → ショートカットは作れませんでした。「ApoBoost起動.bat」を直接ダブルクリックしてください。) else (echo → デスクトップとスタートメニューに「ApoBoost」を作りました)

echo.
echo ============================================
echo   インストールが終わりました
echo ============================================
echo.
echo 次からは、デスクトップの「ApoBoost」をダブルクリックするだけで起動します。
echo いま起動しますか？
choice /c YN /m "起動する(Y) / あとで(N)"
if errorlevel 2 goto :end
start "" "%TARGET%"
:end
echo.
echo この画面は閉じて構いません。
pause
exit /b 0

:notextracted
echo 【準備が必要です】ApoBoost のファイルがそろっていません。
echo zip の中から直接開いている可能性があります。
echo zip を右クリック →「すべて展開」で展開し、できたフォルダの中の「インストール（最初に1回）.bat」をダブルクリックしてください。
echo.
pause
exit /b 1
