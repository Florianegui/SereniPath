@echo off
echo ========================================
echo Arret de tous les processus Node.js
echo ========================================
echo.

taskkill /F /IM node.exe 2>nul
if errorlevel 1 (
    echo Aucun processus Node.js en cours d'execution
) else (
    echo ✅ Tous les processus Node.js ont ete arretes
)

echo.
pause
