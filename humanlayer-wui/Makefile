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

test: ## Run tests (placeholder for future tests)
	@echo "No tests configured yet"

check: format-check lint typecheck ## Run all quality checks (format + lint + typecheck)

clean: ## Clean build artifacts
	rm -rf dist/
	rm -rf src-tauri/target/

.DEFAULT_GOAL := help
