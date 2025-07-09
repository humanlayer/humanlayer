# Claude Code Integration Specification

## Overview

This specification defines the integration of Claude Code (Anthropic's AI-powered code editor) into the Freestyle VM infrastructure. Claude Code serves as the primary development interface for users, enabling AI-assisted coding through a stdio-based API interface.

## Installation Requirements

### System Dependencies

```bash
# Required system packages
- python3 (>= 3.10)
- python3-pip
- python3-venv
- nodejs (>= 18.0)
- npm (>= 8.0)
- git (>= 2.34)
- curl
- wget
- build-essential
- libssl-dev
- libffi-dev
- python3-dev
```

### Claude Code Installation

```bash
# Installation directory structure
/opt/freestyle/claude-code/
├── bin/                    # Executable binaries
│   ├── claude-code         # Main Claude Code binary
│   └── claude-code-server  # Server component
├── lib/                    # Library dependencies
├── config/                 # Configuration files
│   ├── claude-code.json    # Main configuration
│   ├── extensions.json     # Extension configuration
│   └── workspace.json      # Workspace settings
├── logs/                   # Application logs
├── data/                   # Application data
│   ├── workspace/          # Default workspace
│   └── cache/              # Cache directory
└── scripts/                # Management scripts
    ├── install.sh          # Installation script
    ├── update.sh           # Update script
    └── health-check.sh     # Health check script
```

### Installation Process

```bash
#!/bin/bash
# /opt/freestyle/claude-code/scripts/install.sh

set -euo pipefail

CLAUDE_CODE_VERSION="latest"
INSTALL_DIR="/opt/freestyle/claude-code"
USER="freestyle-daemon"

echo "Installing Claude Code v${CLAUDE_CODE_VERSION}..."

# Create installation directory
mkdir -p "${INSTALL_DIR}"/{bin,lib,config,logs,data,scripts}
chown -R ${USER}:${USER} "${INSTALL_DIR}"

# Download Claude Code
cd "${INSTALL_DIR}"
wget -O claude-code.tar.gz "https://releases.anthropic.com/claude-code/${CLAUDE_CODE_VERSION}/claude-code-linux-x64.tar.gz"
tar -xzf claude-code.tar.gz --strip-components=1
rm claude-code.tar.gz

# Set permissions
chmod +x bin/claude-code*
chmod +r config/*.json

# Install Python dependencies
python3 -m venv "${INSTALL_DIR}/venv"
source "${INSTALL_DIR}/venv/bin/activate"
pip install --upgrade pip
pip install -r requirements.txt

echo "Claude Code installation completed successfully"
```

## Configuration

### Main Configuration

```json
{
  "// /opt/freestyle/claude-code/config/claude-code.json": "",

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
    "excluded_patterns": ["node_modules/", ".git/", "*.log", "*.tmp"]
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
    "allowed_commands": ["npm", "yarn", "pnpm", "pip", "python", "node", "git"],
    "blocked_paths": ["/etc/", "/root/", "/opt/freestyle/config/"]
  },

  "logging": {
    "level": "INFO",
    "file": "/opt/freestyle/claude-code/logs/claude-code.log",
    "max_size": "100MB",
    "backup_count": 5,
    "format": "[%(asctime)s] %(levelname)s: %(message)s"
  }
}
```

### Workspace Configuration

```json
{
  "// /opt/freestyle/claude-code/config/workspace.json": "",

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
    "ignore_patterns": ["*.log", "node_modules/", ".env*"]
  }
}
```

## System Integration

### SystemD Service Configuration

```ini
# /etc/systemd/system/claude-code.service
[Unit]
Description=Claude Code AI Development Assistant
Documentation=https://docs.anthropic.com/claude-code
After=network.target
Wants=network.target

[Service]
Type=simple
User=freestyle-daemon
Group=freestyle-daemon
WorkingDirectory=/opt/freestyle/claude-code
Environment=PATH=/opt/freestyle/claude-code/venv/bin:/usr/local/bin:/usr/bin:/bin
Environment=PYTHONPATH=/opt/freestyle/claude-code/lib
Environment=CLAUDE_CODE_CONFIG=/opt/freestyle/claude-code/config/claude-code.json
ExecStart=/opt/freestyle/claude-code/bin/claude-code --config /opt/freestyle/claude-code/config/claude-code.json
ExecReload=/bin/kill -HUP $MAINPID
Restart=always
RestartSec=5
TimeoutStartSec=30
TimeoutStopSec=10

# Security settings
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/home/developer/workspace /opt/freestyle/claude-code/logs /opt/freestyle/claude-code/data

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
```

### Socket-based Activation (Optional)

```ini
# /etc/systemd/system/claude-code.socket
[Unit]
Description=Claude Code Socket
PartOf=claude-code.service

[Socket]
ListenStream=127.0.0.1:8081
Accept=false

[Install]
WantedBy=sockets.target
```

## API Interface Specifications

### STDIO Protocol

```typescript
interface ClaudeCodeMessage {
  id: string // Unique message ID
  type: 'request' | 'response' | 'notification'
  method?: string // Method name (for requests)
  params?: any // Method parameters
  result?: any // Method result (for responses)
  error?: ClaudeCodeError // Error information
  timestamp: number // Unix timestamp
}

interface ClaudeCodeError {
  code: number // Error code
  message: string // Error message
  data?: any // Additional error data
}
```

### Core API Methods

#### File Operations

```typescript
// Read file content
interface ReadFileRequest {
  method: 'file/read'
  params: {
    path: string // Absolute or relative file path
    encoding?: 'utf8' | 'base64' // Default: utf8
  }
}

interface ReadFileResponse {
  result: {
    content: string // File content
    size: number // File size in bytes
    modified: number // Last modified timestamp
    encoding: string // Content encoding
  }
}

// Write file content
interface WriteFileRequest {
  method: 'file/write'
  params: {
    path: string // File path
    content: string // File content
    encoding?: 'utf8' | 'base64' // Default: utf8
    create_dirs?: boolean // Create parent directories
  }
}

interface WriteFileResponse {
  result: {
    success: boolean
    bytes_written: number
    path: string
  }
}

// List directory contents
interface ListDirectoryRequest {
  method: 'file/list'
  params: {
    path: string // Directory path
    recursive?: boolean // Recursive listing
    include_hidden?: boolean // Include hidden files
  }
}

interface ListDirectoryResponse {
  result: {
    files: FileInfo[]
  }
}

interface FileInfo {
  name: string // File/directory name
  path: string // Full path
  type: 'file' | 'directory' | 'symlink'
  size: number // Size in bytes
  modified: number // Last modified timestamp
  permissions: string // Permission string (e.g., "rwxr-xr-x")
}
```

#### Code Operations

```typescript
// Code completion
interface CodeCompletionRequest {
  method: 'code/complete'
  params: {
    file_path: string // Current file path
    content: string // File content
    position: {
      // Cursor position
      line: number // Line number (0-indexed)
      character: number // Character position (0-indexed)
    }
    context?: string // Additional context
  }
}

interface CodeCompletionResponse {
  result: {
    completions: CompletionItem[]
  }
}

interface CompletionItem {
  label: string // Completion label
  kind: string // Completion kind
  detail?: string // Additional details
  documentation?: string // Documentation
  insert_text: string // Text to insert
  replace_range?: Range // Range to replace
}

// Code analysis
interface CodeAnalysisRequest {
  method: 'code/analyze'
  params: {
    file_path: string // File to analyze
    content: string // File content
    analysis_type: 'syntax' | 'semantic' | 'style' | 'security'
  }
}

interface CodeAnalysisResponse {
  result: {
    issues: AnalysisIssue[]
  }
}

interface AnalysisIssue {
  severity: 'error' | 'warning' | 'info'
  message: string // Issue description
  range: Range // Location of issue
  code?: string // Error code
  fix?: string // Suggested fix
}
```

#### Process Management

```typescript
// Execute command
interface ExecuteCommandRequest {
  method: 'process/execute'
  params: {
    command: string // Command to execute
    args?: string[] // Command arguments
    cwd?: string // Working directory
    env?: Record<string, string> // Environment variables
    timeout?: number // Timeout in seconds
  }
}

interface ExecuteCommandResponse {
  result: {
    exit_code: number // Process exit code
    stdout: string // Standard output
    stderr: string // Standard error
    execution_time: number // Execution time in ms
  }
}

// Start background process
interface StartProcessRequest {
  method: 'process/start'
  params: {
    command: string
    args?: string[]
    cwd?: string
    env?: Record<string, string>
  }
}

interface StartProcessResponse {
  result: {
    process_id: string // Process identifier
    pid: number // System process ID
  }
}
```

### Event Notifications

```typescript
// File change notification
interface FileChangeNotification {
  method: 'file/changed'
  params: {
    path: string // Changed file path
    type: 'created' | 'modified' | 'deleted'
    timestamp: number
  }
}

// Process output notification
interface ProcessOutputNotification {
  method: 'process/output'
  params: {
    process_id: string // Process identifier
    stream: 'stdout' | 'stderr' // Output stream
    data: string // Output data
    timestamp: number
  }
}
```

## Security Considerations

### Sandboxing

```json
{
  "sandbox": {
    "enabled": true,
    "allowed_paths": [
      "/home/developer/workspace",
      "/tmp/claude-code-temp",
      "/opt/freestyle/claude-code/data"
    ],
    "blocked_paths": ["/etc", "/root", "/opt/freestyle/config", "/var/log/freestyle"],
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
      "ls",
      "cat",
      "grep",
      "find"
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
      "service"
    ]
  }
}
```

### Input Validation

```python
# Input validation for file operations
def validate_file_path(path: str) -> bool:
    """Validate file path for security."""
    import os
    import re

    # Normalize path
    normalized = os.path.normpath(path)

    # Check for directory traversal
    if '..' in normalized or normalized.startswith('/'):
        return False

    # Check for suspicious patterns
    suspicious_patterns = [
        r'^\.',           # Hidden files
        r'[<>:"|?*]',     # Invalid characters
        r'(con|prn|aux|nul|com[1-9]|lpt[1-9])$',  # Windows reserved names
    ]

    for pattern in suspicious_patterns:
        if re.search(pattern, normalized, re.IGNORECASE):
            return False

    return True

def validate_command(command: str) -> bool:
    """Validate command for security."""
    blocked_patterns = [
        r'sudo\s',
        r'su\s',
        r'rm\s+-rf',
        r'dd\s',
        r'>/dev/',
        r'\|.*sh',
        r'&',
        r';',
        r'`',
        r'\$\(',
    ]

    for pattern in blocked_patterns:
        if re.search(pattern, command, re.IGNORECASE):
            return False

    return True
```

## Health Monitoring

### Health Check Script

```bash
#!/bin/bash
# /opt/freestyle/claude-code/scripts/health-check.sh

set -euo pipefail

HEALTH_STATUS=0
LOG_FILE="/opt/freestyle/claude-code/logs/health-check.log"

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

    mem_usage=$(ps -o pid,vsz,rss,comm -C claude-code | awk 'NR>1 {sum+=$3} END {print sum/1024}')
    cpu_usage=$(ps -o pid,pcpu,comm -C claude-code | awk 'NR>1 {sum+=$2} END {print sum}')

    echo "$(date): Memory usage: ${mem_usage}MB, CPU usage: ${cpu_usage}%" >> "$LOG_FILE"

    # Alert if memory usage > 1GB or CPU usage > 80%
    if (( $(echo "$mem_usage > 1024" | bc -l) )) || (( $(echo "$cpu_usage > 80" | bc -l) )); then
        echo "$(date): ⚠ High resource usage detected" >> "$LOG_FILE"
        HEALTH_STATUS=2  # Warning
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
        HEALTH_STATUS=2
    else
        echo "$(date): ✓ Disk usage OK: ${usage}%" >> "$LOG_FILE"
    fi
}

# Run all checks
check_service
check_api
check_resources
check_disk_space

# Rotate log if too large
if [ -f "$LOG_FILE" ] && [ $(stat -f%z "$LOG_FILE" 2>/dev/null || stat -c%s "$LOG_FILE") -gt 10485760 ]; then
    tail -n 1000 "$LOG_FILE" > "${LOG_FILE}.tmp"
    mv "${LOG_FILE}.tmp" "$LOG_FILE"
fi

exit $HEALTH_STATUS
```

### Monitoring Integration

```bash
# /etc/systemd/system/claude-code-health.service
[Unit]
Description=Claude Code Health Check
After=claude-code.service

[Service]
Type=oneshot
User=freestyle-daemon
ExecStart=/opt/freestyle/claude-code/scripts/health-check.sh
StandardOutput=journal
StandardError=journal

# /etc/systemd/system/claude-code-health.timer
[Unit]
Description=Claude Code Health Check Timer
Requires=claude-code-health.service

[Timer]
OnCalendar=*:0/5  # Every 5 minutes
Persistent=true

[Install]
WantedBy=timers.target
```

## Performance Optimization

### Resource Limits

```json
{
  "performance": {
    "max_memory_mb": 2048,
    "max_cpu_percent": 200,
    "max_open_files": 1024,
    "max_processes": 64,
    "cache_size_mb": 256,
    "worker_threads": 4
  }
}
```

### Caching Strategy

```python
# Cache configuration
CACHE_CONFIG = {
    'file_content_cache': {
        'max_size': 100,  # Max files to cache
        'ttl': 300,       # Time to live in seconds
    },
    'completion_cache': {
        'max_size': 1000,  # Max completions to cache
        'ttl': 600,        # Time to live in seconds
    },
    'analysis_cache': {
        'max_size': 50,    # Max analysis results to cache
        'ttl': 1800,       # Time to live in seconds
    },
}
```

## Testing and Validation

### Integration Tests

```bash
#!/bin/bash
# /opt/freestyle/claude-code/tests/integration-test.sh

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
```

### Performance Benchmarks

```python
#!/usr/bin/env python3
# /opt/freestyle/claude-code/tests/performance-test.py

import time
import json
import subprocess
import statistics

def benchmark_api_response_time():
    """Benchmark API response time."""
    times = []
    test_request = {
        "id": "benchmark",
        "type": "request",
        "method": "system/info",
        "params": {}
    }

    for _ in range(100):
        start_time = time.time()
        process = subprocess.run(
            ['/opt/freestyle/claude-code/bin/claude-code', '--stdio'],
            input=json.dumps(test_request),
            text=True,
            capture_output=True,
            timeout=5
        )
        end_time = time.time()

        if process.returncode == 0:
            times.append(end_time - start_time)

    return {
        'avg_response_time': statistics.mean(times),
        'median_response_time': statistics.median(times),
        'p95_response_time': statistics.quantiles(times, n=20)[18],
        'max_response_time': max(times),
        'min_response_time': min(times)
    }

if __name__ == "__main__":
    results = benchmark_api_response_time()
    print("Performance Benchmark Results:")
    for key, value in results.items():
        print(f"  {key}: {value:.3f}s")
```

## Error Handling and Recovery

### Error Recovery Scripts

```bash
#!/bin/bash
# /opt/freestyle/claude-code/scripts/recover.sh

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
```

This specification provides comprehensive guidance for integrating Claude Code into the Freestyle VM infrastructure with proper security, monitoring, and performance considerations.
