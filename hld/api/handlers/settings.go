package handlers

import (
	"context"
	"log/slog"

	"github.com/humanlayer/humanlayer/hld/api"
	"github.com/humanlayer/humanlayer/hld/store"
)

// SettingsHandlers handles user settings endpoints
type SettingsHandlers struct {
	store store.ConversationStore
}

// NewSettingsHandlers creates a new settings handler
func NewSettingsHandlers(store store.ConversationStore) *SettingsHandlers {
	return &SettingsHandlers{
		store: store,
	}
}

// GetUserSettings retrieves user settings
func (h *SettingsHandlers) GetUserSettings(ctx context.Context, req api.GetUserSettingsRequestObject) (api.GetUserSettingsResponseObject, error) {
	settings, err := h.store.GetUserSettings(ctx)
	if err != nil {
		slog.Error("Failed to retrieve user settings", "error", err)
		return api.GetUserSettings500JSONResponse{
			InternalErrorJSONResponse: api.InternalErrorJSONResponse{
				Error: api.ErrorDetail{
					Code:    "HLD-5001",
					Message: "Failed to retrieve user settings",
				},
			},
		}, nil
	}

	var customMCPConfig *string
	if settings.CustomMCPConfig != "" {
		customMCPConfig = &settings.CustomMCPConfig
	}

	return api.GetUserSettings200JSONResponse{
		Data: api.UserSettings{
			AdvancedProviders: settings.AdvancedProviders,
			OptInTelemetry:    settings.OptInTelemetry,
			CustomMcpConfig:   customMCPConfig,
			CreatedAt:         settings.CreatedAt,
			UpdatedAt:         settings.UpdatedAt,
		},
	}, nil
}

// UpdateUserSettings updates user settings
func (h *SettingsHandlers) UpdateUserSettings(ctx context.Context, req api.UpdateUserSettingsRequestObject) (api.UpdateUserSettingsResponseObject, error) {
	// Get current settings
	current, err := h.store.GetUserSettings(ctx)
	if err != nil {
		slog.Error("Failed to get current settings", "error", err)
		return api.UpdateUserSettings500JSONResponse{
			InternalErrorJSONResponse: api.InternalErrorJSONResponse{
				Error: api.ErrorDetail{
					Code:    "HLD-5002",
					Message: "Failed to retrieve current settings",
				},
			},
		}, nil
	}

	// Apply updates
	if req.Body.AdvancedProviders != nil {
		current.AdvancedProviders = *req.Body.AdvancedProviders
	}
	if req.Body.OptInTelemetry != nil {
		current.OptInTelemetry = req.Body.OptInTelemetry
	}
	if req.Body.CustomMcpConfig != nil {
		current.CustomMCPConfig = *req.Body.CustomMcpConfig
	}

	// Save updated settings
	err = h.store.UpdateUserSettings(ctx, *current)
	if err != nil {
		slog.Error("Failed to update user settings", "error", err)
		return api.UpdateUserSettings500JSONResponse{
			InternalErrorJSONResponse: api.InternalErrorJSONResponse{
				Error: api.ErrorDetail{
					Code:    "HLD-5003",
					Message: "Failed to update settings",
				},
			},
		}, nil
	}

	// Return updated settings
	updated, err := h.store.GetUserSettings(ctx)
	if err != nil {
		slog.Error("Failed to retrieve updated settings", "error", err)
		return api.UpdateUserSettings500JSONResponse{
			InternalErrorJSONResponse: api.InternalErrorJSONResponse{
				Error: api.ErrorDetail{
					Code:    "HLD-5004",
					Message: "Failed to retrieve updated settings",
				},
			},
		}, nil
	}

	var updatedCustomMCPConfig *string
	if updated.CustomMCPConfig != "" {
		updatedCustomMCPConfig = &updated.CustomMCPConfig
	}

	return api.UpdateUserSettings200JSONResponse{
		Data: api.UserSettings{
			AdvancedProviders: updated.AdvancedProviders,
			OptInTelemetry:    updated.OptInTelemetry,
			CustomMcpConfig:   updatedCustomMCPConfig,
			CreatedAt:         updated.CreatedAt,
			UpdatedAt:         updated.UpdatedAt,
		},
	}, nil
}
