.PHONY: install
install: ## Install the poetry environment and install the pre-commit hooks
	poetry install
	 poetry run pre-commit install
	poetry shell

.PHONY: check
check: ## Run code quality tools.
	: 🚀 Checking Poetry lock file consistency with 'pyproject.toml': Running poetry lock --check
	poetry check --lock
	: 🚀 Linting code: Running pre-commit
	poetry run pre-commit run -a
	@$(MAKE) typecheck
	: 🚀 Checking for obsolete dependencies: Running deptry
	poetry run deptry .

typecheck: ## just the typechecks
	: 🚀 Static type checking: Running mypy
	poetry run mypy

.PHONY: test
test: ## Test the code with pytest
	poetry run pytest ./humanlayer --cov --cov-config=pyproject.toml --cov-report=xml

.PHONY: build
build: clean-build ## Build wheel file using poetry
	: 🚀 Creating wheel file
	poetry build

.PHONY: clean-build
clean-build: ## clean build artifacts
	@rm -rf dist

.PHONY: publish
publish: ## publish a release to pypi.
	: 🚀 Publishing: Dry run.
	poetry export -f requirements.txt --output requirements.txt
	poetry config pypi-token.pypi $(PYPI_TOKEN)
	poetry publish --dry-run
	: 🚀 Publishing.
	poetry publish
	rm requirements.txt

.PHONY: build-and-publish
build-and-publish: build publish ## Build and publish.

.PHONY: help
help:
	grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help

.PHONY: test-examples
test-examples:
	:
	: 🐳 build
	:
	docker compose -f examples/controlflow/docker-compose.yaml build examples
	docker compose -f examples/crewai/docker-compose.yaml build examples
	docker compose -f examples/langchain/docker-compose.yaml build examples
	docker compose -f examples/openai_client/docker-compose.yaml build examples
	docker compose -f examples/griptape/docker-compose.yaml build examples
	:
	: 🦾 controlflow
	:
	docker compose -f examples/controlflow/docker-compose.yaml up examples
	docker compose -f examples/controlflow/docker-compose.yaml run examples
	:
	: 🚣 crewai
	:
	docker compose -f examples/crewai/docker-compose.yaml up examples
	docker compose -f examples/crewai/docker-compose.yaml run examples crewai_onboarding_agent.py
	docker compose -f examples/crewai/docker-compose.yaml run examples crewai_onboarding_agent_human_as_tool.py
	:
	: 🚣 griptape
	:
	docker compose -f examples/griptape/docker-compose.yaml up examples
	:
	: 🦜⛓️ langchain
	:
	docker compose -f examples/langchain/docker-compose.yaml up examples
	docker compose -f examples/langchain/docker-compose.yaml run examples 01-math_example.py
	docker compose -f examples/langchain/docker-compose.yaml run examples 02-customer_email.py
	docker compose -f examples/langchain/docker-compose.yaml run examples 04-human_as_tool_linkedin.py
	docker compose -f examples/langchain/docker-compose.yaml run examples 04-human_as_tool_onboarding.py
	docker compose -f examples/langchain/docker-compose.yaml run examples 04-human_as_tool_linkedin_frustration.py
	docker compose -f examples/langchain/docker-compose.yaml run examples 05-approvals_and_humans_composite.py
	:
	: 🦜⛓️ langchain-anthropic
	:
	docker compose -f examples/langchain-anthropic/docker-compose.yaml up examples
	:
	: 🧠 OpenAI
	:
	docker compose -f examples/openai_client/docker-compose.yaml up examples
	docker compose -f examples/openai_client/docker-compose.yaml run examples 02-imperative_fetch.py
	docker compose -f examples/openai_client/docker-compose.yaml run examples 03-imperative_fetch_based.py
	:
	: 🦜⛓️ ts_langchain
	:
	npm run --prefix examples/ts_langchain example
	:
	: 🧠 ts_openai
	:
	npm run --prefix examples/ts_openai_client example
	npm run --prefix examples/ts_openai_client human-as-tool

.PHONY: githooks
githooks:
	:
	: 🚀 Installing pre-push hook
	:
	echo 'make check test' > .git/hooks/pre-push
	chmod +x .git/hooks/pre-push

.PHONY: update-examples-versions
VERSION?=
update-examples-versions:
	@if [ -z "$(VERSION)" ]; then \
		echo "VERSION is not set"; \
		exit 1; \
	fi; \
	: 🚀 Updating examples versions to $(VERSION)
	find examples/*/requirements.txt -type f -exec sed -i '' 's/humanlayer==.*$$/humanlayer==$(VERSION)/g' {} +

.PHONY: update-examples-tokens
HUMANLAYER_API_KEY?=
HUMANLAYER_API_BASE?=
update-examples-tokens:
	@if [ -z "$(HUMANLAYER_API_KEY)" ]; then \
		echo "HUMANLAYER_API_KEY must be set"; \
		exit 1; \
	fi; \
	: 🚀 Updating examples .env files with new tokens
	find examples/*/.env -type f -exec sh -c ' \
		echo "" >> "{}"; \
		echo "# added by Makefile at $(shell date)" >> "{}"; \
		echo "HUMANLAYER_API_KEY=$(HUMANLAYER_API_KEY)" >> "{}"; \
		echo "HUMANLAYER_API_BASE=$(HUMANLAYER_API_BASE)" >> "{}"; \
	' \;
