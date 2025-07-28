.PHONY: setup
setup: ## Set up the repository with all dependencies and builds
	hack/setup_repo.sh
thoughts:
	humanlayer thoughts init --directory humanlayer

.PHONY: worktree
worktree: ## Create a new worktree for development work (use hack/create_worktree.sh branch_name for specific names)
	hack/create_worktree.sh

.PHONY: check-py
check-py: ## Run code quality tools.
	@. ./hack/run_silent.sh && print_header "humanlayer" "Python checks"
	@. ./hack/run_silent.sh && run_with_quiet "Dependencies synced" "uv sync -q"
	@. ./hack/run_silent.sh && run_silent "Pre-commit hooks passed" "uv run pre-commit run -a"
	@. ./hack/run_silent.sh && run_silent "Type checking passed (mypy)" "uv run mypy"
	@. ./hack/run_silent.sh && run_silent "Dependency analysis passed" "uv run deptry ."

.PHONY: check-ts
check-ts:
	@. ./hack/run_silent.sh && print_header "humanlayer-ts" "TypeScript checks"
	@. ./hack/run_silent.sh && run_silent "Type checking passed" "npm --silent -C humanlayer-ts run check"
	@. ./hack/run_silent.sh && print_header "humanlayer-ts-vercel-ai-sdk" "TypeScript checks"
	@. ./hack/run_silent.sh && run_silent "Type checking passed" "npm --silent -C humanlayer-ts-vercel-ai-sdk run check"

check-hlyr:
	@$(MAKE) -C hlyr check VERBOSE=$(VERBOSE)

check-wui:
	@$(MAKE) -C humanlayer-wui check VERBOSE=$(VERBOSE)

check-tui:
	@$(MAKE) -C humanlayer-tui check VERBOSE=$(VERBOSE)

check-hld:
	@$(MAKE) -C hld check VERBOSE=$(VERBOSE)

check-claudecode-go:
	@$(MAKE) -C claudecode-go check VERBOSE=$(VERBOSE)

.PHONY: check-header
check-header:
	@sh -n ./hack/run_silent.sh || (echo "❌ Shell script syntax error in hack/run_silent.sh" && exit 1)
	@. ./hack/run_silent.sh && print_main_header "Running Checks"

# Summary removed - tracking doesn't work across sub-makes

.PHONY: check
check: check-header check-py check-ts check-hlyr check-wui check-tui check-hld check-claudecode-go

typecheck: ## just the typechecks
	@. ./hack/run_silent.sh && run_silent "Static type checking: mypy" "uv run mypy"

.PHONY: test-py
test-py: ## Test the code with pytest
	@. ./hack/run_silent.sh && print_header "humanlayer" "Python tests"
	@. ./hack/run_silent.sh && run_silent_with_test_count "Pytest passed" "uv run pytest ./humanlayer --cov --cov-config=pyproject.toml --cov-report=xml --junitxml=junit.xml" "pytest"

.PHONY: test-ts
test-ts: ## Test the code with jest
	@. ./hack/run_silent.sh && print_header "humanlayer-ts" "TypeScript tests"
	@. ./hack/run_silent.sh && run_silent "Jest passed" "npm --silent -C humanlayer-ts run test"
	@. ./hack/run_silent.sh && print_header "humanlayer-ts-vercel-ai-sdk" "TypeScript tests"
	@. ./hack/run_silent.sh && run_silent "Jest passed" "npm --silent -C humanlayer-ts-vercel-ai-sdk run test"

.PHONY: test-hlyr
test-hlyr: ## Test hlyr CLI tool
	@$(MAKE) -C hlyr test VERBOSE=$(VERBOSE)

.PHONY: test-hld
test-hld: ## Test hld daemon (unit and integration tests)
	@$(MAKE) -C hld test VERBOSE=$(VERBOSE)

.PHONY: test-hld-integration
test-hld-integration: ## Test hld daemon (including integration tests)
	@$(MAKE) -C hld test

.PHONY: e2e-test
e2e-test: ## Run end-to-end REST API tests
	@$(MAKE) -C hld e2e-test

.PHONY: test-claudecode-go
test-claudecode-go: ## Test claudecode-go
	@$(MAKE) -C claudecode-go test VERBOSE=$(VERBOSE)

.PHONY: test-header
test-header:
	@sh -n ./hack/run_silent.sh || (echo "❌ Shell script syntax error in hack/run_silent.sh" && exit 1)
	@. ./hack/run_silent.sh && print_main_header "Running Tests"

.PHONY: clean-wui-release
clean-wui-release: ## clean WUI release
	rm -rf humanlayer-wui/src-tauri/target/release/

.PHONY: test-wui
test-wui: ## Test humanlayer-wui
	@$(MAKE) -C humanlayer-wui test VERBOSE=$(VERBOSE)

.PHONY: test
test: test-header test-py test-ts test-hlyr test-wui test-hld test-claudecode-go

.PHONY: check-test
check-test: ## Run all checks and tests
	@$(MAKE) check
	@$(MAKE) test

.PHONY: check-verbose
check-verbose: ## Run checks with verbose output
	@VERBOSE=1 $(MAKE) check

.PHONY: test-verbose
test-verbose: ## Run tests with verbose output
	@VERBOSE=1 $(MAKE) test

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

	npm -C examples/ts_email_classifier install
	: 🦾 ts_email_classifier
	npm -C examples/ts_email_classifier run human-review-sync
	: skipping async for now
	: npm -C examples/ts_email_classifier run human-review-async

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
	find examples/*/package.json -type f -exec sed -i '' 's/@humanlayer\/sdk": ".*"/@humanlayer\/sdk": "$(VERSION)"/g' {} +

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
#- TS - udpate examples to alpha versions, run smoketests
#- TS - publish full version
#- TS - udpate examples to published version, run smoketests
#
#- PY - publish release candidate
#- PY - udpate examples to alpha versions, run smoketests
#- PY - publish full version
#- PY - udpate examples to published version, run smoketests

#- COMMIT
#- MERGE
#- TAG

#- TS - update to new alpha version
#- PY - update to new alpha version


current-ts-version = $(shell cat humanlayer-ts/package.json | jq -r '.version')
current-py-version = $(shell cat pyproject.toml | grep version | head -1 | cut -d'"' -f2)
new-version = $(shell echo $(current-ts-version) | sed 's/-alpha.*//')
increment := patch
next-alpha-version = $(shell npx semver -i $(increment) $(new-version))-alpha.1

_check-uv-publish-token:
	@if [ -z "$(UV_PUBLISH_TOKEN)" ]; then \
		echo "UV_PUBLISH_TOKEN must be set"; \
		echo "   export UV_PUBLISH_TOKEN=..."; \
		echo; \
		exit 1; \
	fi

.PHONY: _release-plan-versions
_release-plan-versions:
	@echo "Current versions:"
	@echo "  TS: $(current-ts-version)"
	@echo "  PY: $(current-py-version)"
	@echo "  New version: $(new-version)"
	@echo "  Next alpha version: $(next-alpha-version)"

_release-branch-check:
	@if [ "$(shell git rev-parse --abbrev-ref HEAD)" != "release-$(new-version)" ]; then \
		echo "Must be on branch release-$(new-version)"; \
		echo; \
		echo "   git checkout -b release-$(new-version)"; \
		echo; \
		exit 1; \
	else \
	    echo; \
		echo "On branch release-$(new-version)"; \
		echo; \
	fi

_staging-env-check:
	@if [ -z "$(HUMANLAYER_API_BASE)" ]; then \
		echo "HUMANLAYER_API_BASE must be set"; \
		echo "   export HUMANLAYER_API_BASE=https://api.dev.humanlayer.dev/humanlayer/v1"; \
		echo "   export HUMANLAYER_API_KEY="; \
		echo; \
		exit 1; \
	else \
		echo "HUMANLAYER_API_BASE is set to $(HUMANLAYER_API_BASE)"; \
		echo; \
	fi

_production-env-check:
	@if [ ! -z "$(HUMANLAYER_API_BASE)" ] && [ "$(HUMANLAYER_API_BASE)" != "https://api.humanlayer.dev/humanlayer/v1" ]; then \
		echo "HUMANLAYER_API_BASE must be empty or set to https://api.humanlayer.dev/humanlayer/v1"; \
		echo "   unset HUMANLAYER_API_BASE"; \
		echo "   export HUMANLAYER_API_KEY="; \
		echo; \
		exit 1; \
	else \
		echo "HUMANLAYER_API_BASE is set to $(HUMANLAYER_API_BASE)"; \
		echo; \
	fi

.PHONY: release-plan
release-plan: _release-plan-versions _release-branch-check _staging-env-check
	@echo
	@echo "Release steps:"
	@echo "1. Publish TypeScript alpha:"
	@echo "   - cd humanlayer-ts && npm publish --tag alpha --access public"
	@echo "   - make update-examples-ts-versions VERSION=$(current-ts-version)"
	@echo "   - make smoke-test-examples-ts"
	@echo
	@echo "2. Publish Python alpha:"
	@echo "   - make build-and-publish"
	@echo "   - make update-examples-versions VERSION=$(current-py-version)"
	@echo "   - make smoke-test-examples-py"
	@echo
	@echo "3. Switch to production env"
	@: check with the user to ensure they are pointed at production
	@echo "   - export HUMANLAYER_API_BASE=https://api.humanlayer.dev/humanlayer/v1"
	@echo "   - export HUMANLAYER_API_KEY="
	@echo
	@echo "4. Publish TypeScript:"
	@echo "   - sed -i '' 's/$(current-ts-version)/$(new-version)/' humanlayer-ts/package.json"
	@echo "   - cd humanlayer-ts && npm publish --access public"
	@echo "   - make update-examples-ts-versions VERSION=$(new-version)"
	@echo "   - make smoke-test-examples-ts"
	@echo
	@echo "5. Publish Python:"
	@echo "   - sed -i '' 's/$(current-py-version)/$(new-version)/' pyproject.toml"
	@echo "   - make build-and-publish"
	@echo "   - make update-examples-versions VERSION=$(new-version)"
	@echo "   - make smoke-test-examples-py"
	@echo
	@echo "6. Finalize:"
	@echo "   - git commit -am 'release: v$(new-version)' && git push upstream release-$(new-version)"
	@echo "   - git tag v$(new-version)"
	@echo "   - git push upstream release-$(new-version) --tags"
	@echo
	@echo "7. Next alpha:"
	@echo "   - Update version in package.json to $(next-alpha-version)"
	@echo "   - sed -i '' 's/$(new-version)/$(next-alpha-version)/' humanlayer-ts/package.json"
	@echo "   - Update version in pyproject.toml to $(next-alpha-version)"
	@echo "   - sed -i '' 's/$(new-version)/$(next-alpha-version)/' pyproject.toml"
	@echo "   - git commit -am 'bump to next alpha'"
	@echo "   - git diff PREVIOUS_TAG | claude -p 'update the changelog' --allowedTools="Edit"
	@echo "   - git push upstream release-$(new-version)"



.PHONY: release-alpha
release-alpha: _check-uv-publish-token release-plan
	: confirming release plan
	@read -p "Press Enter to continue..."
	@echo "Releasing..."
	cd humanlayer-ts && npm run build && npm publish --tag alpha --access public
	:
	: waiting for ts publish to complete
	:
	sleep 30
	@$(MAKE) update-examples-ts-versions VERSION=$(current-ts-version)
	@$(MAKE) smoke-test-examples-ts
	@$(MAKE) build-and-publish
	:
	: waiting for py publish to complete
	:
	sleep 30
	@$(MAKE) update-examples-versions VERSION=$(current-py-version)
	@$(MAKE) smoke-test-examples-py

	@echo "Alpha tested against staging, to proceed, update env vars to point at production"
	@echo
	@echo "    export HUMANLAYER_API_BASE=https://api.humanlayer.dev/humanlayer/v1"
	@echo "    export HUMANLAYER_API_KEY=..."
	@echo "    (manual) promote saas release to production"
	@echo "    make release-and-test-prod"


.PHONY: release-and-test-prod
release-and-test-prod: _release-plan-versions _release-branch-check _production-env-check
	@echo "Releasing..."
	@echo "Publish TypeScript:"
	sed -i '' 's/$(current-ts-version)/$(new-version)/' humanlayer-ts/package.json
	cat humanlayer-ts/package.json | grep version
	@read -p "Press Enter to continue..."
	cd humanlayer-ts && npm run build && npm publish --access public
	@$(MAKE) update-examples-ts-versions VERSION=$(new-version)
	:
	: waiting for ts publish to complete
	:
	sleep 30
	@$(MAKE) smoke-test-examples-ts

	@echo "Publish Python:"
	sed -i '' 's/$(current-py-version)/$(new-version)/' pyproject.toml
	cat pyproject.toml | grep version
	@read -p "Press Enter to continue..."
	@$(MAKE) build-and-publish
	@$(MAKE) update-examples-versions VERSION=$(new-version)
	:
	: waiting for py publish to complete
	:
	@sleep 30
	@$(MAKE) smoke-test-examples-py

	@echo "Finalize:"
	git commit -am 'release: v$(current-ts-version)' && git push upstream release-$(new-version)
	git tag v$(current-ts-version)
	git push upstream release-$(new-version) --tags

	@echo "Next alpha:"
	sed -i '' 's/$(new-version)/$(next-alpha-version)/' humanlayer-ts/package.json
	sed -i '' 's/$(new-version)/$(next-alpha-version)/' pyproject.toml
	git commit -am 'release: bump to next alpha'
	git push upstream release-$(new-version)

	hub compare


.PHONY: check-local
check-local:
	@if [[ $$(git rev-parse --abbrev-ref HEAD) == local/* ]]; then \
		echo "blocking push of local branch"; \
		exit 1; \
	fi

logfileprefix = $(shell date +%Y-%m-%d-%H-%M-%S)

.PHONY: wui
wui: wui-dev

.PHONY: daemon
daemon: daemon-dev

# Build nightly daemon binary
.PHONY: daemon-nightly-build
daemon-nightly-build:
	cd hld && go build -o hld-nightly ./cmd/hld
	@echo "Built nightly daemon binary: hld/hld-nightly"

# Run nightly daemon
.PHONY: daemon-nightly
daemon-nightly: daemon-nightly-build
	@mkdir -p ~/.humanlayer/logs
	echo "$$(date +%Y-%m-%d-%H-%M-%S) starting nightly daemon in $$(pwd)" > ~/.humanlayer/logs/daemon-nightly-$$(date +%Y-%m-%d-%H-%M-%S).log
	cd hld && ./hld-nightly 2>&1 | tee -a ~/.humanlayer/logs/daemon-nightly-$$(date +%Y-%m-%d-%H-%M-%S).log

# Build and install nightly WUI
.PHONY: wui-nightly-build
wui-nightly-build:
	cd humanlayer-wui && bun run tauri build --bundles app
	@echo "Build complete. Installing to ~/Applications..."
	cp -r humanlayer-wui/src-tauri/target/release/bundle/macos/CodeLayer.app ~/Applications/
	@echo "Installed WUI nightly to ~/Applications/CodeLayer.app"

# Open nightly WUI
.PHONY: wui-nightly
wui-nightly: wui-nightly-build
	@echo "Opening WUI nightly..."
	open ~/Applications/CodeLayer.app

# Copy production database to timestamped dev database
.PHONY: copy-db-to-dev
copy-db-to-dev:
	@mkdir -p ~/.humanlayer/dev
	$(eval TIMESTAMP := $(shell date +%Y-%m-%d-%H-%M-%S))
	$(eval DEV_DB := ~/.humanlayer/dev/daemon-$(TIMESTAMP).db)
	@if [ -f ~/.humanlayer/daemon.db ]; then \
		cp ~/.humanlayer/daemon.db $(DEV_DB); \
		echo "Copied production database to: $(DEV_DB)" >&2; \
		echo "$(DEV_DB)"; \
	else \
		echo "Error: Production database not found at ~/.humanlayer/daemon.db" >&2; \
		exit 1; \
	fi

# Clean up dev databases and logs older than 10 days
.PHONY: cleanup-dev
cleanup-dev:
	@echo "Cleaning up dev artifacts older than 10 days..."
	@# Clean old dev databases
	@if [ -d ~/.humanlayer/dev ]; then \
		find ~/.humanlayer/dev -name "daemon-*.db" -type f -mtime +10 -delete -print | sed 's/^/Deleted database: /'; \
	fi
	@# Clean old dev logs
	@if [ -d ~/.humanlayer/logs ]; then \
		find ~/.humanlayer/logs -name "*-dev-*.log" -type f -mtime +10 -delete -print | sed 's/^/Deleted log: /'; \
	fi
	@echo "Cleanup complete."

# Build dev daemon binary
.PHONY: daemon-dev-build
daemon-dev-build:
	cd hld && go build -o hld-dev ./cmd/hld
	@echo "Built dev daemon binary: hld/hld-dev"

# Run dev daemon with fresh database copy
.PHONY: daemon-dev
daemon-dev: daemon-dev-build
	@mkdir -p ~/.humanlayer/logs
	$(eval TIMESTAMP := $(shell date +%Y-%m-%d-%H-%M-%S))
	$(eval DEV_DB := $(shell make -s copy-db-to-dev))
	@echo "Starting dev daemon with database: $(DEV_DB)"
	echo "$(TIMESTAMP) starting dev daemon in $$(pwd)" > ~/.humanlayer/logs/daemon-dev-$(TIMESTAMP).log
	cd hld && HUMANLAYER_DATABASE_PATH=$(DEV_DB) \
		HUMANLAYER_DAEMON_SOCKET=~/.humanlayer/daemon-dev.sock \
		HUMANLAYER_DAEMON_VERSION_OVERRIDE=$$(git branch --show-current) \
		./hld-dev 2>&1 | tee -a ~/.humanlayer/logs/daemon-dev-$(TIMESTAMP).log

# Run dev WUI with custom socket
.PHONY: wui-dev
wui-dev:
	@mkdir -p ~/.humanlayer/logs
	$(eval TIMESTAMP := $(shell date +%Y-%m-%d-%H-%M-%S))
	echo "$(TIMESTAMP) starting dev wui in $$(pwd)" > ~/.humanlayer/logs/wui-dev-$(TIMESTAMP).log
	cd humanlayer-wui && HUMANLAYER_DAEMON_SOCKET=~/.humanlayer/daemon-dev.sock bun run tauri dev 2>&1 | tee -a ~/.humanlayer/logs/wui-dev-$(TIMESTAMP).log

# Show current dev environment setup
.PHONY: dev-status
dev-status:
	@echo "=== Development Environment Status ==="
	@echo "Dev Socket: ~/.humanlayer/daemon-dev.sock"
	@echo "Nightly Socket: ~/.humanlayer/daemon.sock"
	@echo ""
	@echo "Dev Databases:"
	@ls -la ~/.humanlayer/dev/*.db 2>/dev/null || echo "  No dev databases found"
	@echo ""
	@echo "Active daemons:"
	@ps aux | grep -E "hld(-dev|-nightly)?$$" | grep -v grep || echo "  No daemons running"
