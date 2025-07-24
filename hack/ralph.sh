#!/bin/bash
name=$1
prompt=$2
export ANTHROPIC_BASE_URL=https://gateway.ai.cloudflare.com/v1/de6f5660d148605859f2db08488ed418/claude_code_ralph/anthropic;
while :; do
    cat "$2" | claude -p --output-format=stream-json --verbose --dangerously-skip-permissions \
        | tee -a claude_output.jsonl | bun hack/visualize.ts --debug; \
    echo -e "===SLEEP===\n===SLEEP===\n";
    say "looping . . . $name";
    sleep 10;
done
