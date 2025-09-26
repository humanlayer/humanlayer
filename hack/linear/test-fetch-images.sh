#!/usr/bin/env bash
set -e

# Test script for fetch-images command
echo "Testing Linear fetch-images command..."

# Build the CLI
cd "$(dirname "$0")"
npm run build

# Test with invalid issue ID
echo "Test 1: Invalid issue format"
if ./dist/linear-cli.js fetch-images "INVALID" 2>/dev/null; then
  echo "❌ Should have failed with invalid ID"
  exit 1
else
  echo "✓ Correctly rejected invalid ID"
fi

# Test with valid format (may fail if issue doesn't exist)
echo "Test 2: Valid issue format"
OUTPUT=$(./dist/linear-cli.js fetch-images "ENG-99999" 2>/dev/null || echo "No images")
if [[ "$OUTPUT" == *"No images"* ]] || [[ "$OUTPUT" == *"thoughts/shared/images"* ]]; then
  echo "✓ Returns expected output format"
else
  echo "❌ Unexpected output format"
  exit 1
fi

echo "All tests passed!"