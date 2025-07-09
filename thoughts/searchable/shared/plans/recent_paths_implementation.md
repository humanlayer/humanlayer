# Recent Paths Implementation Plan (ENG-1429)

## Overview

Implement a Chrome-like recent paths feature for the session launcher that tracks previously used directories and provides intelligent filtering as users type. This follows Option 1 from the research document with enhanced search capabilities.

## Current State Analysis

The session launcher currently requires users to type full directory paths manually. While the WUI has fuzzy search for exploring directories, it doesn't remember or suggest previously used paths.

### Key Discoveries:
- WUI already has robust fuzzy search infrastructure in `FuzzySearchInput.tsx`
- Session history is stored in SQLite with `working_dir` field (`hld/store/sqlite.go:81`)
- Frontend receives `working_dir` data but only for "leaf" sessions
- No existing mechanism to query ALL historical paths efficiently
- Chrome-like behavior requires querying full session history, not just visible sessions

## What We're NOT Doing

- No TUI implementation (TUI is archived)
- No persistent favorites or bookmarks
- No preset management UI
- No synchronization of preferences between users
- No auto-detection of project roots or git repositories
- No session templates or saved configurations
- No complex preset CRUD operations

## Implementation Approach

Following Chrome's URL bar pattern:
1. Track all directories used in previous sessions via daemon endpoint
2. As user types, filter recent paths using fuzzy/substring matching
3. Display filtered results in a dropdown with keyboard navigation
4. If a path hasn't been used before, user must type it fully

### Why Daemon Implementation Over Frontend-Only

After analysis, implementing in the daemon provides:
- Access to ALL historical sessions, not just currently visible ones
- Efficient SQL-based deduplication and sorting
- Better performance with proper indexing
- True Chrome-like behavior with complete history

## Phase 1: Backend - Add Recent Paths Query

### Overview
Add the ability to query distinct recently used directories from session history.

### Changes Required:

#### 1. Store Interface Extension
**File**: `hld/store/store.go`
**Changes**: Add new method to ConversationStore interface

```go
// After line 48, before Close() error
GetRecentWorkingDirs(ctx context.Context, limit int) ([]RecentPath, error)

// After line 178, add new type
type RecentPath struct {
    Path         string    `json:"path"`
    LastUsed     time.Time `json:"last_used"`
    UsageCount   int       `json:"usage_count"`
}
```

#### 2. SQLite Implementation
**File**: `hld/store/sqlite.go`
**Changes**: Implement the new method with efficient querying

```go
// Add after ListSessions method (around line 725)
func (s *SQLiteStore) GetRecentWorkingDirs(ctx context.Context, limit int) ([]RecentPath, error) {
    if limit <= 0 {
        limit = 20 // Default to 20 recent paths
    }

    query := `
        SELECT 
            working_dir as path,
            MAX(last_activity_at) as last_used,
            COUNT(*) as usage_count
        FROM sessions
        WHERE working_dir IS NOT NULL 
            AND working_dir != ''
            AND working_dir != '.'
        GROUP BY working_dir
        ORDER BY MAX(last_activity_at) DESC
        LIMIT ?
    `

    rows, err := s.db.QueryContext(ctx, query, limit)
    if err != nil {
        return nil, fmt.Errorf("query recent paths: %w", err)
    }
    defer rows.Close()

    var paths []RecentPath
    for rows.Next() {
        var p RecentPath
        if err := rows.Scan(&p.Path, &p.LastUsed, &p.UsageCount); err != nil {
            return nil, fmt.Errorf("scan recent path: %w", err)
        }
        paths = append(paths, p)
    }

    return paths, rows.Err()
}
```

#### 3. RPC Handler
**File**: `hld/rpc/handlers.go`
**Changes**: Add RPC endpoint to expose recent paths

```go
// Add new request/response types after line 200
type GetRecentPathsRequest struct {
    Limit int `json:"limit,omitempty"`
}

type GetRecentPathsResponse struct {
    Paths []store.RecentPath `json:"paths"`
}

// Add handler method
func (h *Handler) GetRecentPaths(ctx context.Context, req GetRecentPathsRequest) (*GetRecentPathsResponse, error) {
    limit := req.Limit
    if limit <= 0 {
        limit = 20
    }

    paths, err := h.store.GetRecentWorkingDirs(ctx, limit)
    if err != nil {
        return nil, fmt.Errorf("get recent paths: %w", err)
    }

    return &GetRecentPathsResponse{Paths: paths}, nil
}
```

### Success Criteria:

#### Automated Verification:
- [ ] Backend compiles successfully: `cd hld && go build`
- [ ] Tests pass: `cd hld && go test ./...`
- [ ] RPC endpoint responds: `curl -X POST localhost:8789/rpc -d '{"method":"GetRecentPaths","params":{"limit":10}}'`

#### Manual Verification:
- [ ] Recent paths are returned in correct order (most recent first)
- [ ] Paths are deduplicated correctly
- [ ] Empty and '.' paths are filtered out

---

## Phase 2: WUI - Enhance Fuzzy Search with Recent Paths

### Overview
Extend the existing FuzzySearchInput component to show recent paths alongside directory exploration.

### Changes Required:

#### 1. Daemon Client Extension
**File**: `humanlayer-wui/src/lib/daemon/client.ts`
**Changes**: Add method to fetch recent paths

```typescript
// Add to DaemonClient class
async getRecentPaths(limit?: number): Promise<RecentPath[]> {
  const response = await this.request<GetRecentPathsResponse>('GetRecentPaths', { limit });
  return response.paths;
}
```

**File**: `humanlayer-wui/src/lib/daemon/types.ts`
**Changes**: Add type definitions

```typescript
export interface RecentPath {
  path: string;
  last_used: string;
  usage_count: number;
}

export interface GetRecentPathsResponse {
  paths: RecentPath[];
}
```

#### 2. Recent Paths Hook
**File**: `humanlayer-wui/src/hooks/useRecentPaths.ts` (new file)
**Changes**: Create hook to fetch and cache recent paths

```typescript
import { useQuery } from '@tanstack/react-query';
import { useDaemonClient } from './useDaemonClient';

export function useRecentPaths(limit = 20) {
  const client = useDaemonClient();

  return useQuery({
    queryKey: ['recentPaths', limit],
    queryFn: () => client.getRecentPaths(limit),
    staleTime: 60 * 1000, // Cache for 1 minute
    enabled: !!client,
  });
}
```

#### 3. Enhanced FuzzySearchInput
**File**: `humanlayer-wui/src/components/FuzzySearchInput.tsx`
**Changes**: Integrate recent paths into the suggestion dropdown

```typescript
// Add imports
import { useRecentPaths } from '@/hooks/useRecentPaths';
import { Clock } from 'lucide-react';

// Inside SearchInput component, after line 43
const { data: recentPaths = [] } = useRecentPaths();

// Modify onChange function (around line 150) to include recent paths
const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
  // ... existing code ...

  // After filtering directories (line 150), add recent paths filtering
  let combinedResults: Array<{
    selected: boolean;
    path: DirEntry | { name: string; isRecent: true };
    matches?: FuzzyMatch['matches'];
    isRecent?: boolean;
  }> = [];

  // Filter recent paths if we're at the root level or searching
  if (!basePath || searchTerm) {
    const recentFiltered = fuzzySearch(
      recentPaths.map(p => ({ name: p.path, isRecent: true })),
      searchTerm || searchValue,
      { keys: ['name'], threshold: 0.01 }
    );

    // Add recent paths to results
    combinedResults = recentFiltered.map((result, idx) => ({
      selected: idx === 0,
      path: result.item,
      matches: result.matches,
      isRecent: true,
    }));
  }

  // Add directory results after recent paths
  const dirResults = /* existing directory filtering logic */;
  combinedResults = [...combinedResults, ...dirResults];

  setDirectoryPreview(combinedResults);
};

// Update the render section to show recent paths differently (around line 220)
{directoryPreview.length > 0 && (
  <CommandGroup>
    {directoryPreview.map((item, idx) => (
      <CommandItem
        key={idx}
        className={cn('cursor-pointer', item.selected && 'bg-accent')}
        onSelect={() => {
          if (item.isRecent) {
            setSearchValue(item.path.name);
          } else {
            const newPath = basePath + item.path.name;
            setSearchValue(newPath);
          }
          setDropdownOpen(false);
        }}
      >
        <div className="flex items-center space-x-2">
          {item.isRecent && <Clock className="w-4 h-4 text-muted-foreground" />}
          <span className="flex-1">
            {/* Highlight matching characters */}
            {highlightMatches(item.path.name, item.matches?.[0]?.indices || []).map(
              (part, i) => (
                <span
                  key={i}
                  className={part.highlighted ? 'bg-yellow-300 dark:bg-yellow-600' : ''}
                >
                  {part.text}
                </span>
              )
            )}
          </span>
        </div>
      </CommandItem>
    ))}
  </CommandGroup>
)}
```

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compilation passes: `cd humanlayer-wui && bun run typecheck`
- [ ] Linting passes: `cd humanlayer-wui && bun run lint`
- [ ] Tests pass: `cd humanlayer-wui && bun test`

#### Manual Verification:
- [ ] Recent paths appear in dropdown when focusing the working directory field
- [ ] Recent paths are filtered as user types (fuzzy matching works)
- [ ] Clock icon distinguishes recent paths from directory exploration
- [ ] Selecting a recent path fills the input correctly
- [ ] Keyboard navigation works for recent paths

---

## Testing Strategy

### Unit Tests:
- Test `GetRecentWorkingDirs` with various edge cases (empty paths, duplicates)
- Test fuzzy filtering logic for recent paths

### Integration Tests:
- Launch sessions with different directories and verify they appear in recent paths
- Test that recent paths persist across daemon restarts
- Verify RPC endpoint returns correct data

### Manual Testing Steps:
1. Launch several sessions with different working directories
2. Open WUI and focus working directory field - verify recent paths appear
3. Type partial path - verify fuzzy filtering works
4. Check that recent paths show ALL historical directories, not just from visible sessions

## Performance Considerations

- SQL query uses existing indexes and GROUP BY for efficiency
- Recent paths are cached in WUI for 1 minute to avoid repeated queries
- Limit default of 20 paths keeps response size reasonable
- No background indexing or caching needed for Option 1

## Migration Notes

No migration needed - the feature reads from existing session data.

## References

- Original ticket: `thoughts/allison/tickets/eng_1429.md`
- Related research: `thoughts/shared/research/2025-06-30_11-24-53_path_presets_implementation.md`
- Chrome URL bar behavior example in ticket comments
- Existing fuzzy search: `humanlayer-wui/src/lib/fuzzy-search.ts`