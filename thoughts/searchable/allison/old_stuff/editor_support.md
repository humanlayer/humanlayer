# OpenCode External Editor Support Analysis

## Overview

OpenCode's Ctrl+E functionality provides external editor integration for composing messages within the TUI. This document analyzes the complete implementation, including vim binding support and the technical reasons why GUI editors are not supported.

## Vim Binding Support in OpenCode

### Navigation Bindings (hjkl)

OpenCode implements selective vim-style navigation keybindings throughout its TUI interface, but not full vim editing modes.

#### 1. List Navigation Components

**File:** `~/git/opencode/internal/tui/components/util/simple-list.go:52-59`

```go
UpAlpha: key.NewBinding(
    key.WithKeys("k"),
    key.WithHelp("k", "previous list item"),
),
DownAlpha: key.NewBinding(
    key.WithKeys("j"),
    key.WithHelp("j", "next list item"),
),
```

#### 2. Dialog Navigation

**Session Dialog:** `~/git/opencode/internal/tui/components/dialog/session.go:61-68`

- Keys: `j` (down), `k` (up)
- Function: Navigate between sessions in session picker

**Model Selection Dialog:** `~/git/opencode/internal/tui/components/dialog/models.go:89-104`

- Keys: `j` (down), `k` (up), `h` (left), `l` (right)
- Function: Navigate models and switch between providers

**File Picker:** `~/git/opencode/internal/tui/components/dialog/filepicker.go:54-67`

- Keys: `j` (down), `k` (up), `h` (back/up directory), `l` (enter directory)
- Function: Navigate file system

**Theme Dialog:** `~/git/opencode/internal/tui/components/dialog/theme.go:62-68`

- Keys: `j` (down), `k` (up)
- Function: Navigate theme options

**Tools Dialog:** `~/git/opencode/internal/tui/components/dialog/tools.go:84-90`

- Keys: `j` (down), `k` (up)
- Function: Navigate available tools list

#### 3. Page Navigation

**Logs Page:** `~/git/opencode/internal/tui/page/logs.go:30-36`

- Keys: `h` (left), `l` (right)
- Function: Navigate between log details and table view

#### 4. Scrolling Support

**Messages Component:** `~/git/opencode/internal/tui/components/chat/messages.go:62-69`

- Keys: `Ctrl+u` (half page up), `Ctrl+d` (half page down)
- Function: Vim-style scrolling in message viewport

### Text Editor Component

**File:** `~/git/opencode/internal/tui/components/chat/editor.go:103`

The built-in textarea component does not have vim editing modes. Instead, it defaults to using `nvim` as the external editor when no `$EDITOR` environment variable is set:

```go
editor := os.Getenv("EDITOR")
if editor == "" {
    editor = "nvim"
}
```

Users can access full vim functionality via `Ctrl+E` to open their preferred external editor.

## Ctrl+E External Editor Implementation

### 1. Key Binding Registration

**File:** `~/git/opencode/internal/tui/components/chat/editor.go:58-79`

```go
var editorMaps = EditorKeyMaps{
    OpenEditor: key.NewBinding(
        key.WithKeys("ctrl+e"),
        key.WithHelp("ctrl+e", "open editor"),
    ),
    // ... other bindings
}

type EditorKeyMaps struct {
    Send       key.Binding
    OpenEditor key.Binding  // Handles Ctrl+E
    Paste      key.Binding
    HistoryUp  key.Binding
    HistoryDown key.Binding
}
```

### 2. Event Handling and State Management

**File:** `~/git/opencode/internal/tui/components/chat/editor.go:219-227`

```go
if key.Matches(msg, editorMaps.OpenEditor) {
    if m.app.PrimaryAgent.IsSessionBusy(m.app.CurrentSession.ID) {
        status.Warn("Agent is working, please wait...")
        return m, nil
    }
    value := m.textarea.Value()
    m.textarea.Reset()
    return m, m.openEditor(value)
}
```

**Key Design Decisions:**

- **Agent busy check:** Prevents conflicts with ongoing AI operations
- **Immediate textarea reset:** Prevents double-input scenarios
- **Content preservation:** Current text is passed to external editor

### 3. Core External Editor Implementation

**File:** `~/git/opencode/internal/tui/components/chat/editor.go:100-139`

#### Editor Selection Logic

```go
editor := os.Getenv("EDITOR")
if editor == "" {
    editor = "nvim"
}
```

**Priority Order:**

1. `$EDITOR` environment variable
2. `nvim` default fallback

#### Temporary File Management

```go
tmpfile, err := os.CreateTemp("", "msg_*.md")
tmpfile.WriteString(value)
if err != nil {
    status.Error(err.Error())
    return nil
}
tmpfile.Close()
```

**Implementation Details:**

- Creates files with pattern `msg_*.md` in system temp directory
- Uses `.md` extension for Markdown syntax highlighting
- Writes current textarea content before editor launch

#### Process Spawning and Terminal Integration

```go
c := exec.Command(editor, tmpfile.Name())
c.Stdin = os.Stdin
c.Stdout = os.Stdout
c.Stderr = os.Stderr
return tea.ExecProcess(c, func(err error) tea.Msg {
    // callback logic
})
```

**Technical Architecture:**

- Uses `exec.Command` for process spawning
- Connects stdin/stdout/stderr to terminal for full interaction
- Leverages Bubble Tea's `tea.ExecProcess` for proper TUI suspension/restoration

### 4. Return Value Processing and Cleanup

**Callback Function (Lines 117-138):**

```go
return tea.ExecProcess(c, func(err error) tea.Msg {
    if err != nil {
        status.Error(err.Error())
        return nil
    }
    content, err := os.ReadFile(tmpfile.Name())
    if err != nil {
        status.Error(err.Error())
        return nil
    }
    if len(content) == 0 {
        status.Warn("Message is empty")
        return nil
    }
    os.Remove(tmpfile.Name())
    attachments := m.attachments
    m.attachments = nil
    return SendMsg{
        Text:        string(content),
        Attachments: attachments,
    }
})
```

**Process Flow:**

1. **Error handling:** Manages editor execution failures
2. **Content retrieval:** Reads modified file content
3. **Validation:** Warns if content is empty
4. **Cleanup:** Removes temporary file
5. **State preservation:** Maintains existing attachments
6. **Message generation:** Creates `SendMsg` for chat processing

### 5. Integration with Chat System

**File:** `~/git/opencode/internal/tui/page/chat.go:74-78`

```go
case chat.SendMsg:
    cmd := p.sendMessage(msg.Text, msg.Attachments)
    if cmd != nil {
        return p, cmd
    }
```

The `SendMsg` generated by the editor callback is processed identically to regular message input, ensuring seamless integration with the chat workflow.

## Why GUI Editor Support Doesn't Work

### Technical Architecture Constraints

The current implementation has several fundamental limitations that prevent GUI editor support:

#### 1. Terminal-Based Process Model

**File:** `~/git/opencode/internal/tui/components/chat/editor.go:109-115`

```go
c := exec.Command(editor, tmpfile.Name())
c.Stdin = os.Stdin
c.Stdout = os.Stdout
c.Stderr = os.Stderr
```

**Problem:** The implementation assumes editors need direct terminal access (stdin/stdout/stderr). GUI editors like VS Code, Sublime Text, or Atom:

- Don't require terminal input/output streams
- Run as separate windowed applications
- Don't block the terminal process in the same way

#### 2. Synchronous Process Handling

**File:** `~/git/opencode/internal/tui/components/chat/editor.go:116`

```go
return tea.ExecProcess(c, func(err error) tea.Msg {
```

**Problem:** `tea.ExecProcess` is designed for terminal applications that:

- Block until completion
- Suspend the TUI during execution
- Return control when the process exits

GUI editors typically:

- Fork background processes immediately
- Return control to the terminal while remaining open
- Don't provide clear "editing complete" signals

#### 3. Process Lifecycle Management

**Current Assumption:** The editor process lifecycle directly corresponds to editing lifecycle:

- Process starts → User begins editing
- Process runs → User is editing
- Process exits → User finished editing

**GUI Editor Reality:**

- Process starts → Editor launches, process may exit immediately
- Background daemon → Actual editing happens in detached process
- No clear completion signal → Unknown when user finished editing

#### 4. Platform Detection Limitations

**File:** `~/git/opencode/internal/tui/components/chat/editor.go:101-104`

```go
editor := os.Getenv("EDITOR")
if editor == "" {
    editor = "nvim"
}
```

**Missing Features:**

- No platform-specific GUI editor detection
- No differentiation between terminal vs GUI editors
- No macOS-specific handling (e.g., `open -a "Visual Studio Code"`)
- No Windows GUI editor support (e.g., `notepad.exe`, `code.exe`)

### Required Changes for GUI Editor Support

To support GUI editors, the implementation would need:

#### 1. Editor Type Detection

```go
// Hypothetical implementation
type EditorType int
const (
    TerminalEditor EditorType = iota
    GUIEditor
)

func detectEditorType(editorCmd string) EditorType {
    guiEditors := []string{"code", "subl", "atom", "gedit"}
    for _, gui := range guiEditors {
        if strings.Contains(editorCmd, gui) {
            return GUIEditor
        }
    }
    return TerminalEditor
}
```

#### 2. Different Process Handling

```go
// For GUI editors, would need different approach
if editorType == GUIEditor {
    // Launch with --wait flag for editors that support it
    // or implement file watching for changes
    return m.launchGUIEditor(editor, tmpfile.Name())
} else {
    // Current terminal editor approach
    return tea.ExecProcess(c, callback)
}
```

#### 3. File Watching Instead of Process Watching

```go
// Would need file system watching
func (m *editorCmp) watchFileChanges(filepath string) tea.Cmd {
    return func() tea.Msg {
        watcher, _ := fsnotify.NewWatcher()
        watcher.Add(filepath)
        // Wait for file modification events
        // Return when editing appears complete
    }
}
```

#### 4. Platform-Specific Editor Launch

```go
// Different launch strategies per platform
func launchGUIEditor(editor, filepath string) *exec.Cmd {
    switch runtime.GOOS {
    case "darwin":
        return exec.Command("open", "-a", editor, filepath, "--wait-apps")
    case "windows":
        return exec.Command(editor, filepath)
    default:
        return exec.Command(editor, filepath)
    }
}
```

### Design Philosophy

The OpenCode team likely chose to focus on terminal editors because:

1. **Target Audience:** Developers using a terminal-based AI assistant probably prefer terminal editors
2. **Complexity:** GUI editor support adds significant platform-specific complexity
3. **Reliability:** Terminal editors provide predictable process lifecycle management
4. **Consistency:** Maintaining TUI suspension/restoration is simpler with blocking terminal processes
5. **Focus:** Prioritizing core functionality over edge case editor support

### Workarounds for GUI Editor Users

Users who prefer GUI editors can:

1. **Use editor wait flags:** Many GUI editors support waiting modes:

   ```bash
   export EDITOR="code --wait"
   export EDITOR="subl --wait"
   ```

2. **Create wrapper scripts:** Write shell scripts that handle the GUI editor lifecycle:

   ```bash
   #!/bin/bash
   code --wait "$1"
   ```

3. **Use terminal modes:** Many GUI editors have terminal counterparts:
   - VS Code → `code` in terminal mode
   - Sublime → `subl` in terminal mode

The current implementation prioritizes simplicity and reliability for the primary use case (terminal editors) while leaving room for future GUI editor enhancements.
