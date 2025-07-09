Here’s a pragmatic plan to refactor the 2,310-line `tui.go` file into a simpler, more maintainable structure while adhering to the core principles of keeping related things together, avoiding unnecessary abstractions, and targeting around 5 files maximum. The goal is to make the codebase easier to understand and modify without introducing complexity.

---

### File Breakdown

- **`tui.go`**

  - **Purpose**: Remains the central hub for the TUI application, managing the main model, global logic, and shared UI components.
  - **Contents**:
    - Main `model` struct with sub-models for each tab (`approvals`, `sessions`, `history`).
    - Global constants (e.g., `tab`, `viewState`), key bindings (`keyMap`).
    - `Init()` to kick off the app with initial commands.
    - Main `Update()` function to handle global messages (e.g., quit, tab switching) and delegate to tab-specific updates.
    - Main `View()` function to render the tab bar, delegate to tab-specific views, and render the status bar.
    - Shared rendering functions: `renderTabBar()`, `renderStatusBar()`, `renderFeedbackView()`, `renderHelpView()`.
  - **Why**: Keeps the core application flow and shared elements in one place, reducing the need to jump between files for global context.

- **`approvals.go`**

  - **Purpose**: Handles all logic and rendering specific to the Approvals tab.
  - **Contents**:
    - `approvalModel` struct with fields like `requests`, `cursor`, `viewState`, etc.
    - `Update()` function to handle approval-specific messages and inputs (e.g., approving/denying requests).
    - View functions: `ViewList()`, `ViewDetail()`, etc., for rendering approval states.
  - **Why**: Groups all approval-related functionality together, making it easy to find and modify.

- **`sessions.go`**

  - **Purpose**: Manages the Sessions tab’s logic and rendering.
  - **Contents**:
    - `sessionModel` struct with fields like `sessions`, `cursor`, `viewState`, etc.
    - `Update()` function for session-specific actions (e.g., launching sessions).
    - View functions: `ViewList()`, `ViewDetail()`, `ViewLaunch()`, etc.
  - **Why**: Encapsulates session-related code in one cohesive unit.

- **`history.go`**

  - **Purpose**: Contains logic and rendering for the History tab, even if minimal now.
  - **Contents**:
    - `historyModel` struct with fields like `history`, `cursor`, `viewState`.
    - `Update()` and `View()` functions for history-specific behavior.
  - **Why**: Prepares for future expansion while keeping it separate from other tabs.

- **`api.go`**
  - **Purpose**: Centralizes all daemon API interactions.
  - **Contents**:
    - Functions returning `tea.Cmd` for API calls: `fetchRequests()`, `fetchSessions()`, `sendApproval()`, `launchSession()`, etc.
    - Event subscription logic (`subscribeToEvents()`, `listenForEvents()`).
  - **Why**: Isolates backend communication, making it reusable and easy to modify.

This results in 5 files, each with a clear purpose, averaging around 460 lines if evenly split, which is far more manageable than the original 2,310 lines.

---

### Key Types/Interfaces

- **No New Interfaces**: The existing `client.Client` interface from `hld/client/types.go` is sufficient for daemon interactions, and no new abstractions are needed.
- **Sub-Model Structs**:
  - `approvalModel`, `sessionModel`, `historyModel` as embedded structs within the main `model`.
  - These group related fields (e.g., `requests` and `cursor` for approvals) without overcomplicating the design.
  - Defined in their respective files (`approvals.go`, `sessions.go`, `history.go`).

The main `model` in `tui.go` becomes:

```go
type model struct {
    daemonClient client.Client
    activeTab    tab
    approvals    approvalModel
    sessions     sessionModel
    history      historyModel
    width, height int
    err           error
    // other shared fields
}
```

This approach keeps the model manageable by delegating tab-specific state to sub-models, avoiding a monolithic 30+ field struct.

---

### Migration Approach

To refactor incrementally without breaking the app:

1. **Extract API Logic to `api.go`**:

   - Move all command functions (`fetchRequests()`, `sendApproval()`, etc.) to `api.go`.
   - Update `tui.go` to import and use these functions.
   - Test to ensure API calls still work.

2. **Move Shared Rendering to `tui.go`**:

   - Keep `renderTabBar()`, `renderStatusBar()`, `renderFeedbackView()`, and `renderHelpView()` in `tui.go`.
   - Remove them from the original flow and adjust calls accordingly.
   - Test UI rendering.

3. **Extract Tab Logic**:

   - For each tab (Approvals, Sessions, History):
     - Create the respective file (`approvals.go`, etc.).
     - Define the sub-model struct and move relevant fields from the main `model`.
     - Move tab-specific `Update()` and `View()` logic to the new file.
     - Test each tab individually.

4. **Update Main Model and Delegation**:

   - Adjust `tui.go`’s `model` to embed sub-models.
   - Modify `Update()` and `View()` to delegate to tab-specific functions.
   - Test the full app flow.

5. **Final Testing**:
   - Run the app to ensure tab switching, input handling, and API interactions work as expected.

This step-by-step process leverages Bubble Tea’s modularity, allowing testing after each change.

---

### Trade-Offs Acknowledged

- **Not Splitting View/Update Further**: Keeping a tab’s `Update()` and `View()` in the same file preserves their tight coupling, avoiding unnecessary file-hopping.
- **Model Struct Not Fully Split**: While sub-models help, the main `model` retains shared fields (e.g., `daemonClient`). Fully splitting it could add complexity without clear benefits.
- **Potential Duplication**: Similar input handling (e.g., up/down navigation) might repeat across tabs, but since each tab’s functionality differs, this is minimal and acceptable for simplicity.
- **5 Files, Not Fewer**: Combining `api.go` or tab files into `tui.go` would make it bloated again, so 5 files is a pragmatic balance.

---

### Example Artifact: Updated `tui.go`

Here’s how `tui.go` might look post-refactor, focusing on core logic and delegation:

```go
package main

import (
    "strings"
    tea "github.com/charmbracelet/bubbletea"
    "github.com/charmbracelet/lipgloss"
    "github.com/humanlayer/humanlayer/hld/client"
)

type tab int
const (
    approvalsTab tab = iota
    sessionsTab
    historyTab
)

type viewState int
const (
    listView viewState = iota
    detailView
    feedbackView
    launchSessionView
    sessionDetailView
    helpView
)

type model struct {
    daemonClient client.Client
    activeTab    tab
    approvals    approvalModel
    sessions     sessionModel
    history      historyModel
    width, height int
    err           error
    tabNames      []string
    subscribed    bool
    eventChannel  <-chan rpc.EventNotification
}

var keys = keyMap{ /* key bindings unchanged */ }

func newModel() model {
    config, err := LoadConfig()
    if err != nil { log.Fatal("Failed to load configuration:", err) }
    socketPath := expandSocketPath(config.DaemonSocket)
    daemonClient, err := client.Connect(socketPath, 3, time.Second)
    if err != nil { log.Fatal("Failed to connect to daemon:", err) }
    return model{
        daemonClient: daemonClient,
        activeTab:    approvalsTab,
        tabNames:     []string{"Approvals", "Sessions", "History"},
    }
}

func (m model) Init() tea.Cmd {
    return tea.Batch(fetchRequests(m.daemonClient), subscribeToEvents(m.daemonClient))
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
    var cmd tea.Cmd
    switch msg := msg.(type) {
    case tea.KeyMsg:
        if key.Matches(msg, keys.Quit) { return m, tea.Quit }
        if handled, newModel, tabCmd := m.handleTabSwitching(msg); handled {
            return newModel, tabCmd
        }
    case tea.WindowSizeMsg:
        m.width, m.height = msg.Width, msg.Height
    }
    switch m.activeTab {
    case approvalsTab:
        cmd = m.approvals.Update(msg, &m)
    case sessionsTab:
        cmd = m.sessions.Update(msg, &m)
    case historyTab:
        cmd = m.history.Update(msg, &m)
    }
    return m, cmd
}

func (m model) View() string {
    var s strings.Builder
    s.WriteString(m.renderTabBar() + "\n")
    content := ""
    switch m.activeTab {
    case approvalsTab:
        content = m.approvals.View(&m)
    case sessionsTab:
        content = m.sessions.View(&m)
    case historyTab:
        content = m.history.View(&m)
    }
    s.WriteString(content)
    contentHeight := m.height - 3
    if lines := strings.Count(content, "\n"); lines < contentHeight {
        s.WriteString(strings.Repeat("\n", contentHeight-lines))
    }
    s.WriteString(m.renderStatusBar())
    return s.String()
}

func (m model) renderTabBar() string {
    var tabs []string
    for i, name := range m.tabNames {
        style := lipgloss.NewStyle().Padding(0, 2)
        if i == int(m.activeTab) {
            style = style.Bold(true).Foreground(lipgloss.Color("205")).Background(lipgloss.Color("235"))
        } else {
            style = style.Foreground(lipgloss.Color("240"))
        }
        tabs = append(tabs, style.Render(fmt.Sprintf("[%d] %s", i+1, name)))
    }
    return lipgloss.JoinHorizontal(lipgloss.Top, tabs...) + "\n" + strings.Repeat("═", m.width)
}

func (m model) renderStatusBar() string {
    connStatus := "🟢 Connected"
    connColor := "46"
    if m.err != nil {
        connStatus, connColor = "🔴 Disconnected", "196"
    }
    connStyle := lipgloss.NewStyle().Foreground(lipgloss.Color(connColor)).Padding(0, 1)
    return lipgloss.NewStyle().Background(lipgloss.Color("235")).Width(m.width).Render(connStyle.Render(connStatus))
}

// Add renderFeedbackView(), renderHelpView(), handleTabSwitching(), etc., similarly streamlined
```

This refactoring simplifies `tui.go` while delegating tab-specific logic, making the codebase more approachable for developers.
