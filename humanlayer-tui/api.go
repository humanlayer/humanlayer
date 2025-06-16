package main

import (
	tea "github.com/charmbracelet/bubbletea"
	"github.com/humanlayer/humanlayer/hld/rpc"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/api"
)

// API command helper functions that delegate to the API layer

func fetchRequests(apiClient api.Client) tea.Cmd {
	return apiClient.FetchRequests()
}

func fetchSessions(apiClient api.Client) tea.Cmd {
	return apiClient.FetchSessions()
}

func fetchSessionApprovals(apiClient api.Client, sessionID string) tea.Cmd {
	return apiClient.FetchSessionApprovals(sessionID)
}

func subscribeToEvents(apiClient api.Client) tea.Cmd {
	return apiClient.SubscribeToEvents()
}

func listenForEvents(apiClient api.Client, eventChan <-chan rpc.EventNotification) tea.Cmd {
	return apiClient.ListenForEvents(eventChan)
}

func launchSession(apiClient api.Client, query, model, workingDir string) tea.Cmd {
	return apiClient.LaunchSession(query, model, workingDir)
}

func fetchConversation(apiClient api.Client, sessionID string) tea.Cmd {
	return apiClient.FetchConversation(sessionID)
}

func fetchConversationSilent(apiClient api.Client, sessionID string) tea.Cmd {
	return apiClient.FetchConversationSilent(sessionID)
}

func continueSession(apiClient api.Client, sessionID, query string) tea.Cmd {
	return apiClient.ContinueSession(sessionID, query)
}
