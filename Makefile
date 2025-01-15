.PHONY: check-py
check-py: ## Run code quality tools.
	: 🚀 installing uv deps
	uv sync
	: 🚀 Linting code: Running pre-commit
	uv run pre-commit run -a
	@$(MAKE) typecheck
	: 🚀 Checking for obsolete dependencies: Running deptry
	uv run deptry .

.PHONY: check-ts
check-ts:
	npm -C humanlayer-ts run check

.PHONY: check
check: check-py check-ts

typecheck: ## just the typechecks
	: 🚀 Static type checking: Running mypy
	uv run mypy

.PHONY: test-py
test-py: ## Test the code with pytest
	uv run pytest ./humanlayer --cov --cov-config=pyproject.toml --cov-report=xml --junitxml=junit.xml

.PHONY: test-ts
test-ts: ## Test the code with jest
	npm -C humanlayer-ts run test

.PHONY: test
test: test-py test-ts

.PHONY: build
build: clean-build ## Build wheel file using uv
	: 🚀 Creating wheel file
	uv build

.PHONY: build-ts
build-ts:
	npm -C humanlayer-ts run build

.PHONY: clean-build
clean-build: ## clean build artifacts
	@rm -rf dist

.PHONY: publish-py
publish-py: ## publish a release to pypi. with UV_PUBLISH_TOKEN
	: 🚀 Publishing.
	uv publish

.PHONY: publish
publish: publish-py

.PHONY: publish-ts
publish-ts: build-ts
	npm -C humanlayer-ts publish

.PHONY: build-and-publish
build-and-publish: build publish ## Build and publish.

.PHONY: help
help:
	grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help

.PHONY: smoke-test-examples-py
smoke-test-examples-py:
	examples/langchain/venv/bin/pip install -r examples/langchain/requirements.txt
	: 🦾 human_as_tool_linkedin
	examples/langchain/venv/bin/python examples/langchain/04-human_as_tool_linkedin.py
	: 🦾 human_as_tool_linkedin
	examples/langchain/venv/bin/python examples/langchain/04-human_as_tool_linkedin_frustration.py
	examples/langchain/venv/bin/python examples/langchain/09-email-contact.py

.PHONY: smoke-test-examples-ts
smoke-test-examples-ts:
	npm -C examples/ts_openai_client install
	: 🦾 human-as-tool
	npm -C examples/ts_openai_client run human-as-tool
	: 🦾 human-email
	npm -C examples/ts_openai_client run human-email

	npm -C examples/ts_langchain install
	: 🦾 ts_langchain
	npm -C examples/ts_langchain run example

.PHONY: smoke-test-examples
smoke-test-examples: smoke-test-examples-py smoke-test-examples-ts

.PHONY: test-examples
test-examples:
	:
	: 🦾 controlflow
	:
	examples/controlflow/venv/bin/pip install -r examples/controlflow/requirements.txt
	examples/controlflow/venv/bin/python examples/controlflow/controlflow_math.py
	:
	: 🚣 crewai
	:
	examples/crewai/venv/bin/pip install -r examples/crewai/requirements.txt
	examples/crewai/venv/bin/python examples/crewai/crewai_math.py
	examples/crewai/venv/bin/python examples/crewai/crewai_onboarding_agent.py
	examples/crewai/venv/bin/python examples/crewai/crewai_onboarding_agent_human_as_tool.py
	:
	: 🚣 griptape
	:
	examples/griptape/venv/bin/pip install -r examples/griptape/requirements.txt
	examples/griptape/venv/bin/python examples/griptape/01-math_example.py
	:
	: 🦜⛓️ langchain
	:
	examples/langchain/venv/bin/pip install -r examples/langchain/requirements.txt
	examples/langchain/venv/bin/python examples/langchain/01-math_example.py
	examples/langchain/venv/bin/python examples/langchain/02-customer_email.py
	examples/langchain/venv/bin/python examples/langchain/04-human_as_tool_linkedin.py
	examples/langchain/venv/bin/python examples/langchain/04-human_as_tool_onboarding.py
	examples/langchain/venv/bin/python examples/langchain/04-human_as_tool_linkedin_frustration.py
	examples/langchain/venv/bin/python examples/langchain/05-approvals_and_humans_composite.py
	examples/langchain/venv/bin/python examples/langchain/08-email-channel.py
	examples/langchain/venv/bin/python examples/langchain/09-email-contact.py
	:
	: 🦜⛓️ langchain-anthropic
	:
	examples/langchain-anthropic/venv/bin/pip install -r examples/langchain-anthropic/requirements.txt
	examples/langchain-anthropic/venv/bin/python examples/langchain-anthropic/01-math_example.py
	:
	: 🧠 OpenAI
	:
	examples/openai_client/venv/bin/pip install -r examples/openai_client/requirements.txt
	examples/openai_client/venv/bin/python examples/openai_client/02-imperative_fetch.py
	examples/openai_client/venv/bin/python examples/openai_client/03-imperative_fetch_based.py
	:
	: 🦜⛓️ ts_langchain
	:
	npm run --prefix examples/ts_langchain example
	:
	: 🧠 ts_openai
	:
	npm run --prefix examples/ts_openai_client example
	npm run --prefix examples/ts_openai_client human-as-tool
	npm run --prefix examples/ts_openai_client human-email
	npm run --prefix examples/ts_openai_client agent-side

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

.PHONY: update-examples-ts-versions
update-examples-ts-versions:
	find examples/*/package.json -type f -exec sed -i '' 's/"humanlayer": ".*"/"humanlayer": "$(VERSION)"/g' {} +

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


## Release process

#way too manual for now. on a branch with a clean git workspace

#- TS - publish release candidate
#- TS - udpate examples to rc versions, run smoketests
#- TS - publish full version
#- TS - udpate examples to published version, run smoketests
#
#- PY - publish release candidate
#- PY - udpate examples to rc versions, run smoketests
#- PY - publish full version
#- PY - udpate examples to published version, run smoketests

#- COMMIT
#- MERGE
#- TAG

#- TS - update to new rc version
#- PY - update to new rc version


current-ts-version = $(shell cat humanlayer-ts/package.json | jq -r '.version')
current-py-version = $(shell cat pyproject.toml | grep version | head -1 | cut -d'"' -f2)
new-version = $(shell echo $(current-ts-version) | sed 's/-rc.*//')

.PHONY: release-plan
release-plan:
	@echo "Current versions:"
	@echo "  TS: $(current-ts-version)"
	@echo "  PY: $(current-py-version)"
	@echo "  New version: $(new-version)"
	@if [ "$(shell git rev-parse --abbrev-ref HEAD)" != "release-$(new-version)" ]; then \
		echo "Must be on branch release-$(new-version)"; \
		echo; \
		echo "   git checkout -b release-$(new-version)"; \
		echo; \
		exit 1; \
	fi
	@echo
	@echo "Release steps:"
	@echo "1. Publish TypeScript:"
	@echo "   - cd humanlayer-ts && npm publish"
	@echo "   - make update-examples-ts-versions VERSION=$(current-ts-version)"
	@echo "   - make smoke-test-examples-ts"
	@echo
	@echo "2. Publish Python:"
	@echo "   - make build-and-publish"
	@echo "   - make update-examples-versions VERSION=$(current-py-version)"
	@echo "   - make smoke-test-examples-py"
	@echo
	@echo "3. Finalize:"
	@echo "   - git commit -am 'release: v$(current-ts-version)' && git push origin main"
	@echo "   - git tag v$(current-ts-version)"
	@echo "   - git push origin main --tags"
	@echo
	@echo "4. Next RC:"
	@echo "   - Update version in package.json to next rc"
	@echo "   - Update version in pyproject.toml to next rc"
	@echo "   - git commit -am 'bump to next rc'"
	@echo "   - git push origin main"



.PHONY: release-everything
release-everything:
	@if ! grep -q "rc" "humanlayer-ts/package.json"; then \
		echo "Version in humanlayer-ts/package.json must contain 'rc'"; \
		exit 1; \
	fi
	cd humanlayer-ts && npm publish
	$(MAKE) update-examples-ts-versions VERSION=
