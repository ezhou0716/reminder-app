@echo off
echo ============================================
echo   Berkeley Assignment Reminder - Setup
echo ============================================
echo.

echo Installing Python dependencies...
pip install -r requirements.txt
if errorlevel 1 (
    echo.
    echo ERROR: pip install failed. Make sure Python and pip are on your PATH.
    pause
    exit /b 1
)
echo.

if not exist .env (
    echo Creating .env from template...
    copy .env.example .env
    echo.
    echo *** IMPORTANT ***
    echo Open .env in a text editor and fill in your credentials:
    echo   1. GRADESCOPE_EMAIL    - Your Berkeley email (CalNet ID is derived from this)
    echo   2. GRADESCOPE_PASSWORD - Your CalNet passphrase
    echo.
) else (
    echo .env already exists, skipping.
)

echo Setup complete! Run "python main.py" to start.
pause
