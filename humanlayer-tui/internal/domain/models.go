// Package domain contains the pure business logic of the application.
// This package has no dependencies on Bubble Tea or any UI frameworks.
// It defines core types, models, and business rules.
package domain

import (
	"time"
)

// RequestType represents the type of approval request
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

// ViewState represents the current view state of the TUI
type ViewState int

const (
	ListView ViewState = iota
	DetailView
	FeedbackView
	LaunchSessionView
	SessionDetailView
	HelpView
	QueryModalView
	ConversationView
)

// Tab represents a main navigation tab
type Tab int

const (
	ApprovalsTab Tab = iota
	SessionsTab
)

// Layout constants for consistent dimension calculations
const (
	TabBarHeight     = 2 // Tab bar takes 2 lines
	StatusBarHeight  = 1 // Status bar takes 1 line
	MinContentWidth  = 20
	MinContentHeight = 5
)
