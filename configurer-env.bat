@echo off
echo ========================================
echo Configuration de Zénova
echo ========================================
echo.

if exist "server\.env" (
    echo Le fichier server\.env existe deja.
    echo Voulez-vous le remplacer? (O/N)
    set /p replace=
    if /i not "%replace%"=="O" (
        echo Configuration annulee.
        pause
        exit /b 0
    )
)

echo.
echo Configuration du fichier .env pour le serveur...
echo.

echo.
echo Configuration MySQL pour XAMPP:
echo - Utilisateur par defaut: root
echo - Mot de passe par defaut: (vide, appuyez sur Entree)
echo.

set /p DB_USER="Entrez votre utilisateur MySQL [root]: "
if "%DB_USER%"=="" set DB_USER=root

set /p DB_PASSWORD="Entrez votre mot de passe MySQL (laissez vide si aucun): "
if "%DB_PASSWORD%"=="" set DB_PASSWORD=

set /p DB_HOST="Entrez l'host MySQL [localhost]: "
if "%DB_HOST%"=="" set DB_HOST=localhost

set /p DB_NAME="Entrez le nom de la base de donnees [zenova]: "
if "%DB_NAME%"=="" set DB_NAME=zenova

set /p PORT="Entrez le port du serveur [5000]: "
if "%PORT%"=="" set PORT=5000

echo.
echo Creation du fichier server\.env...

(
echo PORT=%PORT%
echo JWT_SECRET=zenova_secret_key_change_in_production_%RANDOM%%RANDOM%
echo DB_HOST=%DB_HOST%
echo DB_USER=%DB_USER%
echo DB_PASSWORD=%DB_PASSWORD%
echo DB_NAME=%DB_NAME%
echo NODE_ENV=development
) > server\.env

echo.
echo ✅ Fichier server\.env cree avec succes!
echo.
echo Prochaines etapes:
echo 1. Assurez-vous que MySQL est demarre
echo 2. Creez la base de donnees: CREATE DATABASE %DB_NAME%;
echo 3. Lancez l'application: npm run dev
echo.
pause
