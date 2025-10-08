package claudecode

import (
	"testing"
)

// TestBuildArgsWithDashPrefixedQuery tests that queries starting with dashes are handled correctly
// This test file uses package claudecode (not claudecode_test) to access private methods
func TestBuildArgsWithDashPrefixedQuery(t *testing.T) {
	client := NewClientWithPath("/usr/bin/claude")

	testCases := []struct {
		name        string
		query       string
		description string
	}{
		{
			name:        "query starting with single dash",
			query:       "-one thing",
			description: "Single dash at start should be treated as query text, not flag",
		},
		{
			name:        "query starting with double dash",
			query:       "--help",
			description: "Double dash at start should be treated as query text, not help flag",
		},
		{
			name:        "query with dash in middle",
			query:       "do this - and that",
			description: "Dash in middle should work correctly",
		},
		{
			name:        "query with only dash",
			query:       "-",
			description: "Single dash character should be treated as query text",
		},
		{
			name:        "query that looks like a flag",
			query:       "--model opus",
			description: "Query resembling a flag should be treated as text",
		},
		{
			name:        "normal query without dashes",
			query:       "normal query",
			description: "Normal queries should continue to work",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			config := SessionConfig{
				Query: tc.query,
			}

			// Call the private buildArgs method directly (accessible in same package)
			args, err := client.buildArgs(config)
			if err != nil {
				t.Fatalf("buildArgs failed: %v", err)
			}

			// Verify structure: args should end with --print -- <query>
			if len(args) < 3 {
				t.Fatalf("%s: expected at least 3 args [--print -- query], got %d: %v",
					tc.description, len(args), args)
			}

			// Check last three elements: must be --print, --, query (in that order)
			lastThree := args[len(args)-3:]
			if lastThree[0] != "--print" {
				t.Errorf("%s: expected --print as third-to-last arg, got %q", tc.description, lastThree[0])
			}
			if lastThree[1] != "--" {
				t.Errorf("%s: expected -- as second-to-last arg, got %q", tc.description, lastThree[1])
			}
			if lastThree[2] != tc.query {
				t.Errorf("%s: expected query %q as last arg, got %q", tc.description, tc.query, lastThree[2])
			}
		})
	}
}

// TestBuildArgsWithComplexConfigs tests buildArgs with various configuration options
// to ensure the -- separator doesn't interfere with other arguments
func TestBuildArgsWithComplexConfigs(t *testing.T) {
	client := NewClientWithPath("/usr/bin/claude")

	testCases := []struct {
		name     string
		config   SessionConfig
		contains []string
	}{
		{
			name: "dash query with model",
			config: SessionConfig{
				Query: "-help me",
				Model: ModelSonnet,
			},
			contains: []string{"--print", "--", "-help me", "--model", "sonnet"},
		},
		{
			name: "dash query with session",
			config: SessionConfig{
				Query:     "--test",
				SessionID: "test-session",
			},
			contains: []string{"--print", "--", "--test", "--resume", "test-session"},
		},
		{
			name: "dash query with output format",
			config: SessionConfig{
				Query:        "-query",
				OutputFormat: OutputJSON,
			},
			contains: []string{"--print", "--", "-query", "--output-format", "json"},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			args, err := client.buildArgs(tc.config)
			if err != nil {
				t.Fatalf("buildArgs failed: %v", err)
			}

			// Verify all expected strings are present
			argsStr := ""
			for _, arg := range args {
				argsStr += arg + " "
			}

			for _, expected := range tc.contains {
				found := false
				for _, arg := range args {
					if arg == expected {
						found = true
						break
					}
				}
				if !found {
					t.Errorf("Expected arg %q not found in args: %v", expected, args)
				}
			}

			// Verify correct ordering: <flags> --print -- <query>
			printIdx := -1
			separatorIdx := -1
			queryIdx := -1

			for i, arg := range args {
				if arg == "--print" {
					printIdx = i
				}
				if arg == "--" {
					separatorIdx = i
				}
				if arg == tc.config.Query {
					queryIdx = i
				}
			}

			if printIdx == -1 {
				t.Error("--print flag not found")
			}
			if separatorIdx == -1 {
				t.Error("-- separator not found")
			}
			if queryIdx == -1 {
				t.Errorf("query %q not found", tc.config.Query)
			}

			// Verify --print is the last flag before --
			if separatorIdx != printIdx+1 {
				t.Errorf("-- separator should immediately follow --print, got positions: --print=%d, --=%d",
					printIdx, separatorIdx)
			}
			// Verify query immediately follows --
			if queryIdx != separatorIdx+1 {
				t.Errorf("query should immediately follow --, got positions: --=%d, query=%d",
					separatorIdx, queryIdx)
			}
			// Verify query is the last argument
			if queryIdx != len(args)-1 {
				t.Errorf("query should be the last argument, got position %d of %d total args",
					queryIdx, len(args))
			}
			// Verify other flags come before --print
			for i := 0; i < printIdx; i++ {
				if args[i] == "--" {
					t.Errorf("-- separator found at position %d, should only appear at position %d (before query)",
						i, separatorIdx)
				}
				if args[i] == tc.config.Query {
					t.Errorf("query found at position %d, should only appear at position %d (after all flags)",
						i, queryIdx)
				}
			}
		})
	}
}
