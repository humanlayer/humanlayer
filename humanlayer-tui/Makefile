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
test:
	go test ./...

.PHONY: check
check: fmt vet lint test
