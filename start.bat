@echo off
REM Studio42 Enhanced - Automated Setup and Launch Script
REM This script automates the setup and launch of the Studio42 Enhanced application.

TITLE Studio42 Enhanced Launcher v2.0

echo.
echo ========================================
echo    STUDIO42 ENHANCED LAUNCHER v2.0
echo ========================================
echo.
echo Multi-file game development powered by AI
echo.

REM Check if Python is installed
python --version >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Python is not installed or not in PATH.
    echo Please install Python 3.8+ from https://python.org
    echo Make sure to check "Add Python to PATH" during installation.
    echo.
    pause
    exit /b
)

echo [INFO] Python detected: 
python --version

REM Check if Ollama is running
echo [INFO] Checking Ollama connection...
curl -s http://localhost:11434/api/tags >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo [WARNING] Ollama is not running or not accessible at localhost:11434
    echo.
    echo Please ensure Ollama is installed and running:
    echo 1. Install Ollama from https://ollama.ai
    echo 2. Run 'ollama serve' in another terminal
    echo 3. Pull a model: 'ollama pull llama3'
    echo.
    echo Would you like to continue anyway? [Y/N]
    set /p choice="Your choice: "
    if /i "%choice%" neq "Y" exit /b
) else (
    echo [SUCCESS] Ollama is running and accessible.
)

REM Check if a Python virtual environment folder 'venv' exists.
IF NOT EXIST venv (
    echo [INFO] No virtual environment found. Creating one now...
    python -m venv venv
    IF %ERRORLEVEL% NEQ 0 (
        echo [ERROR] Failed to create the Python virtual environment.
        echo Please make sure Python 3.8+ is installed and accessible in your PATH.
        echo.
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
IF %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Failed to activate virtual environment.
    echo You may need to delete the 'venv' folder and run this script again.
    echo.
    pause
    exit /b
)

REM Install/update dependencies from requirements.txt.
echo [INFO] Installing/updating required packages...
pip install -q -r requirements.txt
IF %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Failed to install required packages. 
    echo Please check your internet connection and try again.
    echo You may also need to update pip: python -m pip install --upgrade pip
    echo.
    pause
    exit /b
)
echo [SUCCESS] All packages are up to date.

REM Check if projects directory exists
IF NOT EXIST projects (
    echo [INFO] Creating projects directory...
    mkdir projects
)

REM Check if context directory exists
IF NOT EXIST context (
    echo [INFO] Creating context directory...
    mkdir context
)

REM Check if static directory exists
IF NOT EXIST static (
    echo [ERROR] Static directory not found. Please ensure all files are extracted properly.
    echo Expected files: static/script.js, static/style.css, static/index.html
    echo.
    pause
    exit /b
)

REM Launch the main Python application.
echo.
echo ========================================
echo [INFO] Launching Studio42 Enhanced...
echo.
echo Features enabled:
echo   ✓ Multi-file project generation
echo   ✓ Asset management system  
echo   ✓ Real-time AI streaming
echo   ✓ Adaptive context management
echo   ✓ Enhanced progress indicators
echo   ✓ Professional Phaser 3 structure
echo.
echo Access the UI at: http://127.0.0.1:5042
echo.
echo Press CTRL+C in this window to stop the server.
echo ========================================
echo.

python app.py

echo.
echo [INFO] Studio42 Enhanced has been stopped.
echo Thank you for using Studio42 Enhanced!
echo.
pause