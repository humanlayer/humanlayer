# VM Infrastructure Makefile
# Freestyle Cloud Development Environment

.PHONY: all build deploy test clean help
.DEFAULT_GOAL := help

# Configuration
VM_NAME := freestyle-dev
BASE_IMAGE := ubuntu-22.04-freestyle
DOCKER_REGISTRY := registry.freestyle.dev
VERSION := $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")

# Directories
SCRIPT_DIR := scripts
CONFIG_DIR := config
SYSTEMD_DIR := systemd
MONITOR_DIR := monitoring
TEST_DIR := tests
DOCS_DIR := docs

# Build targets
all: build deploy test ## Build, deploy, and test everything

## Build Commands
build: build-base-image ## Build all components

build-base-image: ## Build VM base image
	@echo "Building base image $(BASE_IMAGE):$(VERSION)..."
	@sudo $(SCRIPT_DIR)/build-base-image.sh $(BASE_IMAGE) $(VERSION)

build-docker-images: ## Build Docker images for services
	@echo "Building Docker images..."
	@docker build -t $(DOCKER_REGISTRY)/claude-code:$(VERSION) -f docker/claude-code/Dockerfile .
	@docker build -t $(DOCKER_REGISTRY)/hl-daemon:$(VERSION) -f docker/hl-daemon/Dockerfile .

## Installation Commands
install: install-dependencies install-services ## Install all components

install-dependencies: ## Install system dependencies
	@echo "Installing system dependencies..."
	@sudo apt-get update
	@sudo apt-get install -y \
		curl wget git vim htop tmux \
		python3 python3-pip python3-venv \
		nodejs npm \
		docker.io docker-compose \
		jq unzip ca-certificates gnupg \
		ufw fail2ban unattended-upgrades

install-services: ## Install and configure services
	@echo "Installing services..."
	@sudo $(SCRIPT_DIR)/install-claude-code.sh
	@sudo $(SCRIPT_DIR)/install-hl-daemon.sh
	@sudo $(SCRIPT_DIR)/configure-system.sh

## Deployment Commands
deploy: deploy-vm deploy-services ## Deploy complete infrastructure

deploy-vm: ## Deploy VM instance
	@echo "Deploying VM $(VM_NAME)..."
	@$(SCRIPT_DIR)/deploy-vm.sh $(VM_NAME) $(BASE_IMAGE) $(VERSION)

deploy-services: install-services enable-services ## Deploy and start services
	@echo "Deploying services..."
	@sudo systemctl daemon-reload

enable-services: ## Enable SystemD services
	@echo "Enabling services..."
	@sudo systemctl enable claude-code.service
	@sudo systemctl enable hl-daemon.service
	@sudo systemctl enable vm-monitor.service
	@sudo systemctl enable vm-health.timer

## Service Management
start: ## Start all services
	@echo "Starting services..."
	@sudo systemctl start claude-code
	@sudo systemctl start hl-daemon
	@sudo systemctl start vm-monitor
	@sudo systemctl start vm-health.timer

stop: ## Stop all services
	@echo "Stopping services..."
	@sudo systemctl stop claude-code
	@sudo systemctl stop hl-daemon
	@sudo systemctl stop vm-monitor
	@sudo systemctl stop vm-health.timer

restart: stop start ## Restart all services

status: ## Check service status
	@echo "Service Status:"
	@sudo systemctl status claude-code --no-pager -l
	@sudo systemctl status hl-daemon --no-pager -l
	@sudo systemctl status vm-monitor --no-pager -l

logs: ## View service logs
	@echo "Recent service logs:"
	@sudo journalctl -u claude-code -n 50 --no-pager
	@sudo journalctl -u hl-daemon -n 50 --no-pager
	@sudo journalctl -u vm-monitor -n 50 --no-pager

logs-follow: ## Follow service logs in real-time
	@sudo journalctl -u claude-code -u hl-daemon -u vm-monitor -f

## Testing Commands
test: test-unit test-integration ## Run all tests

test-unit: ## Run unit tests
	@echo "Running unit tests..."
	@cd $(TEST_DIR)/unit && python3 -m pytest -v

test-integration: ## Run integration tests
	@echo "Running integration tests..."
	@$(TEST_DIR)/integration/run-all-tests.sh

test-performance: ## Run performance tests
	@echo "Running performance tests..."
	@cd $(TEST_DIR)/performance && python3 benchmark.py

test-claude-code: ## Test Claude Code integration
	@echo "Testing Claude Code..."
	@$(TEST_DIR)/integration/test-claude-code.sh

test-hl-daemon: ## Test HumanLayer daemon
	@echo "Testing HumanLayer daemon..."
	@$(TEST_DIR)/integration/test-hl-daemon.sh

test-vm-health: ## Test VM health monitoring
	@echo "Testing VM health monitoring..."
	@$(TEST_DIR)/integration/test-health-monitoring.sh

test-load: ## Run load tests
	@echo "Running load tests..."
	@$(TEST_DIR)/performance/load-test.sh

## Monitoring Commands
monitor: ## Show real-time system monitoring
	@echo "Starting system monitor..."
	@$(MONITOR_DIR)/resource-monitor.sh --interactive

health-check: ## Run comprehensive health check
	@echo "Running health check..."
	@$(MONITOR_DIR)/health-check.sh

monitor-resources: ## Monitor resource usage
	@echo "Resource usage:"
	@$(MONITOR_DIR)/resource-monitor.sh --once

check-logs: ## Check for errors in logs
	@echo "Checking logs for errors..."
	@$(MONITOR_DIR)/log-monitor.sh --check-errors

## Configuration Commands
validate-config: ## Validate all configuration files
	@echo "Validating configuration..."
	@$(SCRIPT_DIR)/validate-config.sh

update-config: ## Update configuration from templates
	@echo "Updating configuration..."
	@$(SCRIPT_DIR)/update-config.sh

backup-config: ## Backup current configuration
	@echo "Backing up configuration..."
	@tar -czf config-backup-$(shell date +%Y%m%d-%H%M%S).tar.gz $(CONFIG_DIR)

## Network Commands
check-network: ## Check network connectivity
	@echo "Checking network..."
	@ping -c 3 8.8.8.8
	@curl -s https://api.anthropic.com/v1/health || echo "API unreachable"

configure-firewall: ## Configure firewall rules
	@echo "Configuring firewall..."
	@sudo ufw --force reset
	@sudo ufw default deny incoming
	@sudo ufw default allow outgoing
	@sudo ufw allow 22/tcp
	@sudo ufw allow 3000:3999/tcp
	@sudo ufw allow 8080/tcp
	@sudo ufw --force enable

## Maintenance Commands
update: update-system update-services ## Update system and services

update-system: ## Update system packages
	@echo "Updating system packages..."
	@sudo apt-get update
	@sudo apt-get upgrade -y
	@sudo apt-get autoremove -y

update-services: ## Update service configurations
	@echo "Updating services..."
	@$(SCRIPT_DIR)/update-services.sh

cleanup: cleanup-logs cleanup-cache cleanup-temp ## Clean up system

cleanup-logs: ## Clean up old log files
	@echo "Cleaning up logs..."
	@sudo find /var/log -name "*.log" -mtime +7 -delete
	@sudo find /opt/freestyle/*/logs -name "*.log" -mtime +7 -delete

cleanup-cache: ## Clean up cache files
	@echo "Cleaning up cache..."
	@sudo find /tmp -type f -atime +1 -delete
	@sudo find /var/tmp -type f -atime +1 -delete
	@sudo rm -rf /opt/freestyle/*/cache/*

cleanup-temp: ## Clean up temporary files
	@echo "Cleaning up temporary files..."
	@sudo find /tmp -name "freestyle-*" -mtime +1 -delete

## Backup and Recovery
backup: ## Create full system backup
	@echo "Creating backup..."
	@$(SCRIPT_DIR)/backup.sh

restore: ## Restore from backup (specify BACKUP_FILE)
	@echo "Restoring from backup..."
	@$(SCRIPT_DIR)/restore.sh $(BACKUP_FILE)

test-backup: ## Test backup integrity
	@echo "Testing backup..."
	@$(SCRIPT_DIR)/test-backup.sh

## Development Commands
dev-setup: ## Set up development environment
	@echo "Setting up development environment..."
	@python3 -m venv venv
	@./venv/bin/pip install -r requirements-dev.txt
	@npm install

dev-run: ## Run in development mode
	@echo "Starting development mode..."
	@./venv/bin/python3 dev-server.py

dev-test: ## Run development tests
	@echo "Running development tests..."
	@./venv/bin/python3 -m pytest tests/ -v

dev-lint: ## Run code linting
	@echo "Running linters..."
	@./venv/bin/flake8 .
	@./venv/bin/black --check .
	@shellcheck scripts/*.sh

dev-format: ## Format code
	@echo "Formatting code..."
	@./venv/bin/black .
	@shfmt -w scripts/*.sh

## Security Commands
security-scan: ## Run security scan
	@echo "Running security scan..."
	@$(SCRIPT_DIR)/security-scan.sh

security-hardening: ## Apply security hardening
	@echo "Applying security hardening..."
	@$(SCRIPT_DIR)/security-hardening.sh

check-permissions: ## Check file permissions
	@echo "Checking file permissions..."
	@$(SCRIPT_DIR)/check-permissions.sh

## Utility Commands
collect-logs: ## Collect logs for support
	@echo "Collecting logs..."
	@mkdir -p support-bundle
	@sudo journalctl --since="24 hours ago" > support-bundle/system-logs.txt
	@sudo cp -r /var/log/freestyle support-bundle/
	@sudo cp -r /opt/freestyle/*/logs support-bundle/
	@tar -czf support-bundle-$(shell date +%Y%m%d-%H%M%S).tar.gz support-bundle/
	@rm -rf support-bundle/
	@echo "Support bundle created"

version: ## Show version information
	@echo "Version: $(VERSION)"
	@echo "Base Image: $(BASE_IMAGE)"
	@echo "VM Name: $(VM_NAME)"

info: ## Show system information
	@echo "System Information:"
	@echo "  OS: $(shell lsb_release -d -s)"
	@echo "  Kernel: $(shell uname -r)"
	@echo "  Architecture: $(shell uname -m)"
	@echo "  Memory: $(shell free -h | grep ^Mem | awk '{print $$2}')"
	@echo "  CPU: $(shell nproc) cores"
	@echo "  Disk: $(shell df -h / | tail -1 | awk '{print $$2}')"

clean: ## Clean build artifacts and temporary files
	@echo "Cleaning up..."
	@rm -rf build/ dist/ *.egg-info/
	@find . -type f -name "*.pyc" -delete
	@find . -type d -name "__pycache__" -delete
	@docker system prune -f

## Help
help: ## Show this help message
	@echo "Freestyle VM Infrastructure - Available Commands:"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "Examples:"
	@echo "  make build          # Build base image"
	@echo "  make deploy         # Deploy complete infrastructure"
	@echo "  make test           # Run all tests"
	@echo "  make start          # Start all services"
	@echo "  make monitor        # Monitor system in real-time"
	@echo "  make backup         # Create system backup"
	@echo ""
	@echo "For detailed documentation, see: docs/"

# Check if running as root (some commands require it)
check-root:
	@if [ "$$(id -u)" != "0" ]; then \
		echo "This command requires root privileges. Use sudo."; \
		exit 1; \
	fi

# Ensure directories exist
ensure-dirs:
	@mkdir -p build logs tmp

# Variables that can be overridden
VERBOSE ?= 0
ifeq ($(VERBOSE), 1)
	Q =
else
	Q = @
endif

# Include environment-specific configuration if it exists
-include local.mk
