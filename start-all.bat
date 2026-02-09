@echo off
echo ========================================
echo Demarrage de SereniPathh
echo ========================================
echo.

echo Demarrage du backend...
cd server
start "SereniPathh Backend" cmd /k "npm run dev"
cd ..
timeout /t 3 /nobreak >nul

echo Demarrage du frontend...
cd client
start "SereniPathh Frontend" cmd /k "npm start"
cd ..

echo.
echo ✅ Serveurs demarres!
echo.
echo - Backend: http://localhost:5000
echo - Frontend: http://localhost:3000
echo.
echo Les fenetres de terminal sont ouvertes separement
echo.
pause
