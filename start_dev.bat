@echo off
REM File overview:
REM This script is the local one-click development entrypoint for Love Book.
REM Default behavior starts the backend and frontend directly.
REM Pass --install to install backend and frontend dependencies before startup.

setlocal EnableExtensions
set "ROOT=%~dp0"
set "PYTHON_CMD=python"
set "INSTALL_DEPS=0"

if /I "%~1"=="--install" (
    set "INSTALL_DEPS=1"
) else if not "%~1"=="" (
    if /I "%~1"=="--help" goto :help
    if /I "%~1"=="-h" goto :help
    echo Unsupported argument: %~1
    echo.
    goto :help
)

where python >nul 2>nul
if errorlevel 1 (
    where py >nul 2>nul
    if errorlevel 1 (
        echo [ERROR] Python was not found in PATH.
        exit /b 1
    )
    set "PYTHON_CMD=py"
)

where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm was not found in PATH.
    exit /b 1
)

if "%INSTALL_DEPS%"=="1" (
    echo Installing backend dependencies...
    call "%PYTHON_CMD%" -m pip install -r "%ROOT%requirements.txt"
    if errorlevel 1 (
        echo [ERROR] Backend dependency installation failed.
        exit /b 1
    )

    echo Installing frontend dependencies...
    pushd "%ROOT%web" >nul
    call npm install
    if errorlevel 1 (
        popd >nul
        echo [ERROR] Frontend dependency installation failed.
        exit /b 1
    )
    popd >nul
)

echo Starting Love Book development servers...
echo Backend:  http://127.0.0.1:8000
echo Frontend: http://localhost:3000
echo.

start "Love Book Backend" /D "%ROOT%" cmd /k "%PYTHON_CMD% -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload"
start "Love Book Frontend" /D "%ROOT%web" cmd /k "npm run dev"
exit /b 0

:help
echo Usage:
echo   start_dev.bat
echo   start_dev.bat --install
echo.
echo Options:
echo   --install  Install Python and npm dependencies before startup.
exit /b 0
