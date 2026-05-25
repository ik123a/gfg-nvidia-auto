#!/bin/bash
echo "============================================"
echo "  GFG-NVIDIA-AUTO Backend Server (Unix)"
echo "============================================"

# Navigate to backend folder
cd backend || exit 1

# Check and repair broken virtual env
if [ -d "venv" ]; then
    if ! ./venv/bin/python --version >/dev/null 2>&1; then
        echo "Virtual environment is broken. Recreating..."
        rm -rf venv
    fi
fi

# Create virtual env if it doesn't exist
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv || python -m venv venv
fi

echo "Activating virtual environment..."
source venv/bin/activate

echo "Installing dependencies..."
pip install --upgrade pip
pip install -r requirements.txt

echo ""
echo "Starting backend server on port 5000..."
echo "============================================"
python main.py
