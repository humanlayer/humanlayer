package handlers

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"time"

	"github.com/humanlayer/humanlayer/hld/api"
	"github.com/humanlayer/humanlayer/hld/internal/filescan"
	"github.com/sahilm/fuzzy"
)

// FileHandlers implements file search operations
type FileHandlers struct{}

// NewFileHandlers creates a new FileHandlers instance
func NewFileHandlers() *FileHandlers {
	return &FileHandlers{}
}

// FuzzySearchFiles implements fuzzy file/folder search
func (h *FileHandlers) FuzzySearchFiles(
	ctx context.Context,
	req api.FuzzySearchFilesRequestObject,
) (api.FuzzySearchFilesResponseObject, error) {
	startTime := time.Now()

	// Validate request
	if err := validateSearchRequest(req.Body); err != nil {
		return api.FuzzySearchFiles400JSONResponse{
			BadRequestJSONResponse: api.BadRequestJSONResponse{
				Error: api.ErrorDetail{
					Code:    "HLD-3001",
					Message: err.Error(),
				},
			},
		}, nil
	}

	// Create timeout context (5 seconds)
	searchCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	// Expand tildes in paths
	expandedPaths := make([]string, len(req.Body.Paths))
	for i, path := range req.Body.Paths {
		expandedPaths[i] = expandTilde(path)
	}

	// Initialize scanner
	scanOpts := filescan.ScanOptions{
		Paths:            expandedPaths,
		FilesOnly:        req.Body.FilesOnly != nil && *req.Body.FilesOnly,
		RespectGitignore: req.Body.RespectGitignore == nil || *req.Body.RespectGitignore,
	}

	scanner, err := filescan.NewScanner(scanOpts)
	if err != nil {
		slog.Error("Failed to create scanner",
			"error", fmt.Sprintf("%v", err),
			"paths", req.Body.Paths,
			"operation", "FuzzySearchFiles",
		)
		return api.FuzzySearchFiles400JSONResponse{
			BadRequestJSONResponse: api.BadRequestJSONResponse{
				Error: api.ErrorDetail{
					Code:    "HLD-3001",
					Message: fmt.Sprintf("Invalid search paths: %v", err),
				},
			},
		}, nil
	}

	// Scan file system
	entries, err := scanner.Scan(searchCtx)
	timedOut := false
	if err == context.DeadlineExceeded || err == context.Canceled {
		timedOut = true
		// Continue with partial results
		slog.Warn("File scan timed out, returning partial results",
			"scanned", len(entries),
			"operation", "FuzzySearchFiles",
		)
	} else if err != nil {
		slog.Error("File scan failed",
			"error", fmt.Sprintf("%v", err),
			"operation", "FuzzySearchFiles",
		)
		return api.FuzzySearchFiles500JSONResponse{
			InternalErrorJSONResponse: api.InternalErrorJSONResponse{
				Error: api.ErrorDetail{
					Code:    "HLD-4001",
					Message: fmt.Sprintf("File system scan failed: %v", err),
				},
			},
		}, nil
	}

	// Convert to string slice for fuzzy matching
	paths := make([]string, len(entries))
	for i, entry := range entries {
		paths[i] = entry.AbsPath
	}

	// Perform fuzzy matching without sorting (we'll do custom scoring)
	matches := fuzzy.FindNoSort(req.Body.Query, paths)

	// Enhance scores to prefer basename matches over directory path matches
	for i := range matches {
		// Find the last separator to identify basename portion
		lastSep := strings.LastIndexAny(matches[i].Str, "/\\")

		// Count how many matched characters are in the basename
		basenameMatches := 0
		for _, idx := range matches[i].MatchedIndexes {
			if idx > lastSep {
				basenameMatches++
			}
		}

		// Boost score significantly for each character matched in the basename
		// This ensures "readme" in "docs/readme.md" ranks higher than
		// scattered "r...e...a...d...m...e" in "/Users/nyx/dev/..."
		matches[i].Score += basenameMatches * 30
	}

	// Sort by enhanced scores (higher is better)
	sort.Stable(matches)

	// Apply limit
	limit := 20
	if req.Body.Limit != nil {
		limit = *req.Body.Limit
	}
	totalMatches := len(matches)
	if len(matches) > limit {
		matches = matches[:limit]
	}

	// Convert to API response
	results := make([]api.FileMatch, len(matches))
	for i, match := range matches {
		// Find original entry to get IsDir flag
		var isDir bool
		for _, entry := range entries {
			if entry.AbsPath == match.Str {
				isDir = entry.IsDir
				break
			}
		}

		results[i] = api.FileMatch{
			Path:           match.Str,
			Score:          match.Score,
			MatchedIndexes: match.MatchedIndexes,
			IsDirectory:    isDir,
		}
	}

	duration := time.Since(startTime)

	response := api.FuzzySearchFilesResponse{
		Results: results,
		Metadata: api.SearchMetadata{
			TotalScanned: len(entries),
			TotalMatches: totalMatches,
			DurationMs:   int(duration.Milliseconds()),
			TimedOut:     timedOut,
		},
	}

	return api.FuzzySearchFiles200JSONResponse(response), nil
}

// validateSearchRequest checks request validity
func validateSearchRequest(req *api.FuzzySearchFilesRequest) error {
	if req == nil {
		return fmt.Errorf("request body required")
	}
	if req.Query == "" {
		return fmt.Errorf("query cannot be empty")
	}
	if len(req.Paths) == 0 {
		return fmt.Errorf("at least one path required")
	}
	if len(req.Paths) > 10 {
		return fmt.Errorf("maximum 10 paths allowed")
	}
	if req.Limit != nil && (*req.Limit < 1 || *req.Limit > 1000) {
		return fmt.Errorf("limit must be between 1 and 1000")
	}
	return nil
}
