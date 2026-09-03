@echo off
set "LAUNCH_DIR=%~dp0"
wscript.exe "%LAUNCH_DIR%start_silent.vbs"
exit /b
