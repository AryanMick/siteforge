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
rem Install dependencies on the first run, and again whenever package.json or package-lock.json changed since the
rem last install (npm writes node_modules\.package-lock.json at the end of every install).
node -e "const fs=require('fs');const t=p=>{try{return fs.statSync(p).mtimeMs}catch{return -1}};const i=t('node_modules/.package-lock.json');process.exit(i>=0&&i>=t('package.json')&&i>=t('package-lock.json')?0:1)"
if errorlevel 1 (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
  node -e "const fs=require('fs');const now=new Date();fs.utimesSync('node_modules/.package-lock.json',now,now)"
)
rem Open the browser after a short delay, while the server starts in this window.
start "" /min cmd /c "timeout /t 12 /nobreak >nul && start http://127.0.0.1:4400"
call npm run siteforge
pause
