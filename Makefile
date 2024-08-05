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
	: 🚀 Static type checking: Running mypy
	poetry run mypy
	: 🚀 Checking for obsolete dependencies: Running deptry
	poetry run deptry .

.PHONY: test
test: ## Test the code with pytest
	poetry run pytest --cov --cov-config=pyproject.toml --cov-report=xml

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
