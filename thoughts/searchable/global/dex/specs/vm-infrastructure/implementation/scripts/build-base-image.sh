#!/bin/bash
# VM Base Image Builder
# Builds and configures the Freestyle VM base image

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
LOG_FILE="/var/log/freestyle/build-base-image.log"
TEMP_DIR="/tmp/freestyle-build-$$"

# Arguments
BASE_IMAGE_NAME="${1:-ubuntu-22.04-freestyle}"
VERSION="${2:-latest}"
BUILD_TYPE="${3:-full}"  # full, minimal, dev

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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

# Error handling
cleanup() {
    if [ -d "$TEMP_DIR" ]; then
        rm -rf "$TEMP_DIR"
    fi
}

trap cleanup EXIT

error_exit() {
    log_error "$1"
    exit 1
}

# Validation functions
check_prerequisites() {
    log "Checking prerequisites..."
    
    # Check if running as root
    if [ "$EUID" -ne 0 ]; then
        error_exit "This script must be run as root"
    fi
    
    # Check required commands
    local required_commands=("wget" "curl" "git" "systemctl" "docker")
    for cmd in "${required_commands[@]}"; do
        if ! command -v "$cmd" &> /dev/null; then
            error_exit "Required command '$cmd' not found"
        fi
    done
    
    # Check disk space (minimum 10GB free)
    local available_space
    available_space=$(df / | tail -1 | awk '{print $4}')
    if [ "$available_space" -lt 10485760 ]; then  # 10GB in KB
        error_exit "Insufficient disk space. Need at least 10GB free."
    fi
    
    log_success "Prerequisites check passed"
}

# System update and package installation
update_system() {
    log "Updating system packages..."
    
    # Update package lists
    apt-get update || error_exit "Failed to update package lists"
    
    # Upgrade system packages
    DEBIAN_FRONTEND=noninteractive apt-get upgrade -y || error_exit "Failed to upgrade packages"
    
    log_success "System updated"
}

install_base_packages() {
    log "Installing base packages..."
    
    # Essential system packages
    local base_packages=(
        "curl" "wget" "git" "openssh-server" "sudo" "htop" "vim" "nano"
        "tmux" "screen" "build-essential" "python3" "python3-pip" "python3-venv"
        "nodejs" "npm" "docker.io" "docker-compose" "jq" "unzip"
        "ca-certificates" "gnupg" "lsb-release" "software-properties-common"
        "apt-transport-https" "rsync" "tree" "less" "bc" "netcat"
        "fail2ban" "ufw" "unattended-upgrades" "logrotate"
    )
    
    DEBIAN_FRONTEND=noninteractive apt-get install -y "${base_packages[@]}" || \
        error_exit "Failed to install base packages"
    
    log_success "Base packages installed"
}

configure_network() {
    log "Configuring network settings..."
    
    # Configure netplan
    cat > /etc/netplan/50-cloud-init.yaml << 'EOF'
network:
  version: 2
  ethernets:
    eth0:
      dhcp4: true
      dhcp6: true
      dhcp4-overrides:
        use-dns: false
      nameservers:
        addresses:
          - 8.8.8.8
          - 8.8.4.4
          - 1.1.1.1
EOF
    
    # Configure DNS resolution
    cat > /etc/systemd/resolved.conf << 'EOF'
[Resolve]
DNS=8.8.8.8 8.8.4.4 1.1.1.1
FallbackDNS=1.0.0.1
Domains=~.
DNSSEC=yes
DNSOverTLS=yes
Cache=yes
DNSStubListener=yes
EOF
    
    # Apply network configuration
    netplan apply || log_warning "Failed to apply netplan configuration"
    systemctl restart systemd-resolved || log_warning "Failed to restart DNS resolver"
    
    log_success "Network configured"
}

configure_firewall() {
    log "Configuring firewall..."
    
    # Reset UFW to defaults
    ufw --force reset
    
    # Set default policies
    ufw default deny incoming
    ufw default allow outgoing
    
    # Allow SSH
    ufw allow 22/tcp
    
    # Allow development server ports
    ufw allow 3000:3999/tcp
    
    # Allow HTTP/HTTPS
    ufw allow 80/tcp
    ufw allow 443/tcp
    
    # Allow MCP server port
    ufw allow 8080/tcp
    
    # Enable UFW
    ufw --force enable
    
    log_success "Firewall configured"
}

create_users() {
    log "Creating system users..."
    
    # Create freestyle-daemon user
    if ! id "freestyle-daemon" &>/dev/null; then
        useradd --system --home /opt/freestyle --shell /bin/false freestyle-daemon
        usermod -aG docker freestyle-daemon
        log_success "Created freestyle-daemon user"
    fi
    
    # Create developer user
    if ! id "developer" &>/dev/null; then
        useradd --create-home --shell /bin/bash --groups sudo,docker developer
        echo "developer ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/developer
        chmod 440 /etc/sudoers.d/developer
        log_success "Created developer user"
    fi
    
    # Set up SSH for developer user
    local ssh_dir="/home/developer/.ssh"
    mkdir -p "$ssh_dir"
    chmod 700 "$ssh_dir"
    touch "$ssh_dir/authorized_keys"
    chmod 600 "$ssh_dir/authorized_keys"
    chown -R developer:developer "$ssh_dir"
    
    log_success "Users created and configured"
}

configure_ssh() {
    log "Configuring SSH server..."
    
    # Backup original config
    cp /etc/ssh/sshd_config /etc/ssh/sshd_config.backup
    
    # Configure SSH
    cat > /etc/ssh/sshd_config << 'EOF'
Port 22
Protocol 2
HostKey /etc/ssh/ssh_host_rsa_key
HostKey /etc/ssh/ssh_host_ecdsa_key
HostKey /etc/ssh/ssh_host_ed25519_key

# Authentication
PubkeyAuthentication yes
PasswordAuthentication no
ChallengeResponseAuthentication no
UsePAM yes

# Security
PermitRootLogin no
X11Forwarding no
AllowTcpForwarding yes
ClientAliveInterval 120
ClientAliveCountMax 3
MaxAuthTries 3
MaxSessions 10

# User restrictions
AllowUsers developer freestyle-daemon
EOF
    
    # Test SSH configuration
    sshd -t || error_exit "SSH configuration test failed"
    
    # Restart SSH service
    systemctl restart ssh || error_exit "Failed to restart SSH service"
    
    log_success "SSH configured"
}

setup_directory_structure() {
    log "Setting up directory structure..."
    
    # Create application directories
    local directories=(
        "/opt/freestyle"
        "/opt/freestyle/daemon"
        "/opt/freestyle/claude-code"
        "/opt/freestyle/logs"
        "/opt/freestyle/config"
        "/opt/freestyle/bin"
        "/opt/freestyle/scripts"
        "/opt/freestyle/tests"
        "/var/log/freestyle"
        "/var/lib/freestyle"
        "/home/developer/workspace"
    )
    
    for dir in "${directories[@]}"; do
        mkdir -p "$dir"
    done
    
    # Set permissions
    chown -R freestyle-daemon:freestyle-daemon /opt/freestyle
    chown -R syslog:syslog /var/log/freestyle
    chown -R developer:developer /home/developer/workspace
    
    # Create log directory for this build
    mkdir -p "$(dirname "$LOG_FILE")"
    touch "$LOG_FILE"
    chmod 644 "$LOG_FILE"
    
    log_success "Directory structure created"
}

configure_system_hardening() {
    log "Applying system hardening..."
    
    # Kernel security parameters
    cat > /etc/sysctl.d/99-freestyle-security.conf << 'EOF'
# Network security
net.ipv4.ip_forward = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0
net.ipv4.conf.all.log_martians = 1
net.ipv4.conf.default.log_martians = 1
net.ipv4.icmp_echo_ignore_broadcasts = 1
net.ipv4.icmp_ignore_bogus_error_responses = 1
net.ipv4.tcp_syncookies = 1

# Memory security
kernel.dmesg_restrict = 1
kernel.kptr_restrict = 2
kernel.yama.ptrace_scope = 1
EOF
    
    # Apply sysctl settings
    sysctl -p /etc/sysctl.d/99-freestyle-security.conf
    
    # Disable unnecessary services
    local services_to_disable=("snapd" "bluetooth" "cups" "avahi-daemon")
    for service in "${services_to_disable[@]}"; do
        if systemctl is-enabled "$service" &>/dev/null; then
            systemctl disable "$service" || log_warning "Failed to disable $service"
        fi
    done
    
    # Enable security services
    systemctl enable fail2ban || log_warning "Failed to enable fail2ban"
    systemctl enable ufw || log_warning "Failed to enable ufw"
    systemctl enable unattended-upgrades || log_warning "Failed to enable unattended-upgrades"
    
    # Set secure file permissions
    chmod 600 /etc/ssh/ssh_host_*_key
    chmod 644 /etc/ssh/ssh_host_*_key.pub
    chmod 700 /root
    
    # Remove DSA keys (deprecated)
    rm -f /etc/ssh/ssh_host_dsa_key*
    
    log_success "System hardening applied"
}

install_development_tools() {
    log "Installing development tools..."
    
    # Install Node Version Manager (NVM) for developer user
    local nvm_install_script="/tmp/nvm-install.sh"
    wget -O "$nvm_install_script" https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh
    chmod +x "$nvm_install_script"
    
    # Install NVM as developer user
    sudo -u developer bash "$nvm_install_script"
    
    # Install Node.js versions
    sudo -u developer bash -c '
        export NVM_DIR="/home/developer/.nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
        nvm install 18
        nvm install 20
        nvm use 20
        nvm alias default 20
        npm install -g yarn pnpm create-react-app @vue/cli typescript
    '
    
    # Install Python development tools
    pip3 install --upgrade pip
    pip3 install virtualenv pipenv poetry
    pip3 install requests flask fastapi uvicorn black flake8 pytest
    
    # Configure git globally
    sudo -u developer git config --global init.defaultBranch main
    sudo -u developer git config --global pull.rebase false
    sudo -u developer git config --global user.name "Freestyle Developer"
    sudo -u developer git config --global user.email "developer@freestyle.dev"
    
    rm -f "$nvm_install_script"
    
    log_success "Development tools installed"
}

configure_docker() {
    log "Configuring Docker..."
    
    # Configure Docker daemon
    mkdir -p /etc/docker
    cat > /etc/docker/daemon.json << 'EOF'
{
  "data-root": "/var/lib/docker",
  "storage-driver": "overlay2",
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "default-ulimits": {
    "nofile": {
      "Name": "nofile",
      "Hard": 64000,
      "Soft": 64000
    }
  }
}
EOF
    
    # Enable and start Docker
    systemctl enable docker
    systemctl start docker
    
    # Add users to docker group
    usermod -aG docker developer
    usermod -aG docker freestyle-daemon
    
    log_success "Docker configured"
}

configure_logging() {
    log "Configuring logging..."
    
    # Configure rsyslog for Freestyle
    cat > /etc/rsyslog.d/50-freestyle.conf << 'EOF'
# Freestyle application logs
local0.* /var/log/freestyle/daemon.log
local1.* /var/log/freestyle/claude-code.log
local2.* /var/log/freestyle/system.log
EOF
    
    # Configure log rotation
    cat > /etc/logrotate.d/freestyle << 'EOF'
/var/log/freestyle/*.log {
    daily
    missingok
    rotate 7
    compress
    delaycompress
    notifempty
    create 644 syslog syslog
    postrotate
        systemctl reload rsyslog
    endscript
}
EOF
    
    # Restart rsyslog
    systemctl restart rsyslog
    
    log_success "Logging configured"
}

performance_optimization() {
    log "Applying performance optimizations..."
    
    # SystemD configuration
    cat > /etc/systemd/system.conf.d/freestyle.conf << 'EOF'
[Manager]
DefaultTimeoutStopSec=10s
DefaultTimeoutStartSec=30s
DefaultTasksMax=4096
EOF
    
    # Security limits
    cat > /etc/security/limits.d/freestyle.conf << 'EOF'
developer soft nofile 65536
developer hard nofile 65536
freestyle-daemon soft nofile 32768
freestyle-daemon hard nofile 32768
EOF
    
    # Performance tuning
    cat > /etc/sysctl.d/99-freestyle-performance.conf << 'EOF'
# Memory management
vm.swappiness=1
vm.dirty_ratio=15
vm.dirty_background_ratio=5

# Network performance
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 65536 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
EOF
    
    # Apply sysctl settings
    sysctl -p /etc/sysctl.d/99-freestyle-performance.conf
    
    # Configure tmpfs for temporary files
    echo 'tmpfs /tmp tmpfs defaults,noatime,nosuid,nodev,noexec,mode=1777,size=1G 0 0' >> /etc/fstab
    echo 'tmpfs /var/tmp tmpfs defaults,noatime,nosuid,nodev,noexec,mode=1777,size=512M 0 0' >> /etc/fstab
    
    log_success "Performance optimizations applied"
}

install_monitoring_tools() {
    log "Installing monitoring tools..."
    
    # Create monitoring scripts
    cp "$PROJECT_ROOT/monitoring/health-check.sh" /opt/freestyle/scripts/
    cp "$PROJECT_ROOT/monitoring/resource-monitor.sh" /opt/freestyle/scripts/
    
    # Make scripts executable
    chmod +x /opt/freestyle/scripts/*.sh
    
    # Create monitoring service
    cp "$PROJECT_ROOT/systemd/vm-monitor.service" /etc/systemd/system/
    cp "$PROJECT_ROOT/systemd/vm-health.timer" /etc/systemd/system/
    
    # Reload systemd
    systemctl daemon-reload
    
    log_success "Monitoring tools installed"
}

create_validation_tests() {
    log "Creating validation tests..."
    
    # Create base image test script
    cat > /opt/freestyle/tests/base-image-test.sh << 'EOF'
#!/bin/bash
# Base image validation tests

set -euo pipefail

FAILED_TESTS=0

test_result() {
    if [ $? -eq 0 ]; then
        echo "✓ $1"
    else
        echo "✗ $1"
        ((FAILED_TESTS++))
    fi
}

echo "Running base image validation tests..."

# Test network connectivity
curl -s --connect-timeout 5 http://google.com > /dev/null
test_result "Network connectivity"

# Test essential services
systemctl is-active --quiet ssh
test_result "SSH service"

systemctl is-active --quiet docker
test_result "Docker service"

systemctl is-active --quiet ufw
test_result "Firewall service"

# Test development tools
node --version > /dev/null 2>&1
test_result "Node.js installed"

python3 --version > /dev/null 2>&1
test_result "Python installed"

git --version > /dev/null 2>&1
test_result "Git installed"

docker --version > /dev/null 2>&1
test_result "Docker installed"

# Test filesystem permissions
test -d /opt/freestyle
test_result "Freestyle directory exists"

test -w /var/log/freestyle
test_result "Log directory writable"

# Test user configuration
sudo -u developer -i whoami > /dev/null 2>&1
test_result "Developer user functional"

# Test Docker access
sudo -u developer docker ps > /dev/null 2>&1
test_result "Developer Docker access"

echo "Validation completed. Failed tests: $FAILED_TESTS"
exit $FAILED_TESTS
EOF
    
    chmod +x /opt/freestyle/tests/base-image-test.sh
    
    log_success "Validation tests created"
}

cleanup_system() {
    log "Cleaning up system..."
    
    # Clean package cache
    apt-get autoremove -y
    apt-get autoclean
    
    # Clear package lists
    rm -rf /var/lib/apt/lists/*
    
    # Clear temporary files
    rm -rf /tmp/*
    rm -rf /var/tmp/*
    
    # Clear log files (but keep directories)
    find /var/log -type f -name "*.log" -delete
    
    # Clear bash history
    history -c
    
    # Clear machine-id (will be regenerated on first boot)
    truncate -s 0 /etc/machine-id
    
    log_success "System cleanup completed"
}

run_validation() {
    log "Running validation tests..."
    
    if /opt/freestyle/tests/base-image-test.sh; then
        log_success "All validation tests passed"
    else
        log_error "Some validation tests failed"
        return 1
    fi
}

create_image_info() {
    log "Creating image information..."
    
    cat > /opt/freestyle/image-info.json << EOF
{
  "name": "$BASE_IMAGE_NAME",
  "version": "$VERSION",
  "build_date": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "build_type": "$BUILD_TYPE",
  "base_os": "$(lsb_release -d -s)",
  "kernel": "$(uname -r)",
  "architecture": "$(uname -m)",
  "packages": {
    "python": "$(python3 --version | cut -d' ' -f2)",
    "node": "$(node --version)",
    "docker": "$(docker --version | cut -d' ' -f3 | tr -d ',')",
    "git": "$(git --version | cut -d' ' -f3)"
  }
}
EOF
    
    log_success "Image information created"
}

# Main execution
main() {
    log "Starting VM base image build: $BASE_IMAGE_NAME:$VERSION"
    
    # Setup temporary directory
    mkdir -p "$TEMP_DIR"
    cd "$TEMP_DIR"
    
    # Execute build steps
    check_prerequisites
    update_system
    install_base_packages
    setup_directory_structure
    configure_network
    configure_firewall
    create_users
    configure_ssh
    configure_system_hardening
    install_development_tools
    configure_docker
    configure_logging
    performance_optimization
    install_monitoring_tools
    create_validation_tests
    create_image_info
    
    # Run validation
    if ! run_validation; then
        error_exit "Image validation failed"
    fi
    
    # Final cleanup
    cleanup_system
    
    log_success "VM base image build completed successfully!"
    log "Image: $BASE_IMAGE_NAME:$VERSION"
    log "Build type: $BUILD_TYPE"
    log "Build log: $LOG_FILE"
}

# Execute main function
main "$@"
