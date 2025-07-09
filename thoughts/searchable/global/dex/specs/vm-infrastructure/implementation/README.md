# VM Infrastructure Implementation

This directory contains the complete implementation of the Freestyle VM Snapshot Infrastructure, including all scripts, configurations, and automation needed to build, deploy, and manage development VMs.

## Quick Start

```bash
# Build and deploy VM infrastructure
make deploy

# Run integration tests
make test

# Monitor VM health
make monitor
```

## Directory Structure

```
implementation/
├── README.md                   # This file
├── Makefile                    # Build orchestration
├── scripts/                    # Build and deployment scripts
│   ├── build-base-image.sh     # VM base image builder
│   ├── install-claude-code.sh  # Claude Code installation
│   ├── install-hl-daemon.sh    # HumanLayer daemon installation
│   ├── configure-system.sh     # System configuration
│   ├── deploy-vm.sh            # VM deployment automation
│   └── cleanup.sh              # Cleanup utilities
├── config/                     # Configuration files
│   ├── vm-config.json          # VM configuration
│   ├── claude-code.json        # Claude Code configuration
│   ├── hl-daemon.json          # HumanLayer daemon configuration
│   ├── netplan.yaml            # Network configuration
│   └── sysctl.conf             # Kernel parameters
├── systemd/                    # SystemD service files
│   ├── claude-code.service     # Claude Code service
│   ├── hl-daemon.service       # HumanLayer daemon service
│   ├── vm-monitor.service      # VM monitoring service
│   └── vm-health.timer         # Health check timer
├── monitoring/                 # Health monitoring scripts
│   ├── health-check.sh         # Main health check script
│   ├── resource-monitor.sh     # Resource monitoring
│   ├── log-monitor.sh          # Log monitoring
│   └── alert-handler.sh        # Alert handling
├── tests/                      # Test suites
│   ├── integration/            # Integration tests
│   ├── unit/                   # Unit tests
│   └── performance/            # Performance tests
├── docs/                       # Documentation
│   ├── deployment.md           # Deployment guide
│   ├── configuration.md        # Configuration reference
│   ├── troubleshooting.md      # Troubleshooting guide
│   └── api-reference.md        # API documentation
└── templates/                  # Configuration templates
    ├── cloud-init.yaml         # Cloud-init template
    ├── docker-compose.yml      # Docker compose template
    └── nginx.conf              # Nginx configuration template
```

## Components

### 1. VM Base Image

- Ubuntu 22.04 LTS foundation
- Pre-installed development tools
- Security hardening
- Performance optimization

### 2. Claude Code Integration

- AI-powered code editor
- STDIO-based API interface
- Sandboxed execution environment
- Real-time code assistance

### 3. HumanLayer Daemon

- Human-in-the-loop orchestration
- Secure API gateway
- Request validation and routing
- Audit logging

### 4. System Services

- SystemD service management
- Automated health monitoring
- Resource usage tracking
- Log rotation and management

### 5. Monitoring & Alerting

- Real-time health checks
- Performance monitoring
- Alert notifications
- Automated recovery

## Prerequisites

- Ubuntu 22.04 LTS host system
- Docker and Docker Compose
- Minimum 8GB RAM, 50GB storage
- Internet connectivity for package downloads
- Administrative privileges (sudo)

## Installation

1. **Clone Repository**

   ```bash
   git clone <repository-url>
   cd specs/vm-infrastructure/implementation
   ```

2. **Configure Environment**

   ```bash
   # Copy and edit configuration files
   cp config/vm-config.json.example config/vm-config.json
   cp config/claude-code.json.example config/claude-code.json
   cp config/hl-daemon.json.example config/hl-daemon.json

   # Edit configurations as needed
   vim config/vm-config.json
   ```

3. **Build Base Image**

   ```bash
   make build-base-image
   ```

4. **Deploy Services**

   ```bash
   make deploy-services
   ```

5. **Verify Installation**
   ```bash
   make test-integration
   ```

## Configuration

### VM Configuration (`config/vm-config.json`)

```json
{
  "vm": {
    "name": "freestyle-dev",
    "memory": "4096",
    "cpus": "2",
    "disk_size": "30G"
  },
  "network": {
    "interface": "eth0",
    "dhcp": true,
    "dns": ["8.8.8.8", "8.8.4.4"]
  },
  "users": {
    "developer": {
      "shell": "/bin/bash",
      "groups": ["sudo", "docker"]
    }
  }
}
```

### Claude Code Configuration (`config/claude-code.json`)

See [configuration.md](docs/configuration.md) for detailed options.

### HumanLayer Daemon Configuration (`config/hl-daemon.json`)

See [configuration.md](docs/configuration.md) for detailed options.

## Usage

### Starting Services

```bash
# Start all services
make start

# Start individual services
systemctl start claude-code
systemctl start hl-daemon
systemctl start vm-monitor
```

### Monitoring

```bash
# Check service status
make status

# View logs
make logs

# Run health checks
make health-check
```

### Development

```bash
# Connect to development environment
ssh developer@vm-ip

# Use Claude Code
claude-code --help

# Check HumanLayer daemon
curl http://localhost:8080/health
```

## Testing

### Integration Tests

```bash
# Run all integration tests
make test-integration

# Run specific test suite
make test-claude-code
make test-hl-daemon
make test-vm-health
```

### Performance Tests

```bash
# Run performance benchmarks
make test-performance

# Load testing
make test-load
```

### Unit Tests

```bash
# Run unit tests
make test-unit
```

## Troubleshooting

### Common Issues

1. **Service Failed to Start**

   ```bash
   # Check service logs
   journalctl -u claude-code -f
   journalctl -u hl-daemon -f

   # Verify configuration
   make validate-config
   ```

2. **High Resource Usage**

   ```bash
   # Check resource usage
   make monitor-resources

   # Restart services
   make restart
   ```

3. **Network Connectivity Issues**

   ```bash
   # Check network configuration
   make check-network

   # Reset network
   sudo netplan apply
   ```

### Log Locations

- System logs: `/var/log/syslog`
- Service logs: `/var/log/freestyle/`
- Application logs: `/opt/freestyle/*/logs/`

### Support

- Documentation: [docs/](docs/)
- Issues: Create GitHub issue
- Logs: Run `make collect-logs` for support bundle

## Security

### Security Features

- Sandboxed execution environment
- User privilege separation
- Network access controls
- Audit logging
- Encrypted communications

### Security Best Practices

1. Regular security updates
2. Strong SSH key authentication
3. Firewall configuration
4. Resource limits
5. Log monitoring

### Vulnerability Management

- Automated security scanning
- Regular dependency updates
- Security patch management
- Incident response procedures

## Performance

### Optimization Features

- Resource usage monitoring
- Performance profiling
- Caching strategies
- Load balancing
- Auto-scaling capabilities

### Performance Metrics

- Boot time: < 30 seconds
- API response time: < 100ms
- Memory usage: < 2GB idle
- CPU usage: < 5% idle

## Maintenance

### Regular Tasks

```bash
# Update system packages
make update-system

# Backup configuration
make backup-config

# Clean up logs
make cleanup-logs

# Update services
make update-services
```

### Backup and Recovery

```bash
# Create backup
make backup

# Restore from backup
make restore BACKUP_FILE=backup.tar.gz

# Test backup integrity
make test-backup
```

## Development

### Contributing

1. Fork the repository
2. Create feature branch
3. Make changes
4. Add tests
5. Submit pull request

### Development Environment

```bash
# Set up development environment
make dev-setup

# Run in development mode
make dev-run

# Run development tests
make dev-test
```

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Version History

- v1.0.0 - Initial release
- v1.1.0 - Added Claude Code integration
- v1.2.0 - Added HumanLayer daemon
- v1.3.0 - Enhanced monitoring and alerting

## Support

For support, please refer to:

- [Documentation](docs/)
- [Troubleshooting Guide](docs/troubleshooting.md)
- [API Reference](docs/api-reference.md)
- [GitHub Issues](https://github.com/humanlayer/freestyle/issues)
