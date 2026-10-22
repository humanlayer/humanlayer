.PHONY: setup
setup: # setup the repository with all dependencies and builds
	@echo "🥟  Installing Dependencies with bun..."
	@bun install
	@echo "✏️   Erasing AGENTS.md and replacing with a symlink to CLAUDE.md..."
	@bun rimraf AGENTS.md
	@ln -s CLAUDE.md AGENTS.md
	@echo "✅ Done!"

# CI-specific targets
.PHONY: setup-ci ci-tools

## CI Setup Commands
setup-ci: ci-tools setup ## Complete CI setup including CI-specific tools
	@echo "✅ CI setup complete"

ci-tools: ## Install CI-specific tools
	@echo "Installing CI-specific tools..."
	@command -v claude >/dev/null 2>&1 || bun install -g @anthropic-ai/claude-code

	@echo "Done"

.PHONY: worktree
worktree: ## Create a new worktree for development work (use hack/create_worktree.sh branch_name for specific names)
	scripts/create_worktree.sh

.PHONY: check
check:
	@bun --bun run typecheck
	@bun --bun run quality
