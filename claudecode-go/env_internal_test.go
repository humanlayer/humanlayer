package claudecode

import (
	"strings"
	"testing"
)

func TestFilteredEnviron(t *testing.T) {
	t.Run("strips CLAUDECODE variable", func(t *testing.T) {
		t.Setenv("CLAUDECODE", "1")

		env := filteredEnviron()

		for _, e := range env {
			if strings.HasPrefix(e, "CLAUDECODE=") {
				t.Errorf("filteredEnviron() should strip CLAUDECODE, but found: %s", e)
			}
		}
	})

	t.Run("preserves other variables", func(t *testing.T) {
		t.Setenv("CLAUDECODE", "1")
		t.Setenv("TEST_PRESERVE_VAR", "keep_me")

		env := filteredEnviron()

		found := false
		for _, e := range env {
			if strings.HasPrefix(e, "TEST_PRESERVE_VAR=") {
				found = true
				if e != "TEST_PRESERVE_VAR=keep_me" {
					t.Errorf("expected TEST_PRESERVE_VAR=keep_me, got %s", e)
				}
				break
			}
		}
		if !found {
			t.Error("filteredEnviron() should preserve other variables, but TEST_PRESERVE_VAR was missing")
		}
	})

	t.Run("works when CLAUDECODE is not set", func(t *testing.T) {
		// Don't set CLAUDECODE — filteredEnviron should return all env vars
		env := filteredEnviron()

		if len(env) == 0 {
			t.Error("filteredEnviron() should return non-empty environment")
		}
	})
}
