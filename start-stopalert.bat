@echo off
cd /d "%~dp0"
echo =====================================
echo        Waylo AI - Setup and Run
echo =====================================
if not exist node_modules (
  echo Installing project packages for the first time...
  call npm install
  if errorlevel 1 (
    echo.
    echo Install failed. Check your internet connection and Node.js installation.
    pause
    exit /b 1
  )
)
echo.
echo Starting Waylo AI...
call npm run dev
pause
