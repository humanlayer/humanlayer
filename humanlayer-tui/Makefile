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
check-quiet: ## Run all checks with quiet output
	@. ../hack/run_silent.sh && print_header "humanlayer-tui" "Go checks"
	@. ../hack/run_silent.sh && ensure_golangci_lint
	@. ../hack/run_silent.sh && run_with_quiet "Format check passed" "go fmt ./..."
	@. ../hack/run_silent.sh && run_with_quiet "Vet check passed" "go vet ./..."
	@. ../hack/run_silent.sh && run_with_quiet "Lint check passed" "golangci-lint run ./..."
	@. ../hack/run_silent.sh && run_with_quiet "Tests passed" "go test ./..."

.PHONY: test-quiet
test-quiet: ## Run tests with quiet output
	@. ../hack/run_silent.sh && print_header "humanlayer-tui" "Go tests"
	@. ../hack/run_silent.sh && run_silent_with_test_count "Unit tests passed" "go test -json ./..." "go"

.PHONY: test-integration-quiet
test-integration-quiet: ## Run integration tests with quiet output
	@. ../hack/run_silent.sh && print_header "humanlayer-tui" "Go integration tests"
	@. ../hack/run_silent.sh && run_silent_with_test_count "Integration tests passed" "go test -json -tags=integration ./..." "go"

.PHONY: check
check: ## Run all checks
	@if [ -n "$$VERBOSE" ]; then \
		$(MAKE) fmt vet lint test; \
	else \
		$(MAKE) check-quiet; \
	fi

.PHONY: test
test: test-unit ## Run unit tests

.PHONY: test-unit
test-unit: ## Run unit tests
	@if [ -n "$$VERBOSE" ]; then \
		go test -v ./...; \
	else \
		$(MAKE) test-quiet; \
	fi

.PHONY: test-integration
test-integration: ## Run integration tests
	@if [ -n "$$VERBOSE" ]; then \
		go test -v -tags=integration ./...; \
	else \
		$(MAKE) test-integration-quiet; \
	fi

.PHONY: mocks
mocks:
	mockgen -source=internal/api/types.go -destination=internal/api/mock_api.go -package=api Client,ApprovalClient,SessionClient,ConversationClient,EventClient