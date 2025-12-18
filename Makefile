.PHONY: setup
setup: ## Set up the repository with all dependencies and builds
	hack/setup_repo.sh

# CI-specific targets
.PHONY: setup-ci ci-tools

## CI Setup Commands
setup-ci: ci-tools setup ## Complete CI setup including CI-specific tools
	@echo "✅ CI setup complete"

ci-tools: ## Install CI-specific tools
	@echo "Installing CI-specific tools..."
	@command -v claude >/dev/null 2>&1 || npm install -g @anthropic-ai/claude-code
	@command -v golangci-lint >/dev/null 2>&1 || go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest

thoughts:
	humanlayer thoughts init --directory humanlayer

.PHONY: worktree
worktree: ## Create a new worktree for development work (use hack/create_worktree.sh branch_name for specific names)
	hack/create_worktree.sh

check-hlyr:
	@$(MAKE) -C hlyr check VERBOSE=$(VERBOSE)

check-wui:
	@$(MAKE) -C humanlayer-wui check VERBOSE=$(VERBOSE)

check-hld:
	@$(MAKE) -C hld check VERBOSE=$(VERBOSE)

check-claudecode-go:
	@$(MAKE) -C claudecode-go check VERBOSE=$(VERBOSE)

.PHONY: check-header
check-header:
	@sh -n ./hack/run_silent.sh || (echo "❌ Shell script syntax error in hack/run_silent.sh" && exit 1)
	@. ./hack/run_silent.sh && print_main_header "Running Checks"

# Summary removed - tracking doesn't work across sub-makes

.PHONY: check
check: check-header check-hlyr check-wui check-hld check-claudecode-go

.PHONY: test-hlyr
test-hlyr: ## Test hlyr CLI tool
	@$(MAKE) -C hlyr test VERBOSE=$(VERBOSE)

.PHONY: test-hld
test-hld: ## Test hld daemon (unit and integration tests)
	@$(MAKE) -C hld test VERBOSE=$(VERBOSE)

.PHONY: test-hld-integration
test-hld-integration: ## Test hld daemon (including integration tests)
	@$(MAKE) -C hld test

.PHONY: e2e-test
e2e-test: ## Run end-to-end REST API tests
	@$(MAKE) -C hld e2e-test

.PHONY: test-claudecode-go
test-claudecode-go: ## Test claudecode-go
	@$(MAKE) -C claudecode-go test VERBOSE=$(VERBOSE)

.PHONY: test-header
test-header:
	@sh -n ./hack/run_silent.sh || (echo "❌ Shell script syntax error in hack/run_silent.sh" && exit 1)
	@. ./hack/run_silent.sh && print_main_header "Running Tests"

.PHONY: clean-wui-release
clean-wui-release: ## clean WUI release
	rm -rf humanlayer-wui/src-tauri/target/release/

.PHONY: test-wui
test-wui: ## Test humanlayer-wui
	@$(MAKE) -C humanlayer-wui test VERBOSE=$(VERBOSE)

.PHONY: test
test: test-header test-hlyr test-wui test-hld test-claudecode-go

.PHONY: check-test
check-test: ## Run all checks and tests
	@$(MAKE) check
	@$(MAKE) test

.PHONY: check-verbose
check-verbose: ## Run checks with verbose output
	@VERBOSE=1 $(MAKE) check

.PHONY: test-verbose
test-verbose: ## Run tests with verbose output
	@VERBOSE=1 $(MAKE) test

.PHONY: generate-sdks
generate-sdks: ## Regenerate all SDKs from OpenAPI specs
	@echo "Regenerating TypeScript SDK from OpenAPI spec..."
	@$(MAKE) -C hld generate-sdks
	@echo "Updating SDK in humanlayer-wui..."
	@$(MAKE) -C humanlayer-wui install
	@echo "SDK regeneration complete!"

.PHONY: help
help:
	grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help

.PHONY: githooks
githooks:
	:
	: 🚀 Installing pre-push hook
	:
	echo 'make check test' > .git/hooks/pre-push
	chmod +x .git/hooks/pre-push

.PHONY: check-local
check-local:
	@if [[ $$(git rev-parse --abbrev-ref HEAD) == local/* ]]; then \
		echo "blocking push of local branch"; \
		exit 1; \
	fi

logfileprefix = $(shell date +%Y-%m-%d-%H-%M-%S)

.PHONY: wui
wui: wui-dev

.PHONY: daemon
daemon: daemon-dev

# Build nightly daemon binary
.PHONY: daemon-nightly-build
daemon-nightly-build:
	cd hld && go build -ldflags "\
		-X github.com/humanlayer/humanlayer/hld/config.DefaultCLICommand=humanlayer-nightly" \
		-o hld-nightly ./cmd/hld
	@echo "Built nightly daemon binary: hld/hld-nightly"

# Run nightly daemon
.PHONY: daemon-nightly
daemon-nightly: daemon-nightly-build
	@mkdir -p ~/.humanlayer/logs
	$(eval TIMESTAMP := $(shell date +%Y-%m-%d-%H-%M-%S))
	echo "$(TIMESTAMP) starting nightly daemon in $$(pwd)" > ~/.humanlayer/logs/daemon-nightly-$(TIMESTAMP).log
	cd hld && ./run-with-logging.sh ~/.humanlayer/logs/daemon-nightly-$(TIMESTAMP).log ./hld-nightly

# Build and install nightly WUI
.PHONY: wui-nightly-build
wui-nightly-build:
	cd humanlayer-wui && bun run tauri build --bundles app
	@echo "Build complete. Installing to ~/Applications..."
	cp -r humanlayer-wui/src-tauri/target/release/bundle/macos/CodeLayer.app ~/Applications/
	@echo "Installed WUI nightly to ~/Applications/CodeLayer.app"

# Build humanlayer binary for bundling
.PHONY: humanlayer-build
humanlayer-build:
	@echo "Building humanlayer CLI binary..."
	cd hlyr && bun install && bun run build
	@echo "humanlayer binary built at hlyr/dist/index.js"

# Build humanlayer standalone binary (requires bun)
.PHONY: humanlayer-binary-darwin-arm64
humanlayer-binary-darwin-arm64: humanlayer-build
	@echo "Creating standalone humanlayer binary for macOS ARM64..."
	cd hlyr && bun build ./dist/index.js --compile --target=bun-darwin-arm64 --outfile=humanlayer-darwin-arm64
	chmod +x hlyr/humanlayer-darwin-arm64
	@echo "Standalone binary created at hlyr/humanlayer-darwin-arm64"

# Build humanlayer standalone binary for Linux x86_64 (requires bun)
.PHONY: humanlayer-binary-linux-x64
humanlayer-binary-linux-x64: humanlayer-build
	@echo "Creating standalone humanlayer binary for Linux x86_64..."
	cd hlyr && bun build ./dist/index.js --compile --target=bun-linux-x64 --outfile=humanlayer-linux-x64
	chmod +x hlyr/humanlayer-linux-x64
	@echo "Standalone binary created at hlyr/humanlayer-linux-x64"

# Build CodeLayer with bundled daemon and humanlayer
.PHONY: codelayer-bundle
codelayer-bundle:
	@echo "Building daemon for bundling..."
	cd hld && GOOS=darwin GOARCH=arm64 go build -o hld-darwin-arm64 ./cmd/hld
	@echo "Building humanlayer for bundling..."
	cd hlyr && bun install && bun run build
	cd hlyr && bun build ./dist/index.js --compile --target=bun-darwin-arm64 --outfile=humanlayer-darwin-arm64

# Build CodeLayer for Linux with bundled daemon and humanlayer
.PHONY: codelayer-bundle-linux
codelayer-bundle-linux:
	@echo "Building daemon for Linux bundling..."
	cd hld && GOOS=linux GOARCH=amd64 go build -o hld-linux-x64 ./cmd/hld
	@echo "Building humanlayer for Linux bundling..."
	cd hlyr && bun install && bun run build
	cd hlyr && bun build ./dist/index.js --compile --target=bun-linux-x64 --outfile=humanlayer-linux-x64

codelayer-nightly-bundle:
	@echo "Setting build version..."
	$(eval BUILD_VERSION := $(shell date +%Y%m%d)-nightly-local)
	@echo "Building nightly daemon for bundling (version: $(BUILD_VERSION))..."
	cd hld && GOOS=darwin GOARCH=arm64 go build -ldflags "\
		-X github.com/humanlayer/humanlayer/hld/internal/version.BuildVersion=$(BUILD_VERSION) \
		-X github.com/humanlayer/humanlayer/hld/config.DefaultDatabasePath=~/.humanlayer/daemon-nightly.db \
		-X github.com/humanlayer/humanlayer/hld/config.DefaultSocketPath=~/.humanlayer/daemon-nightly.sock \
		-X github.com/humanlayer/humanlayer/hld/config.DefaultHTTPPort=7778 \
		-X github.com/humanlayer/humanlayer/hld/config.DefaultCLICommand=humanlayer-nightly" \
		-o hld-darwin-arm64 ./cmd/hld
	@echo "Building humanlayer CLI for bundling..."
	cd hlyr && bun install && bun run build
	cd hlyr && bun build ./dist/index.js --compile --target=bun-darwin-arm64 --outfile=humanlayer-darwin-arm64
	chmod +x hlyr/humanlayer-darwin-arm64
	@echo "Copying binaries to Tauri resources..."
	mkdir -p humanlayer-wui/src-tauri/bin
	cp hld/hld-darwin-arm64 humanlayer-wui/src-tauri/bin/hld
	cp hlyr/humanlayer-darwin-arm64 humanlayer-wui/src-tauri/bin/humanlayer
	chmod +x humanlayer-wui/src-tauri/bin/hld
	chmod +x humanlayer-wui/src-tauri/bin/humanlayer
	@echo "Installing WUI dependencies..."
	cd humanlayer-wui && bun install
	@echo "Backing up original icons and using nightly icons..."
	@# Clean up any leftover backup directories first
	cd humanlayer-wui/src-tauri && rm -rf icons-original icons-backup
	cd humanlayer-wui/src-tauri && cp -r icons icons-original && rm -rf icons && cp -r icons-nightly icons
	@echo "Building Tauri app with nightly config (with ad-hoc signing)..."
	@# Use trap to ensure icons are restored even if build fails
	cd humanlayer-wui && ( \
		APPLE_SIGNING_IDENTITY="-" NO_STRIP=1 bun run tauri build --config src-tauri/tauri.nightly.conf.json; \
		EXIT_CODE=$$?; \
		echo "Restoring original icons..."; \
		cd src-tauri && rm -rf icons && cp -r icons-original icons && rm -rf icons-original; \
		exit $$EXIT_CODE \
	)
	@echo "Nightly build complete! DMG available at:"
	@ls -la humanlayer-wui/src-tauri/target/release/bundle/dmg/*.dmg

# Build CodeLayer nightly for Linux
.PHONY: codelayer-nightly-bundle-linux
codelayer-nightly-bundle-linux:
	@echo "Setting build version..."
	$(eval BUILD_VERSION := $(shell date +%Y%m%d)-nightly-local)
	@echo "Building nightly daemon for Linux bundling (version: $(BUILD_VERSION))..."
	cd hld && GOOS=linux GOARCH=amd64 go build -ldflags "\
		-X github.com/humanlayer/humanlayer/hld/internal/version.BuildVersion=$(BUILD_VERSION) \
		-X github.com/humanlayer/humanlayer/hld/config.DefaultDatabasePath=~/.humanlayer/daemon-nightly.db \
		-X github.com/humanlayer/humanlayer/hld/config.DefaultSocketPath=~/.humanlayer/daemon-nightly.sock \
		-X github.com/humanlayer/humanlayer/hld/config.DefaultHTTPPort=7778 \
		-X github.com/humanlayer/humanlayer/hld/config.DefaultCLICommand=humanlayer-nightly" \
		-o hld-linux-x64 ./cmd/hld
	@echo "Building humanlayer CLI for Linux bundling..."
	cd hlyr && bun install && bun run build
	cd hlyr && bun build ./dist/index.js --compile --target=bun-linux-x64 --outfile=humanlayer-linux-x64
	chmod +x hlyr/humanlayer-linux-x64
	@echo "Copying binaries to Tauri resources..."
	mkdir -p humanlayer-wui/src-tauri/bin
	cp hld/hld-linux-x64 humanlayer-wui/src-tauri/bin/hld
	cp hlyr/humanlayer-linux-x64 humanlayer-wui/src-tauri/bin/humanlayer
	chmod +x humanlayer-wui/src-tauri/bin/hld
	chmod +x humanlayer-wui/src-tauri/bin/humanlayer
	@echo "Installing WUI dependencies..."
	cd humanlayer-wui && bun install
	@echo "Backing up original icons and using nightly icons..."
	@# Clean up any leftover backup directories first
	cd humanlayer-wui/src-tauri && rm -rf icons-original icons-backup
	cd humanlayer-wui/src-tauri && cp -r icons icons-original && rm -rf icons && cp -r icons-nightly icons
	@echo "Building Tauri app for Linux with nightly config..."
	@# Use trap to ensure icons are restored even if build fails
	cd humanlayer-wui && ( \
		bun run tauri build --config src-tauri/tauri.nightly.conf.json --bundles appimage,deb; \
		EXIT_CODE=$$?; \
		echo "Restoring original icons..."; \
		cd src-tauri && rm -rf icons && cp -r icons-original icons && rm -rf icons-original; \
		exit $$EXIT_CODE \
	)
	@echo "Linux nightly build complete! Packages available at:"
	@ls -la humanlayer-wui/src-tauri/target/release/bundle/appimage/ 2>/dev/null || true
	@ls -la humanlayer-wui/src-tauri/target/release/bundle/deb/ 2>/dev/null || true


# Open nightly WUI
.PHONY: wui-nightly
wui-nightly: wui-nightly-build
	@echo "Opening WUI nightly..."
	open ~/Applications/CodeLayer.app

# Copy production database to timestamped dev database
.PHONY: copy-db-to-dev
copy-db-to-dev:
	@mkdir -p ~/.humanlayer/dev
	$(eval TIMESTAMP := $(shell date +%Y-%m-%d-%H-%M-%S))
	$(eval DEV_DB := ~/.humanlayer/dev/daemon-$(TIMESTAMP).db)
	@if [ -f ~/.humanlayer/daemon.db ]; then \
		cp ~/.humanlayer/daemon.db $(DEV_DB); \
		echo "Copied production database to: $(DEV_DB)" >&2; \
		echo "$(DEV_DB)"; \
	else \
		echo "Error: Production database not found at ~/.humanlayer/daemon.db" >&2; \
		exit 1; \
	fi

# Clone nightly database to dev database (with backup)
.PHONY: clone-nightly-db-to-dev-db
clone-nightly-db-to-dev-db:
	@mkdir -p ~/.humanlayer/dev
	$(eval TIMESTAMP := $(shell date +%Y-%m-%d-%H-%M-%S))
	@# Backup existing dev database if it exists
	@if [ -f ~/.humanlayer/daemon-dev.db ]; then \
		echo "Backing up existing dev database..."; \
		cp ~/.humanlayer/daemon-dev.db ~/.humanlayer/dev/daemon-dev-backup-$(TIMESTAMP).db; \
		echo "Backed up to: ~/.humanlayer/dev/daemon-dev-backup-$(TIMESTAMP).db"; \
	fi
	@# Copy nightly database to dev
	@if [ -f ~/.humanlayer/daemon.db ]; then \
		cp ~/.humanlayer/daemon.db ~/.humanlayer/daemon-dev.db; \
		echo "Cloned nightly database to: ~/.humanlayer/daemon-dev.db"; \
	else \
		echo "Error: Nightly database not found at ~/.humanlayer/daemon.db"; \
		exit 1; \
	fi

# Clean up dev databases and logs older than 10 days
.PHONY: cleanup-dev
cleanup-dev:
	@echo "Cleaning up dev artifacts older than 10 days..."
	@# Clean old dev databases
	@if [ -d ~/.humanlayer/dev ]; then \
		find ~/.humanlayer/dev -name "daemon-*.db" -type f -mtime +10 -delete -print | sed 's/^/Deleted database: /'; \
	fi
	@# Clean old dev logs
	@if [ -d ~/.humanlayer/logs ]; then \
		find ~/.humanlayer/logs -name "*-dev-*.log" -type f -mtime +10 -delete -print | sed 's/^/Deleted log: /'; \
	fi
	@echo "Cleanup complete."

# Build dev daemon binary
.PHONY: daemon-dev-build
daemon-dev-build: setup
	cd hld && go build -ldflags "\
		-X github.com/humanlayer/humanlayer/hld/config.DefaultCLICommand=$(PWD)/hlyr/dist/index.js" \
		-o hld-dev ./cmd/hld
	@echo "Built dev daemon binary: hld/hld-dev"

# Launch daemon with ticket-based configuration
.PHONY: daemon-ticket
daemon-ticket: daemon-dev-build
	@if [ -z "$(TICKET)" ]; then \
		echo "Error: TICKET parameter required"; \
		echo "Usage: make daemon-ticket TICKET=ENG-2114"; \
		exit 1; \
	fi && \
	if [ -z "$(PORT)" ]; then \
		source hack/port-utils.sh && \
		ticket_num=$$(extract_ticket_number "$(TICKET)") && \
		port=$$(find_available_port "$$ticket_num"); \
	else \
		port="$(PORT)"; \
	fi && \
	echo "Starting daemon for $(TICKET) on port $$port" && \
	HUMANLAYER_DATABASE_PATH=~/.humanlayer/daemon-$(TICKET).db \
	HUMANLAYER_DAEMON_SOCKET=~/.humanlayer/daemon-$$port.sock \
	HUMANLAYER_DAEMON_HTTP_PORT=$$port \
	HUMANLAYER_DAEMON_VERSION_OVERRIDE="$(TICKET)-$$(git branch --show-current)" \
	./hld/hld-dev

# Launch WUI with ticket-based configuration
.PHONY: wui-ticket
wui-ticket:
	@if [ -z "$(TICKET)" ]; then \
		echo "Error: TICKET parameter required"; \
		echo "Usage: make wui-ticket TICKET=ENG-2114"; \
		exit 1; \
	fi && \
	if [ -z "$(PORT)" ] || [ -z "$(VITE_PORT)" ]; then \
		source hack/port-utils.sh && \
		ticket_num=$$(extract_ticket_number "$(TICKET)") && \
		port=$$(find_available_port "$$ticket_num") && \
		vite_port=$$(find_available_vite_port "$$ticket_num" "$$port"); \
	else \
		port="$(PORT)" && \
		vite_port="$(VITE_PORT)"; \
	fi && \
	echo "Starting WUI for $(TICKET) connecting to daemon port $$port, Vite port $$vite_port" && \
	$(if $(POSTHOG),echo "PostHog analytics enabled (nightly key)",:) && \
	echo "{\"build\":{\"devUrl\":\"http://localhost:$$vite_port\"}}" > /tmp/tauri-config-$(TICKET).json && \
	cd humanlayer-wui && \
	$(if $(POSTHOG),VITE_PUBLIC_POSTHOG_KEY=phc_de6RVF0G7CkTzv2UvxHddSk7nfFnE5QWD7KmZV5KfSo \
	VITE_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com,) \
	HUMANLAYER_WUI_AUTOLAUNCH_DAEMON=false \
	HUMANLAYER_DAEMON_SOCKET=~/.humanlayer/daemon-$$port.sock \
	VITE_HUMANLAYER_DAEMON_URL=http://localhost:$$port \
	VITE_PORT=$$vite_port \
	bun run tauri dev --config /tmp/tauri-config-$(TICKET).json

# Run dev daemon with persistent dev database
.PHONY: daemon-dev
daemon-dev: daemon-dev-build
	@mkdir -p ~/.humanlayer/logs
	$(eval TIMESTAMP := $(shell date +%Y-%m-%d-%H-%M-%S))
	@echo "Starting dev daemon with database: ~/.humanlayer/daemon-dev.db"
	echo "$(TIMESTAMP) starting dev daemon in $$(pwd)" > ~/.humanlayer/logs/daemon-dev-$(TIMESTAMP).log
	cd hld && HUMANLAYER_DATABASE_PATH=~/.humanlayer/daemon-dev.db \
		HUMANLAYER_DAEMON_SOCKET=~/.humanlayer/daemon-dev.sock \
		HUMANLAYER_DAEMON_HTTP_PORT=0 \
		HUMANLAYER_DAEMON_VERSION_OVERRIDE=$$(git branch --show-current) \
		./run-with-logging.sh ~/.humanlayer/logs/daemon-dev-$(TIMESTAMP).log ./hld-dev

# Run dev WUI with custom socket
.PHONY: wui-dev
wui-dev: ## Run CodeLayer (WUI) in development mode. Use POSTHOG=true to enable analytics debugging.
ifdef POSTHOG
	@echo "Running CodeLayer with PostHog analytics enabled (nightly key)"
	cd humanlayer-wui && \
		VITE_PUBLIC_POSTHOG_KEY=phc_de6RVF0G7CkTzv2UvxHddSk7nfFnE5QWD7KmZV5KfSo \
		VITE_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com \
		HUMANLAYER_DAEMON_SOCKET=~/.humanlayer/daemon-dev.sock \
		bun run tauri dev
else
	cd humanlayer-wui && HUMANLAYER_DAEMON_SOCKET=~/.humanlayer/daemon-dev.sock bun run tauri dev
endif

# Run Storybook for WUI component development
.PHONY: storybook
storybook: ## Run Storybook for WUI component documentation
	cd humanlayer-wui && bun run storybook

# Alias for wui-dev that ensures daemon is built first
.PHONY: codelayer-dev
codelayer-dev: daemon-dev-build ## Run CodeLayer in development mode. Use POSTHOG=true to enable analytics debugging.
	@if [ -n "$(TICKET)" ]; then \
		source hack/port-utils.sh && \
		ticket_num=$$(extract_ticket_number "$(TICKET)") && \
		port=$$(find_available_port "$$ticket_num") && \
		vite_port=$$(find_available_vite_port "$$ticket_num" "$$port") && \
		echo "==========================================" && \
		echo "Starting instances for ticket: $(TICKET)" && \
		echo "Daemon Port: $$port" && \
		echo "Vite Port: $$vite_port" && \
		echo "Socket: ~/.humanlayer/daemon-$$port.sock" && \
		echo "Database: ~/.humanlayer/daemon-$(TICKET).db" && \
		echo "==========================================" && \
		$(MAKE) daemon-ticket TICKET=$(TICKET) PORT=$$port & \
		daemon_pid=$$! && \
		sleep 2 && \
		$(MAKE) wui-ticket TICKET=$(TICKET) PORT=$$port VITE_PORT=$$vite_port POSTHOG=$(POSTHOG) & \
		wui_pid=$$! && \
		echo "Started daemon PID: $$daemon_pid" && \
		echo "Started WUI PID: $$wui_pid" && \
		wait $$wui_pid && \
		kill $$daemon_pid 2>/dev/null; \
	else \
		echo "==========================================" && \
		echo "Starting default dev environment" && \
		echo "WUI will auto-launch and manage daemon" && \
		echo "Socket: ~/.humanlayer/daemon-dev.sock" && \
		echo "Database: ~/.humanlayer/daemon-dev.db" && \
		echo "(use TICKET=ENG-XXXX for isolated instance)" && \
		echo "==========================================" && \
		$(MAKE) wui-dev POSTHOG=$(POSTHOG); \
	fi

# Test port allocation for a ticket
.PHONY: test-port-allocation
test-port-allocation:
	@source hack/port-utils.sh && \
	if [ -z "$(TICKET)" ]; then \
		echo "Usage: make test-port-allocation TICKET=ENG-2114"; \
		exit 1; \
	fi && \
	ticket_num=$$(extract_ticket_number "$(TICKET)") && \
	port=$$(find_available_port "$$ticket_num") && \
	echo "Ticket: $(TICKET)" && \
	echo "Extracted number: $$ticket_num" && \
	echo "Available port: $$port"

# Show current dev environment setup
.PHONY: dev-status
dev-status:
	@echo "=== Development Environment Status ==="
	@echo "Dev Socket: ~/.humanlayer/daemon-dev.sock"
	@echo "Nightly Socket: ~/.humanlayer/daemon.sock"
	@echo ""
	@echo "Dev Databases:"
	@ls -la ~/.humanlayer/dev/*.db 2>/dev/null || echo "  No dev databases found"
	@echo ""
	@echo "Active daemons:"
	@ps aux | grep -E "hld(-dev|-nightly)?$$" | grep -v grep || echo "  No daemons running"
