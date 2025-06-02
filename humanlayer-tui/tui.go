package main

import (
	"fmt"
	"log"
	"path/filepath"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/humanlayer/humanlayer/hld/bus"
	"github.com/humanlayer/humanlayer/hld/client"
	"github.com/humanlayer/humanlayer/hld/rpc"
	"github.com/humanlayer/humanlayer/hld/session"
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
	AgentName  string
	// Session context
	SessionID     string
	SessionPrompt string // First 50 chars of prompt
	SessionModel  string
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
	requests      []Request
	cursor        int
	viewState     viewState
	width, height int

	// Tab management
	activeTab    tab
	tabNames     []string
	tabViewState []viewState // Track view state per tab
	tabCursors   []int       // Track cursor position per tab
	sessions     []session.Info // For sessions tab
	history      []Request   // For history tab

	// For detail view
	selectedRequest *Request

	// For feedback view
	feedbackInput textinput.Model
	feedbackFor   *Request
	isApproving   bool // true for approve with comment, false for deny/human response

	// For launch session view
	launchPromptInput  textinput.Model
	launchModelSelect  int // 0=default, 1=opus, 2=sonnet
	launchWorkingDir   textinput.Model
	launchActiveField  int // 0=prompt, 1=model, 2=workingDir

	// For session detail view
	selectedSession      *session.Info
	sessionApprovals     []Request
	sessionDetailScroll  int

	// For help view
	helpContext      viewState // Which view help was opened from
	helpScrollOffset int       // For scrolling help content

	// For error handling
	err error

	// For subscription
	subscribed  bool
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
		key.WithKeys("l"),
		key.WithHelp("l", "launch session"),
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
}

func newModel() model {
	ti := textinput.New()
	ti.Placeholder = "Enter your response..."
	ti.CharLimit = 500
	ti.Width = 60

	// Create launch session inputs
	promptInput := textinput.New()
	promptInput.Placeholder = "Enter prompt for Claude..."
	promptInput.CharLimit = 1000
	promptInput.Width = 60
	promptInput.Focus()

	workingDirInput := textinput.New()
	workingDirInput.Placeholder = "Working directory (optional)"
	workingDirInput.CharLimit = 200
	workingDirInput.Width = 60

	// Load configuration
	config, err := LoadConfig()
	if err != nil {
		log.Fatal("Failed to load configuration:", err)
	}

	// Determine socket path
	socketPath := "~/.humanlayer/daemon.sock"
	if config.DaemonSocket != "" {
		socketPath = config.DaemonSocket
	}

	// Expand ~ to home directory
	if socketPath[0] == '~' {
		home := mustGetHomeDir()
		socketPath = filepath.Join(home, socketPath[1:])
	}

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
		daemonClient:  daemonClient,
		requests:      []Request{},
		cursor:        0,
		viewState:     listView,
		feedbackInput: ti,
		// Initialize tab management
		activeTab:    approvalsTab,
		tabNames:     []string{"Approvals", "Sessions", "History"},
		tabViewState: []viewState{listView, listView, listView},
		tabCursors:   []int{0, 0, 0},
		sessions:     []session.Info{},
		history:      []Request{},
		// Initialize launch session
		launchPromptInput: promptInput,
		launchWorkingDir:  workingDirInput,
		launchModelSelect: 0, // default
		launchActiveField: 0, // prompt field
		// Initialize status bar
		daemonConnected: true, // We successfully connected
		lastDaemonCheck: time.Now(),
	}

	return m
}

// Tea command to fetch requests
type fetchRequestsMsg struct {
	requests []Request
	err      error
}

// Tea command to fetch sessions
type fetchSessionsMsg struct {
	sessions []session.Info
	err      error
}

// Tea command for launch session response
type launchSessionMsg struct {
	sessionID string
	runID     string
	err       error
}

// Tea command for session approvals
type fetchSessionApprovalsMsg struct {
	approvals []Request
	err       error
}

func fetchSessionApprovals(daemonClient client.Client, sessionID string) tea.Cmd {
	return func() tea.Msg {
		// Fetch approvals for specific session
		approvals, err := daemonClient.FetchApprovals(sessionID)
		if err != nil {
			return fetchSessionApprovalsMsg{err: err}
		}

		// Get session info to enrich approvals
		sessionsResp, err := daemonClient.ListSessions()
		if err != nil {
			// Continue without session info if fetch fails
			sessionsResp = &rpc.ListSessionsResponse{Sessions: []session.Info{}}
		}

		// Find the specific session
		var sessionInfo *session.Info
		for _, sess := range sessionsResp.Sessions {
			if sess.ID == sessionID {
				sessionInfo = &sess
				break
			}
		}

		// Convert to Request type
		var requests []Request
		for _, approval := range approvals {
			if approval.Type == "function_call" && approval.FunctionCall != nil {
				fc := approval.FunctionCall
				message := fmt.Sprintf("Call %s", fc.Spec.Fn)

				createdAt := time.Now()
				if fc.Status != nil && fc.Status.RequestedAt != nil {
					createdAt = fc.Status.RequestedAt.Time
				}

				req := Request{
					ID:         fc.CallID,
					CallID:     fc.CallID,
					RunID:      fc.RunID,
					Type:       ApprovalRequest,
					Message:    message,
					Tool:       fc.Spec.Fn,
					Parameters: fc.Spec.Kwargs,
					CreatedAt:  createdAt,
					AgentName:  "Agent",
				}

				// Add session info if available
				if sessionInfo != nil {
					req.SessionID = sessionInfo.ID
					req.SessionPrompt = truncate(sessionInfo.Prompt, 50)
					req.SessionModel = sessionInfo.Model
					if req.SessionModel == "" {
						req.SessionModel = "default"
					}
					message += fmt.Sprintf(" with %s", strings.Join(params, ", "))
				}

				requests = append(requests, req)
			} else if approval.Type == "human_contact" && approval.HumanContact != nil {
				hc := approval.HumanContact
				createdAt := time.Now()
				if hc.Status != nil && hc.Status.RequestedAt != nil {
					createdAt = hc.Status.RequestedAt.Time
				}

				req := Request{
					ID:        hc.CallID,
					CallID:    hc.CallID,
					RunID:     hc.RunID,
					Type:      HumanContactRequest,
					Message:   hc.Spec.Msg,
					CreatedAt: createdAt,
					AgentName: "Agent",
				}

				// Add session info if available
				if sessionInfo != nil {
					req.SessionID = sessionInfo.ID
					req.SessionPrompt = truncate(sessionInfo.Prompt, 50)
					req.SessionModel = sessionInfo.Model
					if req.SessionModel == "" {
						req.SessionModel = "default"
					}
				}

				requests = append(requests, req)
			}
		}

		return fetchSessionApprovalsMsg{approvals: requests}
	}
}

func fetchSessions(daemonClient client.Client) tea.Cmd {
	return func() tea.Msg {
		// Fetch all sessions from daemon
		resp, err := daemonClient.ListSessions()
		if err != nil {
			return fetchSessionsMsg{err: err}
		}

		return fetchSessionsMsg{sessions: resp.Sessions}
	}
}

func fetchRequests(daemonClient client.Client) tea.Cmd {
	return func() tea.Msg {
		var allRequests []Request

		// Fetch all pending approvals from daemon
		approvals, err := daemonClient.FetchApprovals("")
		if err != nil {
			return fetchRequestsMsg{err: err}
		}

		// Fetch all sessions to enrich approvals with session context
		sessionsResp, err := daemonClient.ListSessions()
		if err != nil {
			// Continue without session info if fetch fails
			sessionsResp = &rpc.ListSessionsResponse{Sessions: []session.Info{}}
		}

		// Create a map of RunID to Session for quick lookup
		sessionsByRunID := make(map[string]session.Info)
		for _, sess := range sessionsResp.Sessions {
			sessionsByRunID[sess.RunID] = sess
		}

		// Convert approvals to our Request type
		for _, approval := range approvals {
			if approval.Type == "function_call" && approval.FunctionCall != nil {
				fc := approval.FunctionCall
				// Build a message from the function name and kwargs
				message := fmt.Sprintf("Call %s", fc.Spec.Fn)
				if len(fc.Spec.Kwargs) > 0 {
					// Add first few parameters to message
					params := []string{}
					for k, v := range fc.Spec.Kwargs {
						params = append(params, fmt.Sprintf("%s=%v", k, v))
						if len(params) >= 2 {
							break
						}
					}
					message += fmt.Sprintf(" with %s", strings.Join(params, ", "))
				}

				createdAt := time.Now() // Default to now if not available
				if fc.Status != nil && fc.Status.RequestedAt != nil {
					createdAt = fc.Status.RequestedAt.Time
				}

				req := Request{
					ID:         fc.CallID,
					CallID:     fc.CallID,
					RunID:      fc.RunID,
					Type:       ApprovalRequest,
					Message:    message,
					Tool:       fc.Spec.Fn,
					Parameters: fc.Spec.Kwargs,
					CreatedAt:  createdAt,
					AgentName:  "Agent", // TODO: Get from somewhere
				}

				// Enrich with session info if available
				if sess, ok := sessionsByRunID[fc.RunID]; ok {
					req.SessionID = sess.ID
					req.SessionPrompt = truncate(sess.Prompt, 50)
					req.SessionModel = sess.Model
					if req.SessionModel == "" {
						req.SessionModel = "default"
					}
				}

				allRequests = append(allRequests, req)
			} else if approval.Type == "human_contact" && approval.HumanContact != nil {
				hc := approval.HumanContact
				createdAt := time.Now() // Default to now if not available
				if hc.Status != nil && hc.Status.RequestedAt != nil {
					createdAt = hc.Status.RequestedAt.Time
				}

				req := Request{
					ID:        hc.CallID,
					CallID:    hc.CallID,
					RunID:     hc.RunID,
					Type:      HumanContactRequest,
					Message:   hc.Spec.Msg,
					CreatedAt: createdAt,
					AgentName: "Agent", // TODO: Get from somewhere
				}

				// Enrich with session info if available
				if sess, ok := sessionsByRunID[hc.RunID]; ok {
					req.SessionID = sess.ID
					req.SessionPrompt = truncate(sess.Prompt, 50)
					req.SessionModel = sess.Model
					if req.SessionModel == "" {
						req.SessionModel = "default"
					}
				}

				allRequests = append(allRequests, req)
			}
		}

		return fetchRequestsMsg{requests: allRequests}
	}
}

func (m model) Init() tea.Cmd {
	return tea.Batch(
		textinput.Blink,
		fetchRequests(m.daemonClient),
		subscribeToEvents(m.daemonClient),
	)
}

// Event message types
type eventMsg struct {
	event bus.Event
}

type subscriptionErrorMsg struct {
	err error
}

// subscribeToEvents subscribes to daemon events
func subscribeToEvents(client client.Client) tea.Cmd {
	return func() tea.Msg {
		// Subscribe to all event types
		eventChan, err := client.Subscribe(rpc.SubscribeRequest{
			EventTypes: []string{
				string(bus.EventNewApproval),
				string(bus.EventApprovalResolved),
				string(bus.EventSessionStatusChanged),
			},
		})
		if err != nil {
			return subscriptionErrorMsg{err: err}
		}

		// Store the channel for continuous listening
		return eventChannelMsg{channel: eventChan}
	}
}

// eventChannelMsg carries the event channel
type eventChannelMsg struct {
	channel <-chan rpc.EventNotification
}

// listenForEvents listens for events from the subscription channel
func listenForEvents(eventChan <-chan rpc.EventNotification) tea.Cmd {
	return func() tea.Msg {
		// Wait for next event
		notification, ok := <-eventChan
		if !ok {
			// Channel closed, subscription ended
			return subscriptionErrorMsg{err: fmt.Errorf("subscription ended")}
		}
		return eventMsg{event: notification.Event}
	}
}

// handleTabSwitching handles global tab navigation keys
func (m model) handleTabSwitching(msg tea.KeyMsg) (bool, tea.Model, tea.Cmd) {
	// Only allow tab switching from list views
	if m.tabViewState[m.activeTab] != listView {
		return false, m, nil
	}

	switch {
	case key.Matches(msg, keys.Tab):
		// Save current tab state
		m.tabCursors[m.activeTab] = m.cursor
		m.tabViewState[m.activeTab] = m.viewState

		// Move to next tab
		m.activeTab = (m.activeTab + 1) % 3

		// Restore new tab state
		m.cursor = m.tabCursors[m.activeTab]
		m.viewState = m.tabViewState[m.activeTab]

		// Fetch data for new tab if needed
		return true, m, m.fetchDataForTab(m.activeTab)

	case key.Matches(msg, keys.ShiftTab):
		// Save current tab state
		m.tabCursors[m.activeTab] = m.cursor
		m.tabViewState[m.activeTab] = m.viewState

		// Move to previous tab
		m.activeTab = (m.activeTab + 2) % 3

		// Restore new tab state
		m.cursor = m.tabCursors[m.activeTab]
		m.viewState = m.tabViewState[m.activeTab]

		// Fetch data for new tab if needed
		return true, m, m.fetchDataForTab(m.activeTab)

	case key.Matches(msg, keys.Tab1):
		if m.activeTab != approvalsTab {
			m.switchToTab(approvalsTab)
			return true, m, m.fetchDataForTab(approvalsTab)
		}

	case key.Matches(msg, keys.Tab2):
		if m.activeTab != sessionsTab {
			m.switchToTab(sessionsTab)
			return true, m, m.fetchDataForTab(sessionsTab)
		}

	case key.Matches(msg, keys.Tab3):
		if m.activeTab != historyTab {
			m.switchToTab(historyTab)
			return true, m, m.fetchDataForTab(historyTab)
		}
	}

	return false, m, nil
}

// switchToTab saves current tab state and switches to new tab
func (m *model) switchToTab(newTab tab) {
	// Save current tab state
	m.tabCursors[m.activeTab] = m.cursor
	m.tabViewState[m.activeTab] = m.viewState

	// Switch to new tab
	m.activeTab = newTab
	m.cursor = m.tabCursors[m.activeTab]
	m.viewState = m.tabViewState[m.activeTab]
}

// fetchDataForTab returns a command to fetch data for the given tab
func (m model) fetchDataForTab(tab tab) tea.Cmd {
	switch tab {
	case approvalsTab:
		return fetchRequests(m.daemonClient)
	case sessionsTab:
		return fetchSessions(m.daemonClient)
	case historyTab:
		// TODO: Implement fetchHistory
		return nil
	}
	return nil
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmd tea.Cmd

	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil

	case fetchRequestsMsg:
		if msg.err != nil {
			m.err = msg.err
			m.daemonConnected = false
			return m, nil
		}
		m.requests = msg.requests
		m.pendingApprovalCount = len(msg.requests)
		m.err = nil
		m.daemonConnected = true
		m.lastDaemonCheck = time.Now()
		return m, nil

	case fetchSessionsMsg:
		if msg.err != nil {
			m.err = msg.err
			m.daemonConnected = false
			return m, nil
		}
		m.sessions = msg.sessions
		// Count active sessions (running or starting)
		activeCount := 0
		for _, s := range m.sessions {
			if s.Status == session.StatusRunning || s.Status == session.StatusStarting {
				activeCount++
			}
		}
		m.activeSessionCount = activeCount
		m.err = nil
		m.daemonConnected = true
		m.lastDaemonCheck = time.Now()
		return m, nil

	case approvalSentMsg:
		if msg.err != nil {
			m.err = msg.err
			return m, nil
		}
		// Remove the request and refresh
		m.requests = removeRequestByID(m.requests, msg.requestID)
		if m.cursor >= len(m.requests) && m.cursor > 0 {
			m.cursor--
		}
		m.tabViewState[m.activeTab] = listView
		m.viewState = listView
		m.selectedRequest = nil
		m.feedbackFor = nil
		m.feedbackInput.Reset()
		// Refresh the list
		return m, fetchRequests(m.daemonClient)

	case humanResponseSentMsg:
		if msg.err != nil {
			m.err = msg.err
			return m, nil
		}
		// Remove the request and refresh
		m.requests = removeRequestByID(m.requests, msg.requestID)
		if m.cursor >= len(m.requests) && m.cursor > 0 {
			m.cursor--
		}
		m.tabViewState[m.activeTab] = listView
		m.viewState = listView
		m.selectedRequest = nil
		m.feedbackFor = nil
		m.feedbackInput.Reset()
		// Refresh the list
		return m, fetchRequests(m.daemonClient)
    
	case launchSessionMsg:
		if msg.err != nil {
			m.err = msg.err
			return m, nil
		}
		// Session launched successfully
		m.tabViewState[m.activeTab] = listView
		m.viewState = listView
		// Refresh sessions list
		return m, fetchSessions(m.daemonClient)

	case fetchSessionApprovalsMsg:
		if msg.err != nil {
			m.err = msg.err
			return m, nil
		}
		m.sessionApprovals = msg.approvals
		m.err = nil
		return m, nil

	case eventChannelMsg:
		// Store the event channel and start listening
		m.eventChannel = msg.channel
		m.subscribed = true
		return m, listenForEvents(m.eventChannel)

	case eventMsg:
		// Handle events from subscription
		switch msg.event.Type {
		case bus.EventNewApproval:
			// New approvals arrived, refresh the list
			if m.activeTab == approvalsTab {
				cmd = fetchRequests(m.daemonClient)
			}
		case bus.EventApprovalResolved:
			// An approval was resolved, refresh the list
			if m.activeTab == approvalsTab {
				cmd = fetchRequests(m.daemonClient)
			}
		case bus.EventSessionStatusChanged:
			// Session status changed, refresh sessions list
			if m.activeTab == sessionsTab {
				cmd = fetchSessions(m.daemonClient)
			}
		}
		// Continue listening for more events
		if m.eventChannel != nil {
			cmd = tea.Batch(cmd, listenForEvents(m.eventChannel))
		}
		return m, cmd

	case subscriptionErrorMsg:
		// Subscription error, try to reconnect after a delay
		m.err = msg.err
		m.subscribed = false
		return m, tea.Tick(5*time.Second, func(t time.Time) tea.Msg {
			return subscribeToEvents(m.daemonClient)
		})

	case tea.KeyMsg:
		// Clear error on any key press
		m.err = nil

		// Handle global keys
		switch {
		case key.Matches(msg, keys.Help):
			// Don't open help if already in help view
			if m.viewState == helpView || m.tabViewState[m.activeTab] == helpView {
				return m, nil
			}
			// Open help from current context
			m.helpContext = m.tabViewState[m.activeTab]
			m.helpScrollOffset = 0
			m.tabViewState[m.activeTab] = helpView
			m.viewState = helpView
			return m, nil

		case key.Matches(msg, keys.Refresh):
			// Refresh current tab's data
			switch m.activeTab {
			case approvalsTab:
				return m, fetchRequests(m.daemonClient)
			case sessionsTab:
				return m, fetchSessions(m.daemonClient)
			}

		case key.Matches(msg, keys.Sessions):
			// Quick switch to sessions tab
			if m.activeTab != sessionsTab && m.tabViewState[m.activeTab] == listView {
				m.switchToTab(sessionsTab)
				return m, fetchSessions(m.daemonClient)
			}
		}

		// Handle global tab switching keys
		handled, newModel, cmd := m.handleTabSwitching(msg)
		if handled {
			return newModel, cmd
		}

		// Handle view-specific keys based on active tab's view state
		switch m.tabViewState[m.activeTab] {
		case listView:
			return m.updateListView(msg)
		case detailView:
			return m.updateDetailView(msg)
		case feedbackView:
			return m.updateFeedbackView(msg)
		case launchSessionView:
			return m.updateLaunchSessionView(msg)
		case sessionDetailView:
			return m.updateSessionDetailView(msg)
		case helpView:
			return m.updateHelpView(msg)
		}
	}

	return m, cmd
}

func (m model) updateListView(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch {
	case key.Matches(msg, keys.Quit):
		return m, tea.Quit

	case key.Matches(msg, keys.Up):
		if m.cursor > 0 {
			m.cursor--
		}

	case key.Matches(msg, keys.Down):
		// Handle based on active tab
		switch m.activeTab {
		case approvalsTab:
			if m.cursor < len(m.requests)-1 {
				m.cursor++
			}
		case sessionsTab:
			if m.cursor < len(m.sessions)-1 {
				m.cursor++
			}
		case historyTab:
			if m.cursor < len(m.history)-1 {
				m.cursor++
			}
		}

	case key.Matches(msg, keys.Enter):
		switch m.activeTab {
		case approvalsTab:
			if len(m.requests) > 0 {
				m.selectedRequest = &m.requests[m.cursor]
				m.tabViewState[m.activeTab] = detailView
				m.viewState = detailView
			}
		case sessionsTab:
			if len(m.sessions) > 0 {
				// Copy the session to avoid pointer issues
				sess := m.sessions[m.cursor]
				m.selectedSession = &sess
				m.sessionDetailScroll = 0
				m.tabViewState[m.activeTab] = sessionDetailView
				m.viewState = sessionDetailView
				// Fetch approvals for this session
				return m, fetchSessionApprovals(m.daemonClient, sess.ID)
			}
		}

	case key.Matches(msg, keys.Approve):
		// Only handle for approvals tab
		if m.activeTab == approvalsTab && len(m.requests) > 0 {
			req := &m.requests[m.cursor]
			if req.Type == ApprovalRequest {
				// Quick approve
				return m, m.sendApproval(req.ID, true, "")
			}
		}

	case key.Matches(msg, keys.Deny):
		// Only handle for approvals tab
		if m.activeTab == approvalsTab && len(m.requests) > 0 {
			req := &m.requests[m.cursor]
			m.feedbackFor = req
			m.isApproving = false
			m.feedbackInput.Reset()
			m.feedbackInput.Focus()
			m.tabViewState[m.activeTab] = feedbackView
			m.viewState = feedbackView
			return m, textinput.Blink
		}

	case key.Matches(msg, keys.Launch):
		// Launch new session - available from sessions tab
		if m.activeTab == sessionsTab {
			m.launchPromptInput.Reset()
			m.launchWorkingDir.Reset()
			m.launchModelSelect = 0
			m.launchActiveField = 0
			m.launchPromptInput.Focus()
			m.tabViewState[m.activeTab] = launchSessionView
			m.viewState = launchSessionView
			return m, textinput.Blink
		}
	}

	return m, nil
}

func (m model) updateDetailView(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch {
	case key.Matches(msg, keys.Quit):
		return m, tea.Quit

	case key.Matches(msg, keys.Back):
		m.tabViewState[m.activeTab] = listView
		m.viewState = listView
		m.selectedRequest = nil

	case key.Matches(msg, keys.Approve):
		if m.selectedRequest.Type == ApprovalRequest {
			return m, m.sendApproval(m.selectedRequest.ID, true, "")
		}

	case key.Matches(msg, keys.Deny):
		m.feedbackFor = m.selectedRequest
		m.isApproving = false
		m.feedbackInput.Reset()
		m.feedbackInput.Focus()
		m.tabViewState[m.activeTab] = feedbackView
		m.viewState = feedbackView
		return m, textinput.Blink
	}

	return m, nil
}

func (m model) updateFeedbackView(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	var cmd tea.Cmd

	switch {
	case key.Matches(msg, keys.Quit):
		return m, tea.Quit

	case key.Matches(msg, keys.Back):
		m.tabViewState[m.activeTab] = listView
		m.viewState = listView
		m.feedbackFor = nil
		m.feedbackInput.Reset()
		return m, nil

	case msg.Type == tea.KeyEnter:
		// Submit feedback
		feedback := m.feedbackInput.Value()
		if feedback != "" {
			if m.feedbackFor.Type == ApprovalRequest {
				// Deny with reason
				return m, m.sendApproval(m.feedbackFor.ID, false, feedback)
			} else {
				// Human contact response
				return m, m.sendHumanResponse(m.feedbackFor.ID, feedback)
			}
		}
		return m, nil

	default:
		m.feedbackInput, cmd = m.feedbackInput.Update(msg)
		return m, cmd
	}
}

func (m model) updateHelpView(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch {
	case key.Matches(msg, keys.Quit):
		return m, tea.Quit

	case key.Matches(msg, keys.Back):
		// Return to previous view
		m.tabViewState[m.activeTab] = m.helpContext
		m.viewState = m.helpContext
		return m, nil

	case key.Matches(msg, keys.Up):
		if m.helpScrollOffset > 0 {
			m.helpScrollOffset--
		}

	case key.Matches(msg, keys.Down):
		m.helpScrollOffset++

	case msg.Type == tea.KeyPgUp:
		m.helpScrollOffset -= 10
		if m.helpScrollOffset < 0 {
			m.helpScrollOffset = 0
		}

	case msg.Type == tea.KeyPgDown:
		m.helpScrollOffset += 10
	}

	return m, nil
}

func (m model) updateSessionDetailView(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch {
	case key.Matches(msg, keys.Quit):
		return m, tea.Quit

	case key.Matches(msg, keys.Back):
		// Go back to session list
		m.tabViewState[m.activeTab] = listView
		m.viewState = listView
		m.selectedSession = nil
		m.sessionApprovals = nil
		return m, nil

	case key.Matches(msg, keys.Up):
		if m.sessionDetailScroll > 0 {
			m.sessionDetailScroll--
		}

	case key.Matches(msg, keys.Down):
		// Allow scrolling if content is longer than view
		m.sessionDetailScroll++

	case msg.Type == tea.KeyPgUp:
		m.sessionDetailScroll -= 10
		if m.sessionDetailScroll < 0 {
			m.sessionDetailScroll = 0
		}

	case msg.Type == tea.KeyPgDown:
		m.sessionDetailScroll += 10

	case key.Matches(msg, keys.Approve) || key.Matches(msg, keys.Deny):
		// TODO: Handle inline approval actions for session approvals
		// For now, users need to go back to main approval list
	}

	return m, nil
}

func (m model) updateLaunchSessionView(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	var cmd tea.Cmd

	switch {
	case key.Matches(msg, keys.Quit):
		return m, tea.Quit

	case key.Matches(msg, keys.Back):
		// Cancel and go back
		m.tabViewState[m.activeTab] = listView
		m.viewState = listView
		return m, nil

	case msg.Type == tea.KeyTab:
		// Move to next field
		m.launchActiveField = (m.launchActiveField + 1) % 3
		switch m.launchActiveField {
		case 0:
			m.launchPromptInput.Focus()
			m.launchWorkingDir.Blur()
			return m, textinput.Blink
		case 1:
			m.launchPromptInput.Blur()
			m.launchWorkingDir.Blur()
		case 2:
			m.launchPromptInput.Blur()
			m.launchWorkingDir.Focus()
			return m, textinput.Blink
		}

	case msg.Type == tea.KeyShiftTab:
		// Move to previous field
		m.launchActiveField = (m.launchActiveField + 2) % 3
		switch m.launchActiveField {
		case 0:
			m.launchPromptInput.Focus()
			m.launchWorkingDir.Blur()
			return m, textinput.Blink
		case 1:
			m.launchPromptInput.Blur()
			m.launchWorkingDir.Blur()
		case 2:
			m.launchPromptInput.Blur()
			m.launchWorkingDir.Focus()
			return m, textinput.Blink
		}

	case key.Matches(msg, keys.Up) || key.Matches(msg, keys.Down):
		// Handle model selection
		if m.launchActiveField == 1 {
			if key.Matches(msg, keys.Up) {
				m.launchModelSelect = (m.launchModelSelect + 2) % 3
			} else {
				m.launchModelSelect = (m.launchModelSelect + 1) % 3
			}
		}

	case msg.Type == tea.KeyCtrlL || msg.Type == tea.KeyEnter:
		// Launch session
		prompt := m.launchPromptInput.Value()
		if prompt != "" {
			return m, m.launchSession()
		}

	default:
		// Update the active text input
		switch m.launchActiveField {
		case 0:
			m.launchPromptInput, cmd = m.launchPromptInput.Update(msg)
		case 2:
			m.launchWorkingDir, cmd = m.launchWorkingDir.Update(msg)
		}
		return m, cmd
	}

	return m, nil
}

func (m model) View() string {
	var s strings.Builder

	// Calculate available height for content
	contentHeight := m.height - 3 // Tab bar (2 lines) + status bar (1 line)

	// Render tab bar
	s.WriteString(m.renderTabBar())
	s.WriteString("\n")

	// Render content based on active tab's view state
	contentLines := 0
	content := ""
	switch m.tabViewState[m.activeTab] {
	case listView:
		switch m.activeTab {
		case approvalsTab:
			content = m.listViewRender()
		case sessionsTab:
			content = m.sessionsListViewRender()
		case historyTab:
			content = m.historyListViewRender()
		}
	case detailView:
		content = m.detailViewRender()
	case feedbackView:
		content = m.feedbackViewRender()
	case launchSessionView:
		content = m.launchSessionViewRender()
	case sessionDetailView:
		content = m.sessionDetailViewRender()
	case helpView:
		content = m.helpViewRender()
	}

	s.WriteString(content)

	// Count content lines to add padding if needed
	contentLines = strings.Count(content, "\n")
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

// renderStatusBar renders the bottom status bar
func (m model) renderStatusBar() string {
	// Connection status
	connStatus := "🟢 Connected"
	connColor := "46" // green
	if !m.daemonConnected {
		connStatus = "🔴 Disconnected"
		connColor = "196" // red
	} else if time.Since(m.lastDaemonCheck) > 60*time.Second {
		connStatus = "🟡 Reconnecting"
		connColor = "226" // yellow
	}

	connStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color(connColor)).
		Padding(0, 1)

	// Counts
	countsStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("240")).
		Padding(0, 1)
	counts := fmt.Sprintf("%d pending | %d active sessions", m.pendingApprovalCount, m.activeSessionCount)

	// Subscription status
	subStatus := ""
	if m.subscribed {
		subStatus = "| 🔔 Live updates"
	}

	// Build status bar
	leftContent := connStyle.Render(connStatus)
	centerContent := countsStyle.Render(counts + subStatus)

	// Calculate padding for center alignment
	totalWidth := m.width
	leftWidth := lipgloss.Width(leftContent)
	centerWidth := lipgloss.Width(centerContent)

	leftPadding := (totalWidth - centerWidth) / 2 - leftWidth
	if leftPadding < 1 {
		leftPadding = 1
	}

	padding := strings.Repeat(" ", leftPadding)

	statusBar := leftContent + padding + centerContent

	// Add background color
	statusBarStyle := lipgloss.NewStyle().
		Background(lipgloss.Color("235")).
		Width(m.width)

	return statusBarStyle.Render(statusBar)
}

// renderTabBar renders the tab navigation bar
func (m model) renderTabBar() string {
	var tabs []string

	for i, name := range m.tabNames {
		style := lipgloss.NewStyle().
			Padding(0, 2)

		// Add count for tabs
		displayName := name
		if i == int(approvalsTab) && len(m.requests) > 0 {
			displayName = fmt.Sprintf("%s (%d)", name, len(m.requests))
		} else if i == int(sessionsTab) && len(m.sessions) > 0 {
			displayName = fmt.Sprintf("%s (%d)", name, len(m.sessions))
		}

		// Highlight active tab
		if i == int(m.activeTab) {
			style = style.
				Bold(true).
				Foreground(lipgloss.Color("205")).
				Background(lipgloss.Color("235"))
		} else {
			style = style.
				Foreground(lipgloss.Color("240"))
		}

		// Add tab number hint
		tabStr := fmt.Sprintf("[%d] %s", i+1, displayName)
		tabs = append(tabs, style.Render(tabStr))
	}

	tabBar := lipgloss.JoinHorizontal(lipgloss.Top, tabs...)

	// Add separator line
	separator := strings.Repeat("═", m.width)

	return tabBar + "\n" + separator
}

// sessionsListViewRender renders the sessions tab content
func (m model) sessionsListViewRender() string {
	var s strings.Builder

	// Header
	header := lipgloss.NewStyle().
		Bold(true).
		Padding(0, 1).
		Render(fmt.Sprintf("Sessions (%d)", len(m.sessions)))

	s.WriteString(header + "\n")
	s.WriteString(strings.Repeat("─", m.width) + "\n\n")

	// Show error if any
	if m.err != nil {
		errStyle := lipgloss.NewStyle().
			Foreground(lipgloss.Color("196")).
			Padding(0, 1)
		s.WriteString(errStyle.Render(fmt.Sprintf("Error: %v", m.err)) + "\n\n")
	}

	// Session list
	if len(m.sessions) == 0 {
		emptyStyle := lipgloss.NewStyle().
			Foreground(lipgloss.Color("240")).
			Italic(true).
			Padding(0, 2)
		s.WriteString(emptyStyle.Render("No sessions found") + "\n")
	} else {
		for i, sess := range m.sessions {
			cursor := "  "
			if i == m.cursor {
				cursor = " >"
			}

			// Status icon
			statusIcon := "⚪" // default
			switch sess.Status {
			case session.StatusStarting:
				statusIcon = "🟡"
			case session.StatusRunning:
				statusIcon = "🟢"
			case session.StatusCompleted:
				statusIcon = "⚪"
			case session.StatusFailed:
				statusIcon = "🔴"
			}

			// Truncate session ID for display
			shortID := sess.ID
			if len(shortID) > 12 {
				shortID = shortID[:12]
			}

			// Format model
			model := sess.Model
			if model == "" {
				model = "default"
			}

			// Format duration
			duration := formatDuration(time.Since(sess.StartTime))
			if sess.EndTime != nil {
				duration = formatDuration(sess.EndTime.Sub(sess.StartTime))
			}

			// Format prompt preview
			promptPreview := truncate(sess.Prompt, 30)

			line := fmt.Sprintf("%s %s %s  %-7s  %-5s  %s",
				cursor,
				statusIcon,
				shortID,
				model,
				duration,
				promptPreview,
			)

			if i == m.cursor {
				line = lipgloss.NewStyle().
					Foreground(lipgloss.Color("205")).
					Render(line)
			}

			s.WriteString(line + "\n")
		}
	}

	// Remove extra newline since status bar handles spacing
	s.WriteString("\n" + strings.Repeat("─", m.width))

	return s.String()
}

// historyListViewRender renders the history tab content
func (m model) historyListViewRender() string {
	var s strings.Builder

	// Header
	header := lipgloss.NewStyle().
		Bold(true).
		Padding(0, 1).
		Render("History")

	s.WriteString(header + "\n")
	s.WriteString(strings.Repeat("─", m.width) + "\n\n")

	// Placeholder content
	emptyStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("240")).
		Italic(true).
		Padding(0, 2)
	s.WriteString(emptyStyle.Render("History view coming soon...") + "\n")

	// Remove extra newline since status bar handles spacing
	s.WriteString("\n" + strings.Repeat("─", m.width))

	return s.String()
}

func (m model) listViewRender() string {
	var s strings.Builder

	// Header
	header := lipgloss.NewStyle().
		Bold(true).
		Padding(0, 1).
		Render(fmt.Sprintf("Pending Requests (%d)", len(m.requests)))

	s.WriteString(header + "\n")
	s.WriteString(strings.Repeat("─", m.width) + "\n\n")

	// Show error if any
	if m.err != nil {
		errStyle := lipgloss.NewStyle().
			Foreground(lipgloss.Color("196")).
			Padding(0, 1)
		s.WriteString(errStyle.Render(fmt.Sprintf("Error: %v", m.err)) + "\n\n")
	}

	// Request list
	if len(m.requests) == 0 {
		emptyStyle := lipgloss.NewStyle().
			Foreground(lipgloss.Color("240")).
			Italic(true).
			Padding(0, 2)
		s.WriteString(emptyStyle.Render("No pending requests") + "\n")
	} else {
		// Group requests by session
		currentSessionID := ""
		for i, req := range m.requests {
			// Show session header if this is a new session
			if req.SessionID != "" && req.SessionID != currentSessionID {
				currentSessionID = req.SessionID
				sessionStyle := lipgloss.NewStyle().
					Foreground(lipgloss.Color("135")). // Purple
					Bold(true).
					Padding(0, 1)
				sessionHeader := fmt.Sprintf("Session: %s (%s)", req.SessionPrompt, req.SessionModel)
				s.WriteString(sessionStyle.Render(sessionHeader) + "\n")
			} else if req.SessionID == "" && currentSessionID != "" {
				// Show "No Session" header for orphaned approvals
				currentSessionID = ""
				sessionStyle := lipgloss.NewStyle().
					Foreground(lipgloss.Color("240")). // Gray
					Italic(true).
					Padding(0, 1)
				s.WriteString(sessionStyle.Render("No Session") + "\n")
			}

			cursor := "  "
			if i == m.cursor {
				cursor = " >"
			}

			typeIcon := "📋" // approval
			if req.Type == HumanContactRequest {
				typeIcon = "💬" // human contact
			}

			// Indent items under session headers
			indent := "  "
			if req.SessionID != "" {
				indent = "    "
			}

			line := fmt.Sprintf("%s%s %s %-20s %-30s %s",
				indent,
				cursor,
				typeIcon,
				truncate(req.Tool, 20),
				truncate(req.Message, 30),
				formatDuration(time.Since(req.CreatedAt)),
			)

			if i == m.cursor {
				line = lipgloss.NewStyle().
					Foreground(lipgloss.Color("205")).
					Render(line)
			}

			s.WriteString(line + "\n")
		}
	}

	// Remove extra newline since status bar handles spacing
	s.WriteString("\n" + strings.Repeat("─", m.width))

	return s.String()
}

func (m model) detailViewRender() string {
	if m.selectedRequest == nil {
		return ""
	}

	req := m.selectedRequest
	var s strings.Builder

	// Header
	title := "Approval Request"
	if req.Type == HumanContactRequest {
		title = "Human Contact Request"
	}

	header := lipgloss.NewStyle().
		Bold(true).
		Padding(0, 1).
		Render(title + " [esc: back]")

	s.WriteString(header + "\n")
	s.WriteString(strings.Repeat("─", m.width) + "\n\n")

	// Session context if available
	if req.SessionID != "" {
		sessionStyle := lipgloss.NewStyle().
			Foreground(lipgloss.Color("135")). // Purple
			Bold(true).
			Padding(0, 2)
		s.WriteString(sessionStyle.Render("Session Context") + "\n")

		details := lipgloss.NewStyle().
			Padding(0, 2)
		s.WriteString(details.Render(fmt.Sprintf("Session: %s\n", req.SessionID)))
		s.WriteString(details.Render(fmt.Sprintf("Model: %s\n", req.SessionModel)))
		s.WriteString(details.Render(fmt.Sprintf("Prompt: %s\n", req.SessionPrompt)))
		s.WriteString("\n")
	}

	// Request details
	details := lipgloss.NewStyle().
		Padding(0, 2)

	if req.Type == ApprovalRequest {
		s.WriteString(details.Render(fmt.Sprintf("Type: %s\n", req.Type)))
		s.WriteString(details.Render(fmt.Sprintf("Tool: %s\n", req.Tool)))
		s.WriteString(details.Render(fmt.Sprintf("Agent: %s\n", req.AgentName)))
		s.WriteString(details.Render(fmt.Sprintf("Time: %s ago\n", formatDuration(time.Since(req.CreatedAt)))))
		s.WriteString("\n")
		s.WriteString(details.Render("Parameters:\n"))
		for k, v := range req.Parameters {
			s.WriteString(details.Render(fmt.Sprintf("  %s: %v\n", k, v)))
		}
	} else {
		s.WriteString(details.Render(fmt.Sprintf("From: %s\n", req.AgentName)))
		s.WriteString(details.Render(fmt.Sprintf("Time: %s ago\n", formatDuration(time.Since(req.CreatedAt)))))
		s.WriteString("\n")
		s.WriteString(details.Render("Message:\n"))
		s.WriteString(details.Render(req.Message + "\n"))
	}

	// Actions
	s.WriteString("\n" + strings.Repeat("─", m.width) + "\n")

	actions := "[y] approve  [n] deny  [esc] back"
	if req.Type == HumanContactRequest {
		actions = "[n] respond  [esc] back"
	}

	footer := lipgloss.NewStyle().
		Foreground(lipgloss.Color("240")).
		Render(actions)
	s.WriteString(footer)

	return s.String()
}

func (m model) sessionDetailViewRender() string {
	if m.selectedSession == nil {
		return "No session selected"
	}

	var s strings.Builder
	sess := m.selectedSession

	// Header
	header := lipgloss.NewStyle().
		Bold(true).
		Padding(0, 1).
		Render(fmt.Sprintf("Session Details: %s [esc: back]", sess.ID[:12]))

	s.WriteString(header + "\n")
	s.WriteString(strings.Repeat("─", m.width) + "\n\n")

	// Apply scrolling offset
	var contentLines []string

	// Session information section
	infoStyle := lipgloss.NewStyle().
		Padding(0, 2)

	sectionHeader := lipgloss.NewStyle().
		Bold(true).
		Foreground(lipgloss.Color("135")).
		Padding(0, 2)

	contentLines = append(contentLines, sectionHeader.Render("Session Information"))
	contentLines = append(contentLines, "")

	// Status with color
	statusColor := "240"
	statusText := string(sess.Status)
	switch sess.Status {
	case session.StatusStarting:
		statusColor = "226" // yellow
	case session.StatusRunning:
		statusColor = "46" // green
	case session.StatusCompleted:
		statusColor = "240" // gray
	case session.StatusFailed:
		statusColor = "196" // red
	}
	statusStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color(statusColor))

	contentLines = append(contentLines, infoStyle.Render(fmt.Sprintf("Status: %s", statusStyle.Render(statusText))))
	contentLines = append(contentLines, infoStyle.Render(fmt.Sprintf("Model: %s", sess.Model)))
	contentLines = append(contentLines, infoStyle.Render(fmt.Sprintf("Started: %s", sess.StartTime.Format("2006-01-02 15:04:05"))))

	if sess.EndTime != nil {
		contentLines = append(contentLines, infoStyle.Render(fmt.Sprintf("Ended: %s", sess.EndTime.Format("2006-01-02 15:04:05"))))
		duration := sess.EndTime.Sub(sess.StartTime)
		contentLines = append(contentLines, infoStyle.Render(fmt.Sprintf("Duration: %s", duration.Round(time.Second))))
	} else {
		duration := time.Since(sess.StartTime)
		contentLines = append(contentLines, infoStyle.Render(fmt.Sprintf("Duration: %s (ongoing)", duration.Round(time.Second))))
	}

	if sess.Error != "" {
		contentLines = append(contentLines, "")
		contentLines = append(contentLines, infoStyle.Render(fmt.Sprintf("Error: %s", sess.Error)))
	}

	// Prompt section
	contentLines = append(contentLines, "")
	contentLines = append(contentLines, sectionHeader.Render("Prompt"))
	contentLines = append(contentLines, "")

	// Wrap long prompt lines
	promptLines := strings.Split(sess.Prompt, "\n")
	for _, line := range promptLines {
		wrapped := wrapText(line, m.width-4)
		for _, wl := range wrapped {
			contentLines = append(contentLines, infoStyle.Render(wl))
		}
	}

	// Approvals section
	if len(m.sessionApprovals) > 0 {
		contentLines = append(contentLines, "")
		contentLines = append(contentLines, sectionHeader.Render(fmt.Sprintf("Approvals (%d)", len(m.sessionApprovals))))
		contentLines = append(contentLines, "")

		for _, req := range m.sessionApprovals {
			typeIcon := "📋"
			if req.Type == HumanContactRequest {
				typeIcon = "💬"
			}

			status := "pending"
			// TODO: Track approval status

			approvalLine := fmt.Sprintf("%s %s - %s (%s)",
				typeIcon,
				truncate(req.Tool, 20),
				truncate(req.Message, 40),
				status,
			)

			contentLines = append(contentLines, infoStyle.Render(approvalLine))
		}
	} else {
		contentLines = append(contentLines, "")
		contentLines = append(contentLines, sectionHeader.Render("Approvals"))
		contentLines = append(contentLines, "")
		contentLines = append(contentLines, infoStyle.Render("No approvals for this session"))
	}

	// Session output/result section
	if sess.Status == session.StatusCompleted && sess.Result != nil {
		contentLines = append(contentLines, "")
		contentLines = append(contentLines, sectionHeader.Render("Session Output"))
		contentLines = append(contentLines, "")

		if sess.Result.Result != "" {
			// Wrap the result text
			resultLines := strings.Split(sess.Result.Result, "\n")
			for _, line := range resultLines {
				wrapped := wrapText(line, m.width-4)
				for _, wl := range wrapped {
					contentLines = append(contentLines, infoStyle.Render(wl))
				}
			}
		} else {
			contentLines = append(contentLines, infoStyle.Render("No output available"))
		}

		// Show cost and performance metrics
		if sess.Result.CostUSD > 0 {
			contentLines = append(contentLines, "")
			contentLines = append(contentLines, infoStyle.Render(fmt.Sprintf("Cost: $%.4f", sess.Result.CostUSD)))
			contentLines = append(contentLines, infoStyle.Render(fmt.Sprintf("Turns: %d", sess.Result.NumTurns)))
			contentLines = append(contentLines, infoStyle.Render(fmt.Sprintf("Duration: %dms", sess.Result.DurationMS)))
		}
	}

	// Apply scrolling
	visibleHeight := m.height - 8 // Account for header, footer, status bar
	startLine := m.sessionDetailScroll
	if startLine >= len(contentLines) {
		startLine = max(0, len(contentLines)-visibleHeight)
	}
	endLine := min(startLine+visibleHeight, len(contentLines))

	for i := startLine; i < endLine; i++ {
		s.WriteString(contentLines[i] + "\n")
	}

	// Footer with scroll indicator
	footer := "[↑/↓] scroll  [esc] back"
	if len(contentLines) > visibleHeight {
		scrollPercent := 0
		if len(contentLines) > 0 {
			scrollPercent = (startLine * 100) / len(contentLines)
		}
		footer = fmt.Sprintf("[↑/↓] scroll (%d%%)  [esc] back", scrollPercent)
	}

	// Add padding to push footer down
	currentLines := endLine - startLine
	if currentLines < visibleHeight {
		for i := 0; i < visibleHeight-currentLines; i++ {
			s.WriteString("\n")
		}
	}

	s.WriteString(strings.Repeat("─", m.width) + "\n")
	footerStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("240"))
	s.WriteString(footerStyle.Render(footer))

	return s.String()
}

// wrapText wraps text to fit within the given width
func wrapText(text string, width int) []string {
	if width <= 0 || len(text) <= width {
		return []string{text}
	}

	var lines []string
	words := strings.Fields(text)
	if len(words) == 0 {
		return []string{text}
	}

	currentLine := words[0]
	for _, word := range words[1:] {
		if len(currentLine)+1+len(word) <= width {
			currentLine += " " + word
		} else {
			lines = append(lines, currentLine)
			currentLine = word
		}
	}
	if currentLine != "" {
		lines = append(lines, currentLine)
	}

	return lines
}

// min returns the minimum of two integers
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// max returns the maximum of two integers
func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// helpContent represents help information
type helpContent struct {
	Title    string
	Sections []helpSection
}

type helpSection struct {
	Name     string
	Commands []helpCommand
}

type helpCommand struct {
	Keys        string
	Description string
}

// getHelpContent returns context-specific help
func (m model) getHelpContent() helpContent {
	// Global commands available everywhere
	globalCommands := []helpCommand{
		{"?/F1", "Show this help"},
		{"q", "Quit application"},
		{"tab", "Next tab"},
		{"shift+tab", "Previous tab"},
		{"1-3", "Jump to specific tab"},
	}

	// Build help based on context
	switch m.helpContext {
	case listView:
		switch m.activeTab {
		case approvalsTab:
			return helpContent{
				Title: "Approvals List Help",
				Sections: []helpSection{
					{
						Name:     "Navigation",
						Commands: append(globalCommands, []helpCommand{
							{"↑/k", "Move up"},
							{"↓/j", "Move down"},
							{"enter", "View details"},
							{"esc", "Go back"},
						}...),
					},
					{
						Name: "Actions",
						Commands: []helpCommand{
							{"y", "Quick approve"},
							{"n", "Deny with feedback"},
						},
					},
					{
						Name: "Features",
						Commands: []helpCommand{
							{"", "Approvals are grouped by session"},
							{"", "Real-time updates via event subscription"},
							{"", "Session context shown for each approval"},
						},
					},
				},
			}
		case sessionsTab:
			return helpContent{
				Title: "Sessions List Help",
				Sections: []helpSection{
					{
						Name:     "Navigation",
						Commands: append(globalCommands, []helpCommand{
							{"↑/k", "Move up"},
							{"↓/j", "Move down"},
							{"enter", "View session details"},
							{"l", "Launch new session"},
						}...),
					},
					{
						Name: "Session Status",
						Commands: []helpCommand{
							{"🟡", "Starting"},
							{"🟢", "Running"},
							{"⚪", "Completed"},
							{"🔴", "Failed"},
						},
					},
				},
			}
		}
	case detailView:
		return helpContent{
			Title: "Approval Details Help",
			Sections: []helpSection{
				{
					Name: "Navigation",
					Commands: []helpCommand{
						{"esc", "Back to list"},
					},
				},
				{
					Name: "Actions",
					Commands: []helpCommand{
						{"y", "Approve request"},
						{"n", "Deny with feedback"},
					},
				},
			},
		}
	case launchSessionView:
		return helpContent{
			Title: "Launch Session Help",
			Sections: []helpSection{
				{
					Name: "Form Navigation",
					Commands: []helpCommand{
						{"tab", "Next field"},
						{"shift+tab", "Previous field"},
						{"↑/↓", "Select model (when on model field)"},
						{"enter", "Launch session"},
						{"esc", "Cancel"},
					},
				},
				{
					Name: "Models",
					Commands: []helpCommand{
						{"default", "Let Claude choose the best model"},
						{"opus", "Most capable model"},
						{"sonnet", "Balanced performance"},
					},
				},
			},
		}
	case sessionDetailView:
		return helpContent{
			Title: "Session Details Help",
			Sections: []helpSection{
				{
					Name: "Navigation",
					Commands: []helpCommand{
						{"↑/↓", "Scroll content"},
						{"PgUp/PgDn", "Scroll faster"},
						{"esc", "Back to session list"},
					},
				},
				{
					Name: "Information Shown",
					Commands: []helpCommand{
						{"", "Session status and duration"},
						{"", "Full prompt text"},
						{"", "All approvals for this session"},
						{"", "Error details if failed"},
						{"", "Session output/result (when completed)"},
						{"", "Cost and performance metrics"},
					},
				},
			},
		}
	}

	// Default help
	return helpContent{
		Title: "HumanLayer TUI Help",
		Sections: []helpSection{
			{
				Name:     "Global Commands",
				Commands: globalCommands,
			},
			{
				Name: "Tips",
				Commands: []helpCommand{
					{"", "Press ? or F1 in any view for context help"},
					{"", "Status bar shows connection and counts"},
					{"", "Real-time updates when events occur"},
				},
			},
		},
	}
}

func (m model) helpViewRender() string {
	var s strings.Builder
	help := m.getHelpContent()

	// Header
	header := lipgloss.NewStyle().
		Bold(true).
		Padding(0, 1).
		Render(fmt.Sprintf("%s [esc: back]", help.Title))

	s.WriteString(header + "\n")
	s.WriteString(strings.Repeat("═", m.width) + "\n\n")

	// Build content lines
	var contentLines []string

	for _, section := range help.Sections {
		// Section header
		sectionStyle := lipgloss.NewStyle().
			Bold(true).
			Foreground(lipgloss.Color("135")).
			Padding(0, 2)
		contentLines = append(contentLines, sectionStyle.Render(section.Name))
		contentLines = append(contentLines, "")

		// Commands
		cmdStyle := lipgloss.NewStyle().
			Padding(0, 4)

		for _, cmd := range section.Commands {
			if cmd.Keys == "" {
				// Info line without keys
				contentLines = append(contentLines, cmdStyle.Render(cmd.Description))
			} else {
				// Command with keys
				keyStyle := lipgloss.NewStyle().
					Foreground(lipgloss.Color("226")). // yellow
					Width(12)
				descStyle := lipgloss.NewStyle().
					Foreground(lipgloss.Color("252"))

				line := keyStyle.Render(cmd.Keys) + descStyle.Render(cmd.Description)
				contentLines = append(contentLines, cmdStyle.Render(line))
			}
		}
		contentLines = append(contentLines, "")
	}

	// Apply scrolling
	visibleHeight := m.height - 8
	startLine := m.helpScrollOffset
	if startLine >= len(contentLines) {
		startLine = max(0, len(contentLines)-visibleHeight)
	}
	endLine := min(startLine+visibleHeight, len(contentLines))

	for i := startLine; i < endLine; i++ {
		s.WriteString(contentLines[i] + "\n")
	}

	// Add padding to push footer down
	currentLines := endLine - startLine
	if currentLines < visibleHeight {
		for i := 0; i < visibleHeight-currentLines; i++ {
			s.WriteString("\n")
		}
	}

	// Footer
	s.WriteString(strings.Repeat("─", m.width) + "\n")
	footer := "[↑/↓] scroll  [esc] close"
	if len(contentLines) > visibleHeight {
		scrollPercent := 0
		if len(contentLines) > 0 {
			scrollPercent = (startLine * 100) / len(contentLines)
		}
		footer = fmt.Sprintf("[↑/↓] scroll (%d%%)  [esc] close", scrollPercent)
	}

	footerStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("240"))
	s.WriteString(footerStyle.Render(footer))

	return s.String()
}

func (m model) launchSessionViewRender() string {
	var s strings.Builder

	// Header
	header := lipgloss.NewStyle().
		Bold(true).
		Padding(0, 1).
		Render("Launch New Session [esc: cancel]")

	s.WriteString(header + "\n")
	s.WriteString(strings.Repeat("─", m.width) + "\n\n")

	// Form fields
	formStyle := lipgloss.NewStyle().
		Padding(0, 2)

	// Prompt field
	promptLabel := "Prompt:"
	if m.launchActiveField == 0 {
		promptLabel = "▶ " + promptLabel
	}
	s.WriteString(formStyle.Render(promptLabel) + "\n")
	s.WriteString(formStyle.Render(m.launchPromptInput.View()) + "\n\n")

	// Model selection
	modelLabel := "Model:"
	if m.launchActiveField == 1 {
		modelLabel = "▶ " + modelLabel
	}
	s.WriteString(formStyle.Render(modelLabel) + "\n")

	models := []string{"default", "opus", "sonnet"}
	for i, model := range models {
		prefix := "  ○ "
		if i == m.launchModelSelect {
			prefix = "  ● "
		}
		modelLine := prefix + model
		if m.launchActiveField == 1 && i == m.launchModelSelect {
			modelLine = lipgloss.NewStyle().
				Foreground(lipgloss.Color("205")).
				Render(modelLine)
		}
		s.WriteString(formStyle.Render(modelLine) + "\n")
	}
	s.WriteString("\n")

	// Working directory field
	dirLabel := "Working Directory (optional):"
	if m.launchActiveField == 2 {
		dirLabel = "▶ " + dirLabel
	}
	s.WriteString(formStyle.Render(dirLabel) + "\n")
	s.WriteString(formStyle.Render(m.launchWorkingDir.View()) + "\n")

	// Error message if any
	if m.err != nil {
		s.WriteString("\n")
		errStyle := lipgloss.NewStyle().
			Foreground(lipgloss.Color("196")).
			Padding(0, 2)
		s.WriteString(errStyle.Render(fmt.Sprintf("Error: %v", m.err)) + "\n")
	}

	// Footer
	s.WriteString("\n" + strings.Repeat("─", m.width) + "\n")
	footer := lipgloss.NewStyle().
		Foreground(lipgloss.Color("240")).
		Render("[tab] navigate  [enter] launch  [esc] cancel")
	s.WriteString(footer)

	return s.String()
}

func (m model) feedbackViewRender() string {
	var s strings.Builder

	title := "Deny with Feedback"
	if m.feedbackFor.Type == HumanContactRequest {
		title = "Respond to Human Contact"
	}

	header := lipgloss.NewStyle().
		Bold(true).
		Padding(0, 1).
		Render(title)

	s.WriteString(header + "\n")
	s.WriteString(strings.Repeat("─", m.width) + "\n\n")

	// Context
	context := lipgloss.NewStyle().
		Padding(0, 2).
		Foreground(lipgloss.Color("240"))

	if m.feedbackFor.Type == ApprovalRequest {
		// Build a description of what we're denying
		target := ""
		if file, ok := m.feedbackFor.Parameters["file"]; ok {
			target = fmt.Sprintf(" on %v", file)
		} else if cmd, ok := m.feedbackFor.Parameters["command"]; ok {
			target = fmt.Sprintf(": %v", cmd)
		} else if len(m.feedbackFor.Parameters) > 0 {
			// Show first parameter if we don't recognize the type
			for k, v := range m.feedbackFor.Parameters {
				target = fmt.Sprintf(" (%s: %v)", k, v)
				break
			}
		}
		s.WriteString(context.Render(fmt.Sprintf("Denying: %s%s\n\n",
			m.feedbackFor.Tool,
			target)))
	} else {
		s.WriteString(context.Render(fmt.Sprintf("Responding to: %s\n\n",
			truncate(m.feedbackFor.Message, 50))))
	}

	// Input
	s.WriteString(lipgloss.NewStyle().Padding(0, 2).Render("Response:\n"))
	s.WriteString(lipgloss.NewStyle().Padding(0, 2).Render(m.feedbackInput.View()))

	// Footer
	s.WriteString("\n\n" + strings.Repeat("─", m.width) + "\n")
	footer := lipgloss.NewStyle().
		Foreground(lipgloss.Color("240")).
		Render("[enter] send  [esc] cancel")
	s.WriteString(footer)

	return s.String()
}

// Helper functions
func removeRequest(requests []Request, index int) []Request {
	if index < 0 || index >= len(requests) {
		return requests
	}
	return append(requests[:index], requests[index+1:]...)
}

func removeRequestByID(requests []Request, id string) []Request {
	for i, req := range requests {
		if req.ID == id {
			return removeRequest(requests, i)
		}
	}
	return requests
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	if max > 3 {
		return s[:max-3] + "..."
	}
	return s[:max]
}

func formatDuration(d time.Duration) string {
	if d < time.Minute {
		return fmt.Sprintf("%ds", int(d.Seconds()))
	}
	if d < time.Hour {
		return fmt.Sprintf("%dm", int(d.Minutes()))
	}
	return fmt.Sprintf("%dh", int(d.Hours()))
}

// API command messages
type approvalSentMsg struct {
	requestID string
	err       error
}

type humanResponseSentMsg struct {
	requestID string
	err       error
}

// launchSession launches a new Claude session
func (m model) launchSession() tea.Cmd {
	return func() tea.Msg {
		// Get model name
		modelName := ""
		switch m.launchModelSelect {
		case 1:
			modelName = "opus"
		case 2:
			modelName = "sonnet"
		}

		// Build launch request
		req := rpc.LaunchSessionRequest{
			Prompt:     m.launchPromptInput.Value(),
			Model:      modelName,
			WorkingDir: m.launchWorkingDir.Value(),
		}

		// Launch session
		resp, err := m.daemonClient.LaunchSession(req)
		if err != nil {
			return launchSessionMsg{err: err}
		}

		return launchSessionMsg{
			sessionID: resp.SessionID,
			runID:     resp.RunID,
		}
	}
}

// Command to send approval/denial
func (m model) sendApproval(callID string, approved bool, comment string) tea.Cmd {
	return func() tea.Msg {
		decision := "approve"
		if !approved {
			decision = "deny"
		}

		err := m.daemonClient.SendDecision(callID, "function_call", decision, comment)
		return approvalSentMsg{requestID: callID, err: err}
	}
}

// Command to send human response
func (m model) sendHumanResponse(requestID string, response string) tea.Cmd {
	return func() tea.Msg {
		err := m.daemonClient.SendDecision(requestID, "human_contact", "respond", response)
		return humanResponseSentMsg{requestID: requestID, err: err}
	}
}
