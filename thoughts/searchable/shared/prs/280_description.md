## What problem(s) was I solving?

The WUI's diff viewer was limited to showing only isolated find/replace strings without surrounding context because the system only stored partial file content from Read tool operations. When Claude Code reads files with offset/limit parameters, only the requested portion is available, making it impossible to show full context diffs. This PR implements a file snapshot system that captures and stores complete file content during Read operations, creating the foundation for proper diff display in future WUI enhancements.

## What user-facing changes did I ship?

None. This is a backend infrastructure change that captures and stores file snapshots in the database. Users won't see any immediate changes, but this creates the foundation for future WUI enhancements to display full-context diffs with proper line numbers and surrounding code.

## How I implemented it

I added a file snapshot system to the hld daemon that:

1. **Database Schema**: Created a new `file_snapshots` table via migration 7 that stores tool ID, session ID, relative file path, and full content with appropriate indexes.

2. **Async Capture Logic**: Modified the session manager to asynchronously capture file snapshots when processing Read tool results. The system intelligently determines whether to use content directly from the tool result or read from the filesystem.

3. **Smart Content Resolution**: 
   - When Read returns full content (no limit/offset), uses the tool result directly
   - When Read returns partial content, reads the full file from the filesystem
   - Handles large files gracefully with a 10MB size limit
   - Properly resolves both absolute and relative file paths

4. **Line-Numbered Format Parsing**: Added `parseReadToolContent` function to extract actual file content from Claude Code's line-numbered Read tool output format (e.g., "1→content").

5. **Store Integration**: Added `GetToolCallByID`, `CreateFileSnapshot`, and `GetFileSnapshots` methods to the store interface with SQLite implementations.

The implementation follows existing patterns in the codebase, using async processing to avoid blocking the stream and proper error handling throughout.

## How to verify it

- [x] I have ensured `make check test` passes

The PR includes comprehensive integration tests that verify:
- Full content capture from Read tool results
- Partial content capture with filesystem fallback
- Large file handling (>10MB)
- Error handling for non-existent files
- Invalid input handling
- Special characters in paths and content

All existing and new tests pass successfully.

## Description for the changelog

feat(hld): implement file snapshot system to capture full content during Read operations