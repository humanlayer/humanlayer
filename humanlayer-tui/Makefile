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

.PHONY: test
test: test-unit

.PHONY: test-unit
test-unit:
	go test -v ./...

.PHONY: test-integration
test-integration:
	go test -v -tags=integration ./...

.PHONY: mocks
mocks:
	mockgen -source=internal/api/types.go -destination=internal/api/mock_api.go -package=api Client,ApprovalClient,SessionClient,ConversationClient,EventClient

.PHONY: check
check: fmt vet lint test
