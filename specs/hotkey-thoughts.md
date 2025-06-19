# Hotkey and Command Specification

## Global Hotkeys

| Hotkey | Description |
|--------|-------------|
| `⌘K` | Open global command palette to search and access all commands |
| `/` | Search across all sessions and approvals |
| `g` | Go-to prefix for quick navigation |

### Go-to Navigation Commands
After pressing `g`, the following keys activate navigation:

| Key | Navigation Target |
|-----|------------------|
| `a` | Approvals page |
| `s` | Sessions page |
| `t` | Templates page |
| `p` | Pending items |

## Command Palette (⌘K)

The command palette provides centralized access to all system commands and features.

### Available Commands

#### Navigation
- All go-to commands (equivalent to `g` prefix hotkeys)
  - Go to Sessions
  - Go to Approvals
  - Go to Templates
  - Go to Pending Items

#### Actions
- Launch Session
- Search Sessions
- Create Template

## Implementation Notes

- Command palette should provide fuzzy search across all commands
- Hotkeys should be configurable in the future
- Consider adding tooltips for new users to discover hotkeys
- Ensure hotkeys don't conflict with browser/OS defaults
