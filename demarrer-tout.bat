@echo off
cd /d "%~dp0"
start "SereniPath Backend" cmd /k "cd /d %~dp0server && node index.js"
timeout /t 2 /nobreak >nul
start "SereniPath Frontend" cmd /k "cd /d %~dp0client && npm start"
echo Backend et frontend demarres dans deux fenetres.
