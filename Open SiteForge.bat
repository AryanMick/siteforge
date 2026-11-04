@echo off
rem Starts the SiteForge app on Windows and opens it at http://127.0.0.1:4400 . Close this window to stop it.
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install it from https://nodejs.org and try again.
  pause
  exit /b 1
)
if not exist "node_modules\" (
  echo Installing dependencies ^(first run only^)...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)
rem Open the browser after a short delay, while the server starts in this window.
start "" /min cmd /c "timeout /t 12 /nobreak >nul && start http://127.0.0.1:4400"
call npm run siteforge
pause
