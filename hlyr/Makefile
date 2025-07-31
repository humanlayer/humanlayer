# HumanLayer CLI (hlyr) Makefile

.PHONY: help install dev build build-go build-daemon lint format format-check test test-watch check check-quiet clean

help: ## Show this help message
	@echo "Available commands:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	npm install

dev: ## Build and run the CLI
	npm run dev

build: ## Build the TypeScript and Go binaries
	npm run build

build-go: ## Build Go binaries (daemon and TUI)
	npm run build-go

build-daemon: ## Build the daemon binary
	npm run build-daemon

lint: ## Run ESLint
	npm run lint

format: ## Format code with Prettier
	npm run format

format-check: ## Check code formatting
	npm run format:check

test-watch: ## Run tests in watch mode
	npm run test:watch

check-quiet: ## Run all quality checks with quiet output
	@. ../hack/run_silent.sh && print_header "hlyr" "CLI tool checks"
	@. ../hack/run_silent.sh && run_silent "Format check passed" "npm run format:check"
	@. ../hack/run_silent.sh && run_silent "Lint check passed" "npm run lint"
	@. ../hack/run_silent.sh && run_silent_with_test_count "Tests passed" "npm run test" "vitest"
	@. ../hack/run_silent.sh && run_with_quiet "Build completed" "npm run build"

test-quiet: ## Run tests with quiet output
	@. ../hack/run_silent.sh && print_header "hlyr" "CLI tests"
	@. ../hack/run_silent.sh && run_silent_with_test_count "Vitest passed" "npm run test" "vitest"

check: ## Run all quality checks (format + lint + test + build)
	@if [ -n "$$VERBOSE" ]; then \
		npm run check; \
	else \
		$(MAKE) check-quiet; \
	fi

test: ## Run tests
	@if [ -n "$$VERBOSE" ]; then \
		npm run test; \
	else \
		$(MAKE) test-quiet; \
	fi

clean: ## Clean build artifacts
	npm run clean

.DEFAULT_GOAL := help
