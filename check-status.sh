#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${BLUE}[STATUS]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[UP]${NC} $1"
}

print_error() {
    echo -e "${RED}[DOWN]${NC} $1"
}

print_status "Checking service status..."

# Check frontend
if curl -s http://localhost:2222 > /dev/null 2>&1; then
    print_success "Frontend (http://localhost:2222)"
else
    print_error "Frontend (http://localhost:2222)"
fi

# Check API
if curl -s http://localhost:8085 > /dev/null 2>&1; then
    print_success "API (http://localhost:8085)"
else
    print_error "API (http://localhost:8085)"
fi

# Check if Python process is running (basic check)
if pgrep -f "python.*headless.py" > /dev/null; then
    print_success "Python server (headless.py)"
else
    print_error "Python server (headless.py)"
fi

print_status "Log files:"
for log in api.log frontend.log python.log; do
    if [ -f "$log" ]; then
        print_status "  $log ($(wc -l < "$log") lines)"
    else
        print_error "  $log (not found)"
    fi
done 