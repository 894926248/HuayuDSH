@echo off
setlocal
set ELECTRON_RUN_AS_NODE=
set "DSH_DESKTOP_SOURCE_ROOT=C:\Users\89492\Desktop\deepseek-harness\.workspace\artifacts\staging\runtime"
cd /d "C:\Users\89492\Desktop\deepseek-harness\product\app\desktop"
start "" "node_modules\electron\dist\electron.exe" . --disable-gpu --no-sandbox --remote-debugging-port=9351
endlocal
