@echo off
REM This script automates the setup and launch of the Studio42 application.

TITLE Studio42 Launcher v2.0

REM Check if a Python virtual environment folder 'venv' exists.
IF NOT EXIST venv (
    echo [INFO] No virtual environment found. Creating one now...
    python -m venv venv
    IF %ERRORLEVEL% NEQ 0 (
        echo [ERROR] Failed to create the Python virtual environment.
        echo Please make sure Python 3 is installed and accessible in your PATH.
        pause
        exit /b
    )
    echo [SUCCESS] Virtual environment created.
) ELSE (
    echo [INFO] Existing virtual environment found.
)

REM Activate the virtual environment.
echo [INFO] Activating virtual environment...
call venv\Scripts\activate.bat

REM Install/update dependencies from requirements.txt.
echo [INFO] Installing required packages...
pip install -r requirements.txt
IF %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Failed to install required packages. Please check your network connection.
    pause
    exit /b
)
echo [SUCCESS] All packages are up to date.

REM Launch the main Python application using the venv's python executable.
echo.
echo [INFO] Launching Studio42 GameDev AI...
echo You can now access the UI in your web browser at http://127.0.0.1:5042
echo Press CTRL+C in this window to stop the server.
echo.
venv\Scripts\python.exe app.py

pause

