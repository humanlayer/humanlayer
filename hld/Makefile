.PHONY: build test test-unit test-integration test-race clean

# Build the daemon binary
build:
	go build -o hld ./cmd/hld

# Run all tests
test: test-unit test-integration

# Run unit tests with race detection
test-unit:
	go test -v -race ./...

# Run integration tests (requires build tag)
test-integration: build
	go test -v -tags=integration -run Integration ./daemon/...

# Run tests with race detection
test-race:
	go test -race ./...

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