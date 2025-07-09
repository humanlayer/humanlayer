# TUI Client Component Specification

---
component: tui_client
package: packages/tui  
type: user_interface
dependencies: [bubble_tea, lipgloss, glamour, chroma, cobra]
status: production
language: go
---

## Overview

The TUI (Terminal User Interface) client is a sophisticated Bubble Tea-based application that provides a complete chat interface for interacting with AI models. It features a theme system, layout management, real-time event handling, and rich markdown rendering with syntax highlighting.

## Architecture

### Core Components

#### Main Application Entry Point
- **Location**: [`packages/tui/cmd/opencode/main.go`](file:///Users/allison/git/opencode/packages/tui/cmd/opencode/main.go)
- **Purpose**: Application bootstrap, dependency injection, event stream setup
- **Key Functions**:
  - `main()`: Entry point, sets up logging, HTTP client, and starts TUI
  - Environment variable handling (`OPENCODE_SERVER`, `OPENCODE_APP_INFO`)
  - Logging configuration to `{data}/log/tui.log`
  - Background event stream subscription

#### Application State Manager
- **Location**: [`packages/tui/internal/app/app.go`](file:///Users/allison/git/opencode/packages/tui/internal/app/app.go)
- **Purpose**: Central state management, HTTP client coordination, session management
- **Key Functions**:
  - `New()`: Initialize application with config, themes, and providers
  - `InitializeProvider()`: Load and set default AI providers/models
  - `SendChatMessage()`: Send messages with optimistic updates
  - `CreateSession()`: Create new chat sessions
  - `ListSessions()`: Retrieve session history
  - `Cancel()`: Interrupt running operations
  - State persistence with automatic saving

#### Main TUI Controller
- **Location**: [`packages/tui/internal/tui/tui.go`](file:///Users/allison/git/opencode/packages/tui/internal/tui/tui.go)
- **Purpose**: Core TUI event loop, component coordination, key handling
- **Key Functions**:
  - `Update()`: Main event dispatcher with priority-based key handling
  - `View()`: Composite view rendering with overlays
  - `executeCommand()`: Command execution with proper state updates
  - Leader key sequence handling with debouncing
  - Modal dialog management
  - Completion dialog coordination

### Chat Components

#### Editor Component
- **Location**: [`packages/tui/internal/components/chat/editor.go`](file:///Users/allison/git/opencode/packages/tui/internal/components/chat/editor.go)
- **Purpose**: Multi-line text input with history, attachments, and shortcuts
- **Features**:
  - Textarea with syntax highlighting awareness
  - Command history navigation (up/down arrows)
  - Clipboard integration for images and text
  - Backslash continuation for multi-line messages
  - Interrupt key debouncing for safety
  - Responsive width adjustment
  - External editor integration (`$EDITOR`)

#### Messages Component  
- **Location**: [`packages/tui/internal/components/chat/messages.go`](file:///Users/allison/git/opencode/packages/tui/internal/components/chat/messages.go)
- **Purpose**: Message display with caching, tool rendering, and navigation
- **Features**:
  - Viewport-based scrolling with page up/down
  - Cached message rendering for performance
  - Tool invocation display with details toggle
  - Home screen with ASCII art logo
  - Session header with share URL display
  - Tail mode for auto-scrolling

#### Message Rendering
- **Location**: [`packages/tui/internal/components/chat/message.go`](file:///Users/allison/git/opencode/packages/tui/internal/components/chat/message.go)
- **Purpose**: Rich message rendering with tool-specific formatting
- **Features**:
  - Markdown rendering with syntax highlighting
  - Tool-specific rendering (read, edit, write, bash, etc.)
  - Diff visualization for code changes
  - File content preview with truncation
  - Error diagnostic display
  - Adaptive width and alignment

#### Message Cache
- **Location**: [`packages/tui/internal/components/chat/cache.go`](file:///Users/allison/git/opencode/packages/tui/internal/components/chat/cache.go)
- **Purpose**: Thread-safe caching of rendered message content
- **Features**:
  - SHA256-based cache keys from content and parameters
  - Thread-safe read/write operations
  - Cache invalidation on theme/size changes
  - Memory-efficient storage

### Theme System

#### Theme Interface
- **Location**: [`packages/tui/internal/theme/theme.go`](file:///Users/allison/git/opencode/packages/tui/internal/theme/theme.go)
- **Purpose**: Comprehensive color scheme definitions
- **Color Categories**:
  - Background colors (background, panel, element)
  - Border colors (subtle, normal, active)
  - Brand colors (primary, secondary, accent)
  - Text colors (normal, muted)
  - Status colors (error, warning, success, info)
  - Diff colors (added, removed, context with backgrounds)
  - Markdown colors (headings, links, code, emphasis)
  - Syntax highlighting colors (keywords, strings, comments, etc.)

#### Theme Manager
- **Location**: [`packages/tui/internal/theme/manager.go`](file:///Users/allison/git/opencode/packages/tui/internal/theme/manager.go)
- **Purpose**: Theme registration, selection, and ANSI color detection
- **Features**:
  - Global theme registry with thread-safe access
  - ANSI 0-16 color detection for terminal compatibility
  - Automatic system theme updates
  - Theme caching for performance

#### Theme Loader
- **Location**: [`packages/tui/internal/theme/loader.go`](file:///Users/allison/git/opencode/packages/tui/internal/theme/loader.go)
- **Purpose**: JSON theme loading with inheritance and validation
- **Features**:
  - Embedded theme files with go:embed
  - User/project theme directory scanning
  - Color reference resolution with circular detection
  - Adaptive color parsing (light/dark variants)
  - Theme override hierarchy: builtin < user < project < cwd

#### System Theme
- **Location**: [`packages/tui/internal/theme/system.go`](file:///Users/allison/git/opencode/packages/tui/internal/theme/system.go)  
- **Purpose**: Dynamic theme generation from terminal background
- **Features**:
  - Terminal background color detection
  - Luminance-based gray scale generation
  - ANSI color usage for maximum compatibility
  - Adaptive brightness adjustments
  - Automatic light/dark mode switching

### Layout System

#### Flex Layout
- **Location**: [`packages/tui/internal/layout/flex.go`](file:///Users/allison/git/opencode/packages/tui/internal/layout/flex.go)
- **Purpose**: Flexible box layout with grow/fixed sizing
- **Features**:
  - Horizontal and vertical flex directions
  - Fixed and grow child sizing
  - Automatic size calculation and distribution
  - Position tracking for child components
  - Alignment support (left, center, right)

#### Container Component
- **Location**: [`packages/tui/internal/layout/container.go`](file:///Users/allison/git/opencode/packages/tui/internal/layout/container.go)
- **Purpose**: Styled container with padding, borders, and focus states
- **Features**:
  - Configurable padding on all sides
  - Border styles (normal, thick, rounded, double)
  - Focus state with color changes
  - Max width constraints
  - Content alignment options
  - Size delegation to child components

#### Overlay System
- **Location**: [`packages/tui/internal/layout/overlay.go`](file:///Users/allison/git/opencode/packages/tui/internal/layout/overlay.go)
- **Purpose**: Advanced overlay rendering with ANSI style preservation
- **Features**:
  - Precise ANSI escape sequence parsing
  - Style preservation across overlay boundaries
  - Border rendering with background preservation
  - Whitespace handling with custom styles
  - Position clamping for viewport bounds

### Dialog System

#### Completion Dialog
- **Location**: [`packages/tui/internal/components/dialog/complete.go`](file:///Users/allison/git/opencode/packages/tui/internal/components/dialog/complete.go)
- **Purpose**: Auto-completion interface for commands and files
- **Features**:
  - Provider-based completion system
  - Real-time filtering as user types
  - Keyboard navigation (tab, enter, escape)
  - Command vs. file completion modes
  - Dynamic width calculation

#### Init Dialog
- **Location**: [`packages/tui/internal/components/dialog/init.go`](file:///Users/allison/git/opencode/packages/tui/internal/components/dialog/init.go)
- **Purpose**: Project initialization confirmation dialog
- **Features**:
  - Yes/No selection with keyboard navigation
  - Tab/arrow key toggle between options
  - Direct y/n key shortcuts
  - Escape to cancel
  - Descriptive text explaining initialization

### HTTP Client Integration

#### Generated Client
- **Location**: [`packages/tui/pkg/client/generated-client.go`](file:///Users/allison/git/opencode/packages/tui/pkg/client/generated-client.go)
- **Purpose**: OpenAPI-generated HTTP client with full type safety
- **Features**: 
  - Complete API coverage with request/response types
  - Automatic JSON marshaling/unmarshaling
  - Error handling with structured error types
  - Context support for cancellation

#### Event Streaming
- **Location**: [`packages/tui/pkg/client/event.go`](file:///Users/allison/git/opencode/packages/tui/pkg/client/event.go)
- **Purpose**: Server-Sent Events (SSE) client for real-time updates
- **Features**:
  - Channel-based event delivery
  - Automatic reconnection handling
  - Large buffer support (10MB) for big events
  - Discriminated union event parsing
  - Context-based cancellation

### Command System

#### Command Registry
- **Location**: [`packages/tui/internal/commands/command.go`](file:///Users/allison/git/opencode/packages/tui/internal/commands/command.go)
- **Purpose**: Centralized command definition and key binding management
- **Features**:
  - Leader key sequence support
  - Multiple key bindings per command
  - Configuration-based key binding overrides
  - Command categorization and sorting
  - Trigger string support for completion

#### Available Commands
- **App Commands**: help, exit
- **Editor Commands**: open external editor, clear, paste, submit, newline
- **Session Commands**: new, list, share, interrupt, compact
- **Navigation Commands**: page up/down, half page, first/last message
- **Model Commands**: list models, list themes, toggle tool details
- **Project Commands**: initialize project

### Completion System

#### Completion Manager
- **Location**: [`packages/tui/internal/completions/manager.go`](file:///Users/allison/git/opencode/packages/tui/internal/completions/manager.go)
- **Purpose**: Coordinate different completion providers
- **Features**:
  - Provider routing based on input context
  - File/folder completion provider
  - Command completion provider
  - Default provider selection

### Utility Components

#### Status Bar
- **Location**: [`packages/tui/internal/components/status/status.go`](file:///Users/allison/git/opencode/packages/tui/internal/components/status/status.go)
- **Purpose**: Bottom status bar with session info and costs
- **Features**:
  - Token usage display with human-readable formatting
  - Cost tracking across messages
  - Context window percentage
  - Current working directory display
  - Logo and version information

#### Toast System
- **Purpose**: Non-blocking notification system
- **Features**:
  - Success, error, info, and warning toasts
  - Automatic timeout with dismissal
  - Multiple toast stacking
  - Overlay rendering without blocking interaction

#### Diff Viewer
- **Purpose**: Code diff visualization
- **Features**:
  - Unified and side-by-side diff formats
  - Syntax highlighting within diffs
  - Line number display
  - Add/remove highlighting
  - Responsive width adjustment

### Styles and Rendering

#### Markdown Renderer
- **Location**: [`packages/tui/internal/styles/markdown.go`](file:///Users/allison/git/opencode/packages/tui/internal/styles/markdown.go)
- **Purpose**: Themed markdown rendering with syntax highlighting
- **Features**:
  - Glamour-based markdown rendering
  - Theme-aware color application
  - Chroma syntax highlighting integration
  - Adaptive color conversion
  - Custom style configuration

#### Style Utilities
- **Location**: [`packages/tui/internal/styles/styles.go`](file:///Users/allison/git/opencode/packages/tui/internal/styles/styles.go)
- **Purpose**: Style helper functions and common patterns
- **Features**:
  - Whitespace style generation
  - Background color application
  - Consistent styling patterns

## Data Flow

### Initialization Flow
1. **Startup**: Parse environment variables and app info
2. **Logging**: Set up file-based logging system
3. **HTTP Client**: Create API client with server URL
4. **App State**: Load configuration and initialize state
5. **Themes**: Load theme hierarchy and set initial theme
6. **Providers**: Initialize AI providers and select default model
7. **TUI Setup**: Create Bubble Tea program with components
8. **Event Stream**: Start background SSE connection
9. **Main Loop**: Begin TUI event processing

### Message Flow
1. **User Input**: Text entered in editor component
2. **Validation**: Check for empty messages or backslash continuation
3. **History**: Save to local history if not duplicate
4. **Optimistic Update**: Add user message immediately to UI
5. **API Call**: Send message to server via HTTP client
6. **Event Stream**: Receive real-time updates via SSE
7. **Message Updates**: Update UI as assistant responds
8. **Tool Rendering**: Render tool invocations with results
9. **Completion**: Mark message as complete when done

### Theme Updates
1. **Selection**: User selects theme via dialog or config
2. **Loading**: Load theme definition from JSON
3. **Validation**: Resolve color references and validate
4. **Registration**: Register theme in global manager
5. **Activation**: Set as current theme
6. **Cache Clear**: Invalidate message render cache
7. **Component Update**: Send theme update messages
8. **Re-render**: Components update with new colors

### Event Handling Priority
1. **Modal Dialogs**: Highest priority, capture all input
2. **Leader Sequences**: Special key combinations
3. **Completion Dialog**: Auto-completion interface
4. **Printable Characters**: Direct to editor for responsiveness
5. **Navigation**: Scroll and movement commands
6. **Global Commands**: App-level operations

## Performance Optimizations

### Message Rendering Cache
- **Purpose**: Avoid expensive markdown re-rendering
- **Key Generation**: SHA256 of content + width + theme + options
- **Invalidation**: Theme changes, window resize, tool detail toggle
- **Thread Safety**: RWMutex for concurrent access
- **Memory Management**: Manual cache clearing on navigation

### Event Stream Buffering
- **Buffer Size**: 10MB for large tool outputs
- **Channel Design**: Non-blocking with context cancellation
- **Reconnection**: Automatic retry on connection loss
- **Parsing**: Efficient discriminated union handling

### Layout Calculation
- **Flex Layout**: Mathematical size distribution
- **Container Sizing**: Efficient padding/border calculations
- **Viewport Management**: Minimal re-rendering on scroll
- **Overlay Positioning**: Clamped positioning calculations

### ANSI Processing
- **Regex Compilation**: Pre-compiled patterns for escape sequences
- **Style Parsing**: Efficient state machine for style tracking
- **Color Conversion**: Cached adaptive color resolution
- **Overlay Rendering**: Minimal style recalculation

## Error Handling

### Network Errors
- **HTTP Client**: Structured error responses with status codes
- **Event Stream**: Automatic reconnection with exponential backoff
- **Timeout Handling**: Context-based cancellation
- **Error Display**: Toast notifications for user feedback

### File System Errors
- **Theme Loading**: Graceful fallback to built-in themes
- **State Persistence**: Error logging with continued operation
- **External Editor**: Error handling for missing `$EDITOR`
- **Log File Creation**: Directory creation with permission handling

### Rendering Errors
- **Theme Errors**: Fallback to default colors
- **Markdown Errors**: Plain text fallback
- **Layout Errors**: Graceful degradation
- **Cache Errors**: Cache invalidation and regeneration

## Configuration

### Environment Variables
- `OPENCODE_SERVER`: Server URL for API connections
- `OPENCODE_APP_INFO`: JSON-encoded application information
- `EDITOR`: External editor for compose mode

### State Persistence
- **Location**: `{app.state}/tui` TOML file
- **Contents**: Theme selection, provider/model selection
- **Auto-save**: On every significant state change
- **Loading**: Graceful fallback to defaults on errors

### Theme Configuration
- **Built-in Themes**: Embedded in binary
- **User Themes**: `{config}/opencode/themes/*.json`
- **Project Themes**: `{project}/.opencode/themes/*.json`
- **CWD Themes**: `{cwd}/.opencode/themes/*.json`
- **Priority**: CWD > Project > User > Built-in

## Dependencies

### Core Dependencies
- **bubbletea/v2**: Main TUI framework for event handling and rendering
- **lipgloss/v2**: Styling and layout system with adaptive colors
- **bubbles/v2**: Pre-built components (textarea, viewport, spinner)
- **glamour**: Markdown rendering with syntax highlighting
- **chroma/v2**: Syntax highlighting engine

### Utility Dependencies
- **go-colorful**: Color manipulation and conversion
- **fuzzysearch**: Fuzzy string matching for completions
- **go-diff**: Diff generation and formatting
- **qr**: QR code generation for sharing
- **clipboard**: System clipboard integration
- **imaging**: Image processing for attachments

### HTTP Dependencies
- **oapi-codegen**: OpenAPI client generation
- **runtime**: OpenAPI runtime support
- **BurntSushi/toml**: Configuration file parsing

## Testing

### Component Testing
- **Theme Loader**: JSON parsing and color resolution tests
- **Message Cache**: Concurrency and invalidation tests
- **Layout System**: Size calculation and positioning tests
- **Command System**: Key binding and execution tests

### Integration Testing
- **Event Flow**: End-to-end message flow testing
- **Theme Application**: Complete theme loading and application
- **API Integration**: Mock server testing for client operations
- **Error Scenarios**: Network failure and recovery testing

## Security Considerations

### Input Validation
- **Message Content**: Sanitization before API submission
- **File Paths**: Validation for attachment operations
- **Command Injection**: Safe external editor invocation
- **URL Validation**: Server URL validation

### State Security
- **Log Files**: No sensitive data in logs
- **State Files**: Safe permissions on state files
- **Clipboard**: Secure clipboard operations
- **External Editor**: Temporary file cleanup

## Future Enhancements

### Performance
- **Virtual Scrolling**: For very large message histories
- **Progressive Loading**: Lazy load message content
- **Background Rendering**: Pre-render upcoming messages
- **Memory Management**: Automatic cache size limits

### Features
- **Split Panes**: Multiple conversation views
- **Plugin System**: Custom tool renderers
- **Export Options**: Save conversations to files
- **Search**: Full-text search across conversations
- **Offline Mode**: Local operation when disconnected

### Accessibility
- **Screen Reader**: Better ARIA support
- **High Contrast**: Enhanced contrast themes
- **Large Text**: Font size scaling
- **Keyboard Navigation**: Complete keyboard accessibility

## API Reference

### Core Interfaces

```go
// Main application interface
type App interface {
    InitializeProvider() tea.Cmd
    SendChatMessage(ctx context.Context, text string, attachments []Attachment) tea.Cmd
    CreateSession(ctx context.Context) (*client.SessionInfo, error)
    ListSessions(ctx context.Context) ([]client.SessionInfo, error)
    Cancel(ctx context.Context, sessionID string) error
}

// Component interfaces
type EditorComponent interface {
    tea.Model
    tea.ViewModel
    layout.Sizeable
    Content() string
    Lines() int
    Value() string
    Submit() (tea.Model, tea.Cmd)
    Clear() (tea.Model, tea.Cmd)
}

type MessagesComponent interface {
    tea.Model
    tea.ViewModel
    PageUp() (tea.Model, tea.Cmd)
    PageDown() (tea.Model, tea.Cmd)
    First() (tea.Model, tea.Cmd)
    Last() (tea.Model, tea.Cmd)
    ToolDetailsVisible() bool
}

// Theme system interfaces
type Theme interface {
    // Background colors
    Background() compat.AdaptiveColor
    BackgroundPanel() compat.AdaptiveColor
    BackgroundElement() compat.AdaptiveColor
    
    // Brand colors
    Primary() compat.AdaptiveColor
    Secondary() compat.AdaptiveColor
    Accent() compat.AdaptiveColor
    
    // Status colors
    Error() compat.AdaptiveColor
    Warning() compat.AdaptiveColor
    Success() compat.AdaptiveColor
    Info() compat.AdaptiveColor
    
    // ... [additional color methods]
}

// Layout interfaces
type Sizeable interface {
    SetSize(width, height int) tea.Cmd
    GetSize() (int, int)
}

type Alignable interface {
    MaxWidth() int
    Alignment() lipgloss.Position
    SetPosition(x, y int)
    GetPosition() (x, y int)
}
```

This comprehensive specification documents the complete TUI client implementation, providing detailed insights into its architecture, components, data flows, and technical implementation details.
