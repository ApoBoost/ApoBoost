@echo off
chcp 65001 >nul
rem ApoBoost（Windows用）ダブルクリックで起動するファイル。
rem 初回はこのファイルだけで、必要な部品の用意から起動まで全部やります（Node.js が無ければ、このフォルダの中に自動で用意します）。
rem ※ このファイルはフォルダの中に置いたまま使ってください（移動すると起動できません）
rem 書き方の決まり: 括弧のブロック（if ... ( ... ) など）は使わず、goto で1行ずつ書く。
rem ブロックの中では、PATH などに含まれる「)」で構文が壊れたり、変数が1回しか展開されなかったりするため。Windows の実機で試しにくいので単純に保つ
cd /d "%~dp0"
title ApoBoost

rem ---- 自動で用意する Node.js（版とハッシュはここ1か所。インストール（最初に1回）.bat の先頭と同じ値にそろえる）----
rem 出どころ: https://nodejs.org/dist/index.json（22 系 LTS の最新）と https://nodejs.org/dist/v22.23.3/SHASUMS256.txt（2026-10-05 確認）
rem Mac 用の値は ApoBoost起動.command の先頭にある。版を変えるときは3つのファイルをそろえること
set "AB_NODE_VER=v22.23.3"
set "AB_NODE_SHA=2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71"
set "AB_NODE_NAME=node-%AB_NODE_VER%-win-x64"

cls
echo ============================================
echo   ApoBoost を起動します
echo ============================================
echo.

rem zip の中から直接開いた場合（ファイルが一時フォルダに1つだけ取り出されて動く）や、ファイルが欠けている場合は止める
if not exist "package.json" goto :notextracted
if not exist "scripts\run.mjs" goto :notextracted

rem 置き場所の注意（1回だけ）。OneDrive の中だと、部品（数万個のファイル）の同期で準備が失敗しやすく、自動起動も動かないことがある
set "AB_PLACE_SHOWN="
if exist "node_modules\.apoboost-place-noted" goto :place_done
echo "%CD%" | findstr /i /l /c:"OneDrive" >nul
if errorlevel 1 goto :place_done
echo 【おすすめ】このフォルダは OneDrive の中にあります。
echo   ここに置いたままだと、部品の用意が失敗しやすく、パソコンの起動時の自動起動も動かないことがあります。
echo   ApoBoost を止めてから、フォルダごと C:\ApoBoost などに移して使うのがおすすめです。
echo   （このまま使うこともできます。この案内は1回だけ出します）
echo.
set "AB_PLACE_SHOWN=1"
if exist "node_modules" echo ok>"node_modules\.apoboost-place-noted"
timeout /t 3 /nobreak >nul 2>&1
:place_done

rem 準備ができたかどうかは、npm install が最後まで通ったときに置く目印で見る（ブラウザの用意は起動のたびに scripts\run.mjs が確かめる）。
rem node_modules があるかだけで見ると、準備の途中で画面を閉じた場合に「済み」と扱われ、英語のエラーで止まり続けていた
rem 以前の版で準備を済ませたフォルダには目印が無いので、npm が準備を終えたときに作るファイルがあれば済みとみなす
if not exist "node_modules\.apoboost-ready" if exist "node_modules\.package-lock.json" if exist "node_modules\tsx" echo ok>"node_modules\.apoboost-ready"

rem ---- 使う Node.js を決める ----
rem 1. このフォルダの中に用意した Node.js（runtime\）があれば、それを使う（部品はその Node.js に合わせて用意してあるため）
rem 2. 無ければ、パソコンに入っている Node.js（20 以上。初回の準備では、部品のビルド済みがある 22 以上の偶数版）
rem 3. どちらも使えないときは、nodejs.org の公式の配布物を runtime\ に落として使う。失敗したら、これまでどおり nodejs.org を案内する
set "AB_RT="
for /d %%d in ("runtime\node-v*-win-x64") do if exist "%%~d\node.exe" set "AB_RT=%CD%\%%~d"
if exist "runtime\%AB_NODE_NAME%\node.exe" set "AB_RT=%CD%\runtime\%AB_NODE_NAME%"
if not defined AB_RT goto :sysnode
"%AB_RT%\node.exe" -v >nul 2>&1
if errorlevel 1 goto :rt_broken
goto :rt_use
:rt_broken
set "AB_RT="
:sysnode
set "NODE_MAJOR=0"
set "NODE_VER="
where node >nul 2>&1
if errorlevel 1 goto :sysnode_done
for /f "tokens=1 delims=v." %%a in ('node -v') do set "NODE_MAJOR=%%a"
for /f "tokens=*" %%v in ('node -v') do set "NODE_VER=%%v"
:sysnode_done
set "AB_ODD=0"
set /a "AB_ODD=NODE_MAJOR %% 2" >nul 2>&1
set "AB_NEED=0"
if %NODE_MAJOR% LSS 20 set "AB_NEED=1"
if not exist "node_modules\.apoboost-ready" if %NODE_MAJOR% LSS 22 set "AB_NEED=1"
if not exist "node_modules\.apoboost-ready" if "%AB_ODD%"=="1" set "AB_NEED=1"
if "%AB_NEED%"=="1" goto :fetch
goto :node_ok

:rt_use
set "PATH=%AB_RT%;%PATH%"

:node_ok
for /f "tokens=*" %%v in ('node -v') do echo Node.js: %%v
if exist "node_modules\.apoboost-ready" goto :ready
echo 部品を用意しています（初回は3〜5分かかります。たくさん文字が流れますが、そのままお待ちください）
call npm install --no-audit --no-fund
if errorlevel 1 goto :install_failed
echo ok>"node_modules\.apoboost-ready"
if "%AB_PLACE_SHOWN%"=="1" echo ok>"node_modules\.apoboost-place-noted"
:ready

rem 起動できたらアプリが自分でブラウザを開く
set FO_OPEN=1

echo.
echo 起動します。この黒い画面は閉じないでください（閉じると送信も止まります）。
echo 止めるときは、この画面で Ctrl+C を押して Y を入力してください。
echo.
rem ↓ 起動から終わりまでを、わざと1行にしてある。この行のあとに処理を足さないこと。
rem アップデートは、動いている最中のこのファイルを新しい版に置き換える。cmd は1行実行するごとにファイルを開き直し、
rem 「次の行があった位置」から読み直すため、npm start が終わったときに長さの違う新しいファイルの途中から読み始め、
rem 意味の無い命令を実行していた。1行にしておけば、ファイルを読み直す前に exit で終わる。
rem この行より前の部分は、今後長さが変わっても安全（置き換わるのは、ここを読み終えて npm start が動いているあいだだけのため）
call npm start & echo. & echo ApoBoostを終了しました。 & pause & exit /b 0

rem ---- ここから下は、上から goto で飛んでくる部分 ----

:fetch
rem 64ビット版の Windows 用だけ用意する（ARM 版の Windows 11 でも動く）
if /i "%PROCESSOR_ARCHITECTURE%"=="AMD64" goto :fetch_go
if /i "%PROCESSOR_ARCHITEW6432%"=="AMD64" goto :fetch_go
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" goto :fetch_go
echo → この Windows（%PROCESSOR_ARCHITECTURE%）には自動で用意できません。
goto :fetch_failed
:fetch_go
echo Node.js（%AB_NODE_VER%）をこのフォルダの中に用意します（約50MB。数分かかることがあります）
if not exist "runtime" mkdir "runtime"
if exist "runtime\node.zip.part" del /f /q "runtime\node.zip.part"
if exist "runtime\node.zip" del /f /q "runtime\node.zip"
if exist "runtime\.extract" rmdir /s /q "runtime\.extract"
rem PowerShell には、パスと URL を環境変数で渡す（日本語や ' を含むフォルダ名でも壊れないように）
set "AB_URL=https://nodejs.org/dist/%AB_NODE_VER%/%AB_NODE_NAME%.zip"
set "AB_PART=%CD%\runtime\node.zip.part"
set "AB_ZIP=%CD%\runtime\node.zip"
set "AB_TMP=%CD%\runtime\.extract"
if not exist "%SystemRoot%\System32\curl.exe" goto :fetch_ps
"%SystemRoot%\System32\curl.exe" -fL --retry 2 --connect-timeout 20 -o "runtime\node.zip.part" "%AB_URL%"
if errorlevel 1 goto :fetch_ps
goto :fetch_verify
:fetch_ps
if exist "runtime\node.zip.part" del /f /q "runtime\node.zip.part"
echo （別の方法でダウンロードしています）
powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12; try { Invoke-WebRequest -UseBasicParsing -Uri $env:AB_URL -OutFile $env:AB_PART; exit 0 } catch { Write-Host $_.Exception.Message; exit 1 }"
if errorlevel 1 goto :fetch_failed
:fetch_verify
if not exist "runtime\node.zip.part" goto :fetch_failed
certutil -hashfile "runtime\node.zip.part" SHA256 2>nul | findstr /i /l /c:"%AB_NODE_SHA%" >nul
if not errorlevel 1 goto :fetch_extract
powershell -NoProfile -Command "if ((Get-FileHash -Algorithm SHA256 -LiteralPath $env:AB_PART).Hash -eq $env:AB_NODE_SHA) { exit 0 } else { exit 1 }"
if not errorlevel 1 goto :fetch_extract
echo → ダウンロードしたファイルが壊れていました。
goto :fetch_failed
:fetch_extract
move /y "runtime\node.zip.part" "runtime\node.zip" >nul
if errorlevel 1 goto :fetch_failed
mkdir "runtime\.extract"
if not exist "%SystemRoot%\System32\tar.exe" goto :fetch_unzip_ps
"%SystemRoot%\System32\tar.exe" -xf "runtime\node.zip" -C "runtime\.extract"
if errorlevel 1 goto :fetch_unzip_ps
goto :fetch_place
:fetch_unzip_ps
if exist "runtime\.extract" rmdir /s /q "runtime\.extract"
powershell -NoProfile -Command "try { Expand-Archive -LiteralPath $env:AB_ZIP -DestinationPath $env:AB_TMP -Force; exit 0 } catch { Write-Host $_.Exception.Message; exit 1 }"
if errorlevel 1 goto :fetch_failed
:fetch_place
if not exist "runtime\.extract\%AB_NODE_NAME%\node.exe" goto :fetch_failed
if exist "runtime\%AB_NODE_NAME%" rmdir /s /q "runtime\%AB_NODE_NAME%"
rem 展開した直後はウイルス対策ソフトが中身を調べていて、フォルダを動かせないことがあるので、少し待って2回まで試し直す
move "runtime\.extract\%AB_NODE_NAME%" "runtime\%AB_NODE_NAME%" >nul 2>&1
if not errorlevel 1 goto :fetch_moved
timeout /t 3 /nobreak >nul 2>&1
move "runtime\.extract\%AB_NODE_NAME%" "runtime\%AB_NODE_NAME%" >nul 2>&1
if not errorlevel 1 goto :fetch_moved
timeout /t 10 /nobreak >nul 2>&1
move "runtime\.extract\%AB_NODE_NAME%" "runtime\%AB_NODE_NAME%" >nul
if errorlevel 1 goto :fetch_failed
:fetch_moved
"runtime\%AB_NODE_NAME%\node.exe" -v 2>nul | findstr /l /c:"%AB_NODE_VER%" >nul
if errorlevel 1 goto :fetch_failed
del /f /q "runtime\node.zip" >nul 2>&1
rmdir /s /q "runtime\.extract" >nul 2>&1
set "AB_RT=%CD%\runtime\%AB_NODE_NAME%"
echo → 用意できました（Node.js %AB_NODE_VER%）
echo.
goto :rt_use

:fetch_failed
echo → Node.js を自動で用意できませんでした（インターネットにつながっているか確かめてください）。
if exist "runtime\node.zip.part" del /f /q "runtime\node.zip.part"
if exist "runtime\node.zip" del /f /q "runtime\node.zip"
if exist "runtime\.extract" rmdir /s /q "runtime\.extract"
if exist "runtime\%AB_NODE_NAME%" rmdir /s /q "runtime\%AB_NODE_NAME%"
rmdir "runtime" >nul 2>&1
if "%NODE_MAJOR%"=="0" goto :nonode
if %NODE_MAJOR% LSS 20 goto :oldnode
echo → パソコンに入っている Node.js（%NODE_VER%）で、このまま進めます。
echo.
goto :node_ok

:nonode
echo.
echo 【準備が必要です】Node.js が入っていません。
echo ブラウザで https://nodejs.org/ を開きます。
echo 「LTS」と書かれた方をダウンロードして入れたあと、もう一度このファイルをダブルクリックしてください。
start "" "https://nodejs.org/"
echo.
pause
exit /b 1

:oldnode
rem Node.js 20 未満では部品（better-sqlite3 など）が動かないため、入れ直してもらう
echo.
echo 【準備が必要です】Node.js が古いため動きません。いま: v%NODE_MAJOR% / 必要: 20 以上
echo ブラウザで https://nodejs.org/ を開きます。
echo 「LTS」と書かれた方をダウンロードして入れ直したあと、もう一度このファイルをダブルクリックしてください。
start "" "https://nodejs.org/"
echo.
pause
exit /b 1

:install_failed
echo.
echo 準備に失敗しました。インターネットにつながっているか確かめて、もう一度このファイルをダブルクリックしてください。
echo それでも失敗する場合は、この画面を写真に撮って配布元に送ってください。
pause
exit /b 1

:notextracted
echo 【準備が必要です】ApoBoost のファイルがそろっていません。
echo zip の中から直接開いている可能性があります。
echo zip を右クリック →「すべて展開」で展開し、できたフォルダの中の「ApoBoost起動.bat」をダブルクリックしてください。
echo.
pause
exit /b 1
