@echo off
REM 本地一键启动：安装可选；后端优先 8000，若被 Windows Hyper-V 保留（WinError 10013）则改用可用端口并同步前端。

setlocal EnableExtensions
set "ROOT=%~dp0"
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

where poetry >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Poetry was not found in PATH. Install Poetry 2.2 or newer first.
    exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm was not found in PATH.
    exit /b 1
)

if "%INSTALL_DEPS%"=="1" (
    echo Installing backend dependencies...
    pushd "%ROOT%" >nul
    call poetry sync --no-root --no-interaction
    if errorlevel 1 (
        popd >nul
        echo [ERROR] Backend dependency installation failed.
        exit /b 1
    )
    popd >nul

    echo Installing frontend dependencies...
    pushd "%ROOT%web" >nul
    call npm ci --no-audit --no-fund
    if errorlevel 1 (
        popd >nul
        echo [ERROR] Frontend dependency installation failed.
        exit /b 1
    )
    popd >nul
)

pushd "%ROOT%" >nul
set "LB_API_PORT="
for /f "usebackq delims=" %%p in (`poetry run python scripts\dev_backend_port.py`) do set "LB_API_PORT=%%p"
popd >nul
if not defined LB_API_PORT (
    echo [ERROR] Could not pick a local backend port.
    exit /b 1
)

echo Starting Love Book development servers...
echo Backend:  http://127.0.0.1:%LB_API_PORT%
echo Frontend: http://localhost:3000
echo.

start "Love Book Backend" /D "%ROOT%" cmd /k "poetry run uvicorn app.main:app --host 127.0.0.1 --port %LB_API_PORT% --reload"
start "Love Book Frontend" /D "%ROOT%web" cmd /k "set NEXT_PUBLIC_API_BASE=http://127.0.0.1:%LB_API_PORT%&& npm run dev"
exit /b 0

:help
echo Usage:
echo   start_dev.bat
echo   start_dev.bat --install
echo.
echo Options:
echo   --install  Install Python and npm dependencies before startup.
exit /b 0
