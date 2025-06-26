#!/bin/bash

set -e  # Exit on any error

echo "🚀 Starting comprehensive setup for reigh + Headless-Wan2GP..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[SETUP]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if we're in the reigh directory
if [ ! -f "package.json" ]; then
    print_error "This script must be run from the reigh project root directory"
    exit 1
fi

# 1. Setup reigh project
print_status "Setting up reigh project..."

# Check Node.js version
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    print_warning "Node.js version is $NODE_VERSION. Recommended version is 18+."
fi

# Install Node.js dependencies
print_status "Installing Node.js dependencies..."
npm install

# Create .env.local for reigh
print_status "Creating .env.local for reigh..."
cat > .env.local << 'EOF'
APP_ENV=local
EOF

# Setup and seed SQLite database
print_status "Setting up and seeding SQLite database..."
npm run db:seed:sqlite

print_success "Reigh project setup completed!"

# 2. Setup Python server (Headless-Wan2GP)
print_status "Setting up Headless-Wan2GP Python server..."

# Check if Python 3.10 is available
if ! command -v python3.10 &> /dev/null; then
    print_warning "python3.10 not found, trying python3..."
    if ! command -v python3 &> /dev/null; then
        print_error "Python 3 is not installed. Please install Python 3.10+ first."
        exit 1
    fi
    PYTHON_CMD="python3"
else
    PYTHON_CMD="python3.10"
fi

# Clone Headless-Wan2GP if it doesn't exist
if [ ! -d "Headless-Wan2GP" ]; then
    print_status "Cloning Headless-Wan2GP..."
    git clone https://github.com/peteromallet/Headless-Wan2GP
else
    print_status "Headless-Wan2GP directory already exists, skipping clone..."
fi

cd Headless-Wan2GP

# Update system packages (if running as root/sudo)
if [ "$EUID" -eq 0 ]; then
    print_status "Updating system packages..."
    apt-get update && apt-get install -y python3.10-venv ffmpeg
else
    print_warning "Not running as root. Make sure ffmpeg and python3.10-venv are installed."
fi

# Create virtual environment
print_status "Creating Python virtual environment..."
$PYTHON_CMD -m venv venv

# Activate virtual environment and install dependencies
print_status "Installing Python dependencies..."
source venv/bin/activate

# Install PyTorch with CUDA support
print_status "Installing PyTorch with CUDA support..."
pip install --no-cache-dir torch==2.6.0 torchvision torchaudio -f https://download.pytorch.org/whl/cu124

# Install requirements
if [ -f "Wan2GP/requirements.txt" ]; then
    print_status "Installing Wan2GP requirements..."
    pip install --no-cache-dir -r Wan2GP/requirements.txt
fi

if [ -f "requirements.txt" ]; then
    print_status "Installing main requirements..."
    pip install --no-cache-dir -r requirements.txt
fi

# Create .env for Python server
print_status "Creating .env for Python server..."
cat > .env << 'EOF'
DB_TYPE=sqlite
SQLITE_DB_PATH_ENV="../local.db"
EOF

cd ..

print_success "Headless-Wan2GP setup completed!"

echo ""
print_success "🎉 Setup completed successfully!"
echo ""
print_status "Next steps:"
echo "  1. Run './launch.sh' to start all services"
echo "  2. Run './check-status.sh' to check if services are running"
echo "  3. Open http://localhost:2222 in your browser"
echo ""
print_status "Log files will be created when you run launch.sh:"
echo "  - api.log (API server logs)"
echo "  - frontend.log (Frontend development server logs)"  
echo "  - python.log (Python server logs)" 