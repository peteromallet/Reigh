#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${BLUE}[LAUNCH]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to cleanup background processes
cleanup() {
    print_status "Shutting down services..."
    if [ ! -z "$API_PID" ]; then
        kill $API_PID 2>/dev/null || true
    fi
    if [ ! -z "$FRONTEND_PID" ]; then
        kill $FRONTEND_PID 2>/dev/null || true
    fi
    if [ ! -z "$PYTHON_PID" ]; then
        kill $PYTHON_PID 2>/dev/null || true
    fi
    wait 2>/dev/null || true
    print_status "All services stopped."
    exit 0
}

# Set up signal handlers
trap cleanup SIGINT SIGTERM

print_status "🚀 Starting all services..."

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    print_error "This script must be run from the reigh project root directory"
    exit 1
fi

# 1. Start the API server
print_status "Starting API server..."
npm run start:api > api.log 2>&1 &
API_PID=$!
print_status "API server started (PID: $API_PID) - logs in api.log"

# Wait a moment for API to start
sleep 3

# 2. Start the frontend development server
print_status "Starting frontend development server..."
npm run dev > frontend.log 2>&1 &
FRONTEND_PID=$!
print_status "Frontend server started (PID: $FRONTEND_PID) - logs in frontend.log"

# Wait a moment for frontend to start
sleep 3

# 3. Start the Python server
if [ -d "Headless-Wan2GP" ]; then
    print_status "Starting Python server..."
    cd Headless-Wan2GP
    source venv/bin/activate
    python headless.py > ../python.log 2>&1 &
    PYTHON_PID=$!
    cd ..
    print_status "Python server started (PID: $PYTHON_PID) - logs in python.log"
else
    print_error "Headless-Wan2GP directory not found. Run setup.sh first."
fi

print_success "All services are starting up!"
print_status "Frontend: http://localhost:2222"
print_status "API: http://localhost:8085"
print_status "Logs are being written to: api.log, frontend.log, python.log"
print_status "Press Ctrl+C to stop all services"

# Wait for all background processes
wait 