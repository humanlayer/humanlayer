package daemon

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/humanlayer/humanlayer/hld/api"
	"github.com/humanlayer/humanlayer/hld/api/handlers"
	"github.com/humanlayer/humanlayer/hld/approval"
	"github.com/humanlayer/humanlayer/hld/bus"
	"github.com/humanlayer/humanlayer/hld/config"
	"github.com/humanlayer/humanlayer/hld/session"
	"github.com/humanlayer/humanlayer/hld/store"
)

// HTTPServer manages the REST API server
type HTTPServer struct {
	config           *config.Config
	router           *gin.Engine
	sessionHandlers  *handlers.SessionHandlers
	approvalHandlers *handlers.ApprovalHandlers
	sseHandler       *handlers.SSEHandler
	server           *http.Server
}

// NewHTTPServer creates a new HTTP server instance
func NewHTTPServer(
	cfg *config.Config,
	sessionManager session.SessionManager,
	approvalManager approval.Manager,
	conversationStore store.ConversationStore,
	eventBus bus.EventBus,
) *HTTPServer {
	// Set Gin mode to release
	gin.SetMode(gin.ReleaseMode)

	router := gin.New()

	// Add middleware
	router.Use(gin.Recovery())
	router.Use(handlers.RequestIDMiddleware())
	router.Use(handlers.CompressionMiddleware())

	// Add CORS middleware for browser clients
	router.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"*"}, // TODO: Configure allowed origins
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Accept", "Authorization"},
		ExposeHeaders:    []string{"X-Request-ID"},
		AllowCredentials: false,
		MaxAge:           12 * time.Hour,
	}))

	// Create handlers
	sessionHandlers := handlers.NewSessionHandlers(sessionManager, conversationStore, approvalManager)
	approvalHandlers := handlers.NewApprovalHandlers(approvalManager, sessionManager)
	sseHandler := handlers.NewSSEHandler(eventBus)

	return &HTTPServer{
		config:           cfg,
		router:           router,
		sessionHandlers:  sessionHandlers,
		approvalHandlers: approvalHandlers,
		sseHandler:       sseHandler,
	}
}

// Start starts the HTTP server
func (s *HTTPServer) Start(ctx context.Context) error {
	// Create server implementation combining all handlers
	serverImpl := handlers.NewServerImpl(s.sessionHandlers, s.approvalHandlers, s.sseHandler)

	// Create strict handler with middleware
	strictHandler := api.NewStrictHandler(serverImpl, nil)

	// Create API v1 route group
	v1 := s.router.Group("/api/v1")

	// Register OpenAPI handlers under the v1 group
	api.RegisterHandlers(v1, strictHandler)

	// Create HTTP server
	addr := fmt.Sprintf("%s:%d", s.config.HTTPHost, s.config.HTTPPort)
	s.server = &http.Server{
		Addr:    addr,
		Handler: s.router,
	}

	// Start server in goroutine
	go func() {
		slog.Info("Starting HTTP server", "address", addr)
		if err := s.server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("HTTP server error", "error", err)
		}
	}()

	// Wait for context cancellation
	<-ctx.Done()
	return s.Shutdown()
}

// Shutdown gracefully shuts down the HTTP server
func (s *HTTPServer) Shutdown() error {
	if s.server == nil {
		return nil
	}

	slog.Info("Shutting down HTTP server")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	return s.server.Shutdown(ctx)
}
