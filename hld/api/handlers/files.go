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

	// Determine limit
	limit := 20
	if req.Body.Limit != nil {
		limit = *req.Body.Limit
	}

	// Two-round search strategy:
	// Round 1: Search basenames only (better quality results)
	// Round 2: If needed, search full paths to fill up to limit

	// Extract basenames for first round
	basenames := make([]string, len(paths))
	for i, path := range paths {
		lastSep := strings.LastIndexAny(path, "/\\")
		if lastSep >= 0 {
			basenames[i] = path[lastSep+1:]
		} else {
			basenames[i] = path
		}
	}

	// Round 1: Search basenames
	basenameMatches := fuzzy.FindNoSort(req.Body.Query, basenames)

	// Track which path indices we've already matched
	matchedIndices := make(map[int]struct{})
	var allMatches fuzzy.Matches

	// Convert basename matches to full path matches
	for _, match := range basenameMatches {
		fullPath := paths[match.Index]
		lastSep := strings.LastIndexAny(fullPath, "/\\")

		// Adjust matched indexes to be relative to full path
		adjustedIndexes := make([]int, len(match.MatchedIndexes))
		for i, idx := range match.MatchedIndexes {
			adjustedIndexes[i] = lastSep + 1 + idx
		}

		// Boost score for basename matches to prioritize them over full path matches
		boostedScore := match.Score + (len(match.MatchedIndexes) * 30)

		fullMatch := fuzzy.Match{
			Str:            fullPath,
			Index:          match.Index,
			Score:          boostedScore,
			MatchedIndexes: adjustedIndexes,
		}

		allMatches = append(allMatches, fullMatch)
		matchedIndices[match.Index] = struct{}{}
	}

	// Round 2: If we need more results, search full paths
	if len(allMatches) < limit {
		fullPathMatches := fuzzy.FindNoSort(req.Body.Query, paths)

		// Add new matches that weren't already included from basename search
		for _, match := range fullPathMatches {
			if _, alreadyMatched := matchedIndices[match.Index]; !alreadyMatched {
				allMatches = append(allMatches, match)
				matchedIndices[match.Index] = struct{}{}

				// Stop if we've reached the limit
				if len(allMatches) >= limit {
					break
				}
			}
		}
	}

	// Sort by score (higher is better)
	sort.Stable(allMatches)

	// Apply limit and track total matches
	totalMatches := len(allMatches)
	if len(allMatches) > limit {
		allMatches = allMatches[:limit]
	}

	matches := allMatches

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

		// Compute display path (relative to first search path if possible)
		displayPath := match.Str
		if len(expandedPaths) > 0 {
			firstPath := expandedPaths[0]
			if strings.HasPrefix(match.Str, firstPath+"/") {
				displayPath = match.Str[len(firstPath)+1:]
			}
		}

		results[i] = api.FileMatch{
			Path:           match.Str,
			DisplayPath:    displayPath,
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
