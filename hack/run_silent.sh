#!/bin/bash
set -e  # Exit immediately if any command fails

# Helper functions for running commands with clean output
# Used by Makefile to reduce verbosity while preserving error information

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if verbose mode is enabled
VERBOSE=${VERBOSE:-0}

# Run command silently, show output only on failure
run_silent() {
    local description="$1"
    local command="$2"

    if [ "$VERBOSE" = "1" ]; then
        echo "  → Running: $command"
        eval "$command"
        return $?
    fi

    local tmp_file=$(mktemp)
    if eval "$command" > "$tmp_file" 2>&1; then
        printf "  ${GREEN}✓${NC} %s\n" "$description"
        rm -f "$tmp_file"
        return 0
    else
        local exit_code=$?
        printf "  ${RED}✗${NC} %s\n" "$description"
        printf "${RED}Command failed: %s${NC}\n" "$command"
        cat "$tmp_file"
        rm -f "$tmp_file"
        return $exit_code
    fi
}

# Run command with native quiet flags (output shown on failure)
run_with_quiet() {
    local description="$1"
    local command="$2"

    if [ "$VERBOSE" = "1" ]; then
        echo "  → Running: $command"
        eval "$command"
        return $?
    fi

    local tmp_file=$(mktemp)
    if eval "$command" > "$tmp_file" 2>&1; then
        printf "  ${GREEN}✓${NC} %s\n" "$description"
        rm -f "$tmp_file"
        return 0
    else
        local exit_code=$?
        printf "  ${RED}✗${NC} %s\n" "$description"
        cat "$tmp_file"
        rm -f "$tmp_file"
        return $exit_code
    fi
}

# Run test command and extract test count
run_silent_with_test_count() {
    local description="$1"
    local command="$2"
    local test_type="${3:-pytest}"  # Default to pytest

    if [ "$VERBOSE" = "1" ]; then
        echo "  → Running: $command"
        eval "$command"
        return $?
    fi

    local tmp_file=$(mktemp)
    local test_count=""

    if eval "$command" > "$tmp_file" 2>&1; then
        # Extract test count based on test type
        case "$test_type" in
            pytest)
                # Look for pytest summary line like "45 passed in 2.3s"
                test_count=$(grep -E "[0-9]+ passed" "$tmp_file" | grep -oE "^[0-9]+ passed" | awk '{print $1}' | tail -1)
                if [ -n "$test_count" ]; then
                    local duration=$(grep -E "[0-9]+ passed" "$tmp_file" | grep -oE "in [0-9.]+s" | tail -1)
                    printf "  ${GREEN}✓${NC} %s (%s tests%s)\n" "$description" "$test_count" "${duration:+, $duration}"
                else
                    printf "  ${GREEN}✓${NC} %s\n" "$description"
                fi
                ;;
            jest)
                # For jest with --json output
                test_count=$(jq -r '.numTotalTests // empty' "$tmp_file" 2>/dev/null)
                if [ -n "$test_count" ]; then
                    printf "  ${GREEN}✓${NC} %s (%s tests)\n" "$description" "$test_count"
                else
                    printf "  ${GREEN}✓${NC} %s\n" "$description"
                fi
                ;;
            go)
                # For go test -json output
                test_count=$(grep -c '"Action":"pass"' "$tmp_file" 2>/dev/null || true)
                if [ "$test_count" -gt 0 ]; then
                    printf "  ${GREEN}✓${NC} %s (%s tests)\n" "$description" "$test_count"
                else
                    printf "  ${GREEN}✓${NC} %s\n" "$description"
                fi
                ;;
            vitest)
                # Look for vitest summary
                test_count=$(grep -E "Test Files.*passed" "$tmp_file" | grep -oE "[0-9]+ passed" | awk '{print $1}' | head -1)
                if [ -n "$test_count" ]; then
                    printf "  ${GREEN}✓${NC} %s (%s test files)\n" "$description" "$test_count"
                else
                    printf "  ${GREEN}✓${NC} %s\n" "$description"
                fi
                ;;
            *)
                printf "  ${GREEN}✓${NC} %s\n" "$description"
                ;;
        esac
        rm -f "$tmp_file"
        return 0
    else
        local exit_code=$?
        printf "  ${RED}✗${NC} %s\n" "$description"
        printf "${RED}Command failed: %s${NC}\n" "$command"
        cat "$tmp_file"
        rm -f "$tmp_file"
        return $exit_code
    fi
}

# Print section header
print_header() {
    local module="$1"
    local description="$2"
    printf "\n${BLUE}[%s]${NC} %s:\n" "$module" "$description"
}

# Print main section header
print_main_header() {
    local title="$1"
    printf "\n=== %s ===\n\n" "$title"
}

# Check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Install golangci-lint if needed (used by Go targets)
ensure_golangci_lint() {
    if ! command_exists golangci-lint; then
        echo "  Installing golangci-lint..."
        brew install golangci-lint >/dev/null 2>&1 || {
            echo "  ${RED}Failed to install golangci-lint${NC}"
            return 1
        }
    fi
}

# Removed tracking functionality - doesn't work across sub-makes
