# HumanLayer WUI Makefile

DOCKER_TTY := $(shell if [ -t 0 ]; then echo -it; fi)

.PHONY: help dev build lint format format-check typecheck check clean install build-local

help: ## Show this help message
	@echo "Available commands:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

build-local: ## Build local Docker image with dependencies
	docker build -t humanlayer-wui-local:latest -f Dockerfile .

install: ## Install dependencies
	docker run --rm -v $(PWD):/app -w /app oven/bun:1 bun install

dev: build-local ## Start development server
	docker run --rm $(DOCKER_TTY) -v $(PWD)/src:/app/src -p 1420:1420 humanlayer-wui-local:latest bun run dev

build: build-local ## Build the application
	docker run --rm $(DOCKER_TTY) humanlayer-wui-local:latest bun run build

lint: build-local ## Run ESLint
	docker run --rm $(DOCKER_TTY) humanlayer-wui-local:latest bun run lint

format: build-local ## Format code with Prettier
	docker run --rm $(DOCKER_TTY) -v $(PWD):/app humanlayer-wui-local:latest bun run format

format-check: build-local ## Check code formatting
	docker run --rm $(DOCKER_TTY) humanlayer-wui-local:latest bun run format:check

typecheck: build-local ## Run TypeScript type checking
	docker run --rm $(DOCKER_TTY) humanlayer-wui-local:latest bun run typecheck

check: build-local ## Run all quality checks (format + lint + typecheck)
	docker run --rm $(DOCKER_TTY) humanlayer-wui-local:latest bun run check

clean: ## Clean build artifacts
	rm -rf dist/
	rm -rf src-tauri/target/
	docker rmi humanlayer-wui-local:latest 2>/dev/null || true

.DEFAULT_GOAL := help
