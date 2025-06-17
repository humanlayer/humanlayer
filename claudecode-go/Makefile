.PHONY: fmt
fmt:
	go fmt ./...

.PHONY: vet
vet:
	go vet ./...

install-lint:
	@[ -x "$$(which golangci-lint)" ] || brew install golangci-lint

.PHONY: lint
lint: install-lint
	golangci-lint run ./...

# Base test target overridden below

.PHONY: check-quiet
check-quiet:
	@. ../hack/run_silent.sh && print_header "claudecode-go" "Go checks"
	@. ../hack/run_silent.sh && ensure_golangci_lint
	@. ../hack/run_silent.sh && run_with_quiet "Format check passed" "go fmt ./..."
	@. ../hack/run_silent.sh && run_with_quiet "Vet check passed" "go vet ./..."
	@. ../hack/run_silent.sh && run_with_quiet "Lint check passed" "golangci-lint run ./..."
	@. ../hack/run_silent.sh && run_silent_with_test_count "Tests passed" "go test -json ./..." "go"

.PHONY: test-quiet
test-quiet:
	@. ../hack/run_silent.sh && print_header "claudecode-go" "Go tests"
	@. ../hack/run_silent.sh && run_silent_with_test_count "Tests passed" "go test -json ./..." "go"

.PHONY: check
check:
	@if [ -n "$$VERBOSE" ]; then \
		$(MAKE) fmt vet lint test; \
	else \
		$(MAKE) check-quiet; \
	fi

.PHONY: test
test:
	@if [ -n "$$VERBOSE" ]; then \
		go test -v ./...; \
	else \
		$(MAKE) test-quiet; \
	fi

.PHONY: test-race
test-race:
	go test -race ./...
