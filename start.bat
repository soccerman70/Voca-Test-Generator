@echo off
REM Launcher: starts the dev server and opens the browser. Double-click to use.
REM ASCII only. Non-ASCII text breaks depending on the console code page.
cd /d "%~dp0"

set PORT=5180
set URL=http://localhost:%PORT%/

REM Copy of package-lock.json taken after the last successful install.
REM If the current package-lock.json differs (git pull brought a new package),
REM install again. Comparing contents, not dates, so a fresh checkout still works.
set STAMP=node_modules\.voca-installed-lock.json

REM Starting a second instance would grab another port, so just open the browser.
netstat -ano | findstr ":%PORT% " | findstr "LISTENING" >nul
if not errorlevel 1 (
  REM Warn only when the copy exists and differs. No copy yet means it was never checked.
  if exist "%STAMP%" (
    fc /b "package-lock.json" "%STAMP%" >nul 2>&1
    if errorlevel 1 (
      echo.
      echo   The package list has changed since the running server started.
      echo   Close the running server window, then run start.bat again.
      echo.
      pause
    )
  )
  echo Already running. Opening browser.
  start "" "%URL%"
  exit /b
)

set INSTALL=
if not exist "node_modules" (
  set INSTALL=First run. Installing packages. This takes a few minutes.
) else (
  fc /b "package-lock.json" "%STAMP%" >nul 2>&1
  if errorlevel 1 set INSTALL=The package list has changed. Updating packages.
)

if defined INSTALL (
  echo %INSTALL%
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo   npm install failed. Check the network, then run start.bat again.
    echo   Trying to start anyway.
    echo.
  ) else (
    copy /y "package-lock.json" "%STAMP%" >nul
  )
)

echo.
echo   URL    %URL%
echo   Stop   Close this window, or press Ctrl+C
echo.
call npm run dev -- --open
