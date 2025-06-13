package main

import (
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/humanlayer/humanlayer/hld/bus"
	"github.com/humanlayer/humanlayer/hld/client"
	"github.com/humanlayer/humanlayer/hld/rpc"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/domain"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/util"
)

type model struct {
	daemonClient  client.Client
	width, height int

	// Tab management
	activeTab domain.Tab
	tabNames  []string

	// Sub-models for each tab
	approvals    approvalModel
	sessions     sessionModel
	conversation conversationModel

	// For help view
	helpContext      domain.ViewState // Which view help was opened from
	helpScrollOffset int              // For scrolling help content

	// For error handling
	err             error
	fullError       error // Store full error for detail view
	showErrorDetail bool  // Whether to show full error in popup

	// For subscription
	subscribed   bool
	eventChannel <-chan rpc.EventNotification

	// For status bar
	daemonConnected      bool
	lastDaemonCheck      time.Time
	pendingApprovalCount int
	activeSessionCount   int

	// For notifications
	showNotification     bool
	notificationMessage  string
	notificationShowTime time.Time

	// For conversation caching
	conversationCache *domain.ConversationCache
}

type keyMap struct {
	Up          key.Binding
	Down        key.Binding
	Enter       key.Binding
	Back        key.Binding
	Approve     key.Binding
	Deny        key.Binding
	Quit        key.Binding
	Tab         key.Binding
	ShiftTab    key.Binding
	Tab1        key.Binding
	Tab2        key.Binding
	Launch      key.Binding
	Help        key.Binding
	Refresh     key.Binding
	Sessions    key.Binding
	Left        key.Binding
	Right       key.Binding
	ErrorDetail key.Binding
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
	ErrorDetail: key.NewBinding(
		key.WithKeys("e"),
		key.WithHelp("e", "error details"),
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
		activeTab: domain.ApprovalsTab,
		tabNames:  []string{"Approvals", "Sessions"},
		// Initialize sub-models
		approvals:    newApprovalModel(),
		sessions:     newSessionModel(),
		conversation: newConversationModel(),
		// Initialize status bar
		daemonConnected: true, // We successfully connected
		lastDaemonCheck: time.Now(),
		// Initialize cache
		conversationCache: domain.NewConversationCache(100),
		// Initialize with reasonable defaults that will be updated on first window size message
		width:  80,
		height: 24,
	}

	// Initialize all view sizes
	m.updateAllViewSizes()

	return m
}

func expandSocketPath(socketPath string) string {
	if socketPath == "" {
		socketPath = "~/.humanlayer/daemon.sock"
	}
	return util.ExpandSocketPath(socketPath)
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
		// Update all view sizes
		m.updateAllViewSizes()
		return m, nil

	case tea.KeyMsg:
		// Handle global keys even in modal views
		if m.getCurrentViewState() == domain.QueryModalView {
			// Check for quit key first
			if key.Matches(msg, keys.Quit) {
				// Quit immediately from any view
				return m, tea.Quit
			}

			// Delegate other keys to tab handlers
			switch m.activeTab {
			case domain.ApprovalsTab:
				cmd = m.approvals.Update(msg, &m)
			case domain.SessionsTab:
				cmd = m.sessions.Update(msg, &m)
			}
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
			return m, tea.Batch(cmds...)
		}

		// Global key handling (only when not in modal)
		switch {
		case key.Matches(msg, keys.Quit):
			// Quit immediately from any view
			return m, tea.Quit

		case key.Matches(msg, keys.Help):
			if m.getCurrentViewState() != domain.HelpView {
				m.helpContext = m.getCurrentViewState()
				m.setViewState(domain.HelpView)
				m.helpScrollOffset = 0
			}
			return m, nil

		case key.Matches(msg, keys.Back):
			if m.getCurrentViewState() == domain.HelpView {
				m.setViewState(m.helpContext)
				return m, nil
			} else if m.getCurrentViewState() == domain.ConversationView {
				// Clear conversation view and return to appropriate tab
				m.conversation.stopPolling() // Stop any active polling
				m.conversation.sessionID = ""
				return m, nil
			} else if m.showErrorDetail {
				// Close error detail popup
				m.showErrorDetail = false
				return m, nil
			}

		case key.Matches(msg, keys.ErrorDetail):
			// Show full error detail if there's an error
			if m.fullError != nil {
				m.showErrorDetail = !m.showErrorDetail
				return m, nil
			}
		}

		// Tab switching
		if handled, newModel, tabCmd := m.handleTabSwitching(msg); handled {
			// Hide notification when switching tabs
			if modelCast, ok := newModel.(model); ok {
				modelCast.showNotification = false
				return modelCast, tabCmd
			}
			return newModel, tabCmd
		}

	case subscriptionMsg:
		if msg.err != nil {
			m.err = msg.err
			m.fullError = msg.err
			return m, nil
		}
		m.subscribed = true
		m.eventChannel = msg.eventChannel
		// Start listening for events
		return m, listenForEvents(msg.eventChannel)

	case eventNotificationMsg:
		// Handle real-time events
		switch msg.event.Event.Type {
		case bus.EventNewApproval:
			// Show notification for new approvals (only if not already on approvals tab)
			if m.activeTab != domain.ApprovalsTab && m.getCurrentViewState() != domain.ConversationView {
				m.showNotification = true
				m.notificationMessage = "New approval required. Press '1' to view"
				m.notificationShowTime = time.Now()
			}
			// Refresh approvals
			cmds = append(cmds, fetchRequests(m.daemonClient))
		case bus.EventApprovalResolved:
			// Refresh approvals on approval resolution
			if m.activeTab == domain.ApprovalsTab {
				cmds = append(cmds, fetchRequests(m.daemonClient))
			}
		case bus.EventSessionStatusChanged:
			// Refresh sessions on session events
			if m.activeTab == domain.SessionsTab {
				cmds = append(cmds, fetchSessions(m.daemonClient))
			}
		}
		// Continue listening for more events
		if m.eventChannel != nil {
			cmds = append(cmds, listenForEvents(m.eventChannel))
		}

	case errMsg:
		m.err = msg.err
		m.fullError = msg.err
		return m, nil
	}

	// Delegate to active view
	currentView := m.getCurrentViewState()
	if currentView == domain.ConversationView {
		cmd = m.conversation.Update(msg, &m)
	} else {
		// Delegate to active tab's update function
		switch m.activeTab {
		case domain.ApprovalsTab:
			cmd = m.approvals.Update(msg, &m)
		case domain.SessionsTab:
			cmd = m.sessions.Update(msg, &m)
		}
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
	if m.getCurrentViewState() == domain.HelpView {
		content = m.renderHelpView()
	} else {
		// Delegate to active view
		currentView := m.getCurrentViewState()
		if currentView == domain.ConversationView {
			content = m.conversation.View(&m)
		} else {
			// Delegate to active tab's view
			switch m.activeTab {
			case domain.ApprovalsTab:
				content = m.approvals.View(&m)
			case domain.SessionsTab:
				content = m.sessions.View(&m)
			}
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

	// Render notification popup on top if shown
	if m.showNotification {
		// Auto-hide after 5 seconds
		if time.Since(m.notificationShowTime) > 5*time.Second {
			m.showNotification = false
		} else {
			return m.renderWithNotification(s.String())
		}
	}

	// Render error detail popup if shown
	if m.showErrorDetail && m.fullError != nil {
		return m.renderWithErrorDetail(s.String())
	}

	return s.String()
}

// getCurrentViewState returns the current view state based on active tab or conversation
func (m model) getCurrentViewState() domain.ViewState {
	// Check if we're in conversation view first
	if m.conversation.sessionID != "" {
		return domain.ConversationView
	}

	switch m.activeTab {
	case domain.ApprovalsTab:
		return m.approvals.viewState
	case domain.SessionsTab:
		return m.sessions.viewState
	}
	return domain.ListView
}

// setViewState sets the view state for the current tab
func (m *model) setViewState(state domain.ViewState) {
	switch m.activeTab {
	case domain.ApprovalsTab:
		m.approvals.viewState = state
	case domain.SessionsTab:
		m.sessions.viewState = state
	}
}

// handleTabSwitching handles tab navigation
func (m model) handleTabSwitching(msg tea.KeyMsg) (bool, tea.Model, tea.Cmd) {
	switch {
	case key.Matches(msg, keys.Tab):
		if m.getCurrentViewState() == domain.ListView {
			m.activeTab = (m.activeTab + 1) % domain.Tab(len(m.tabNames))
			return true, m, m.fetchDataForTab(m.activeTab)
		}

	case key.Matches(msg, keys.ShiftTab):
		if m.getCurrentViewState() == domain.ListView {
			m.activeTab = (m.activeTab + domain.Tab(len(m.tabNames)) - 1) % domain.Tab(len(m.tabNames))
			return true, m, m.fetchDataForTab(m.activeTab)
		}

	case key.Matches(msg, keys.Tab1):
		if m.activeTab != domain.ApprovalsTab {
			// Clear conversation view when switching tabs
			if m.conversation.sessionID != "" {
				m.conversation.stopPolling()
				m.conversation.sessionID = ""
			}
			m.activeTab = domain.ApprovalsTab
			m.showNotification = false // Hide notification when going to approvals
			return true, m, m.fetchDataForTab(domain.ApprovalsTab)
		}

	case key.Matches(msg, keys.Tab2):
		if m.activeTab != domain.SessionsTab {
			// Clear conversation view when switching tabs
			if m.conversation.sessionID != "" {
				m.conversation.stopPolling()
				m.conversation.sessionID = ""
			}
			m.activeTab = domain.SessionsTab
			return true, m, m.fetchDataForTab(domain.SessionsTab)
		}

	}

	return false, m, nil
}

// fetchDataForTab returns commands to fetch data for a specific tab
func (m model) fetchDataForTab(tab domain.Tab) tea.Cmd {
	switch tab {
	case domain.ApprovalsTab:
		return fetchRequests(m.daemonClient)
	case domain.SessionsTab:
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
		if i == int(domain.ApprovalsTab) && m.pendingApprovalCount > 0 {
			label += fmt.Sprintf(" (%d)", m.pendingApprovalCount)
		} else if i == int(domain.SessionsTab) && m.activeSessionCount > 0 {
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

	// Calculate width for connection status
	connStatusRendered := connStyle.Render(connStatus)
	connStatusWidth := lipgloss.Width(connStatusRendered)

	// Build help text based on current view
	helpText := m.getContextualHelp()
	helpStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("243")).
		Italic(true).
		Padding(0, 1)
	helpRendered := helpStyle.Render(helpText)
	helpWidth := lipgloss.Width(helpRendered)

	// Error message if any
	errorMsg := ""
	errorWidth := 0
	if m.err != nil {
		// Calculate available width for error message
		// Account for connection status, help text, spacing, and some padding
		availableWidth := m.width - connStatusWidth - helpWidth - 6
		if availableWidth < 20 {
			availableWidth = 20 // Minimum width for error display
		}

		truncatedError := util.TruncateError(m.err, availableWidth)

		errorStyle := lipgloss.NewStyle().
			Foreground(lipgloss.Color("196")).
			Padding(0, 1)

		// Add hint if error was truncated
		errorHint := ""
		if len(util.PreprocessError(m.err.Error())) > availableWidth {
			errorHint = " [e]"
		}
		errorMsg = errorStyle.Render(fmt.Sprintf("Error: %s%s", truncatedError, errorHint))
		errorWidth = lipgloss.Width(errorMsg)
	}

	// Build status bar with proper spacing
	statusStyle := lipgloss.NewStyle().
		Background(lipgloss.Color("235")).
		Width(m.width)

	// Calculate spacing
	leftContent := connStatusRendered
	if errorMsg != "" {
		leftContent += " " + errorMsg
	}
	leftWidth := connStatusWidth + errorWidth
	if errorMsg != "" {
		leftWidth += 1 // Space between connection and error
	}

	// Add spacing between left and right content
	spacing := m.width - leftWidth - helpWidth
	if spacing > 0 {
		leftContent += strings.Repeat(" ", spacing) + helpRendered
	}
	// If not enough space, just show left content as-is

	return statusStyle.Render(leftContent)
}

// getContextualHelp returns appropriate help text based on current view
func (m model) getContextualHelp() string {
	// Don't show help if in special views
	if m.showErrorDetail {
		return "[e] close • [esc] dismiss"
	}

	currentView := m.getCurrentViewState()

	// Special handling for conversation view since it has its own help
	if currentView == domain.ConversationView {
		return ""
	}

	switch currentView {
	case domain.HelpView:
		return "[esc] close"
	case domain.FeedbackView:
		return "[enter] submit • [esc] cancel"
	case domain.LaunchSessionView:
		return "[tab] next field • [enter] launch • [esc] cancel"
	case domain.QueryModalView:
		return "[enter] submit • [esc] cancel"
	case domain.ListView:
		// Context-specific help for list views
		switch m.activeTab {
		case domain.ApprovalsTab:
			if len(m.approvals.requests) > 0 {
				return "[↑/↓] navigate • [enter] view • [y] approve • [n] deny • [?] help"
			}
			return "[tab] switch tab • [?] help • [q] quit"
		case domain.SessionsTab:
			if len(m.sessions.sortedSessions) > 0 {
				return "[↑/↓] navigate • [enter] view • [c] create • [?] help"
			}
			return "[c] create session • [tab] switch tab • [?] help • [q] quit"
		}
	case domain.DetailView, domain.SessionDetailView:
		return "[esc] back • [?] help"
	}

	return "[?] help • [q] quit"
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
		{"1/2", "Jump to tab"},
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
	case domain.FeedbackView:
		s.WriteString("  " + descStyle.Render("Type your response and press enter to submit") + "\n")
	case domain.LaunchSessionView:
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

// renderWithNotification overlays a notification popup on top of the main content
func (m model) renderWithNotification(mainContent string) string {
	lines := strings.Split(mainContent, "\n")

	// Create notification popup style
	notificationStyle := lipgloss.NewStyle().
		Background(lipgloss.Color("208")). // Orange background
		Foreground(lipgloss.Color("16")).  // Black text
		Padding(0, 1).
		Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color("208"))

	notification := notificationStyle.Render("🔔 " + m.notificationMessage)
	notificationWidth := lipgloss.Width(notification)

	// Position in top-right corner
	if len(lines) > 0 && m.width > notificationWidth+2 {
		// Calculate position
		firstLine := lines[0]
		firstLineWidth := len(firstLine)

		// If first line is shorter than screen, pad and add notification
		if firstLineWidth < m.width-notificationWidth-2 {
			padding := m.width - firstLineWidth - notificationWidth - 2
			lines[0] = firstLine + strings.Repeat(" ", padding) + notification
		} else {
			// Insert notification at the beginning
			lines = append([]string{strings.Repeat(" ", m.width-notificationWidth) + notification}, lines...)
		}
	}

	return strings.Join(lines, "\n")
}

// renderWithErrorDetail overlays an error detail popup on top of the main content
func (m model) renderWithErrorDetail(mainContent string) string {
	// Create error detail popup
	errorDetailStyle := lipgloss.NewStyle().
		Background(lipgloss.Color("235")).
		Foreground(lipgloss.Color("252")).
		Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color("196")).
		Padding(1, 2).
		MaxWidth(m.width - 10).
		MaxHeight(m.height - 10)

	// Format error content
	errorContent := fmt.Sprintf("🔍 Error Details\n\n%v\n\nPress [e] to close or [esc] to dismiss", m.fullError)
	errorPopup := errorDetailStyle.Render(errorContent)

	// Calculate center position
	popupWidth := lipgloss.Width(errorPopup)
	popupHeight := strings.Count(errorPopup, "\n") + 1

	startX := (m.width - popupWidth) / 2
	startY := (m.height - popupHeight) / 2

	// Split main content into lines
	lines := strings.Split(mainContent, "\n")

	// Overlay the popup
	popupLines := strings.Split(errorPopup, "\n")
	for i, popupLine := range popupLines {
		if startY+i < len(lines) && startY+i >= 0 {
			line := lines[startY+i]
			// Replace portion of line with popup content
			if startX >= 0 && startX < len(line) {
				before := ""
				if startX > 0 {
					before = line[:startX]
				}
				after := ""
				endX := startX + len(popupLine)
				if endX < len(line) {
					after = line[endX:]
				}
				lines[startY+i] = before + popupLine + after
			}
		}
	}

	return strings.Join(lines, "\n")
}

// updateAllViewSizes updates the size of all sub-views based on terminal dimensions
func (m *model) updateAllViewSizes() {
	// Calculate available content height (terminal - tab bar - status bar)
	contentHeight := m.height - domain.TabBarHeight - domain.StatusBarHeight
	if contentHeight < domain.MinContentHeight {
		contentHeight = domain.MinContentHeight
	}

	contentWidth := m.width - 2 // Some padding
	if contentWidth < domain.MinContentWidth {
		contentWidth = domain.MinContentWidth
	}

	// Update conversation view - pass content dimensions, not full terminal
	m.conversation.updateSize(contentWidth, contentHeight)

	// Update approvals view
	m.approvals.updateSize(contentWidth, contentHeight)

	// Update sessions view
	m.sessions.updateSize(contentWidth, contentHeight)
}

// openConversationView opens the conversation view for a specific session
func (m *model) openConversationView(sessionID string) tea.Cmd {
	m.conversation.setSession(sessionID)

	// Update conversation view size using the standardized update function
	m.updateAllViewSizes()

	// Check cache first - always show cached data immediately if available
	if session, events, found := m.conversationCache.Get(sessionID); found {
		// Return cached data immediately, then fetch fresh data
		return tea.Batch(
			func() tea.Msg {
				return fetchConversationMsg{
					session: session,
					events:  events,
				}
			},
			// Follow up with fresh data from server
			fetchConversation(m.daemonClient, sessionID),
		)
	}

	// Not in cache, fetch from API
	return fetchConversation(m.daemonClient, sessionID)
}
