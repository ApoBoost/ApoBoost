@echo off
chcp 65001 >nul
rem ApoBoost Windows用インストーラー（最初に1回だけ実行してください）。
rem Node.js の用意 → 必要な部品の用意 → デスクトップとスタートメニューにショートカットを作成 まで行います。
rem Node.js が無い・古いときは、このフォルダの中（runtime\）に公式の配布物を自動で用意します。
rem 書き方の決まり: 括弧のブロック（if ... ( ... ) など）は使わず、goto で1行ずつ書く（ApoBoost起動.bat と同じ理由）
cd /d "%~dp0"
title ApoBoost インストール

rem ---- 自動で用意する Node.js（版とハッシュはここ1か所。ApoBoost起動.bat の先頭と同じ値にそろえる）----
rem 出どころ: https://nodejs.org/dist/index.json（22 系 LTS の最新）と https://nodejs.org/dist/v22.23.3/SHASUMS256.txt（2026-10-05 確認）
set "AB_NODE_VER=v22.23.3"
set "AB_NODE_SHA=2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71"
set "AB_NODE_NAME=node-%AB_NODE_VER%-win-x64"

cls
echo ============================================
echo   ApoBoost インストール
echo ============================================
echo.
echo このフォルダ: "%CD%"
echo.

rem zip の中から直接開いた場合（ファイルが一時フォルダに1つだけ取り出されて動く）や、ファイルが欠けている場合は止める
if not exist "package.json" goto :notextracted
if not exist "scripts\run.mjs" goto :notextracted

rem ダウンロードした zip から展開したファイルには「インターネットから来た」印が付き、開くたびに警告が出る。
rem このファイルを開けた（＝一度許可した）ら、フォルダの中の印を外す（2回目以降・ショートカットから開くときに警告を出さないため）。外せなくても続ける
rem 1回だけ行う（印が付くのは zip から展開したファイルだけ。アップデートで入れ替わるファイルには付かない）。起動のたびに部品まで数千ファイルを調べると遅くなるため
if exist ".apoboost-unblocked" goto :unblock_done
set "AB_HERE=%CD%"
powershell -NoProfile -Command "Get-ChildItem -LiteralPath $env:AB_HERE -Recurse -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue" >nul 2>&1
echo ok>".apoboost-unblocked"
attrib +h ".apoboost-unblocked" >nul 2>&1
:unblock_done
rem npm が英語で「新しい版があります」と出すのを止める（購入者には関係が無い）
set "npm_config_update_notifier=false"

rem 置き場所の注意（1回だけ。ApoBoost起動.bat と同じ目印を使う）
set "AB_PLACE_SHOWN="
if exist "node_modules\.apoboost-place-noted" goto :place_done
echo "%CD%" | findstr /i /l /c:"OneDrive" >nul
if errorlevel 1 goto :place_done
echo 【おすすめ】このフォルダは OneDrive の中にあります。
echo   ここに置いたままだと、部品の用意が失敗しやすく、パソコンの起動時の自動起動も動かないことがあります。
echo   この画面を閉じて、フォルダごと C:\ApoBoost などに移してから、もう一度このファイルを開くのがおすすめです。
echo   （このまま進めることもできます。この案内は1回だけ出します）
echo.
set "AB_PLACE_SHOWN=1"
if exist "node_modules" echo ok>"node_modules\.apoboost-place-noted"
timeout /t 5 /nobreak >nul 2>&1
:place_done

rem ---- 使う Node.js を決める（ApoBoost起動.bat と同じ順番）----
rem 1. このフォルダの中に用意した Node.js（runtime\） 2. パソコンに入っている 22 以上の偶数版 3. 公式の配布物を runtime\ に落とす
rem （インストールは準備をやり直すので、「準備済みなら 20 以上で可」の扱いはしない）。3 に失敗したら、これまでどおり nodejs.org を案内する
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
if %NODE_MAJOR% LSS 22 goto :fetch
if "%AB_ODD%"=="1" goto :fetch
goto :node_ok

:rt_use
set "PATH=%AB_RT%;%PATH%"

:node_ok
for /f "tokens=*" %%v in ('node -v') do echo Node.js: %%v

echo.
echo [1/2] 必要な部品をダウンロードしています（1〜5分ほど。画面が止まって見えても動いています）
echo       画面の中はクリックしないでください（クリックすると止まります。止まったら Enter キーを1回押してください）
rem 英語の注意書き（部品の古さ・npm の新しい版の案内）は購入者には関係が無く、見て不安になって閉じる人がいるので出さない
call npm install --no-audit --no-fund --loglevel=error --no-update-notifier
if errorlevel 1 goto :install_failed
rem 準備が最後まで通った目印。ApoBoost起動.bat はこれを見て、準備をやり直すかどうかを決める
echo ok>"node_modules\.apoboost-ready"
if "%AB_PLACE_SHOWN%"=="1" echo ok>"node_modules\.apoboost-place-noted"
rem フォーム操作用のブラウザ（Chromium）は、起動のたびに scripts\run.mjs が確かめて、無ければ裏で入れる
rem （Edge があればそれを使って先に起動する。ここで数分待たせないため）

echo.
echo [2/2] ショートカットを作成しています
rem デスクトップの場所は Windows に聞く。OneDrive にデスクトップを移したPCでは、ユーザーフォルダの Desktop が実際のデスクトップと別の場所で、
rem ショートカットが見えない所に作られていた。1つでも作れなければ失敗として扱う（以前は最後の1つが通れば「作りました」と出ていた）
rem パスは環境変数で渡す（' を含むフォルダ名でも壊れないように）
set "AB_TARGET=%CD%\ApoBoost起動.bat"
set "AB_WORKDIR=%CD%"
powershell -NoProfile -Command "$ErrorActionPreference = 'Stop'; $ws = New-Object -ComObject WScript.Shell; foreach ($dir in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) { $lnk = $ws.CreateShortcut((Join-Path $dir 'ApoBoost.lnk')); $lnk.TargetPath = $env:AB_TARGET; $lnk.WorkingDirectory = $env:AB_WORKDIR; $lnk.Description = 'フォーム＆メール営業の自動送信ツール'; $lnk.Save() }"
if errorlevel 1 goto :shortcut_failed
echo → デスクトップとスタートメニューに「ApoBoost」を作りました
goto :shortcut_done
:shortcut_failed
echo → ショートカットは作れませんでした。「ApoBoost起動.bat」を直接ダブルクリックしてください。
:shortcut_done

echo.
echo ============================================
echo   インストールが終わりました
echo ============================================
echo.
echo 次からは、デスクトップの「ApoBoost」をダブルクリックするだけで起動します。
echo いま起動しますか？
choice /c YN /m "起動する(Y) / あとで(N)"
if errorlevel 2 goto :later
rem 同じ窓のまま起動する（別の窓で開くと黒い画面が2つになり、どちらを閉じてよいか迷うため）。
rem 1行にしてある（待っているあいだにアップデートでこのファイルが置き換わっても、読み直す前に終わるように）
call "%AB_TARGET%" & exit /b 0
:later
rem 最後は1行にしてある（待っているあいだにアップデートでこのファイルが置き換わっても、読み直す前に終わるように。ApoBoost起動.bat と同じ理由）
echo. & echo この画面は閉じて構いません。 & pause & exit /b 0

rem ---- ここから下は、上から goto で飛んでくる部分 ----

:fetch
rem 64ビット版の Windows 用だけ用意する（ARM 版の Windows 11 でも動く）
if /i "%PROCESSOR_ARCHITECTURE%"=="AMD64" goto :fetch_go
if /i "%PROCESSOR_ARCHITEW6432%"=="AMD64" goto :fetch_go
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" goto :fetch_go
echo → この Windows（%PROCESSOR_ARCHITECTURE%）には自動で用意できません。
goto :fetch_failed
:fetch_go
echo Node.js（%AB_NODE_VER%）をこのフォルダの中に用意します（約40MB。数分かかることがあります）
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
echo Node.js のインストーラーをダウンロードします。開いたら案内どおりに入れて、
echo このファイルをもう一度ダブルクリックしてください。
echo （会社のパソコンでは、ネットワークの制限で自動の用意が止められていることがあります。その場合は社内のご担当にご相談ください）
start "" "https://nodejs.org/dist/%AB_NODE_VER%/node-%AB_NODE_VER%-x64.msi"
echo.
pause
exit /b 1

:oldnode
rem Node.js 20 未満では部品（better-sqlite3 など）が動かないため、入れ直してもらう
echo.
echo 【準備が必要です】Node.js が古いため動きません。いま: v%NODE_MAJOR% / 必要: 20 以上
echo Node.js のインストーラーをダウンロードします。開いたら案内どおりに入れ直して、もう一度このファイルをダブルクリックしてください。
start "" "https://nodejs.org/dist/%AB_NODE_VER%/node-%AB_NODE_VER%-x64.msi"
echo.
pause
exit /b 1

:install_failed
echo.
echo 失敗しました。インターネットにつながっているか確かめて、もう一度このファイルをダブルクリックしてください。
echo 会社のパソコンでは、ネットワークの制限で止められていることがあります。社内のご担当に、github.com・nodejs.org・registry.npmjs.org・cdn.playwright.dev への接続の許可をご相談ください。
echo それでも失敗する場合は、この画面を写真に撮って配布元に送ってください。
pause
exit /b 1

:notextracted
echo 【準備が必要です】ApoBoost のファイルがそろっていません。
echo zip の中から直接開いている可能性があります。
echo zip を右クリック →「すべて展開」で展開し、できたフォルダの中の「インストール（最初に1回）.bat」をダブルクリックしてください。
echo.
pause
exit /b 1
