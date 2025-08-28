# QuickLauncher Implementation Plan & Documentation

## Overview
Implemented a macOS-style quick launcher window (cmd+shift+h) for creating Claude sessions with a clean, native appearance.

## Completed Tasks

### 1. Fixed Claude Command Construction Bug
**Problem**: Query was being added twice to the Claude command arguments, causing "MCP config file not found" error.

**Solution**: Removed duplicate query argument in `claudecode-go/client.go`:
```go
// buildArgs function - REMOVED lines 184-189
// Query is already passed as argument to --print at line 72
// Don't add it again as positional argument
```

### 2. QuickLauncher Window Implementation

#### Window Configuration (`src-tauri/src/lib.rs`)
```rust
WebviewWindowBuilder::new(
    &app,
    "quick-launcher",
    WebviewUrl::App("index.html#/quick-launcher".into())
)
.title("")
.inner_size(500.0, 225.0)
.resizable(false)
.maximizable(false)
.minimizable(false)
.always_on_top(true)
.skip_taskbar(true)
.decorations(true)
.title_bar_style(tauri::TitleBarStyle::Transparent)
.hidden_title(true)
.center()
```

#### Component Features (`src/components/QuickLauncher.tsx`)
- **Directory field**: Always opens blank with focus
- **Default directory**: Uses current directory (`.`) if none specified
- **Keyboard shortcuts**:
  - `Cmd+Enter`: Submit form
  - `Escape`: Close window
  - `Enter` in directory field: Move to prompt field
- **Error handling**: Closes window immediately on success, shows errors inline

### 3. Window Permissions
Added to `src-tauri/capabilities/default.json`:
```json
"core:window:allow-close",
"core:window:allow-show",
"core:window:allow-hide",
"core:window:allow-set-focus",
"core:window:allow-center"
```

### 4. Main Window Title Bar Customization
Updated `src-tauri/tauri.conf.json`:
```json
{
  "label": "main",
  "title": "CodeLayer",
  "titleBarStyle": "Transparent",
  "hiddenTitle": false
}
```

## Key Learnings

### macOS Title Bar Styles in Tauri

#### 1. Overlay Style
```rust
.title_bar_style(tauri::TitleBarStyle::Overlay)
```
- **Pros**: Content can flow under titlebar
- **Cons**:
  - Only title text area is draggable
  - With `hidden_title: true`, nothing is draggable
  - Requires padding to avoid content overlap

#### 2. Transparent Style (Recommended)
```rust
.title_bar_style(tauri::TitleBarStyle::Transparent)
```
- **Pros**:
  - Entire titlebar area remains draggable
  - Titlebar background matches window background color
  - No padding needed
  - Similar to native macOS apps (Terminal, etc.)
- **Cons**: Content cannot flow under titlebar

#### 3. Default Style with decorations(false)
```rust
.decorations(false)
```
- **Result**: No rounded corners, no native shadow, not draggable

### Window Appearance Features

#### Rounded Corners & Shadows
- **Native macOS**: Requires `decorations(true)`
- **Shadow control**:
  - `.shadow(true)` - Adds native shadow on macOS
  - `.shadow(false)` - No shadow, prevents 1px border
- **Windows 11**: `.shadow(true)` with `.decorations(false)` adds rounded corners

#### Draggability
- **HTML attribute**: `data-tauri-drag-region` on any div
- **CSS style**: `style={{ WebkitAppRegion: 'drag' }}`
- **Note**: Doesn't work properly with Overlay style

### Platform-Specific Behaviors

| Feature | macOS | Windows | Linux |
|---------|-------|---------|-------|
| Transparent titlebar | ✅ Supported | ❌ Not supported | ❌ Not supported |
| Shadow with decorations(false) | Shows 1px border | Can add rounded corners (Win11) | ❌ Not supported |
| Overlay titlebar | ✅ Supported | ❌ Not supported | ❌ Not supported |

## Code Patterns

### Session Creation Pattern
```typescript
const response = await daemonClient.launchSession({
  query: prompt,
  working_dir: expandedWorkingDir || '.',
  provider: 'anthropic',
})

// Close window immediately after success
const window = getCurrentWindow()
await window.close()

// Optional: Notify main window
try {
  const mainWindow = await WebviewWindow.getByLabel('main')
  if (mainWindow) {
    await emit('session-created', { sessionId: response.sessionId })
  }
} catch (e) {
  // Ignore - notification is optional
}
```

### Directory Handling Pattern
```typescript
// Use current directory if empty
const dirToUse = workingDir.trim() || '.'

// Expand ~ to home directory
if (dirToUse.startsWith('~')) {
  const home = await homeDir()
  expandedDir = dirToUse.replace(/^~(?=$|\/|\\)/, home)
}
```

## Known Issues & Solutions

### Issue 1: Window Not Draggable
**Cause**: Using Overlay style with hidden title
**Solution**: Use Transparent style instead

### Issue 2: Duplicate Query in Claude Command
**Cause**: Query added both as --print argument and positional
**Solution**: Remove positional argument addition

### Issue 3: Window Won't Close
**Cause**: Missing window close permission
**Solution**: Add `core:window:allow-close` to capabilities

### Issue 4: Color Mismatch Bug
**Known Tauri Bug**: With Transparent style, backgroundColor sometimes appears inverted
**Workaround**: Use opposite hex color or set via Rust with Cocoa APIs

## Future Improvements

1. **Custom Shadow**: Could implement CSS shadow with transparent window background
2. **Drag Region**: Could make specific areas draggable while keeping inputs interactive
3. **Animation**: Could add slide-in animation for window appearance
4. **Recent Directories**: Currently shows recent paths but doesn't persist selection

## Testing Checklist

- [ ] Cmd+Shift+H opens launcher
- [ ] Directory field has focus on open
- [ ] Directory field starts blank
- [ ] Enter in directory field moves to prompt
- [ ] Cmd+Enter submits form
- [ ] Escape closes window
- [ ] Window closes on successful submission
- [ ] Error messages display properly
- [ ] Cancel button closes window
- [ ] Window has rounded corners
- [ ] Window has native shadow
- [ ] Title bar matches background color
