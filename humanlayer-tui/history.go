package main

import (
	"strings"

	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// historyModel contains all state related to the history tab
type historyModel struct {
	history   []Request
	cursor    int
	viewState viewState
}

// newHistoryModel creates a new history model with default state
func newHistoryModel() historyModel {
	return historyModel{
		history:   []Request{},
		cursor:    0,
		viewState: listView,
	}
}

// Update handles messages for the history tab
func (hm *historyModel) Update(msg tea.Msg, m *model) tea.Cmd {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch hm.viewState {
		case listView:
			return hm.updateListView(msg, m)
		}
	}

	return nil
}

// updateListView handles key events in the history list view
func (hm *historyModel) updateListView(msg tea.KeyMsg, m *model) tea.Cmd {
	switch {
	case key.Matches(msg, keys.Up):
		if hm.cursor > 0 {
			hm.cursor--
		}

	case key.Matches(msg, keys.Down):
		if hm.cursor < len(hm.history)-1 {
			hm.cursor++
		}
	}

	return nil
}

// View renders the history tab
func (hm *historyModel) View(m *model) string {
	switch hm.viewState {
	default:
		return hm.renderListView(m)
	}
}

// renderListView renders the history list
func (hm *historyModel) renderListView(m *model) string {
	var s strings.Builder

	// Header
	headerStyle := lipgloss.NewStyle().
		Bold(true).
		Foreground(lipgloss.Color("205")).
		MarginBottom(1)
	s.WriteString(headerStyle.Render("History") + "\n\n")

	// Placeholder content
	emptyStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("241")).
		Italic(true).
		Padding(2, 0)
	s.WriteString(emptyStyle.Render("History view coming soon..."))

	return s.String()
}