package handlers

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/humanlayer/humanlayer/hld/api"
)

func TestGetSlashCommands(t *testing.T) {
	handler := &SessionHandlers{}
	ctx := context.Background()

	tests := []struct {
		name     string
		query    string
		expected []string
	}{
		{
			name:     "no query returns all commands",
			query:    "",
			expected: []string{"/create_plan", "/implement_plan", "/research_codebase", "/linear", "/hl:research", "/hl:alpha:test"},
		},
		{
			name:     "fuzzy match 'plan'",
			query:    "plan",
			expected: []string{"/create_plan", "/implement_plan"},
		},
		{
			name:     "fuzzy match 'research'",
			query:    "research",
			expected: []string{"/research_codebase", "/hl:research"},
		},
		{
			name:     "fuzzy match 'hl'",
			query:    "hl",
			expected: []string{"/hl:research", "/hl:alpha:test"},
		},
		{
			name:     "fuzzy match 'lin'",
			query:    "lin",
			expected: []string{"/linear"},
		},
		{
			name:     "fuzzy match 'impl'",
			query:    "impl",
			expected: []string{"/implement_plan"},
		},
		{
			name:     "no results for non-matching query",
			query:    "xyz123",
			expected: []string{},
		},
		{
			name:     "just slash returns all commands",
			query:    "/",
			expected: []string{"/create_plan", "/implement_plan", "/research_codebase", "/linear", "/hl:research", "/hl:alpha:test"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var queryPtr *string
			if tt.query != "" {
				queryPtr = &tt.query
			}

			req := api.GetSlashCommandsRequestObject{
				Params: api.GetSlashCommandsParams{
					SessionId: "test-session",
					Query:     queryPtr,
				},
			}

			resp, err := handler.GetSlashCommands(ctx, req)
			assert.NoError(t, err)

			jsonResp, ok := resp.(api.GetSlashCommands200JSONResponse)
			assert.True(t, ok, "expected 200 response")

			// Extract command names
			var names []string
			for _, cmd := range jsonResp.Data {
				names = append(names, cmd.Name)
			}

			assert.ElementsMatch(t, tt.expected, names, "commands should match expected for query: %s", tt.query)
		})
	}
}