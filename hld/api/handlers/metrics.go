package handlers

import (
	"context"
	"net/http"
	"time"
	
	"github.com/gin-gonic/gin"
	"github.com/humanlayer/humanlayer/hld/store"
)

type ApprovalMetrics struct {
	TotalPending      int       `json:"total_pending"`
	OrphanedCount     int       `json:"orphaned_count"`
	CorrelatedCount   int       `json:"correlated_count"` 
	CheckedAt         time.Time `json:"checked_at"`
	MCPFailures       int       `json:"mcp_failures,omitempty"`
}

type MetricsHandler struct {
	store           store.ConversationStore
	mcpFailureCount int // In-memory counter for now
}

func NewMetricsHandler(s store.ConversationStore) *MetricsHandler {
	return &MetricsHandler{
		store: s,
	}
}

func (h *MetricsHandler) GetApprovalMetrics(c *gin.Context) {
	ctx := c.Request.Context()
	
	// Get orphaned approvals older than 1 minute
	orphaned, err := h.store.GetOrphanedApprovals(ctx, 1*time.Minute)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	
	// Get all pending approvals count
	// Note: This is a simplified version - in production you'd want a dedicated query
	totalPending := 0
	correlated := 0
	
	// Try to get session list to count pending approvals
	sessions, err := h.store.ListSessions(ctx)
	if err == nil {
		for _, session := range sessions {
			pending, err := h.store.GetPendingApprovals(ctx, session.ID)
			if err == nil {
				totalPending += len(pending)
				// Count how many are correlated (have a tool call)
				for _, approval := range pending {
					// Check if this approval is in the orphaned list
					isOrphaned := false
					for _, orphan := range orphaned {
						if orphan.ID == approval.ID {
							isOrphaned = true
							break
						}
					}
					if !isOrphaned {
						correlated++
					}
				}
			}
		}
	}
	
	metrics := ApprovalMetrics{
		TotalPending:    totalPending,
		OrphanedCount:   len(orphaned),
		CorrelatedCount: correlated,
		CheckedAt:       time.Now(),
		MCPFailures:     h.mcpFailureCount,
	}
	
	c.JSON(http.StatusOK, metrics)
}

// ReportMCPFailure increments the MCP failure counter
func (h *MetricsHandler) ReportMCPFailure(ctx context.Context, approvalID string, failureType string, details map[string]interface{}) {
	h.mcpFailureCount++
	// In a production system, you'd want to store this in the database
	// and track more detailed information about the failures
}