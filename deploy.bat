@echo off
REM Windows 下的便捷封装：通过 git-bash / wsl 跑 deploy.sh
SETLOCAL ENABLEDELAYEDEXPANSION
SET "ROOT=%~dp0"

WHERE bash >NUL 2>NUL
IF %ERRORLEVEL%==0 (
    bash "%ROOT%deploy.sh" %*
    EXIT /B %ERRORLEVEL%
)

WHERE wsl >NUL 2>NUL
IF %ERRORLEVEL%==0 (
    wsl -- bash deploy.sh %*
    EXIT /B %ERRORLEVEL%
)

ECHO 未检测到 bash / wsl，无法在 Windows 上直接运行 deploy.sh
ECHO 请在 Linux 服务器上执行：./deploy.sh %*
EXIT /B 1
