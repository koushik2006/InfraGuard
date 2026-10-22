@echo off
REM One-click InfraGuard demo launcher (Windows). Needs Python 3.11+ and Node 20+.
cd /d "%~dp0"
if not exist .venv (
  python -m venv .venv
  .venv\Scripts\python -m pip install -r requirements.txt
)
if not exist frontend\node_modules (
  pushd frontend
  call npm install
  popd
)
start "InfraGuard API" cmd /k ".venv\Scripts\python -m uvicorn backend.api.main:app --port 8000"
start "InfraGuard UI" cmd /k "cd frontend && npm run dev"
echo Waiting for servers... then open http://localhost:3000
timeout /t 12 >nul
start http://localhost:3000
