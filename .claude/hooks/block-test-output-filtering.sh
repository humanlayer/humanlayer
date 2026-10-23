#!/bin/bash

INPUT=$(cat)

COMMAND=$(printf "%s" "$INPUT" | node -e '
let data = "";
process.stdin.on("data", (chunk) => {
  data += chunk;
});
process.stdin.on("end", () => {
  try {
    const parsed = JSON.parse(data);
    process.stdout.write(parsed?.tool_input?.command ?? "");
  } catch {
    process.exit(0);
  }
});
')

if [ -z "$COMMAND" ]; then
  exit 0
fi

is_check_command() {
  [[ "$COMMAND" =~ (^|[[:space:];&|()])([^[:space:]]+=\S+[[:space:]]+)*(bun|npm|yarn|pnpm)([[:space:]]+--bun)?[[:space:]]+(run[[:space:]]+)?([^[:space:]]*:)?(test|test:ci|typecheck)([[:space:]]|$) ]] || \
    [[ "$COMMAND" =~ (^|[[:space:];&|()])([^[:space:]]+=\S+[[:space:]]+)*(bun[[:space:]]+--bun[[:space:]]+)?turbo[[:space:]]+run[[:space:]]+(test|test:llm|typecheck)([[:space:]]|$) ]] || \
    [[ "$COMMAND" =~ (^|[[:space:];&|()])([^[:space:]]+=\S+[[:space:]]+)*(oxlint|oxfmt)([[:space:]]|$) ]]
}

uses_disallowed_pipe_filter() {
  [[ "$COMMAND" =~ \|[[:space:]]*(head|tail|grep|egrep|fgrep|rg|sed|awk|less|more)([[:space:]]|$) ]]
}

if is_check_command && uses_disallowed_pipe_filter; then
  cat >&2 <<'EOF'
Do not pipe test, typecheck, or quality output to head/tail/grep/etc.

The Bash tool spools large output to disk automatically. Run the full command
without filtering so the complete output is captured. If the output is too long,
use the <persisted_output> path from the tool result and filter that file instead.
EOF
  exit 2
fi

exit 0
