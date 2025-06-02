function printTurn() {
    echo "\033[32m<$1>\033[0m"
    echo "$2"
    echo "\033[32m</$1>\033[0m"
}

export HUMANLAYER_RUN_ID="claude"

message="you are claude, a helpful assistant. Greet the user and await further instructions."
# allowedTools="Write,Edit"
allowedTools=""

CLAUDE_ANSWER=$(
    claude -p "$message" \
     --allowedTools="$allowedTools" \
     --mcp-config=./mcp-config.json \
     --permission-prompt-tool=mcp__approvals__request_permission \
)


while true; do
   printTurn "claude_answer" "$CLAUDE_ANSWER"

   HUMAN_MESSAGE=$(echo "$CLAUDE_ANSWER" | npx humanlayer contact_human -m -)

   printTurn "human_message" "$HUMAN_MESSAGE"

   CLAUDE_ANSWER=$(claude -p "$HUMAN_MESSAGE" \
     --continue \
     --allowedTools="$allowedTools" \
     --mcp-config=./mcp-config.json \
     --permission-prompt-tool=mcp__approvals__request_permission \
   )
done
