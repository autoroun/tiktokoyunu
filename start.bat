@echo off
setlocal
cd /d "%~dp0"

echo =========================================
echo   SAMPION KIM? BASLATILIYOR
echo =========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [HATA] Node.js kurulu degil.
    echo Lutfen Node.js yukleyin: https://nodejs.org/
    pause
    exit /b 1
)

if not exist node_modules (
    echo [BILGI] Gerekli paketler yukleniyor...
    call npm install
    if errorlevel 1 (
        echo.
        echo [HATA] npm install basarisiz oldu.
        pause
        exit /b 1
    )
)

echo.
echo [BILGI] Sunucu baslatiliyor...
start "" http://localhost:3000
call npm start

pause
