.PHONY: build test test-unit test-integration test-race clean mocks check fmt vet lint

# Build the daemon binary
build:
	go build -o hld ./cmd/hld

# Run all tests
test: test-unit test-integration

# Base test-unit target overridden below

# Run integration tests (requires build tag)
test-integration: build
	CGO_LDFLAGS="-Wl,-w" go test -v -tags=integration -run Integration ./daemon/...

# Run tests with race detection
test-race:
	CGO_LDFLAGS="-Wl,-w" go test -race ./...

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

# Generate mocks
mocks:
	mockgen -source=session/types.go -destination=session/mock_session.go -package=session SessionManager
	mockgen -source=approval/types.go -destination=approval/mock_approval.go -package=approval Manager,Store,APIClient
	mockgen -source=client/types.go -destination=client/mock_client.go -package=client Client,Factory
	mockgen -source=bus/types.go -destination=bus/mock_bus.go -package=bus EventBus
	mockgen -source=store/store.go -destination=store/mock_store.go -package=store ConversationStore

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
	@. ../hack/run_silent.sh && run_silent_with_test_count "Unit tests passed" "CGO_LDFLAGS=\"-Wl,-w\" go test -json ./..." "go"

# Run unit tests with quiet output
test-unit-quiet:
	@. ../hack/run_silent.sh && print_header "hld" "Daemon tests"
	@. ../hack/run_silent.sh && run_silent_with_test_count "Unit tests passed" "CGO_LDFLAGS=\"-Wl,-w\" go test -json ./..." "go"

# Run all checks
check:
	@if [ -n "$$VERBOSE" ]; then \
		$(MAKE) fmt vet lint test-unit; \
	else \
		$(MAKE) check-quiet; \
	fi

# Override test-unit to support quiet mode
test-unit:
	@if [ -n "$$VERBOSE" ]; then \
		CGO_LDFLAGS="-Wl,-w" go test -v -race ./...; \
	else \
		$(MAKE) test-unit-quiet; \
	fi
