package filescan

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewScanner_ValidatesAbsolutePaths(t *testing.T) {
	opts := ScanOptions{
		Paths: []string{"relative/path"},
	}
	_, err := NewScanner(opts)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "must be absolute")
}

func TestNewScanner_ValidatesDirectoryExists(t *testing.T) {
	opts := ScanOptions{
		Paths: []string{"/nonexistent/path"},
	}
	_, err := NewScanner(opts)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "cannot access")
}

func TestScanner_BasicFileDiscovery(t *testing.T) {
	// Setup test directory
	tmpDir := t.TempDir()
	createTestFiles(t, tmpDir, []string{
		"file1.txt",
		"dir1/file2.go",
		"dir1/dir2/file3.md",
	})

	opts := ScanOptions{
		Paths:            []string{tmpDir},
		RespectGitignore: false,
	}
	scanner, err := NewScanner(opts)
	require.NoError(t, err)

	results, err := scanner.Scan(context.Background())
	require.NoError(t, err)

	// Should find 3 files + 2 directories
	assert.Len(t, results, 5)
}

func TestScanner_FilesOnlyOption(t *testing.T) {
	tmpDir := t.TempDir()
	createTestFiles(t, tmpDir, []string{
		"file1.txt",
		"dir1/file2.go",
	})

	opts := ScanOptions{
		Paths:     []string{tmpDir},
		FilesOnly: true,
	}
	scanner, err := NewScanner(opts)
	require.NoError(t, err)

	results, err := scanner.Scan(context.Background())
	require.NoError(t, err)

	// Should find only 2 files, no directories
	assert.Len(t, results, 2)
	for _, r := range results {
		assert.False(t, r.IsDir)
	}
}

func TestScanner_GitignoreFiltering(t *testing.T) {
	tmpDir := t.TempDir()

	// Create .gitignore
	gitignore := filepath.Join(tmpDir, ".gitignore")
	err := os.WriteFile(gitignore, []byte("*.log\nbuild/\n"), 0644)
	require.NoError(t, err)

	createTestFiles(t, tmpDir, []string{
		"src/main.go",
		"src/debug.log",
		"build/output.txt",
		"README.md",
	})

	opts := ScanOptions{
		Paths:            []string{tmpDir},
		RespectGitignore: true,
	}
	scanner, err := NewScanner(opts)
	require.NoError(t, err)

	results, err := scanner.Scan(context.Background())
	require.NoError(t, err)

	// Collect basenames
	var names []string
	for _, r := range results {
		names = append(names, filepath.Base(r.AbsPath))
	}

	// Should include main.go and README.md
	assert.Contains(t, names, "main.go")
	assert.Contains(t, names, "README.md")
	// Should exclude debug.log and build/
	assert.NotContains(t, names, "debug.log")
	assert.NotContains(t, names, "build")
}

func TestScanner_ContextCancellation(t *testing.T) {
	tmpDir := t.TempDir()
	// Create many files to ensure scan takes measurable time
	for i := 0; i < 100; i++ {
		err := os.WriteFile(filepath.Join(tmpDir, fmt.Sprintf("file%d.txt", i)), []byte("test"), 0644)
		require.NoError(t, err)
	}

	opts := ScanOptions{Paths: []string{tmpDir}}
	scanner, err := NewScanner(opts)
	require.NoError(t, err)

	// Use a context that's already cancelled
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	_, err = scanner.Scan(ctx)

	// Should return context.Canceled error
	assert.ErrorIs(t, err, context.Canceled)
}

// Helper to create test file structure
func createTestFiles(t *testing.T, root string, paths []string) {
	for _, p := range paths {
		fullPath := filepath.Join(root, p)
		dir := filepath.Dir(fullPath)

		err := os.MkdirAll(dir, 0755)
		require.NoError(t, err)

		err = os.WriteFile(fullPath, []byte("test content"), 0644)
		require.NoError(t, err)
	}
}
