@echo off
echo ============================================
echo   GFG-NVIDIA-AUTO Backend Server
echo ============================================
cd backend
if exist venv (
    venv\Scripts\python.exe --version >nul 2>&1
    if errorlevel 1 (
        echo Virtual environment is broken. Recreating...
        rmdir /s /q venv
    )
)

if not exist venv (
    echo Creating virtual environment...
    python -m venv venv
)
echo Activating virtual environment...
call venv\Scripts\activate
echo Installing dependencies...
pip install -r requirements.txt
echo.
echo Starting backend server on port 5000...
echo ============================================
python main.py
pause
