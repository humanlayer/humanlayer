#!/bin/bash
# Test script for ENG-2188 - Inject malformed tool inputs

DB_PATH="$HOME/.humanlayer/daemon.db"

# Get an active session
SESSION_ID=$(sqlite3 "$DB_PATH" "SELECT id FROM conversation_sessions WHERE status = 'running' ORDER BY created_at DESC LIMIT 1")

if [ -z "$SESSION_ID" ]; then
    echo "No active session found. Please start a Claude Code session first."
    exit 1
fi

echo "Testing malformed inputs for session: $SESSION_ID"

# Test 1: Missing old_string and new_string
sqlite3 "$DB_PATH" <<EOF
INSERT INTO conversation_events (
  session_id, sequence, event_type, tool_name, tool_input_json, created_at
) VALUES (
  '$SESSION_ID',
  (SELECT MAX(sequence) + 1 FROM conversation_events WHERE session_id = '$SESSION_ID'),
  'tool_call', 'Edit',
  '{"file_path": "/test.js"}',
  datetime('now')
);
EOF

# Test 2: Null values
sqlite3 "$DB_PATH" <<EOF
INSERT INTO conversation_events (
  session_id, sequence, event_type, tool_name, tool_input_json, created_at
) VALUES (
  '$SESSION_ID',
  (SELECT MAX(sequence) + 1 FROM conversation_events WHERE session_id = '$SESSION_ID'),
  'tool_call', 'Edit',
  '{"file_path": "/test.js", "old_string": null, "new_string": null}',
  datetime('now')
);
EOF

echo "Malformed events injected. Check CodeLayer UI for errors."