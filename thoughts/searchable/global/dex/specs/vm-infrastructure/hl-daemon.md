# HumanLayer (HL) Daemon Specification

## Overview

This specification defines the HumanLayer (HL) daemon component that runs within VM instances to provide secure, reliable communication between the cloud infrastructure and local development environment. The HL daemon serves as the primary bridge for command execution, event streaming, and service lifecycle management.

## System Architecture

The HL daemon operates as a critical system service within the VM instance, facilitating:

- Bi-directional communication with HL Cloud API
- STDIO-based communication with Claude Code
- Process and service lifecycle management
- Event streaming and health monitoring
- Secure VM registration and initialization

## Installation Requirements

### System Dependencies

```bash
# Required system packages
- systemd (>= 249)
- curl (>= 7.68)
- wget (>= 1.20)
- jq (>= 1.6)
- openssl (>= 1.1.1)
- ca-certificates
- python3 (>= 3.10)
- python3-pip
- python3-venv
- build-essential
- libssl-dev
- libffi-dev
- python3-dev
```

### Installation Directory Structure

```bash
/opt/freestyle/hl-daemon/
├── bin/                        # Executable binaries
│   ├── hl-daemon              # Main daemon binary
│   ├── hl-client              # CLI client utility
│   └── hl-health-check        # Health check utility
├── lib/                       # Library dependencies
│   ├── python/                # Python modules
│   └── native/                # Native libraries
├── config/                    # Configuration files
│   ├── daemon.json            # Main daemon configuration
│   ├── security.json          # Security policies
│   ├── logging.json           # Logging configuration
│   └── api-endpoints.json     # API endpoint configuration
├── scripts/                   # Management scripts
│   ├── install.sh             # Installation script
│   ├── configure.sh           # Configuration script
│   ├── start.sh               # Startup script
│   ├── stop.sh                # Shutdown script
│   ├── health-check.sh        # Health monitoring script
│   └── recovery.sh            # Error recovery script
├── logs/                      # Application logs
│   ├── daemon.log             # Main daemon log
│   ├── api-requests.log       # API request/response log
│   ├── events.log             # Event streaming log
│   ├── claude-stdio.log       # Claude Code communication log
│   └── health.log             # Health check log
├── data/                      # Application data
│   ├── cache/                 # Temporary cache
│   ├── state/                 # Daemon state files
│   ├── auth/                  # Authentication tokens
│   └── metrics/               # Performance metrics
└── tests/                     # Test suites
    ├── unit/                  # Unit tests
    ├── integration/           # Integration tests
    └── performance/           # Performance benchmarks
```

### Installation Process

```bash
#!/bin/bash
# /opt/freestyle/hl-daemon/scripts/install.sh

set -euo pipefail

HL_DAEMON_VERSION="1.0.0"
INSTALL_DIR="/opt/freestyle/hl-daemon"
USER="freestyle-daemon"
GROUP="freestyle-daemon"

echo "Installing HumanLayer Daemon v${HL_DAEMON_VERSION}..."

# Create system user and group
if ! getent group "${GROUP}" > /dev/null 2>&1; then
    groupadd --system "${GROUP}"
fi

if ! getent passwd "${USER}" > /dev/null 2>&1; then
    useradd --system --home "${INSTALL_DIR}" --shell /bin/false \
            --gid "${GROUP}" --comment "HumanLayer Daemon" "${USER}"
fi

# Create installation directory structure
mkdir -p "${INSTALL_DIR}"/{bin,lib,config,scripts,logs,data,tests}
mkdir -p "${INSTALL_DIR}/lib"/{python,native}
mkdir -p "${INSTALL_DIR}/data"/{cache,state,auth,metrics}
mkdir -p "${INSTALL_DIR}/tests"/{unit,integration,performance}

# Set ownership and permissions
chown -R "${USER}:${GROUP}" "${INSTALL_DIR}"
chmod 755 "${INSTALL_DIR}"
chmod 750 "${INSTALL_DIR}/config"
chmod 700 "${INSTALL_DIR}/data/auth"
chmod 755 "${INSTALL_DIR}/logs"

# Download and install daemon binaries
cd "${INSTALL_DIR}"
wget -O hl-daemon.tar.gz "https://releases.humanlayer.dev/hl-daemon/${HL_DAEMON_VERSION}/hl-daemon-linux-x64.tar.gz"
tar -xzf hl-daemon.tar.gz --strip-components=1
rm hl-daemon.tar.gz

# Set executable permissions
chmod +x bin/hl-daemon*
chmod +x scripts/*.sh

# Install Python dependencies
python3 -m venv "${INSTALL_DIR}/lib/python/venv"
source "${INSTALL_DIR}/lib/python/venv/bin/activate"
pip install --upgrade pip
pip install -r requirements.txt

# Install systemd service
cp "${INSTALL_DIR}/config/systemd/hl-daemon.service" /etc/systemd/system/
systemctl daemon-reload

echo "HumanLayer Daemon installation completed successfully"
```

## Configuration

### Main Daemon Configuration

```json
{
  "// /opt/freestyle/hl-daemon/config/daemon.json": "",

  "daemon": {
    "instance_id": "${VM_INSTANCE_ID}",
    "workspace_id": "${WORKSPACE_ID}",
    "version": "1.0.0",
    "environment": "production"
  },

  "cloud_api": {
    "base_url": "https://api.humanlayer.dev",
    "endpoints": {
      "register": "/v1/vm/register",
      "heartbeat": "/v1/vm/heartbeat",
      "commands": "/v1/vm/commands",
      "events": "/v1/vm/events",
      "status": "/v1/vm/status"
    },
    "auth": {
      "method": "jwt",
      "token_file": "/opt/freestyle/hl-daemon/data/auth/access_token",
      "refresh_token_file": "/opt/freestyle/hl-daemon/data/auth/refresh_token",
      "cert_file": "/opt/freestyle/hl-daemon/data/auth/client.crt",
      "key_file": "/opt/freestyle/hl-daemon/data/auth/client.key"
    },
    "connection": {
      "timeout": 30,
      "retry_attempts": 3,
      "retry_delay": 5,
      "keepalive": true,
      "max_connections": 10,
      "compression": "gzip"
    },
    "rate_limiting": {
      "requests_per_minute": 1000,
      "burst_limit": 100,
      "backoff_strategy": "exponential"
    }
  },

  "claude_integration": {
    "enabled": true,
    "binary_path": "/opt/freestyle/claude-code/bin/claude-code",
    "config_path": "/opt/freestyle/claude-code/config/claude-code.json",
    "stdio_timeout": 30,
    "restart_on_failure": true,
    "max_restart_attempts": 5,
    "restart_delay": 10,
    "health_check_interval": 60,
    "communication": {
      "buffer_size": 8192,
      "message_delimiter": "\n",
      "encoding": "utf-8",
      "compression": false
    }
  },

  "process_management": {
    "max_processes": 64,
    "process_timeout": 300,
    "cleanup_interval": 600,
    "resource_limits": {
      "max_memory_mb": 1024,
      "max_cpu_percent": 80,
      "max_open_files": 1024,
      "max_execution_time": 1800
    },
    "allowed_commands": [
      "npm",
      "yarn",
      "pnpm",
      "pip",
      "python",
      "python3",
      "node",
      "nodejs",
      "git",
      "docker",
      "docker-compose",
      "ls",
      "cat",
      "grep",
      "find",
      "tail",
      "head",
      "curl",
      "wget"
    ],
    "blocked_commands": [
      "sudo",
      "su",
      "chmod",
      "chown",
      "rm -rf",
      "dd",
      "fdisk",
      "systemctl",
      "service",
      "passwd",
      "useradd",
      "userdel"
    ]
  },

  "event_streaming": {
    "enabled": true,
    "batch_size": 100,
    "flush_interval": 5,
    "max_queue_size": 10000,
    "compression": "gzip",
    "encryption": true,
    "event_types": [
      "process_start",
      "process_end",
      "file_change",
      "system_metric",
      "error",
      "health_check"
    ]
  },

  "health_monitoring": {
    "enabled": true,
    "check_interval": 60,
    "metrics_collection": true,
    "alerts": {
      "cpu_threshold": 80,
      "memory_threshold": 85,
      "disk_threshold": 90,
      "load_threshold": 2.0,
      "error_rate_threshold": 0.05
    },
    "self_healing": {
      "enabled": true,
      "restart_on_failure": true,
      "max_restart_attempts": 3,
      "restart_delay": 30
    }
  },

  "security": {
    "sandbox_mode": true,
    "tls_version": "1.3",
    "certificate_validation": true,
    "allowed_networks": ["api.humanlayer.dev", "releases.humanlayer.dev"],
    "blocked_networks": ["169.254.169.254", "localhost:22", "127.0.0.1:22"],
    "file_access": {
      "allowed_paths": [
        "/home/developer/workspace",
        "/tmp/hl-daemon-temp",
        "/opt/freestyle/hl-daemon/data"
      ],
      "blocked_paths": ["/etc/shadow", "/root", "/opt/freestyle/hl-daemon/config", "/var/log/auth.log"]
    }
  },

  "logging": {
    "level": "INFO",
    "format": "json",
    "output": "file",
    "file": "/opt/freestyle/hl-daemon/logs/daemon.log",
    "max_size": "100MB",
    "backup_count": 5,
    "compression": true,
    "structured_logging": true,
    "log_rotation": {
      "enabled": true,
      "frequency": "daily",
      "retention_days": 7
    }
  }
}
```

### Security Configuration

```json
{
  "// /opt/freestyle/hl-daemon/config/security.json": "",

  "authentication": {
    "methods": ["jwt", "certificate"],
    "jwt": {
      "algorithm": "RS256",
      "issuer": "humanlayer.dev",
      "audience": "hl-daemon",
      "expiry": 3600,
      "refresh_threshold": 300,
      "public_key_url": "https://api.humanlayer.dev/.well-known/jwks.json"
    },
    "certificate": {
      "ca_cert": "/opt/freestyle/hl-daemon/data/auth/ca.crt",
      "client_cert": "/opt/freestyle/hl-daemon/data/auth/client.crt",
      "client_key": "/opt/freestyle/hl-daemon/data/auth/client.key",
      "verify_hostname": true,
      "cipher_suites": ["ECDHE-RSA-AES256-GCM-SHA384", "ECDHE-RSA-AES128-GCM-SHA256"]
    }
  },

  "authorization": {
    "rbac_enabled": true,
    "default_role": "vm-instance",
    "permissions": {
      "vm-instance": ["process:execute", "file:read", "file:write", "system:monitor", "events:stream"],
      "admin": ["system:configure", "daemon:restart", "logs:access"]
    }
  },

  "network_security": {
    "firewall_rules": [
      {
        "direction": "outbound",
        "protocol": "https",
        "destination": "api.humanlayer.dev",
        "action": "allow"
      },
      {
        "direction": "outbound",
        "protocol": "any",
        "destination": "169.254.169.254",
        "action": "deny"
      }
    ],
    "tls_config": {
      "min_version": "1.2",
      "max_version": "1.3",
      "cipher_suites": [
        "TLS_AES_256_GCM_SHA384",
        "TLS_AES_128_GCM_SHA256",
        "TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384"
      ],
      "certificate_pinning": true,
      "pin_hashes": ["sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="]
    }
  },

  "input_validation": {
    "max_request_size": "10MB",
    "sanitization_rules": [
      {
        "field": "command",
        "type": "command_injection",
        "action": "sanitize"
      },
      {
        "field": "file_path",
        "type": "path_traversal",
        "action": "reject"
      }
    ]
  }
}
```

## SystemD Service Configuration

### Main Service Definition

```ini
# /etc/systemd/system/hl-daemon.service
[Unit]
Description=HumanLayer VM Daemon
Documentation=https://docs.humanlayer.dev/daemon
After=network-online.target
Wants=network-online.target
Before=claude-code.service
Requires=systemd-resolved.service

[Service]
Type=notify
User=freestyle-daemon
Group=freestyle-daemon
WorkingDirectory=/opt/freestyle/hl-daemon
Environment=PATH=/opt/freestyle/hl-daemon/lib/python/venv/bin:/usr/local/bin:/usr/bin:/bin
Environment=PYTHONPATH=/opt/freestyle/hl-daemon/lib/python
Environment=HL_DAEMON_CONFIG=/opt/freestyle/hl-daemon/config/daemon.json
Environment=HL_DAEMON_SECURITY_CONFIG=/opt/freestyle/hl-daemon/config/security.json
ExecStartPre=/opt/freestyle/hl-daemon/scripts/pre-start.sh
ExecStart=/opt/freestyle/hl-daemon/bin/hl-daemon --config /opt/freestyle/hl-daemon/config/daemon.json
ExecReload=/bin/kill -HUP $MAINPID
ExecStop=/opt/freestyle/hl-daemon/scripts/stop.sh
ExecStopPost=/opt/freestyle/hl-daemon/scripts/post-stop.sh
Restart=always
RestartSec=10
TimeoutStartSec=60
TimeoutStopSec=30
KillMode=mixed
KillSignal=SIGTERM

# Security settings
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictRealtime=true
RestrictNamespaces=true
LockPersonality=true
MemoryDenyWriteExecute=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
SystemCallFilter=@system-service
SystemCallErrorNumber=EPERM

# Read/write paths
ReadWritePaths=/home/developer/workspace
ReadWritePaths=/opt/freestyle/hl-daemon/logs
ReadWritePaths=/opt/freestyle/hl-daemon/data
ReadOnlyPaths=/opt/freestyle/claude-code/config

# Resource limits
LimitNOFILE=65536
LimitNPROC=4096
MemoryMax=4G
CPUQuota=300%
TasksMax=4096

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=hl-daemon
SyslogFacility=daemon

# Watchdog
WatchdogSec=60
NotifyAccess=main

[Install]
WantedBy=multi-user.target
```

### Health Check Service

```ini
# /etc/systemd/system/hl-daemon-health.service
[Unit]
Description=HumanLayer Daemon Health Check
After=hl-daemon.service
Requires=hl-daemon.service

[Service]
Type=oneshot
User=freestyle-daemon
Group=freestyle-daemon
ExecStart=/opt/freestyle/hl-daemon/scripts/health-check.sh
StandardOutput=journal
StandardError=journal
SyslogIdentifier=hl-daemon-health
```

### Health Check Timer

```ini
# /etc/systemd/system/hl-daemon-health.timer
[Unit]
Description=HumanLayer Daemon Health Check Timer
Requires=hl-daemon-health.service

[Timer]
OnCalendar=*:0/2  # Every 2 minutes
Persistent=true
RandomizedDelaySec=30

[Install]
WantedBy=timers.target
```

## API Specifications

### JSON-RPC over STDIO Protocol

```typescript
interface HLDaemonMessage {
  jsonrpc: '2.0'
  id: string | number | null
  method?: string // Method name (for requests)
  params?: any // Method parameters
  result?: any // Method result (for responses)
  error?: HLDaemonError // Error information
  timestamp: number // Unix timestamp
}

interface HLDaemonError {
  code: number // Error code (-32xxx for JSON-RPC, 1xxx+ for HL-specific)
  message: string // Error message
  data?: {
    // Additional error data
    stack_trace?: string
    request_id?: string
    error_type?: string
  }
}
```

### Cloud API Communication Methods

#### VM Registration

```typescript
interface RegisterVMRequest {
  method: 'vm/register'
  params: {
    instance_id: string // VM instance identifier
    workspace_id: string // Workspace identifier
    capabilities: string[] // VM capabilities
    system_info: {
      os: string // Operating system
      arch: string // CPU architecture
      memory: number // Total memory in MB
      cpu_cores: number // Number of CPU cores
      disk_space: number // Available disk space in MB
    }
    network_info: {
      ip_address: string // VM IP address
      hostname: string // VM hostname
      ports: number[] // Available ports
    }
  }
}

interface RegisterVMResponse {
  result: {
    registration_id: string // Registration identifier
    access_token: string // Access token for API calls
    refresh_token: string // Refresh token
    api_endpoints: {
      // API endpoint URLs
      commands: string
      events: string
      heartbeat: string
      status: string
    }
    configuration: {
      // Runtime configuration
      heartbeat_interval: number
      event_batch_size: number
      log_level: string
    }
  }
}
```

#### Command Execution

```typescript
interface ExecuteCommandRequest {
  method: 'command/execute'
  params: {
    command_id: string // Unique command identifier
    command: string // Command to execute
    args?: string[] // Command arguments
    cwd?: string // Working directory
    env?: Record<string, string> // Environment variables
    timeout?: number // Execution timeout in seconds
    stream_output?: boolean // Stream output in real-time
    user?: string // User to execute as
  }
}

interface ExecuteCommandResponse {
  result: {
    command_id: string // Command identifier
    process_id: number // System process ID
    status: 'started' | 'completed' | 'failed' | 'timeout'
    exit_code?: number // Process exit code
    stdout?: string // Standard output
    stderr?: string // Standard error
    execution_time: number // Execution time in milliseconds
    resource_usage: {
      max_memory: number // Peak memory usage in MB
      cpu_time: number // CPU time in milliseconds
    }
  }
}
```

#### Event Streaming

```typescript
interface StreamEventRequest {
  method: 'event/stream'
  params: {
    event_id: string // Unique event identifier
    event_type: string // Event type
    timestamp: number // Event timestamp
    data: any // Event data
    tags?: Record<string, string> // Event tags
    severity?: 'info' | 'warning' | 'error' | 'critical'
  }
}

interface StreamEventResponse {
  result: {
    event_id: string // Event identifier
    status: 'accepted' | 'rejected'
    reason?: string // Rejection reason
  }
}
```

### Claude Code Communication Methods

#### Process Management

```typescript
interface StartClaudeProcessRequest {
  method: 'claude/start'
  params: {
    workspace_path: string // Workspace directory
    config_overrides?: any // Configuration overrides
    environment?: Record<string, string> // Environment variables
  }
}

interface StartClaudeProcessResponse {
  result: {
    process_id: string // Claude process identifier
    pid: number // System process ID
    status: 'started'
    stdio_ready: boolean // STDIO communication ready
  }
}

interface StopClaudeProcessRequest {
  method: 'claude/stop'
  params: {
    process_id: string // Claude process identifier
    force?: boolean // Force termination
    timeout?: number // Graceful shutdown timeout
  }
}

interface StopClaudeProcessResponse {
  result: {
    process_id: string // Claude process identifier
    status: 'stopped' | 'terminated'
    exit_code: number // Process exit code
  }
}
```

#### STDIO Message Relay

```typescript
interface RelayStdioMessageRequest {
  method: 'claude/relay'
  params: {
    process_id: string // Claude process identifier
    message: any // Message to relay to Claude
    timeout?: number // Response timeout
  }
}

interface RelayStdioMessageResponse {
  result: {
    process_id: string // Claude process identifier
    response: any // Response from Claude
    execution_time: number // Response time in milliseconds
  }
}
```

### System Management Methods

#### Health Check

```typescript
interface HealthCheckRequest {
  method: 'system/health'
  params: {
    detailed?: boolean // Include detailed metrics
  }
}

interface HealthCheckResponse {
  result: {
    status: 'healthy' | 'degraded' | 'unhealthy'
    timestamp: number
    uptime: number // Uptime in seconds
    version: string // Daemon version
    system_metrics: {
      cpu_usage: number // CPU usage percentage
      memory_usage: number // Memory usage in MB
      disk_usage: number // Disk usage percentage
      load_average: number[] // Load average [1m, 5m, 15m]
      network_io: {
        bytes_sent: number
        bytes_received: number
      }
    }
    service_status: {
      claude_code: 'running' | 'stopped' | 'error'
      api_connection: 'connected' | 'disconnected' | 'error'
      event_streaming: 'active' | 'inactive' | 'error'
    }
    recent_errors?: string[] // Recent error messages
  }
}
```

#### Configuration Management

```typescript
interface UpdateConfigRequest {
  method: 'system/config/update'
  params: {
    config_section: string // Configuration section to update
    config_data: any // New configuration data
    restart_required?: boolean // Whether restart is required
  }
}

interface UpdateConfigResponse {
  result: {
    success: boolean
    restart_required: boolean
    validation_errors?: string[] // Configuration validation errors
  }
}
```

## Security Considerations

### Authentication and Authorization

```python
# Authentication implementation
class AuthenticationManager:
    def __init__(self, config: SecurityConfig):
        self.jwt_validator = JWTValidator(config.jwt)
        self.cert_validator = CertificateValidator(config.certificate)
        self.rate_limiter = RateLimiter(config.rate_limiting)

    def authenticate_request(self, request: Request) -> AuthenticationResult:
        """Authenticate incoming request."""
        # Rate limiting check
        if not self.rate_limiter.allow_request(request.client_ip):
            raise AuthenticationError("Rate limit exceeded")

        # JWT authentication
        if request.has_jwt_token():
            return self.jwt_validator.validate(request.jwt_token)

        # Certificate authentication
        if request.has_client_certificate():
            return self.cert_validator.validate(request.client_certificate)

        raise AuthenticationError("No valid authentication provided")

    def authorize_action(self, user: User, action: str, resource: str) -> bool:
        """Authorize user action on resource."""
        required_permission = f"{resource}:{action}"
        return required_permission in user.permissions
```

### Input Validation and Sanitization

```python
# Input validation implementation
class InputValidator:
    def __init__(self, config: SecurityConfig):
        self.max_request_size = config.max_request_size
        self.sanitization_rules = config.sanitization_rules

    def validate_command(self, command: str) -> bool:
        """Validate command for security."""
        # Check for blocked commands
        blocked_patterns = [
            r'sudo\s', r'su\s', r'rm\s+-rf', r'dd\s',
            r'>/dev/', r'\|.*sh', r'&', r';', r'`', r'\$\(',
            r'chmod\s+[0-7]{3,4}', r'chown\s+', r'passwd\s'
        ]

        for pattern in blocked_patterns:
            if re.search(pattern, command, re.IGNORECASE):
                return False

        return True

    def validate_file_path(self, path: str) -> bool:
        """Validate file path for security."""
        normalized = os.path.normpath(path)

        # Check for directory traversal
        if '..' in normalized or normalized.startswith('/'):
            return False

        # Check against blocked paths
        for blocked_path in self.config.blocked_paths:
            if normalized.startswith(blocked_path):
                return False

        return True

    def sanitize_input(self, data: any, field: str) -> any:
        """Sanitize input data based on field type."""
        for rule in self.sanitization_rules:
            if rule['field'] == field:
                if rule['type'] == 'command_injection':
                    return self.sanitize_command(data)
                elif rule['type'] == 'path_traversal':
                    return self.sanitize_path(data)

        return data
```

### Network Security

```python
# Network security implementation
class NetworkSecurityManager:
    def __init__(self, config: SecurityConfig):
        self.allowed_networks = config.allowed_networks
        self.blocked_networks = config.blocked_networks
        self.tls_config = config.tls_config

    def create_secure_connection(self, url: str) -> SSLContext:
        """Create secure TLS connection."""
        context = ssl.create_default_context()
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        context.maximum_version = ssl.TLSVersion.TLSv1_3

        # Certificate pinning
        if self.tls_config.certificate_pinning:
            context.check_hostname = True
            context.verify_mode = ssl.CERT_REQUIRED

        # Cipher suite configuration
        context.set_ciphers(':'.join(self.tls_config.cipher_suites))

        return context

    def is_network_allowed(self, destination: str) -> bool:
        """Check if network destination is allowed."""
        # Check blocked networks first
        for blocked in self.blocked_networks:
            if self.matches_network(destination, blocked):
                return False

        # Check allowed networks
        for allowed in self.allowed_networks:
            if self.matches_network(destination, allowed):
                return True

        return False
```

## Health Monitoring and Error Recovery

### Health Check Implementation

```bash
#!/bin/bash
# /opt/freestyle/hl-daemon/scripts/health-check.sh

set -euo pipefail

HEALTH_STATUS=0
LOG_FILE="/opt/freestyle/hl-daemon/logs/health.log"
CONFIG_FILE="/opt/freestyle/hl-daemon/config/daemon.json"

log_message() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [$$] $1" >> "$LOG_FILE"
}

check_daemon_service() {
    if systemctl is-active --quiet hl-daemon; then
        log_message "✓ HL Daemon service is running"
        return 0
    else
        log_message "✗ HL Daemon service is not running"
        return 1
    fi
}

check_api_connectivity() {
    local api_url=$(jq -r '.cloud_api.base_url' "$CONFIG_FILE")
    local timeout=10

    if curl -sf --max-time "$timeout" "${api_url}/health" > /dev/null 2>&1; then
        log_message "✓ Cloud API connectivity OK"
        return 0
    else
        log_message "✗ Cloud API connectivity failed"
        return 1
    fi
}

check_claude_integration() {
    local claude_binary=$(jq -r '.claude_integration.binary_path' "$CONFIG_FILE")

    if [[ -x "$claude_binary" ]]; then
        # Test STDIO communication
        local test_message='{"jsonrpc":"2.0","id":"health-check","method":"system/ping","params":{}}'
        if echo "$test_message" | timeout 5 "$claude_binary" --stdio > /dev/null 2>&1; then
            log_message "✓ Claude Code integration OK"
            return 0
        else
            log_message "✗ Claude Code STDIO communication failed"
            return 1
        fi
    else
        log_message "✗ Claude Code binary not found or not executable"
        return 1
    fi
}

check_system_resources() {
    local cpu_threshold=$(jq -r '.health_monitoring.alerts.cpu_threshold' "$CONFIG_FILE")
    local memory_threshold=$(jq -r '.health_monitoring.alerts.memory_threshold' "$CONFIG_FILE")
    local disk_threshold=$(jq -r '.health_monitoring.alerts.disk_threshold' "$CONFIG_FILE")

    # Check CPU usage
    local cpu_usage=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | sed 's/%us,//')
    if (( $(echo "$cpu_usage > $cpu_threshold" | bc -l) )); then
        log_message "⚠ High CPU usage: ${cpu_usage}%"
        HEALTH_STATUS=2
    fi

    # Check memory usage
    local memory_usage=$(free | grep '^Mem:' | awk '{printf "%.1f", $3/$2 * 100.0}')
    if (( $(echo "$memory_usage > $memory_threshold" | bc -l) )); then
        log_message "⚠ High memory usage: ${memory_usage}%"
        HEALTH_STATUS=2
    fi

    # Check disk usage
    local disk_usage=$(df /opt/freestyle | tail -1 | awk '{print $5}' | sed 's/%//')
    if [ "$disk_usage" -gt "$disk_threshold" ]; then
        log_message "⚠ High disk usage: ${disk_usage}%"
        HEALTH_STATUS=2
    fi

    log_message "System resources: CPU=${cpu_usage}%, Memory=${memory_usage}%, Disk=${disk_usage}%"
}

check_log_files() {
    local log_dir="/opt/freestyle/hl-daemon/logs"
    local max_log_size=104857600  # 100MB

    for log_file in "$log_dir"/*.log; do
        if [[ -f "$log_file" ]]; then
            local size=$(stat -f%z "$log_file" 2>/dev/null || stat -c%s "$log_file")
            if [ "$size" -gt "$max_log_size" ]; then
                log_message "⚠ Large log file detected: $(basename "$log_file") (${size} bytes)"
                # Rotate log file
                tail -n 10000 "$log_file" > "${log_file}.tmp"
                mv "${log_file}.tmp" "$log_file"
                log_message "Log file rotated: $(basename "$log_file")"
            fi
        fi
    done
}

# Run all health checks
check_daemon_service || HEALTH_STATUS=1
check_api_connectivity || HEALTH_STATUS=1
check_claude_integration || HEALTH_STATUS=1
check_system_resources
check_log_files

# Report overall health status
case $HEALTH_STATUS in
    0)
        log_message "Health check passed - system healthy"
        ;;
    1)
        log_message "Health check failed - system unhealthy"
        # Attempt automatic recovery
        /opt/freestyle/hl-daemon/scripts/recovery.sh
        ;;
    2)
        log_message "Health check warning - system degraded"
        ;;
esac

exit $HEALTH_STATUS
```

### Error Recovery System

```bash
#!/bin/bash
# /opt/freestyle/hl-daemon/scripts/recovery.sh

set -euo pipefail

LOG_FILE="/opt/freestyle/hl-daemon/logs/recovery.log"

log_message() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [RECOVERY] $1" >> "$LOG_FILE"
}

attempt_daemon_recovery() {
    log_message "Attempting HL Daemon recovery..."

    # Stop daemon service
    systemctl stop hl-daemon || true
    sleep 5

    # Clean up stale processes
    pkill -f hl-daemon || true
    sleep 2

    # Clean up temporary files
    find /opt/freestyle/hl-daemon/data/cache -name "*.tmp" -delete 2>/dev/null || true
    find /opt/freestyle/hl-daemon/data/state -name "*.lock" -delete 2>/dev/null || true

    # Reset daemon state
    rm -f /opt/freestyle/hl-daemon/data/state/daemon.pid
    rm -f /opt/freestyle/hl-daemon/data/state/claude.sock

    # Restart daemon service
    systemctl start hl-daemon
    sleep 10

    # Verify recovery
    if systemctl is-active --quiet hl-daemon; then
        log_message "✓ HL Daemon recovery successful"
        return 0
    else
        log_message "✗ HL Daemon recovery failed"
        return 1
    fi
}

attempt_claude_recovery() {
    log_message "Attempting Claude Code recovery..."

    # Kill any stale Claude processes
    pkill -f claude-code || true
    sleep 2

    # Clean up Claude temporary files
    rm -f /tmp/claude-code-*

    # The daemon will automatically restart Claude Code
    log_message "✓ Claude Code cleanup completed"
}

attempt_network_recovery() {
    log_message "Attempting network recovery..."

    # Flush DNS cache
    systemd-resolve --flush-caches || true

    # Reset network connection
    systemctl restart systemd-resolved || true

    log_message "✓ Network recovery completed"
}

perform_system_cleanup() {
    log_message "Performing system cleanup..."

    # Clean temporary files
    find /tmp -name "hl-daemon-*" -mtime +1 -delete 2>/dev/null || true
    find /var/tmp -name "hl-*" -mtime +1 -delete 2>/dev/null || true

    # Compress old logs
    find /opt/freestyle/hl-daemon/logs -name "*.log" -mtime +1 -exec gzip {} \; 2>/dev/null || true

    # Remove old compressed logs
    find /opt/freestyle/hl-daemon/logs -name "*.log.gz" -mtime +7 -delete 2>/dev/null || true

    log_message "✓ System cleanup completed"
}

# Main recovery sequence
log_message "Starting recovery sequence..."

attempt_daemon_recovery
attempt_claude_recovery
attempt_network_recovery
perform_system_cleanup

log_message "Recovery sequence completed"
```

## Performance Requirements

### Response Time Requirements

```yaml
# Performance SLA requirements
api_response_times:
  health_check:
    target: 100ms
    maximum: 500ms
  command_execution:
    start_target: 200ms
    start_maximum: 1000ms
  event_streaming:
    batch_target: 50ms
    batch_maximum: 200ms
  claude_communication:
    relay_target: 300ms
    relay_maximum: 2000ms

throughput_requirements:
  api_requests_per_second: 100
  events_per_second: 1000
  concurrent_processes: 32
  file_operations_per_second: 50

resource_limits:
  memory_usage:
    idle: 128MB
    active: 512MB
    maximum: 1GB
  cpu_usage:
    idle: 2%
    active: 25%
    maximum: 80%
  disk_io:
    read_mbps: 50
    write_mbps: 25
  network_io:
    inbound_mbps: 10
    outbound_mbps: 10
```

### Performance Monitoring

```python
# Performance monitoring implementation
class PerformanceMonitor:
    def __init__(self, config: DaemonConfig):
        self.metrics = MetricsCollector()
        self.alerts = AlertManager(config.health_monitoring.alerts)
        self.thresholds = config.performance_thresholds

    def record_api_request(self, method: str, duration: float):
        """Record API request performance metrics."""
        self.metrics.record_histogram(
            'api_request_duration',
            duration,
            tags={'method': method}
        )

        # Check against SLA thresholds
        threshold = self.thresholds.get(f'api_{method}', 1.0)
        if duration > threshold:
            self.alerts.send_alert(
                'api_performance',
                f'API method {method} exceeded threshold: {duration:.3f}s > {threshold}s'
            )

    def record_system_metrics(self):
        """Record system performance metrics."""
        metrics = self.get_system_metrics()

        self.metrics.record_gauge('cpu_usage', metrics.cpu_usage)
        self.metrics.record_gauge('memory_usage', metrics.memory_usage)
        self.metrics.record_gauge('disk_usage', metrics.disk_usage)

        # Check thresholds and send alerts
        if metrics.cpu_usage > self.thresholds.cpu_threshold:
            self.alerts.send_alert('high_cpu', f'CPU usage: {metrics.cpu_usage}%')

        if metrics.memory_usage > self.thresholds.memory_threshold:
            self.alerts.send_alert('high_memory', f'Memory usage: {metrics.memory_usage}%')
```

## Integration Tests

### Comprehensive Test Suite

```python
#!/usr/bin/env python3
# /opt/freestyle/hl-daemon/tests/integration/test_full_system.py

import asyncio
import json
import subprocess
import time
import unittest
from typing import Dict, Any

class HLDaemonIntegrationTest(unittest.TestCase):

    def setUp(self):
        """Set up test environment."""
        self.daemon_config = "/opt/freestyle/hl-daemon/config/daemon.json"
        self.test_workspace = "/tmp/hl-daemon-test"
        self.daemon_process = None

        # Ensure test workspace exists
        os.makedirs(self.test_workspace, exist_ok=True)

    def tearDown(self):
        """Clean up test environment."""
        if self.daemon_process:
            self.daemon_process.terminate()
            self.daemon_process.wait()

        # Clean up test files
        shutil.rmtree(self.test_workspace, ignore_errors=True)

    def test_daemon_startup(self):
        """Test daemon startup and initialization."""
        # Start daemon
        self.daemon_process = subprocess.Popen([
            "/opt/freestyle/hl-daemon/bin/hl-daemon",
            "--config", self.daemon_config,
            "--test-mode"
        ], stdout=subprocess.PIPE, stderr=subprocess.PIPE)

        # Wait for startup
        time.sleep(5)

        # Check if daemon is running
        self.assertIsNone(self.daemon_process.poll(), "Daemon should be running")

        # Test health check
        result = subprocess.run([
            "/opt/freestyle/hl-daemon/scripts/health-check.sh"
        ], capture_output=True, text=True)

        self.assertEqual(result.returncode, 0, "Health check should pass")

    def test_cloud_api_communication(self):
        """Test communication with cloud API."""
        # Mock cloud API server for testing
        mock_server = self.start_mock_api_server()

        try:
            # Test VM registration
            response = self.send_api_request({
                "jsonrpc": "2.0",
                "id": "test-1",
                "method": "vm/register",
                "params": {
                    "instance_id": "test-vm-001",
                    "workspace_id": "test-workspace-001",
                    "capabilities": ["claude-code", "docker"],
                    "system_info": {
                        "os": "Ubuntu 22.04",
                        "arch": "x86_64",
                        "memory": 4096,
                        "cpu_cores": 2,
                        "disk_space": 50000
                    }
                }
            })

            self.assertIn("result", response)
            self.assertIn("registration_id", response["result"])

        finally:
            mock_server.stop()

    def test_claude_integration(self):
        """Test integration with Claude Code."""
        # Start Claude Code mock
        claude_mock = self.start_claude_mock()

        try:
            # Test Claude process start
            response = self.send_daemon_request({
                "jsonrpc": "2.0",
                "id": "test-2",
                "method": "claude/start",
                "params": {
                    "workspace_path": self.test_workspace
                }
            })

            self.assertIn("result", response)
            self.assertEqual(response["result"]["status"], "started")

            # Test STDIO relay
            relay_response = self.send_daemon_request({
                "jsonrpc": "2.0",
                "id": "test-3",
                "method": "claude/relay",
                "params": {
                    "process_id": response["result"]["process_id"],
                    "message": {
                        "jsonrpc": "2.0",
                        "id": "claude-test",
                        "method": "system/info",
                        "params": {}
                    }
                }
            })

            self.assertIn("result", relay_response)

        finally:
            claude_mock.stop()

    def test_process_execution(self):
        """Test process execution capabilities."""
        # Test simple command execution
        response = self.send_daemon_request({
            "jsonrpc": "2.0",
            "id": "test-4",
            "method": "command/execute",
            "params": {
                "command_id": "test-cmd-001",
                "command": "echo",
                "args": ["Hello, World!"],
                "timeout": 10
            }
        })

        self.assertIn("result", response)
        self.assertEqual(response["result"]["exit_code"], 0)
        self.assertIn("Hello, World!", response["result"]["stdout"])

    def test_security_restrictions(self):
        """Test security restrictions and sandboxing."""
        # Test blocked command
        response = self.send_daemon_request({
            "jsonrpc": "2.0",
            "id": "test-5",
            "method": "command/execute",
            "params": {
                "command_id": "test-cmd-002",
                "command": "sudo",
                "args": ["whoami"],
                "timeout": 10
            }
        })

        self.assertIn("error", response)
        self.assertIn("blocked", response["error"]["message"].lower())

    def test_event_streaming(self):
        """Test event streaming functionality."""
        # Mock event collector
        events_received = []
        event_server = self.start_event_collector(events_received)

        try:
            # Trigger some events
            self.send_daemon_request({
                "jsonrpc": "2.0",
                "id": "test-6",
                "method": "event/stream",
                "params": {
                    "event_id": "test-event-001",
                    "event_type": "test_event",
                    "timestamp": int(time.time()),
                    "data": {"test": "data"},
                    "severity": "info"
                }
            })

            # Wait for event delivery
            time.sleep(2)

            self.assertGreater(len(events_received), 0, "Events should be received")

        finally:
            event_server.stop()

    def test_health_monitoring(self):
        """Test health monitoring and recovery."""
        # Force a recoverable error condition
        self.introduce_error_condition()

        # Wait for health check cycle
        time.sleep(65)  # Health checks run every 60 seconds

        # Verify recovery
        result = subprocess.run([
            "/opt/freestyle/hl-daemon/scripts/health-check.sh"
        ], capture_output=True, text=True)

        self.assertEqual(result.returncode, 0, "System should recover automatically")

    def test_performance_requirements(self):
        """Test performance requirements are met."""
        start_time = time.time()

        # Test API response time
        response = self.send_daemon_request({
            "jsonrpc": "2.0",
            "id": "perf-test-1",
            "method": "system/health",
            "params": {}
        })

        response_time = time.time() - start_time
        self.assertLess(response_time, 0.5, f"Health check should respond in <500ms, got {response_time:.3f}s")

        # Test throughput
        self.run_throughput_test()

    # Helper methods
    def send_daemon_request(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """Send request to daemon and return response."""
        # Implementation depends on daemon's API interface
        pass

    def send_api_request(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """Send request to cloud API and return response."""
        # Implementation for API testing
        pass

    def start_mock_api_server(self):
        """Start mock cloud API server for testing."""
        # Implementation for mock server
        pass

    def start_claude_mock(self):
        """Start Claude Code mock for testing."""
        # Implementation for Claude mock
        pass

    def start_event_collector(self, events_list):
        """Start event collector for testing."""
        # Implementation for event collection
        pass

if __name__ == '__main__':
    unittest.main()
```

### Performance Benchmarks

```bash
#!/bin/bash
# /opt/freestyle/hl-daemon/tests/performance/benchmark.sh

set -euo pipefail

RESULTS_FILE="/tmp/hl-daemon-benchmark-$(date +%s).json"
DAEMON_ENDPOINT="http://localhost:8080"

benchmark_api_latency() {
    echo "Benchmarking API latency..."

    local total_time=0
    local requests=100
    local failures=0

    for i in $(seq 1 $requests); do
        start_time=$(date +%s.%3N)

        if curl -sf "$DAEMON_ENDPOINT/health" > /dev/null 2>&1; then
            end_time=$(date +%s.%3N)
            duration=$(echo "$end_time - $start_time" | bc)
            total_time=$(echo "$total_time + $duration" | bc)
        else
            ((failures++))
        fi
    done

    avg_latency=$(echo "scale=3; $total_time / ($requests - $failures)" | bc)
    success_rate=$(echo "scale=2; (($requests - $failures) * 100) / $requests" | bc)

    echo "API Latency Results:" >> "$RESULTS_FILE"
    echo "  Average: ${avg_latency}s" >> "$RESULTS_FILE"
    echo "  Success Rate: ${success_rate}%" >> "$RESULTS_FILE"
    echo "  Failures: $failures" >> "$RESULTS_FILE"
}

benchmark_throughput() {
    echo "Benchmarking throughput..."

    local duration=60  # Test duration in seconds
    local concurrent_requests=10
    local total_requests=0

    # Start background workers
    for i in $(seq 1 $concurrent_requests); do
        {
            local count=0
            local end_time=$(($(date +%s) + duration))

            while [ $(date +%s) -lt $end_time ]; do
                if curl -sf "$DAEMON_ENDPOINT/health" > /dev/null 2>&1; then
                    ((count++))
                fi
                sleep 0.1
            done

            echo $count > "/tmp/worker_${i}_count"
        } &
    done

    # Wait for all workers to complete
    wait

    # Calculate total requests
    for i in $(seq 1 $concurrent_requests); do
        if [ -f "/tmp/worker_${i}_count" ]; then
            worker_count=$(cat "/tmp/worker_${i}_count")
            total_requests=$((total_requests + worker_count))
            rm "/tmp/worker_${i}_count"
        fi
    done

    requests_per_second=$(echo "scale=2; $total_requests / $duration" | bc)

    echo "Throughput Results:" >> "$RESULTS_FILE"
    echo "  Total Requests: $total_requests" >> "$RESULTS_FILE"
    echo "  Duration: ${duration}s" >> "$RESULTS_FILE"
    echo "  Requests/Second: $requests_per_second" >> "$RESULTS_FILE"
}

benchmark_resource_usage() {
    echo "Benchmarking resource usage..."

    local duration=60
    local samples=60
    local interval=1

    local cpu_total=0
    local memory_total=0
    local sample_count=0

    for i in $(seq 1 $samples); do
        # Get CPU usage for hl-daemon process
        cpu_usage=$(ps -o pcpu -p $(pgrep hl-daemon) --no-headers | tr -d ' ')

        # Get memory usage for hl-daemon process
        memory_usage=$(ps -o rss -p $(pgrep hl-daemon) --no-headers | tr -d ' ')
        memory_mb=$(echo "scale=2; $memory_usage / 1024" | bc)

        cpu_total=$(echo "$cpu_total + $cpu_usage" | bc)
        memory_total=$(echo "$memory_total + $memory_mb" | bc)
        ((sample_count++))

        sleep $interval
    done

    avg_cpu=$(echo "scale=2; $cpu_total / $sample_count" | bc)
    avg_memory=$(echo "scale=2; $memory_total / $sample_count" | bc)

    echo "Resource Usage Results:" >> "$RESULTS_FILE"
    echo "  Average CPU: ${avg_cpu}%" >> "$RESULTS_FILE"
    echo "  Average Memory: ${avg_memory}MB" >> "$RESULTS_FILE"
}

# Run all benchmarks
echo "Starting HL Daemon Performance Benchmarks..."
echo "Results will be saved to: $RESULTS_FILE"

echo "HL Daemon Performance Benchmark Results" > "$RESULTS_FILE"
echo "Date: $(date)" >> "$RESULTS_FILE"
echo "Version: $(hl-daemon --version)" >> "$RESULTS_FILE"
echo "" >> "$RESULTS_FILE"

benchmark_api_latency
benchmark_throughput
benchmark_resource_usage

echo "Benchmark completed. Results:"
cat "$RESULTS_FILE"
```

This comprehensive CLEANROOM specification provides all the necessary details for implementing the HumanLayer daemon component, including installation procedures, configuration files, API specifications, security measures, health monitoring, performance requirements, and integration tests. The specification is detailed enough for a developer with no prior context to implement the entire system.
