package main

import (
	"fmt"
	"log"
	"path/filepath"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/humanlayer/humanlayer/hld/bus"
	"github.com/humanlayer/humanlayer/hld/client"
	"github.com/humanlayer/humanlayer/hld/rpc"
)

// Request types
type RequestType string

const (
	ApprovalRequest     RequestType = "approval"
	HumanContactRequest RequestType = "human_contact"
)

// Request represents either an approval or human contact
type Request struct {
	ID         string
	CallID     string
	RunID      string
	Type       RequestType
	Message    string
	Tool       string                 // For approvals
	Parameters map[string]interface{} // For approvals
	CreatedAt  time.Time
	// Session context
	SessionID    string
	SessionQuery string // First 50 chars of query
	SessionModel string
}

// View states
type viewState int

const (
	listView viewState = iota
	detailView
	feedbackView
	launchSessionView
	sessionDetailView
	helpView
)

// Tab represents a main navigation tab
type tab int

const (
	approvalsTab tab = iota
	sessionsTab
	historyTab
)

type model struct {
	daemonClient  client.Client
	width, height int

	// Tab management
	activeTab tab
	tabNames  []string

	// Sub-models for each tab
	approvals approvalModel
	sessions  sessionModel
	history   historyModel

	// For help view
	helpContext      viewState // Which view help was opened from
	helpScrollOffset int       // For scrolling help content

	// For error handling
	err error

	// For subscription
	subscribed   bool
	eventChannel <-chan rpc.EventNotification

	// For status bar
	daemonConnected      bool
	lastDaemonCheck      time.Time
	pendingApprovalCount int
	activeSessionCount   int
}

type keyMap struct {
	Up       key.Binding
	Down     key.Binding
	Enter    key.Binding
	Back     key.Binding
	Approve  key.Binding
	Deny     key.Binding
	Quit     key.Binding
	Tab      key.Binding
	ShiftTab key.Binding
	Tab1     key.Binding
	Tab2     key.Binding
	Tab3     key.Binding
	Launch   key.Binding
	Help     key.Binding
	Refresh  key.Binding
	Sessions key.Binding
	Left     key.Binding
	Right    key.Binding
}

var keys = keyMap{
	Up: key.NewBinding(
		key.WithKeys("up", "k"),
		key.WithHelp("↑/k", "move up"),
	),
	Down: key.NewBinding(
		key.WithKeys("down", "j"),
		key.WithHelp("↓/j", "move down"),
	),
	Enter: key.NewBinding(
		key.WithKeys("enter"),
		key.WithHelp("enter", "expand/select"),
	),
	Back: key.NewBinding(
		key.WithKeys("esc"),
		key.WithHelp("esc", "back"),
	),
	Approve: key.NewBinding(
		key.WithKeys("y"),
		key.WithHelp("y", "approve"),
	),
	Deny: key.NewBinding(
		key.WithKeys("n"),
		key.WithHelp("n", "deny/respond"),
	),
	Quit: key.NewBinding(
		key.WithKeys("q", "ctrl+c"),
		key.WithHelp("q", "quit"),
	),
	Tab: key.NewBinding(
		key.WithKeys("tab"),
		key.WithHelp("tab", "next tab"),
	),
	ShiftTab: key.NewBinding(
		key.WithKeys("shift+tab"),
		key.WithHelp("shift+tab", "prev tab"),
	),
	Tab1: key.NewBinding(
		key.WithKeys("1"),
		key.WithHelp("1", "approvals tab"),
	),
	Tab2: key.NewBinding(
		key.WithKeys("2"),
		key.WithHelp("2", "sessions tab"),
	),
	Tab3: key.NewBinding(
		key.WithKeys("3"),
		key.WithHelp("3", "history tab"),
	),
	Launch: key.NewBinding(
		key.WithKeys("c"),
		key.WithHelp("c", "create session"),
	),
	Help: key.NewBinding(
		key.WithKeys("?", "f1"),
		key.WithHelp("?/F1", "help"),
	),
	Refresh: key.NewBinding(
		key.WithKeys("r"),
		key.WithHelp("r", "refresh"),
	),
	Sessions: key.NewBinding(
		key.WithKeys("s"),
		key.WithHelp("s", "sessions"),
	),
	Left: key.NewBinding(
		key.WithKeys("left", "h"),
		key.WithHelp("←/h", "left"),
	),
	Right: key.NewBinding(
		key.WithKeys("right", "l"),
		key.WithHelp("→/l", "right"),
	),
}

func newModel() model {
	// Load configuration
	config, err := LoadConfig()
	if err != nil {
		log.Fatal("Failed to load configuration:", err)
	}

	// Determine socket path
	socketPath := expandSocketPath(config.DaemonSocket)

	// Connect to daemon with retries
	daemonClient, err := client.Connect(socketPath, 3, time.Second)
	if err != nil {
		log.Fatal("Failed to connect to HumanLayer daemon at ", socketPath, "\n\n",
			"The daemon is not running. Please start it with:\n",
			"  hld\n\n",
			"Or use 'npx humanlayer tui' which will start the daemon automatically.\n\n",
			"Error: ", err)
	}

	m := model{
		daemonClient: daemonClient,
		// Initialize tab management
		activeTab: approvalsTab,
		tabNames:  []string{"Approvals", "Sessions", "History"},
		// Initialize sub-models
		approvals: newApprovalModel(),
		sessions:  newSessionModel(),
		history:   newHistoryModel(),
		// Initialize status bar
		daemonConnected: true, // We successfully connected
		lastDaemonCheck: time.Now(),
	}

	return m
}

func expandSocketPath(socketPath string) string {
	if socketPath == "" {
		socketPath = "~/.humanlayer/daemon.sock"
	}
	// Expand ~ to home directory
	if socketPath[0] == '~' {
		home := mustGetHomeDir()
		socketPath = filepath.Join(home, socketPath[1:])
	}
	return socketPath
}

func (m model) Init() tea.Cmd {
	// Initial commands to run
	return tea.Batch(
		fetchRequests(m.daemonClient),
		fetchSessions(m.daemonClient),
		subscribeToEvents(m.daemonClient),
	)
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmd tea.Cmd
	var cmds []tea.Cmd

	// Handle global messages first
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil

	case tea.KeyMsg:
		// Global key handling
		switch {
		case key.Matches(msg, keys.Quit):
			// Only quit from list views
			if m.getCurrentViewState() == listView {
				return m, tea.Quit
			}

		case key.Matches(msg, keys.Help):
			if m.getCurrentViewState() != helpView {
				m.helpContext = m.getCurrentViewState()
				m.setViewState(helpView)
				m.helpScrollOffset = 0
			}
			return m, nil

		case key.Matches(msg, keys.Back):
			if m.getCurrentViewState() == helpView {
				m.setViewState(m.helpContext)
				return m, nil
			}
		}

		// Tab switching
		if handled, newModel, tabCmd := m.handleTabSwitching(msg); handled {
			return newModel, tabCmd
		}

	case subscriptionMsg:
		if msg.err != nil {
			m.err = msg.err
			return m, nil
		}
		m.subscribed = true
		m.eventChannel = msg.eventChannel
		// Start listening for events
		return m, listenForEvents(msg.eventChannel)

	case eventNotificationMsg:
		// Handle real-time events
		switch msg.event.Event.Type {
		case bus.EventNewApproval, bus.EventApprovalResolved:
			// Refresh approvals on approval events
			if m.activeTab == approvalsTab {
				cmds = append(cmds, fetchRequests(m.daemonClient))
			}
		case bus.EventSessionStatusChanged:
			// Refresh sessions on session events
			if m.activeTab == sessionsTab {
				cmds = append(cmds, fetchSessions(m.daemonClient))
			}
		}
		// Continue listening for more events
		if m.eventChannel != nil {
			cmds = append(cmds, listenForEvents(m.eventChannel))
		}

	case errMsg:
		m.err = msg.err
		return m, nil
	}

	// Delegate to active tab's update function
	switch m.activeTab {
	case approvalsTab:
		cmd = m.approvals.Update(msg, &m)
	case sessionsTab:
		cmd = m.sessions.Update(msg, &m)
	case historyTab:
		cmd = m.history.Update(msg, &m)
	}

	if cmd != nil {
		cmds = append(cmds, cmd)
	}

	return m, tea.Batch(cmds...)
}

func (m model) View() string {
	var s strings.Builder

	// Render tab bar
	s.WriteString(m.renderTabBar() + "\n")
	s.WriteString(strings.Repeat("─", m.width) + "\n")

	// Calculate content height
	contentHeight := m.height - 3 // Tab bar (2 lines) + status bar (1 line)

	// Render content based on current view state
	var content string
	if m.getCurrentViewState() == helpView {
		content = m.renderHelpView()
	} else {
		// Delegate to active tab's view
		switch m.activeTab {
		case approvalsTab:
			content = m.approvals.View(&m)
		case sessionsTab:
			content = m.sessions.View(&m)
		case historyTab:
			content = m.history.View(&m)
		}
	}

	s.WriteString(content)

	// Count content lines to add padding if needed
	contentLines := strings.Count(content, "\n")
	if contentLines < contentHeight {
		// Add padding to push status bar to bottom
		padding := contentHeight - contentLines
		for i := 0; i < padding; i++ {
			s.WriteString("\n")
		}
	}

	// Render status bar at bottom
	s.WriteString(m.renderStatusBar())

	return s.String()
}

// getCurrentViewState returns the current view state based on active tab
func (m model) getCurrentViewState() viewState {
	switch m.activeTab {
	case approvalsTab:
		return m.approvals.viewState
	case sessionsTab:
		return m.sessions.viewState
	case historyTab:
		return m.history.viewState
	}
	return listView
}

// setViewState sets the view state for the current tab
func (m *model) setViewState(state viewState) {
	switch m.activeTab {
	case approvalsTab:
		m.approvals.viewState = state
	case sessionsTab:
		m.sessions.viewState = state
	case historyTab:
		m.history.viewState = state
	}
}

// handleTabSwitching handles tab navigation
func (m model) handleTabSwitching(msg tea.KeyMsg) (bool, tea.Model, tea.Cmd) {
	switch {
	case key.Matches(msg, keys.Tab):
		if m.getCurrentViewState() == listView {
			m.activeTab = (m.activeTab + 1) % tab(len(m.tabNames))
			return true, m, m.fetchDataForTab(m.activeTab)
		}

	case key.Matches(msg, keys.ShiftTab):
		if m.getCurrentViewState() == listView {
			m.activeTab = (m.activeTab + tab(len(m.tabNames)) - 1) % tab(len(m.tabNames))
			return true, m, m.fetchDataForTab(m.activeTab)
		}

	case key.Matches(msg, keys.Tab1):
		if m.activeTab != approvalsTab {
			m.activeTab = approvalsTab
			return true, m, m.fetchDataForTab(approvalsTab)
		}

	case key.Matches(msg, keys.Tab2):
		if m.activeTab != sessionsTab {
			m.activeTab = sessionsTab
			return true, m, m.fetchDataForTab(sessionsTab)
		}

	case key.Matches(msg, keys.Tab3):
		if m.activeTab != historyTab {
			m.activeTab = historyTab
			return true, m, m.fetchDataForTab(historyTab)
		}
	}

	return false, m, nil
}

// fetchDataForTab returns commands to fetch data for a specific tab
func (m model) fetchDataForTab(tab tab) tea.Cmd {
	switch tab {
	case approvalsTab:
		return fetchRequests(m.daemonClient)
	case sessionsTab:
		return fetchSessions(m.daemonClient)
	default:
		return nil
	}
}

// renderTabBar renders the tab navigation bar
func (m model) renderTabBar() string {
	var tabs []string

	for i, name := range m.tabNames {
		style := lipgloss.NewStyle().Padding(0, 2)
		if i == int(m.activeTab) {
			style = style.Bold(true).
				Foreground(lipgloss.Color("205")).
				Background(lipgloss.Color("235"))
		} else {
			style = style.Foreground(lipgloss.Color("240"))
		}

		// Add count indicators
		label := fmt.Sprintf("[%d] %s", i+1, name)
		if i == int(approvalsTab) && m.pendingApprovalCount > 0 {
			label += fmt.Sprintf(" (%d)", m.pendingApprovalCount)
		} else if i == int(sessionsTab) && m.activeSessionCount > 0 {
			label += fmt.Sprintf(" (%d)", m.activeSessionCount)
		}

		tabs = append(tabs, style.Render(label))
	}

	return lipgloss.JoinHorizontal(lipgloss.Top, tabs...)
}

// renderStatusBar renders the bottom status bar
func (m model) renderStatusBar() string {
	// Connection status
	connStatus := "🟢 Connected"
	connColor := "46" // Green
	if m.err != nil || !m.daemonConnected {
		connStatus = "🔴 Disconnected"
		connColor = "196" // Red
	}

	connStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color(connColor)).
		Padding(0, 1)

	// Error message if any
	errorMsg := ""
	if m.err != nil {
		errorStyle := lipgloss.NewStyle().
			Foreground(lipgloss.Color("196")).
			Padding(0, 1)
		errorMsg = errorStyle.Render(fmt.Sprintf("Error: %v", m.err))
	}

	// Build status bar
	statusStyle := lipgloss.NewStyle().
		Background(lipgloss.Color("235")).
		Width(m.width)

	leftContent := connStyle.Render(connStatus)
	if errorMsg != "" {
		leftContent += " " + errorMsg
	}

	return statusStyle.Render(leftContent)
}

// renderHelpView renders the help screen
func (m model) renderHelpView() string {
	var s strings.Builder

	// Header
	headerStyle := lipgloss.NewStyle().
		Bold(true).
		Foreground(lipgloss.Color("205")).
		MarginBottom(1)
	s.WriteString(headerStyle.Render("Help") + "\n\n")

	// Key bindings sections
	sectionStyle := lipgloss.NewStyle().
		Bold(true).
		Foreground(lipgloss.Color("243")).
		MarginTop(1)

	keyStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("215"))
	descStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("252"))

	// Navigation
	s.WriteString(sectionStyle.Render("Navigation") + "\n")
	navigationKeys := []struct{ key, desc string }{
		{"↑/k", "Move up"},
		{"↓/j", "Move down"},
		{"enter", "Select/expand"},
		{"esc", "Go back"},
		{"tab", "Next tab"},
		{"shift+tab", "Previous tab"},
		{"1/2/3", "Jump to tab"},
	}
	for _, k := range navigationKeys {
		s.WriteString(fmt.Sprintf("  %s  %s\n",
			keyStyle.Render(k.key),
			descStyle.Render(k.desc)))
	}

	// Actions
	s.WriteString("\n" + sectionStyle.Render("Actions") + "\n")
	actionKeys := []struct{ key, desc string }{
		{"y", "Approve (in approvals)"},
		{"n", "Deny/respond"},
		{"c", "Create session (in sessions)"},
		{"r", "Refresh current view"},
		{"?/F1", "Show this help"},
		{"q", "Quit (from list view)"},
	}
	for _, k := range actionKeys {
		s.WriteString(fmt.Sprintf("  %s  %s\n",
			keyStyle.Render(k.key),
			descStyle.Render(k.desc)))
	}

	// Context-specific help
	s.WriteString("\n" + sectionStyle.Render("Context-Specific") + "\n")
	switch m.helpContext {
	case feedbackView:
		s.WriteString("  " + descStyle.Render("Type your response and press enter to submit") + "\n")
	case launchSessionView:
		s.WriteString("  " + descStyle.Render("Fill in the form fields and press enter to launch") + "\n")
		s.WriteString("  " + descStyle.Render("Use tab to navigate between fields") + "\n")
		s.WriteString("  " + descStyle.Render("Use ←/→ arrows to select model") + "\n")
	}

	// Footer
	s.WriteString("\n" + lipgloss.NewStyle().
		Foreground(lipgloss.Color("243")).
		Italic(true).
		Render("Press esc to close help"))

	return s.String()
}

// Error message type
type errMsg struct {
	err error
}
