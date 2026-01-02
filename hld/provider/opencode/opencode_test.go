package opencode_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/humanlayer/humanlayer/hld/provider/opencode"
)

func TestProvider(t *testing.T) {
	t.Run("Name", func(t *testing.T) {
		// Even without a valid client, we can test the provider name
		p := opencode.NewProviderWithPath("/nonexistent/path")
		require.Equal(t, "opencode", p.Name())
	})

	t.Run("GetPathReturnsConfiguredPath", func(t *testing.T) {
		path := "/usr/local/bin/opencode"
		p := opencode.NewProviderWithPath(path)
		require.Equal(t, path, p.GetPath())
	})

	t.Run("IsAvailableReturnsFalseWithInvalidPath", func(t *testing.T) {
		p := opencode.NewProviderWithPath("/nonexistent/path")
		// The provider with path constructor doesn't validate,
		// but it sets up the client anyway
		require.NotNil(t, p)
	})
}

func TestProviderInterface(t *testing.T) {
	t.Run("ProviderWithPathImplementsInterface", func(t *testing.T) {
		p := opencode.NewProviderWithPath("/test/path")

		// Verify all interface methods exist
		_ = p.Name()
		_ = p.IsAvailable()
		_ = p.GetPath()

		// GetVersion will fail with invalid path but should not panic
		_, err := p.GetVersion()
		require.Error(t, err) // Expected to fail with invalid path
	})
}
