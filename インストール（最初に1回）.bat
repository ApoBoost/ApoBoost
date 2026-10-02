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

echo.
echo [3/3] ショートカットを作成しています
set "TARGET=%cd%\ApoBoost起動.bat"
set "DESKTOP=%USERPROFILE%\Desktop"
set "STARTMENU=%APPDATA%\Microsoft\Windows\Start Menu\Programs"
powershell -NoProfile -Command ^
  "$ws = New-Object -ComObject WScript.Shell;" ^
  "foreach ($dir in @('%DESKTOP%','%STARTMENU%')) {" ^
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
