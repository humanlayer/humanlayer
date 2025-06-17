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

func subscribeToEvents(apiClient api.Client) tea.Cmd {
	return apiClient.SubscribeToEvents()
}

func listenForEvents(apiClient api.Client, eventChan <-chan rpc.EventNotification) tea.Cmd {
	return apiClient.ListenForEvents(eventChan)
}

func fetchConversation(apiClient api.Client, sessionID string) tea.Cmd {
	return apiClient.FetchConversation(sessionID)
}
