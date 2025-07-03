#!/bin/bash
# Claude Code Installation Script
# Installs and configures Claude Code AI development assistant

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
LOG_FILE="/var/log/freestyle/claude-code-install.log"

# Installation parameters
CLAUDE_CODE_VERSION="${CLAUDE_CODE_VERSION:-latest}"
INSTALL_DIR="/opt/freestyle/claude-code"
USER="freestyle-daemon"
GROUP="freestyle-daemon"
SERVICE_NAME="claude-code"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Logging functions
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}" | tee -a "$LOG_FILE"
}

log_success() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] ✓ $1${NC}" | tee -a "$LOG_FILE"
}

log_warning() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] ⚠ $1${NC}" | tee -a "$LOG_FILE"
}

log_error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ✗ $1${NC}" | tee -a "$LOG_FILE"
}

error_exit() {
    log_error "$1"
    exit 1
}

# Prerequisites check
check_prerequisites() {
    log "Checking prerequisites for Claude Code installation..."
    
    # Check if running as root
    if [ "$EUID" -ne 0 ]; then
        error_exit "This script must be run as root"
    fi
    
    # Check required commands
    local required_commands=("wget" "curl" "python3" "pip3" "npm" "systemctl")
    for cmd in "${required_commands[@]}"; do
        if ! command -v "$cmd" &> /dev/null; then
            error_exit "Required command '$cmd' not found"
        fi
    done
    
    # Check Python version
    local python_version
    python_version=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
    if [[ $(echo "$python_version >= 3.10" | bc -l) != "1" ]]; then
        error_exit "Python 3.10 or higher required, found $python_version"
    fi
    
    # Check Node.js version
    local node_version
    node_version=$(node --version | sed 's/v//')
    local node_major
    node_major=$(echo "$node_version" | cut -d. -f1)
    if [ "$node_major" -lt 18 ]; then
        error_exit "Node.js 18 or higher required, found $node_version"
    fi
    
    # Check if user exists
    if ! id "$USER" &>/dev/null; then
        error_exit "User '$USER' does not exist"
    fi
    
    log_success "Prerequisites check passed"
}

# Create installation directory structure
setup_directories() {
    log "Setting up Claude Code directory structure..."
    
    # Create directory structure
    local directories=(
        "$INSTALL_DIR"
        "$INSTALL_DIR/bin"
        "$INSTALL_DIR/lib"
        "$INSTALL_DIR/config"
        "$INSTALL_DIR/logs"
        "$INSTALL_DIR/data"
        "$INSTALL_DIR/data/workspace"
        "$INSTALL_DIR/data/cache"
        "$INSTALL_DIR/scripts"
        "$INSTALL_DIR/venv"
    )
    
    for dir in "${directories[@]}"; do
        mkdir -p "$dir"
    done
    
    # Set ownership
    chown -R "$USER:$GROUP" "$INSTALL_DIR"
    
    # Set permissions
    chmod 755 "$INSTALL_DIR"
    chmod 750 "$INSTALL_DIR/config"
    chmod 750 "$INSTALL_DIR/logs"
    chmod 755 "$INSTALL_DIR/data"
    
    log_success "Directory structure created"
}

# Install system dependencies
install_dependencies() {
    log "Installing Claude Code system dependencies..."
    
    # Update package list
    apt-get update
    
    # Install required packages
    local packages=(
        "python3-dev"
        "python3-venv"
        "libssl-dev"
        "libffi-dev"
        "build-essential"
        "pkg-config"
        "libcairo2-dev"
        "libgirepository1.0-dev"
    )
    
    DEBIAN_FRONTEND=noninteractive apt-get install -y "${packages[@]}" || \
        error_exit "Failed to install system dependencies"
    
    log_success "System dependencies installed"
}

# Download and install Claude Code
download_claude_code() {
    log "Downloading Claude Code v$CLAUDE_CODE_VERSION..."
    
    local temp_dir="/tmp/claude-code-install-$$"
    mkdir -p "$temp_dir"
    cd "$temp_dir"
    
    # Determine download URL based on version
    local download_url
    if [ "$CLAUDE_CODE_VERSION" = "latest" ]; then
        download_url="https://releases.anthropic.com/claude-code/latest/claude-code-linux-x64.tar.gz"
    else
        download_url="https://releases.anthropic.com/claude-code/$CLAUDE_CODE_VERSION/claude-code-linux-x64.tar.gz"
    fi
    
    # Download with retry logic
    local max_retries=3
    local retry_count=0
    
    while [ $retry_count -lt $max_retries ]; do
        if wget -O claude-code.tar.gz "$download_url"; then
            break
        else
            ((retry_count++))
            if [ $retry_count -eq $max_retries ]; then
                error_exit "Failed to download Claude Code after $max_retries attempts"
            fi
            log_warning "Download attempt $retry_count failed, retrying..."
            sleep 5
        fi
    done
    
    # Verify download integrity
    if [ ! -s claude-code.tar.gz ]; then
        error_exit "Downloaded file is empty or corrupted"
    fi
    
    # Extract archive
    log "Extracting Claude Code archive..."
    tar -xzf claude-code.tar.gz --strip-components=1 -C "$INSTALL_DIR" || \
        error_exit "Failed to extract Claude Code archive"
    
    # Set permissions
    chmod +x "$INSTALL_DIR/bin/claude-code"*
    
    # Cleanup
    cd /
    rm -rf "$temp_dir"
    
    log_success "Claude Code downloaded and extracted"
}

# Create Python virtual environment and install dependencies
setup_python_environment() {
    log "Setting up Python virtual environment..."
    
    # Create virtual environment
    sudo -u "$USER" python3 -m venv "$INSTALL_DIR/venv" || \
        error_exit "Failed to create Python virtual environment"
    
    # Create requirements file
    cat > "$INSTALL_DIR/requirements.txt" << 'EOF'
# Claude Code Python dependencies
aiohttp>=3.8.0
aiofiles>=0.8.0
pydantic>=1.10.0
websockets>=10.0
jsonschema>=4.0.0
psutil>=5.9.0
watchdog>=2.1.0
click>=8.0.0
rich>=12.0.0
loguru>=0.6.0
httpx>=0.23.0
cryptography>=3.4.0
PyJWT>=2.4.0
python-multipart>=0.0.5
uvloop>=0.17.0
orjson>=3.7.0
EOF
    
    # Install Python dependencies
    sudo -u "$USER" bash -c "
        source '$INSTALL_DIR/venv/bin/activate'
        pip install --upgrade pip setuptools wheel
        pip install -r '$INSTALL_DIR/requirements.txt'
    " || error_exit "Failed to install Python dependencies"
    
    log_success "Python environment set up"
}

# Create configuration files
create_configuration() {
    log "Creating Claude Code configuration files..."
    
    # Main configuration file
    cat > "$INSTALL_DIR/config/claude-code.json" << 'EOF'
{
  "server": {
    "host": "127.0.0.1",
    "port": 0,
    "stdio": true,
    "mode": "daemon"
  },
  
  "ai": {
    "provider": "anthropic",
    "model": "claude-3-5-sonnet-20241022",
    "api_endpoint": "https://api.anthropic.com/v1/messages",
    "max_tokens": 8192,
    "temperature": 0.1,
    "timeout": 30
  },
  
  "workspace": {
    "root": "/home/developer/workspace",
    "auto_save": true,
    "auto_save_interval": 5,
    "max_file_size": "10MB",
    "excluded_patterns": [
      "node_modules/",
      ".git/",
      "*.log",
      "*.tmp"
    ]
  },
  
  "editor": {
    "tab_size": 2,
    "insert_spaces": true,
    "word_wrap": true,
    "auto_format": true,
    "syntax_highlighting": true,
    "line_numbers": true
  },
  
  "features": {
    "code_completion": true,
    "code_analysis": true,
    "error_detection": true,
    "refactoring": true,
    "documentation_generation": true,
    "test_generation": true
  },
  
  "security": {
    "sandbox_mode": true,
    "allowed_commands": [
      "npm",
      "yarn",
      "pnpm",
      "pip",
      "python",
      "node",
      "git"
    ],
    "blocked_paths": [
      "/etc/",
      "/root/",
      "/opt/freestyle/config/"
    ]
  },
  
  "logging": {
    "level": "INFO",
    "file": "/opt/freestyle/claude-code/logs/claude-code.log",
    "max_size": "100MB",
    "backup_count": 5,
    "format": "[%(asctime)s] %(levelname)s: %(message)s"
  }
}
EOF
    
    # Workspace configuration
    cat > "$INSTALL_DIR/config/workspace.json" << 'EOF'
{
  "workspace": {
    "name": "Freestyle Development",
    "root": "/home/developer/workspace",
    "settings": {
      "auto_detect_language": true,
      "enable_intellisense": true,
      "enable_linting": true,
      "enable_formatting": true
    }
  },
  
  "languages": {
    "javascript": {
      "formatter": "prettier",
      "linter": "eslint",
      "runtime": "node"
    },
    "typescript": {
      "formatter": "prettier",
      "linter": "eslint",
      "compiler": "tsc"
    },
    "python": {
      "formatter": "black",
      "linter": "flake8",
      "runtime": "python3"
    },
    "json": {
      "formatter": "prettier"
    }
  },
  
  "git": {
    "auto_stage": false,
    "auto_commit": false,
    "commit_message_template": "feat: ${description}",
    "ignore_patterns": [
      "*.log",
      "node_modules/",
      ".env*"
    ]
  }
}
EOF
    
    # Set configuration file permissions
    chown "$USER:$GROUP" "$INSTALL_DIR/config"/*.json
    chmod 640 "$INSTALL_DIR/config"/*.json
    
    log_success "Configuration files created"
}

# Create management scripts
create_scripts() {
    log "Creating Claude Code management scripts..."
    
    # Health check script
    cat > "$INSTALL_DIR/scripts/health-check.sh" << 'EOF'
#!/bin/bash
# Claude Code health check script

set -euo pipefail

HEALTH_STATUS=0
LOG_FILE="/opt/freestyle/claude-code/logs/health-check.log"
CONFIG_FILE="/opt/freestyle/claude-code/config/claude-code.json"

check_service() {
    if systemctl is-active --quiet claude-code; then
        echo "$(date): ✓ Claude Code service is running" >> "$LOG_FILE"
    else
        echo "$(date): ✗ Claude Code service is not running" >> "$LOG_FILE"
        HEALTH_STATUS=1
    fi
}

check_api() {
    local test_message='{"id":"health-check","type":"request","method":"system/ping","params":{}}'
    local response
    
    if response=$(echo "$test_message" | timeout 5 /opt/freestyle/claude-code/bin/claude-code --stdio 2>/dev/null); then
        echo "$(date): ✓ Claude Code API is responding" >> "$LOG_FILE"
    else
        echo "$(date): ✗ Claude Code API is not responding" >> "$LOG_FILE"
        HEALTH_STATUS=1
    fi
}

check_resources() {
    local mem_usage
    local cpu_usage
    
    if pgrep -f "claude-code" > /dev/null; then
        mem_usage=$(ps -o pid,vsz,rss,comm -C claude-code | awk 'NR>1 {sum+=$3} END {print sum/1024}')
        cpu_usage=$(ps -o pid,pcpu,comm -C claude-code | awk 'NR>1 {sum+=$2} END {print sum}')
        
        echo "$(date): Memory usage: ${mem_usage}MB, CPU usage: ${cpu_usage}%" >> "$LOG_FILE"
        
        # Alert if memory usage > 1GB or CPU usage > 80%
        if (( $(echo "$mem_usage > 1024" | bc -l 2>/dev/null || echo 0) )) || (( $(echo "$cpu_usage > 80" | bc -l 2>/dev/null || echo 0) )); then
            echo "$(date): ⚠ High resource usage detected" >> "$LOG_FILE"
            HEALTH_STATUS=2
        fi
    fi
}

check_disk_space() {
    local usage
    usage=$(df /opt/freestyle/claude-code | tail -1 | awk '{print $5}' | sed 's/%//')
    
    if [ "$usage" -gt 90 ]; then
        echo "$(date): ✗ Disk usage critical: ${usage}%" >> "$LOG_FILE"
        HEALTH_STATUS=1
    elif [ "$usage" -gt 80 ]; then
        echo "$(date): ⚠ Disk usage high: ${usage}%" >> "$LOG_FILE"
        [ $HEALTH_STATUS -eq 0 ] && HEALTH_STATUS=2
    else
        echo "$(date): ✓ Disk usage OK: ${usage}%" >> "$LOG_FILE"
    fi
}

# Run all checks
check_service
check_api
check_resources
check_disk_space

# Rotate log if too large (10MB)
if [ -f "$LOG_FILE" ] && [ $(stat -c%s "$LOG_FILE" 2>/dev/null || echo 0) -gt 10485760 ]; then
    tail -n 1000 "$LOG_FILE" > "${LOG_FILE}.tmp"
    mv "${LOG_FILE}.tmp" "$LOG_FILE"
fi

exit $HEALTH_STATUS
EOF
    
    # Update script
    cat > "$INSTALL_DIR/scripts/update.sh" << 'EOF'
#!/bin/bash
# Claude Code update script

set -euo pipefail

INSTALL_DIR="/opt/freestyle/claude-code"
USER="freestyle-daemon"
SERVICE_NAME="claude-code"

echo "Updating Claude Code..."

# Stop service
systemctl stop "$SERVICE_NAME"

# Backup current installation
BACKUP_DIR="/tmp/claude-code-backup-$(date +%Y%m%d-%H%M%S)"
cp -r "$INSTALL_DIR" "$BACKUP_DIR"

# Download and install latest version
wget -O /tmp/claude-code-latest.tar.gz \
    "https://releases.anthropic.com/claude-code/latest/claude-code-linux-x64.tar.gz"

# Extract new version
tar -xzf /tmp/claude-code-latest.tar.gz --strip-components=1 -C "$INSTALL_DIR"

# Restore configuration
cp "$BACKUP_DIR/config"/*.json "$INSTALL_DIR/config/"

# Update permissions
chown -R "$USER:$USER" "$INSTALL_DIR"
chmod +x "$INSTALL_DIR/bin/claude-code"*

# Start service
systemctl start "$SERVICE_NAME"

# Cleanup
rm -f /tmp/claude-code-latest.tar.gz

echo "Claude Code updated successfully"
echo "Backup saved to: $BACKUP_DIR"
EOF
    
    # Recovery script
    cat > "$INSTALL_DIR/scripts/recover.sh" << 'EOF'
#!/bin/bash
# Claude Code recovery script

echo "Attempting Claude Code recovery..."

# Stop service
systemctl stop claude-code

# Check for corrupted files
find /opt/freestyle/claude-code/data -name "*.tmp" -delete
find /opt/freestyle/claude-code/logs -name "*.lock" -delete

# Reset cache
rm -rf /opt/freestyle/claude-code/data/cache/*

# Restart service
systemctl start claude-code

# Verify recovery
sleep 5
if systemctl is-active --quiet claude-code; then
    echo "✓ Claude Code recovery successful"
    exit 0
else
    echo "✗ Claude Code recovery failed"
    exit 1
fi
EOF
    
    # Make scripts executable
    chmod +x "$INSTALL_DIR/scripts"/*.sh
    chown "$USER:$GROUP" "$INSTALL_DIR/scripts"/*.sh
    
    log_success "Management scripts created"
}

# Create SystemD service
create_systemd_service() {
    log "Creating SystemD service for Claude Code..."
    
    cat > "/etc/systemd/system/$SERVICE_NAME.service" << EOF
[Unit]
Description=Claude Code AI Development Assistant
Documentation=https://docs.anthropic.com/claude-code
After=network.target
Wants=network.target

[Service]
Type=simple
User=$USER
Group=$GROUP
WorkingDirectory=$INSTALL_DIR
Environment=PATH=$INSTALL_DIR/venv/bin:/usr/local/bin:/usr/bin:/bin
Environment=PYTHONPATH=$INSTALL_DIR/lib
Environment=CLAUDE_CODE_CONFIG=$INSTALL_DIR/config/claude-code.json
ExecStart=$INSTALL_DIR/bin/claude-code --config $INSTALL_DIR/config/claude-code.json
ExecReload=/bin/kill -HUP \$MAINPID
Restart=always
RestartSec=5
TimeoutStartSec=30
TimeoutStopSec=10

# Security settings
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/home/developer/workspace $INSTALL_DIR/logs $INSTALL_DIR/data

# Resource limits
LimitNOFILE=65536
LimitNPROC=4096
MemoryMax=2G
CPUQuota=200%

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=claude-code

[Install]
WantedBy=multi-user.target
EOF
    
    # Reload systemd
    systemctl daemon-reload
    
    log_success "SystemD service created"
}

# Create integration tests
create_tests() {
    log "Creating Claude Code integration tests..."
    
    cat > "$INSTALL_DIR/scripts/integration-test.sh" << 'EOF'
#!/bin/bash
# Claude Code integration tests

set -euo pipefail

echo "Running Claude Code integration tests..."

# Test 1: Service startup
systemctl start claude-code
sleep 5
if systemctl is-active --quiet claude-code; then
    echo "✓ Service startup test passed"
else
    echo "✗ Service startup test failed"
    exit 1
fi

# Test 2: API communication
test_request='{"id":"test-1","type":"request","method":"system/info","params":{}}'
response=$(echo "$test_request" | timeout 10 /opt/freestyle/claude-code/bin/claude-code --stdio)
if echo "$response" | grep -q '"result"'; then
    echo "✓ API communication test passed"
else
    echo "✗ API communication test failed"
    exit 1
fi

# Test 3: File operations
test_dir="/tmp/claude-code-test"
mkdir -p "$test_dir"
echo "console.log('Hello, World!');" > "$test_dir/test.js"

read_request='{"id":"test-2","type":"request","method":"file/read","params":{"path":"'$test_dir'/test.js"}}'
response=$(echo "$read_request" | timeout 10 /opt/freestyle/claude-code/bin/claude-code --stdio)
if echo "$response" | grep -q "Hello, World"; then
    echo "✓ File operations test passed"
else
    echo "✗ File operations test failed"
    exit 1
fi

# Test 4: Code completion
completion_request='{"id":"test-3","type":"request","method":"code/complete","params":{"file_path":"'$test_dir'/test.js","content":"console.","position":{"line":0,"character":8}}}'
response=$(echo "$completion_request" | timeout 10 /opt/freestyle/claude-code/bin/claude-code --stdio)
if echo "$response" | grep -q "completions"; then
    echo "✓ Code completion test passed"
else
    echo "✗ Code completion test failed"
    exit 1
fi

# Cleanup
rm -rf "$test_dir"

echo "All integration tests passed!"
EOF
    
    chmod +x "$INSTALL_DIR/scripts/integration-test.sh"
    
    log_success "Integration tests created"
}

# Set up log rotation
setup_log_rotation() {
    log "Setting up log rotation for Claude Code..."
    
    cat > /etc/logrotate.d/claude-code << 'EOF'
/opt/freestyle/claude-code/logs/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 644 freestyle-daemon freestyle-daemon
    postrotate
        systemctl reload claude-code 2>/dev/null || true
    endscript
}
EOF
    
    log_success "Log rotation configured"
}

# Main installation function
main() {
    log "Starting Claude Code installation..."
    
    # Ensure log directory exists
    mkdir -p "$(dirname "$LOG_FILE")"
    touch "$LOG_FILE"
    
    # Run installation steps
    check_prerequisites
    setup_directories
    install_dependencies
    download_claude_code
    setup_python_environment
    create_configuration
    create_scripts
    create_systemd_service
    create_tests
    setup_log_rotation
    
    # Enable service
    systemctl enable "$SERVICE_NAME"
    
    log_success "Claude Code installation completed successfully!"
    log "Installation directory: $INSTALL_DIR"
    log "Service name: $SERVICE_NAME"
    log "Configuration: $INSTALL_DIR/config/claude-code.json"
    log "Logs: $INSTALL_DIR/logs/"
    log ""
    log "To start Claude Code:"
    log "  systemctl start $SERVICE_NAME"
    log ""
    log "To test the installation:"
    log "  $INSTALL_DIR/scripts/integration-test.sh"
}

# Run main function
main "$@"
