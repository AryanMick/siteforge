@echo off
rem Starts SiteForge on Windows and opens it at http://127.0.0.1:4400 . Close this window to stop it.
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install it from https://nodejs.org and try again.
  pause
  exit /b 1
)
rem Installs dependencies when needed, starts the app and opens the browser when it is ready.
node scripts\start-siteforge.mjs --open
pause
