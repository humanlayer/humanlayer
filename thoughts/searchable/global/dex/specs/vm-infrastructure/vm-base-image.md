# VM Base Image Specification

## Overview

This specification defines the requirements for the base VM image used in the Freestyle Cloud Development Environment. The base image serves as the foundation for all VM instances and must be optimized for development workloads, security, and integration with the Freestyle platform.

## System Requirements

### Operating System

- **Base Distribution**: Ubuntu 22.04 LTS (Jammy Jellyfish) Server
- **Architecture**: x86_64 (AMD64)
- **Kernel**: Linux 5.15+ with container support enabled
- **Package Manager**: APT with snap disabled by default
- **Init System**: SystemD 249+

### Core System Packages

```bash
# Essential system packages
- curl
- wget
- git (>= 2.34)
- openssh-server
- sudo
- htop
- vim
- nano
- tmux
- screen
- build-essential
- python3 (>= 3.10)
- python3-pip
- nodejs (>= 18.0)
- npm (>= 8.0)
- docker.io
- docker-compose
- jq
- unzip
- ca-certificates
- gnupg
- lsb-release
```

## Network Configuration

### Interface Configuration

```yaml
# /etc/netplan/50-cloud-init.yaml
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
```

### Firewall Rules

```bash
# UFW (Uncomplicated Firewall) configuration
ufw --force enable
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
```

### DNS Configuration

```bash
# /etc/systemd/resolved.conf
[Resolve]
DNS=8.8.8.8 8.8.4.4 1.1.1.1
FallbackDNS=1.0.0.1
Domains=~.
DNSSEC=yes
DNSOverTLS=yes
Cache=yes
DNSStubListener=yes
```

## Storage and Filesystem Layout

### Disk Partitioning

```
/dev/sda1    512M    /boot/efi    vfat    (EFI System Partition)
/dev/sda2    1G      /boot        ext4    (Boot partition)
/dev/sda3    18G     /            ext4    (Root filesystem)
/dev/sda4    8G      /var         ext4    (Variable data)
/dev/sda5    2G      swap         swap    (Swap partition)
```

### Directory Structure

```
/opt/
├── freestyle/              # Freestyle application directory
│   ├── daemon/            # HL daemon installation
│   ├── claude-code/       # Claude Code installation
│   ├── logs/              # Application logs
│   └── config/            # Configuration files
/home/
├── developer/             # Default development user
│   ├── .ssh/              # SSH configuration
│   ├── workspace/         # Default workspace directory
│   └── .config/           # User configuration
/var/
├── log/
│   └── freestyle/         # Freestyle application logs
└── lib/
    └── freestyle/         # Freestyle application data
```

### Filesystem Optimization

```bash
# /etc/fstab optimizations
/ ext4 defaults,noatime,discard 0 1
/var ext4 defaults,noatime,discard 0 2
/boot ext4 defaults,noatime 0 2

# Tmpfs for temporary files
tmpfs /tmp tmpfs defaults,noatime,nosuid,nodev,noexec,mode=1777,size=1G 0 0
tmpfs /var/tmp tmpfs defaults,noatime,nosuid,nodev,noexec,mode=1777,size=512M 0 0
```

## User Management

### System Users

```bash
# Freestyle daemon user
useradd --system --home /opt/freestyle --shell /bin/false freestyle-daemon
usermod -aG docker freestyle-daemon

# Developer user (default workspace user)
useradd --create-home --shell /bin/bash --groups sudo,docker developer
echo "developer ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/developer
```

### SSH Configuration

```bash
# /etc/ssh/sshd_config
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
```

## Security Hardening

### Kernel Security Parameters

```bash
# /etc/sysctl.d/99-freestyle-security.conf

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
```

### Service Hardening

```bash
# Disable unnecessary services
systemctl disable snapd
systemctl disable bluetooth
systemctl disable cups
systemctl disable avahi-daemon
systemctl disable NetworkManager-wait-online

# Enable security services
systemctl enable fail2ban
systemctl enable ufw
systemctl enable unattended-upgrades
```

### File System Security

```bash
# Set secure permissions
chmod 600 /etc/ssh/ssh_host_*_key
chmod 644 /etc/ssh/ssh_host_*_key.pub
chmod 700 /root
chmod 700 /home/developer/.ssh
chmod 600 /home/developer/.ssh/authorized_keys

# Remove unnecessary files
rm -f /etc/ssh/ssh_host_dsa_key*
find /tmp -type f -atime +7 -delete
find /var/tmp -type f -atime +7 -delete
```

## System Monitoring

### Log Configuration

```bash
# /etc/rsyslog.d/50-freestyle.conf
# Freestyle application logs
local0.* /var/log/freestyle/daemon.log
local1.* /var/log/freestyle/claude-code.log
local2.* /var/log/freestyle/system.log

# Log rotation
# /etc/logrotate.d/freestyle
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
```

### Resource Monitoring

```bash
# /etc/systemd/system/freestyle-monitor.service
[Unit]
Description=Freestyle Resource Monitor
After=network.target

[Service]
Type=simple
User=freestyle-daemon
ExecStart=/opt/freestyle/bin/resource-monitor
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

## Performance Optimization

### System Tuning

```bash
# /etc/systemd/system.conf
DefaultTimeoutStopSec=10s
DefaultTimeoutStartSec=30s
DefaultTasksMax=4096

# /etc/security/limits.conf
developer soft nofile 65536
developer hard nofile 65536
freestyle-daemon soft nofile 32768
freestyle-daemon hard nofile 32768

# Disable swap for better performance
echo 'vm.swappiness=1' >> /etc/sysctl.d/99-freestyle-performance.conf
```

### Docker Configuration

```json
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
```

## Pre-installed Development Tools

### Version Control

```bash
# Git configuration
git config --global init.defaultBranch main
git config --global pull.rebase false
git config --global user.name "Freestyle Developer"
git config --global user.email "developer@freestyle.dev"
```

### Node.js Environment

```bash
# Install Node Version Manager (NVM)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc

# Install and set default Node.js version
nvm install 18
nvm install 20
nvm use 20
nvm alias default 20

# Global npm packages
npm install -g yarn pnpm create-react-app @vue/cli typescript
```

### Python Environment

```bash
# Python package management
pip3 install --upgrade pip
pip3 install virtualenv pipenv poetry

# Common development packages
pip3 install requests flask fastapi uvicorn black flake8 pytest
```

## Validation Criteria

### Boot Performance

- Cold boot time: < 30 seconds
- Service startup time: < 10 seconds
- Network connectivity: < 5 seconds after boot

### Resource Usage (Idle)

- RAM usage: < 512MB
- CPU usage: < 2%
- Disk I/O: < 1MB/s
- Network: < 100KB/s

### Security Compliance

- All security updates applied
- No unnecessary services running
- Firewall properly configured
- SSH hardening in place
- Log monitoring active

### Integration Tests

```bash
#!/bin/bash
# /opt/freestyle/tests/base-image-test.sh

# Test network connectivity
curl -s http://google.com > /dev/null && echo "✓ Network connectivity" || echo "✗ Network failed"

# Test essential services
systemctl is-active ssh && echo "✓ SSH service" || echo "✗ SSH failed"
systemctl is-active docker && echo "✓ Docker service" || echo "✗ Docker failed"
systemctl is-active ufw && echo "✓ Firewall service" || echo "✗ Firewall failed"

# Test development tools
node --version && echo "✓ Node.js installed" || echo "✗ Node.js failed"
python3 --version && echo "✓ Python installed" || echo "✗ Python failed"
git --version && echo "✓ Git installed" || echo "✗ Git failed"
docker --version && echo "✓ Docker installed" || echo "✗ Docker failed"

# Test filesystem permissions
test -d /opt/freestyle && echo "✓ Freestyle directory" || echo "✗ Freestyle directory missing"
test -w /var/log/freestyle && echo "✓ Log directory writable" || echo "✗ Log directory not writable"

# Test user configuration
sudo -u developer -i whoami && echo "✓ Developer user" || echo "✗ Developer user failed"
```

## Build Process

### Automated Build Script

```bash
#!/bin/bash
# /opt/freestyle/scripts/build-base-image.sh

set -euo pipefail

echo "Building Freestyle VM Base Image..."

# Update system
apt-get update
apt-get upgrade -y

# Install packages
apt-get install -y $(cat /opt/freestyle/config/packages.list)

# Configure system
/opt/freestyle/scripts/configure-system.sh
/opt/freestyle/scripts/configure-security.sh
/opt/freestyle/scripts/configure-network.sh

# Install development tools
/opt/freestyle/scripts/install-dev-tools.sh

# Cleanup
apt-get autoremove -y
apt-get autoclean
rm -rf /var/lib/apt/lists/*
rm -rf /tmp/*
rm -rf /var/tmp/*

# Final validation
/opt/freestyle/tests/base-image-test.sh

echo "Base image build completed successfully!"
```

## Maintenance and Updates

### Automated Updates

```bash
# /etc/cron.daily/freestyle-updates
#!/bin/bash
# Update security packages daily
unattended-upgrade -d

# Update base image monthly (if automated)
if [ $(date +%d) -eq 01 ]; then
    /opt/freestyle/scripts/update-base-image.sh
fi
```

### Version Control

- Image versioning follows semantic versioning (MAJOR.MINOR.PATCH)
- Each image tagged with build date and commit hash
- Rollback capability to previous stable version
- Automated testing before release

## Error Handling

### Boot Failure Recovery

```bash
# /etc/systemd/system/freestyle-recovery.service
[Unit]
Description=Freestyle Boot Recovery
DefaultDependencies=false
After=emergency.target

[Service]
Type=oneshot
ExecStart=/opt/freestyle/scripts/boot-recovery.sh
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=emergency.target
```

### Service Health Checks

```bash
#!/bin/bash
# /opt/freestyle/scripts/health-check.sh

# Check critical services
services=("ssh" "docker" "ufw" "rsyslog")
for service in "${services[@]}"; do
    if ! systemctl is-active --quiet "$service"; then
        echo "CRITICAL: $service is not running"
        systemctl restart "$service"
    fi
done

# Check filesystem health
if [ $(df / | tail -1 | awk '{print $5}' | sed 's/%//') -gt 90 ]; then
    echo "WARNING: Root filesystem > 90% full"
    # Cleanup old logs
    find /var/log -name "*.log" -mtime +7 -delete
fi
```

This specification provides a comprehensive foundation for building secure, performant, and maintainable VM base images for the Freestyle Cloud Development Environment.
