# HumanLayer WUI Makefile

.PHONY: help install dev build lint format format-check typecheck test check clean

help: ## Show this help message
	@echo "Available commands:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	bun install

dev: ## Start development server
	bun run dev

build: ## Build the application
	bun run build

lint: ## Run ESLint
	bun run lint

format: ## Format code with Prettier
	bun run format

format-check: ## Check code formatting
	bun run format:check

typecheck: ## Run TypeScript type checking
	bun run typecheck

# Placeholder for future test command

check-quiet: ## Run all quality checks with quiet output
	@. ../hack/run_silent.sh && print_header "humanlayer-wui" "Web UI checks"
	@. ../hack/run_silent.sh && run_silent "Format check passed" "bun run format:check"
	@. ../hack/run_silent.sh && run_silent "Lint check passed" "bun run lint"
	@. ../hack/run_silent.sh && run_silent "Type checking passed" "bun run typecheck"

test-quiet: ## Run tests with quiet output
	@. ../hack/run_silent.sh && print_header "humanlayer-wui" "Web UI tests"
	@echo "  No tests configured yet"

check: ## Run all quality checks (format + lint + typecheck)
	@if [ -n "$$VERBOSE" ]; then \
		$(MAKE) format-check lint typecheck; \
	else \
		$(MAKE) check-quiet; \
	fi

test: ## Run tests
	@if [ -n "$$VERBOSE" ]; then \
		echo "No tests configured yet"; \
	else \
		$(MAKE) test-quiet; \
	fi

clean: ## Clean build artifacts
	rm -rf dist/
	rm -rf src-tauri/target/

.DEFAULT_GOAL := help
