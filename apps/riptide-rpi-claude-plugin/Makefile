.PHONY: build test shell

CLAUDE_MOUNTS := -v $(PWD)/tmp/test-claude/.claude/:/home/claude/.claude -v $(PWD)/tmp/test-claude/.claude.json:/home/claude/.claude.json -v $(PWD)/tmp/workspace:/home/claude/workspace

build:
	docker build -t riptide-rpi-test .

test: build
	docker run --rm $(CLAUDE_MOUNTS) -e ANTHROPIC_API_KEY -it riptide-rpi-test -p "hi" --dangerously-skip-permissions

shell: build
	docker run --rm $(CLAUDE_MOUNTS) -e ANTHROPIC_API_KEY -it --entrypoint bash riptide-rpi-test
