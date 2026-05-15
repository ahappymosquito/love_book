@echo off
set "ROOT=%~dp0"

echo Starting Love Book development servers...
echo Backend:  http://127.0.0.1:8000
echo Frontend: http://localhost:3000
echo.

start "Love Book Backend" /D "%ROOT%" cmd /k "python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload"
start "Love Book Frontend" /D "%ROOT%web" cmd /k "npm run dev"

