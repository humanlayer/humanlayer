.PHONY: build test test-unit test-unit-race test-unit-quiet test-unit-race-quiet test-integration test-integration-race test-integration-quiet test-integration-race-quiet test-quiet clean mocks generate check fmt vet lint

# Build the daemon binary
build:
	@if [ -n "$$VERBOSE" ]; then \
		go build -o hld ./cmd/hld; \
	else \
		. ../hack/run_silent.sh && run_silent "Building hld daemon..." "go build -o hld ./cmd/hld"; \
	fi

# Run all tests
test:
	@if [ -n "$$VERBOSE" ]; then \
		$(MAKE) test-unit test-unit-race test-integration test-integration-race; \
	else \
		$(MAKE) test-quiet; \
	fi

# Run all tests with quiet output
test-quiet:
	@. ../hack/run_silent.sh && print_header "hld" "Daemon tests"
	@$(MAKE) test-unit-quiet
	@$(MAKE) test-unit-race-quiet
	@$(MAKE) test-integration-quiet
	@$(MAKE) test-integration-race-quiet

# Base test-unit target overridden below

# Run integration tests (requires build tag)
test-integration: build
	@if [ -n "$$VERBOSE" ]; then \
		CGO_LDFLAGS="-Wl,-w" go test -v -tags=integration -run Integration ./daemon/...; \
	else \
		$(MAKE) test-integration-quiet; \
	fi

# Run integration tests with quiet output
test-integration-quiet: build
	@. ../hack/run_silent.sh && run_silent_with_test_count "Integration tests passed" "CGO_LDFLAGS=\"-Wl,-w\" go test -json -tags=integration -run Integration ./daemon/..." "go"

# Run integration tests with race detection
test-integration-race:
	@if [ -n "$$VERBOSE" ]; then \
		CGO_LDFLAGS="-Wl,-w" go test -v -race -tags=integration -run Integration ./daemon/...; \
	else \
		$(MAKE) test-integration-race-quiet; \
	fi

# Run integration tests with race detection and quiet output
test-integration-race-quiet: build
	@. ../hack/run_silent.sh && run_silent_with_test_count "Integration tests with race detection passed" "CGO_LDFLAGS=\"-Wl,-w\" go test -json -race -tags=integration -run Integration ./daemon/..." "go"

# Run unit tests with race detection
test-unit-race:
	@if [ -n "$$VERBOSE" ]; then \
		CGO_LDFLAGS="-Wl,-w" go test -v -race ./...; \
	else \
		$(MAKE) test-unit-race-quiet; \
	fi

# Clean build artifacts
clean:
	rm -f hld
	rm -f ~/.humanlayer/daemon.sock

# Run the daemon (for development)
run: build
	./hld

# Check if daemon is running
status:
	@if [ -S ~/.humanlayer/daemon.sock ]; then \
		echo "Daemon socket exists at ~/.humanlayer/daemon.sock"; \
		if nc -zU ~/.humanlayer/daemon.sock 2>/dev/null; then \
			echo "Daemon is running and accepting connections"; \
		else \
			echo "Socket exists but daemon not responding"; \
		fi \
	else \
		echo "Daemon is not running"; \
	fi

# E2E test targets
.PHONY: e2e-test e2e-test-verbose e2e-test-manual

# Run REST API e2e tests
e2e-test: build
	@if [ -n "$$VERBOSE" ]; then \
		$(MAKE) -C ../hlyr build && \
		cd sdk/typescript && bun install && bun run build && \
		cd ../e2e && bun install && bun run test:e2e:verbose; \
	else \
		$(MAKE) e2e-test-quiet; \
	fi

# Run e2e tests with quiet output
e2e-test-quiet:
	@. ../hack/run_silent.sh && run_silent "Building hlyr MCP server..." "$(MAKE) -s -C ../hlyr build"
	@. ../hack/run_silent.sh && run_silent "Building TypeScript SDK..." "cd sdk/typescript && bun install --silent && bun run build"
	@. ../hack/run_silent.sh && run_silent "Installing test dependencies..." "cd e2e && bun install --silent"
	@cd e2e && bun run test:e2e

# Run with verbose output
e2e-test-verbose: build
	@$(MAKE) -C ../hlyr build
	@cd sdk/typescript && bun install && bun run build
	@cd e2e && bun install && bun run test:e2e:verbose

# Run with manual approval mode
e2e-test-manual: build
	@. ../hack/run_silent.sh && run_silent "Building hlyr MCP server..." "$(MAKE) -s -C ../hlyr build"
	@. ../hack/run_silent.sh && run_silent "Building TypeScript SDK..." "cd sdk/typescript && bun install --silent && bun run build"
	@. ../hack/run_silent.sh && run_silent "Installing test dependencies..." "cd e2e && bun install --silent"
	@cd e2e && bun run test:e2e:manual

# Run specific test phase
e2e-test-phase: build
	@cd sdk/typescript && bun install && bun run build
	@cd e2e && bun install && bun run test-rest-api.ts --phase=$(PHASE)

# Generate mocks
mocks:
	mockgen -source=session/types.go -destination=session/mock_session.go -package=session SessionManager
	mockgen -source=approval/types.go -destination=approval/mock_approval.go -package=approval Manager
	mockgen -source=client/types.go -destination=client/mock_client.go -package=client Client,Factory
	mockgen -source=bus/types.go -destination=bus/mock_bus.go -package=bus EventBus
	mockgen -source=store/store.go -destination=store/mock_store.go -package=store ConversationStore

# Generate server code from OpenAPI spec
generate:
	@echo "Generating server code from OpenAPI spec..."
	@cd api && go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@latest \
		-config config.yaml \
		openapi.yaml
	@echo "Code generation complete"

# Format code
fmt:
	go fmt ./...

# Vet code
vet:
	go vet ./...

install-lint:
	@[ -x "$$(which golangci-lint)" ] || brew install golangci-lint

# Lint code
lint: install-lint
	golangci-lint run ./...

# Run all checks with quiet output
check-quiet:
	@. ../hack/run_silent.sh && print_header "hld" "Daemon checks"
	@. ../hack/run_silent.sh && ensure_golangci_lint
	@. ../hack/run_silent.sh && run_with_quiet "Format check passed" "go fmt ./..."
	@. ../hack/run_silent.sh && run_with_quiet "Vet check passed" "go vet ./..."
	@. ../hack/run_silent.sh && run_with_quiet "Lint check passed" "golangci-lint run ./..."

# Run unit tests with quiet output
test-unit-quiet:
	@. ../hack/run_silent.sh && run_silent_with_test_count "Unit tests passed" "CGO_LDFLAGS=\"-Wl,-w\" go test -json ./..." "go"

# Run unit tests with race detection and quiet output
test-unit-race-quiet:
	@. ../hack/run_silent.sh && run_silent_with_test_count "Unit tests with race detection passed" "CGO_LDFLAGS=\"-Wl,-w\" go test -json -race ./..." "go"

# Run all checks
check:
	@if [ -n "$$VERBOSE" ]; then \
		$(MAKE) fmt vet lint; \
	else \
		$(MAKE) check-quiet; \
	fi

# Override test-unit to support quiet mode
test-unit:
	@if [ -n "$$VERBOSE" ]; then \
		CGO_LDFLAGS="-Wl,-w" go test -v ./...; \
	else \
		$(MAKE) test-unit-quiet; \
	fi
