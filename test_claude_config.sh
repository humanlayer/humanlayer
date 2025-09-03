#!/bin/bash
set -e

echo "Testing Claude configuration API..."

# Test getting config
echo "1. Getting current config:"
curl -s localhost:7777/api/config | jq .

echo ""
echo "2. Setting Claude path to empty (auto-detect):"
curl -s -X PATCH localhost:7777/api/config \
  -H "Content-Type: application/json" \
  -d '{"claude_path": ""}' | jq .

echo ""
echo "3. Getting config after auto-detect:"
curl -s localhost:7777/api/config | jq .

echo ""
echo "4. Setting Claude path to specific location:"
curl -s -X PATCH localhost:7777/api/config \
  -H "Content-Type: application/json" \
  -d '{"claude_path": "/usr/local/bin/claude"}' | jq .

echo ""
echo "5. Getting config after setting specific path:"
curl -s localhost:7777/api/config | jq .

echo ""
echo "Test complete!"
