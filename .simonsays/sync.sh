#!/bin/bash
cat .simonsays/prompt.md | \
        claude -p --output-format=stream-json --verbose --dangerously-skip-permissions --add-dir ../humanlayer-transformed | \
        tee -a .simonsays/claude_output.jsonl | \
        npx repomirror visualize --debug;
