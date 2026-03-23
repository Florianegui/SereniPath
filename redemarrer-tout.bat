@echo off
echo ========================================
echo Arret de tous les processus Node.js
echo ========================================
echo.

REM Tuer tous les processus node
taskkill /F /IM node.exe 2>nul
if errorlevel 1 (
    echo Aucun processus Node.js trouve
) else (
    echo ✅ Tous les processus Node.js ont ete arretes
)

timeout /t 2 /nobreak >nul

echo.
echo ========================================
echo Demarrage des serveurs
echo ========================================
echo.

echo Demarrage du backend et du frontend...
cd /d "%~dp0server"
start "Zénova Backend" cmd /k npm run dev
cd /d "%~dp0"
timeout /t 3 /nobreak >nul
cd /d "%~dp0client"
start "Zénova Frontend" cmd /k npm start
cd /d "%~dp0"

echo.
echo ✅ Serveurs demarres!
echo.
echo - Backend: http://localhost:5000
echo - Frontend: http://localhost:3000
echo.
echo Les fenetres de terminal sont ouvertes separement
echo.
pause
