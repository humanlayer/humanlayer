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
	:
	: 🦾 controlflow
	:
	docker compose -f examples/controlflow/docker-compose.yaml run examples
	:
	: 🚣 crewai
	:
	docker compose -f examples/crewai/docker-compose.yaml run examples
	docker compose -f examples/crewai/docker-compose.yaml run examples crewai_onboarding_agent.py
	docker compose -f examples/crewai/docker-compose.yaml run examples crewai_onboarding_agent_human_as_tool.py
	:
	: 🦜⛓️ langchain
	:
	docker compose -f examples/langchain/docker-compose.yaml run examples 01-math_example.py
	docker compose -f examples/langchain/docker-compose.yaml run examples 02-customer_email.py
	docker compose -f examples/langchain/docker-compose.yaml run examples 04-human_as_tool_linkedin.py
	docker compose -f examples/langchain/docker-compose.yaml run examples 04-human_as_tool_onboarding.py
	docker compose -f examples/langchain/docker-compose.yaml run examples 05-approvals_and_humans_composite.py
	:
	: 🧠 OpenAI
	:
	docker compose -f examples/openai_client/docker-compose.yaml run examples

.PHONY: githooks
githooks:
	:
	: 🚀 Installing pre-push hook
	:
	echo 'make check test' > .git/hooks/pre-push
	chmod +x .git/hooks/pre-push
