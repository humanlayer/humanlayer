package handlers_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/humanlayer/humanlayer/hld/api"
	"github.com/humanlayer/humanlayer/hld/api/handlers"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFuzzySearchFiles_Success(t *testing.T) {
	// Setup test directory
	tmpDir := t.TempDir()
	createTestFiles(t, tmpDir, []string{
		"fuzzyHandler.go",
		"fuzzySearch.go",
		"handler.go",
		"utils.go",
	})

	router := setupTestRouterFiles(t, handlers.NewFileHandlers())

	reqBody := api.FuzzySearchFilesRequest{
		Query: "fuz",
		Paths: []string{tmpDir},
	}
	w := makeRequest(t, router, "POST", "/api/v1/fuzzy-search/files", reqBody)

	assert.Equal(t, http.StatusOK, w.Code)

	var resp api.FuzzySearchFilesResponse
	err := json.NewDecoder(w.Body).Decode(&resp)
	require.NoError(t, err)

	// Should match fuzzyHandler.go and fuzzySearch.go
	assert.GreaterOrEqual(t, len(resp.Results), 2)
	assert.False(t, resp.Metadata.TimedOut)
	assert.Greater(t, resp.Metadata.TotalScanned, 0)
}

func TestFuzzySearchFiles_FilesOnly(t *testing.T) {
	tmpDir := t.TempDir()
	createTestFiles(t, tmpDir, []string{
		"dir1/file.go",
		"file.txt",
	})

	router := setupTestRouterFiles(t, handlers.NewFileHandlers())

	filesOnly := true
	reqBody := api.FuzzySearchFilesRequest{
		Query:     "file",
		Paths:     []string{tmpDir},
		FilesOnly: &filesOnly,
	}
	w := makeRequest(t, router, "POST", "/api/v1/fuzzy-search/files", reqBody)

	assert.Equal(t, http.StatusOK, w.Code)

	var resp api.FuzzySearchFilesResponse
	err := json.NewDecoder(w.Body).Decode(&resp)
	require.NoError(t, err)

	// All results should be files
	for _, r := range resp.Results {
		assert.False(t, r.IsDirectory)
	}
}

func TestFuzzySearchFiles_GitignoreRespected(t *testing.T) {
	tmpDir := t.TempDir()

	// Create .gitignore
	gitignore := filepath.Join(tmpDir, ".gitignore")
	err := os.WriteFile(gitignore, []byte("ignored.txt\n"), 0644)
	require.NoError(t, err)

	createTestFiles(t, tmpDir, []string{
		"included.txt",
		"ignored.txt",
	})

	router := setupTestRouterFiles(t, handlers.NewFileHandlers())

	reqBody := api.FuzzySearchFilesRequest{
		Query: "txt",
		Paths: []string{tmpDir},
	}
	w := makeRequest(t, router, "POST", "/api/v1/fuzzy-search/files", reqBody)

	assert.Equal(t, http.StatusOK, w.Code)

	var resp api.FuzzySearchFilesResponse
	err = json.NewDecoder(w.Body).Decode(&resp)
	require.NoError(t, err)

	// Should only include included.txt
	var paths []string
	for _, r := range resp.Results {
		paths = append(paths, filepath.Base(r.Path))
	}
	assert.Contains(t, paths, "included.txt")
	assert.NotContains(t, paths, "ignored.txt")
}

func TestFuzzySearchFiles_InvalidPath(t *testing.T) {
	router := setupTestRouterFiles(t, handlers.NewFileHandlers())

	reqBody := api.FuzzySearchFilesRequest{
		Query: "test",
		Paths: []string{"/nonexistent/path"},
	}
	w := makeRequest(t, router, "POST", "/api/v1/fuzzy-search/files", reqBody)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assertErrorResponse(t, w, "HLD-3001", "Invalid search paths")
}

func TestFuzzySearchFiles_EmptyQuery(t *testing.T) {
	router := setupTestRouterFiles(t, handlers.NewFileHandlers())

	tmpDir := t.TempDir()
	reqBody := api.FuzzySearchFilesRequest{
		Query: "",
		Paths: []string{tmpDir},
	}
	w := makeRequest(t, router, "POST", "/api/v1/fuzzy-search/files", reqBody)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assertErrorResponse(t, w, "HLD-3001", "query cannot be empty")
}

func TestFuzzySearchFiles_LimitApplied(t *testing.T) {
	tmpDir := t.TempDir()

	// Create 50 files
	var files []string
	for i := 0; i < 50; i++ {
		files = append(files, fmt.Sprintf("test%d.txt", i))
	}
	createTestFiles(t, tmpDir, files)

	router := setupTestRouterFiles(t, handlers.NewFileHandlers())

	limit := 10
	reqBody := api.FuzzySearchFilesRequest{
		Query: "test",
		Paths: []string{tmpDir},
		Limit: &limit,
	}
	w := makeRequest(t, router, "POST", "/api/v1/fuzzy-search/files", reqBody)

	assert.Equal(t, http.StatusOK, w.Code)

	var resp api.FuzzySearchFilesResponse
	err := json.NewDecoder(w.Body).Decode(&resp)
	require.NoError(t, err)

	assert.LessOrEqual(t, len(resp.Results), 10)
	// Should have found more matches than returned
	assert.Greater(t, resp.Metadata.TotalMatches, 10)
}

func TestFuzzySearchFiles_AbsolutePath(t *testing.T) {
	tmpDir := t.TempDir()
	createTestFiles(t, tmpDir, []string{
		"test.txt",
		"file.go",
		"nested/test.txt", // Should NOT be found due to depth limit
	})

	router := setupTestRouterFiles(t, handlers.NewFileHandlers())

	// Query with absolute path should search only top-level of that directory
	reqBody := api.FuzzySearchFilesRequest{
		Query: tmpDir + "/test",
		Paths: []string{"/some/other/path"}, // Should be overridden
	}
	w := makeRequest(t, router, "POST", "/api/v1/fuzzy-search/files", reqBody)

	assert.Equal(t, http.StatusOK, w.Code)

	var resp api.FuzzySearchFilesResponse
	err := json.NewDecoder(w.Body).Decode(&resp)
	require.NoError(t, err)

	// Should find top-level test.txt
	assert.GreaterOrEqual(t, len(resp.Results), 1)
	foundTopLevel := false
	foundNested := false
	for _, r := range resp.Results {
		if r.Path == filepath.Join(tmpDir, "test.txt") {
			foundTopLevel = true
		}
		if r.Path == filepath.Join(tmpDir, "nested/test.txt") {
			foundNested = true
		}
	}
	assert.True(t, foundTopLevel, "Should find top-level test.txt")
	assert.False(t, foundNested, "Should NOT find nested test.txt due to depth=1")
}

func TestFuzzySearchFiles_AbsolutePathTrailingSlash(t *testing.T) {
	tmpDir := t.TempDir()
	createTestFiles(t, tmpDir, []string{
		"nested/file.txt",
		"file.go",
		"test.txt",
	})

	router := setupTestRouterFiles(t, handlers.NewFileHandlers())

	// Query ending with / should search only top-level of that directory
	reqBody := api.FuzzySearchFilesRequest{
		Query: tmpDir + "/",
		Paths: []string{"/some/other/path"},
	}
	w := makeRequest(t, router, "POST", "/api/v1/fuzzy-search/files", reqBody)

	assert.Equal(t, http.StatusOK, w.Code)

	var resp api.FuzzySearchFilesResponse
	err := json.NewDecoder(w.Body).Decode(&resp)
	require.NoError(t, err)

	// Should find top-level items (file.go, test.txt, nested dir) but NOT nested/file.txt
	assert.GreaterOrEqual(t, len(resp.Results), 2)

	// Verify nested/file.txt is NOT in results
	for _, r := range resp.Results {
		assert.NotEqual(t, filepath.Join(tmpDir, "nested/file.txt"), r.Path,
			"Should not find nested files when listing directory with trailing slash")
	}

	// Verify we do have top-level files
	foundTopLevel := false
	for _, r := range resp.Results {
		if filepath.Base(r.Path) == "file.go" || filepath.Base(r.Path) == "test.txt" {
			foundTopLevel = true
			break
		}
	}
	assert.True(t, foundTopLevel, "Should find top-level files")
}

func TestFuzzySearchFiles_AbsolutePathNonExistent(t *testing.T) {
	router := setupTestRouterFiles(t, handlers.NewFileHandlers())

	// Query with non-existent absolute path should return error
	reqBody := api.FuzzySearchFilesRequest{
		Query: "/nonexistent/directory/test",
		Paths: []string{"/some/path"},
	}
	w := makeRequest(t, router, "POST", "/api/v1/fuzzy-search/files", reqBody)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assertErrorResponse(t, w, "HLD-3001", "Invalid search paths")
}

// Helper to setup router with file handlers
func setupTestRouterFiles(t *testing.T, files *handlers.FileHandlers) *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()

	// Create server implementation with file handlers
	// Pass nil for handlers we don't need in these tests
	settingsHandlers := handlers.NewSettingsHandlers(nil)
	serverImpl := handlers.NewServerImpl(nil, nil, files, nil, settingsHandlers)
	strictHandler := api.NewStrictHandler(serverImpl, nil)

	api.RegisterHandlersWithOptions(router, strictHandler,
		api.GinServerOptions{BaseURL: "/api/v1"})

	return router
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
