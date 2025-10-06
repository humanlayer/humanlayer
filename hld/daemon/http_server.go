package daemon

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/humanlayer/humanlayer/hld/api"
	"github.com/humanlayer/humanlayer/hld/api/handlers"
	"github.com/humanlayer/humanlayer/hld/approval"
	"github.com/humanlayer/humanlayer/hld/bus"
	"github.com/humanlayer/humanlayer/hld/config"
	"github.com/humanlayer/humanlayer/hld/mcp"
	"github.com/humanlayer/humanlayer/hld/session"
	"github.com/humanlayer/humanlayer/hld/store"
)

// getHTTPShutdownTimeout returns the timeout for HTTP server graceful shutdown
func getHTTPShutdownTimeout() time.Duration {
	if timeoutStr := os.Getenv("HUMANLAYER_HLD_HTTP_SHUTDOWN_TIMEOUT"); timeoutStr != "" {
		if timeout, err := time.ParseDuration(timeoutStr); err == nil {
			slog.Info("using custom HTTP shutdown timeout", "timeout", timeout)
			return timeout
		} else {
			slog.Warn("invalid HUMANLAYER_HLD_HTTP_SHUTDOWN_TIMEOUT, using default",
				"value", timeoutStr, "error", err)
		}
	}
	return 2 * time.Second // Reduced from 30s
}

// HTTPServer manages the REST API server
type HTTPServer struct {
	config           *config.Config
	router           *gin.Engine
	sessionManager   session.SessionManager
	sessionHandlers  *handlers.SessionHandlers
	approvalHandlers *handlers.ApprovalHandlers
	fileHandlers     *handlers.FileHandlers
	sseHandler       *handlers.SSEHandler
	proxyHandler     *handlers.ProxyHandler
	configHandler    *handlers.ConfigHandler
	settingsHandlers *handlers.SettingsHandlers
	approvalManager  approval.Manager
	eventBus         bus.EventBus
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
	router.Use(gin.LoggerWithConfig(gin.LoggerConfig{
		SkipPaths: []string{"/api/v1/health"}, // Skip health check logs
	}))
	router.Use(handlers.RequestIDMiddleware())
	router.Use(handlers.CompressionMiddleware())

	// Add CORS middleware for browser clients
	router.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"*"}, // TODO: Configure allowed origins
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Accept", "Authorization", "X-Client", "X-Client-Version"},
		ExposeHeaders:    []string{"X-Request-ID"},
		AllowCredentials: false,
		MaxAge:           12 * time.Hour,
	}))

	// Create handlers
	sessionHandlers := handlers.NewSessionHandlersWithConfig(sessionManager, conversationStore, approvalManager, cfg)
	approvalHandlers := handlers.NewApprovalHandlers(approvalManager, sessionManager)
	fileHandlers := handlers.NewFileHandlers()
	sseHandler := handlers.NewSSEHandler(eventBus)
	proxyHandler := handlers.NewProxyHandler(sessionManager, conversationStore)
	configHandler := handlers.NewConfigHandler()
	settingsHandlers := handlers.NewSettingsHandlers(conversationStore)

	return &HTTPServer{
		config:           cfg,
		router:           router,
		sessionManager:   sessionManager,
		sessionHandlers:  sessionHandlers,
		approvalHandlers: approvalHandlers,
		fileHandlers:     fileHandlers,
		sseHandler:       sseHandler,
		proxyHandler:     proxyHandler,
		configHandler:    configHandler,
		settingsHandlers: settingsHandlers,
		approvalManager:  approvalManager,
		eventBus:         eventBus,
	}
}

// Start starts the HTTP server
func (s *HTTPServer) Start(ctx context.Context) error {
	// Create server implementation combining all handlers
	serverImpl := handlers.NewServerImpl(s.sessionHandlers, s.approvalHandlers, s.fileHandlers, s.sseHandler, s.settingsHandlers)

	// Create strict handler with middleware
	strictHandler := api.NewStrictHandler(serverImpl, nil)

	// Create API v1 route group
	v1 := s.router.Group("/api/v1")

	// Register OpenAPI handlers under the v1 group
	api.RegisterHandlers(v1, strictHandler)

	// Register SSE endpoint directly (not part of strict interface)
	v1.GET("/stream/events", s.sseHandler.StreamEvents)

	// Register proxy endpoint directly (not part of strict interface)
	v1.POST("/anthropic_proxy/:session_id/v1/messages", s.proxyHandler.ProxyAnthropicRequest)

	// Register config status endpoint
	v1.GET("/config/status", s.configHandler.GetConfigStatus)

	// MCP endpoint (Phase 5: with event-driven approvals)
	mcpServer := mcp.NewMCPServer(s.approvalManager, s.eventBus)
	mcpServer.Start(ctx) // Start background processes with context
	v1.Any("/mcp", func(c *gin.Context) {
		mcpServer.ServeHTTP(c.Writer, c.Request)
	})

	// Create listener first to handle port 0
	addr := fmt.Sprintf("%s:%d", s.config.HTTPHost, s.config.HTTPPort)
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("failed to listen on %s: %w", addr, err)
	}

	// Get actual port after binding
	actualAddr := listener.Addr().(*net.TCPAddr)
	actualPort := actualAddr.Port

	// If port 0 was used, output actual port to stdout
	if s.config.HTTPPort == 0 {
		fmt.Printf("HTTP_PORT=%d\n", actualPort)
	}

	// Update session manager with the actual HTTP port
	s.sessionManager.SetHTTPPort(actualPort)

	slog.Info("Starting HTTP server",
		"configured_port", s.config.HTTPPort,
		"actual_address", actualAddr.String())

	// Create HTTP server
	s.server = &http.Server{
		Handler: s.router,
	}

	// Start server in goroutine
	go func() {
		// Use the existing listener
		if err := s.server.Serve(listener); err != nil && err != http.ErrServerClosed {
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
	timeout := getHTTPShutdownTimeout()
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	return s.server.Shutdown(ctx)
}
