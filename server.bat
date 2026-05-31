@echo off
rem Study Support のローカルサーバー本体（ビルド→静的配信）。
rem run-server-hidden.vbs / open-study-support.vbs から非表示で呼ばれる。
rem 配信は stdin を読まない自前サーバー(serve.mjs)なので、非表示起動でも常駐する。
cd /d "C:\Projects\study-suport"
set "NODE=C:\Program Files\nodejs\node.exe"
set "LOGDIR=%TEMP%\study-support"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
"%NODE%" "node_modules\vite\bin\vite.js" build > "%LOGDIR%\build.log" 2>&1
"%NODE%" "C:\Projects\study-suport\serve.mjs" > "%LOGDIR%\server.log" 2>&1
