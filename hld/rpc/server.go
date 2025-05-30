package rpc

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"sync"
)

// Version of the daemon
const Version = "0.1.0"

// Server handles JSON-RPC requests
type Server struct {
	handlers map[string]HandlerFunc
	mu       sync.RWMutex
}

// HandlerFunc is a function that handles an RPC method
type HandlerFunc func(ctx context.Context, params json.RawMessage) (interface{}, error)

// NewServer creates a new RPC server
func NewServer() *Server {
	s := &Server{
		handlers: make(map[string]HandlerFunc),
	}

	// Register built-in handlers
	s.registerBuiltinHandlers()

	return s
}

// registerBuiltinHandlers registers the default RPC methods
func (s *Server) registerBuiltinHandlers() {
	s.Register("health", s.handleHealthCheck)
}

// Register adds a new RPC method handler
func (s *Server) Register(method string, handler HandlerFunc) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.handlers[method] = handler
}

// ServeConn handles a single client connection
func (s *Server) ServeConn(ctx context.Context, conn net.Conn) error {
	// Use a scanner to read line-delimited JSON
	scanner := bufio.NewScanner(conn)
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024) // 1MB buffer

	for scanner.Scan() {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		// Process the request
		response := s.handleRequest(ctx, line)

		// Send response
		if err := s.sendResponse(conn, response); err != nil {
			return fmt.Errorf("failed to send response: %w", err)
		}
	}

	if err := scanner.Err(); err != nil {
		return fmt.Errorf("scanner error: %w", err)
	}

	return nil
}

// Request represents a JSON-RPC 2.0 request
type Request struct {
	JSONRPC string          `json:"jsonrpc"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
	ID      interface{}     `json:"id"`
}

// Response represents a JSON-RPC 2.0 response
type Response struct {
	JSONRPC string      `json:"jsonrpc"`
	Result  interface{} `json:"result,omitempty"`
	Error   *Error      `json:"error,omitempty"`
	ID      interface{} `json:"id"`
}

// Error represents a JSON-RPC 2.0 error
type Error struct {
	Code    int         `json:"code"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
}

// Standard JSON-RPC error codes
const (
	ParseError     = -32700
	InvalidRequest = -32600
	MethodNotFound = -32601
	InvalidParams  = -32602
	InternalError  = -32603
)

// handleRequest processes a single JSON-RPC request
func (s *Server) handleRequest(ctx context.Context, data []byte) *Response {
	var req Request
	if err := json.Unmarshal(data, &req); err != nil {
		return &Response{
			JSONRPC: "2.0",
			Error: &Error{
				Code:    ParseError,
				Message: "Parse error",
			},
			ID: nil,
		}
	}

	// Validate JSON-RPC version
	if req.JSONRPC != "2.0" {
		return &Response{
			JSONRPC: "2.0",
			Error: &Error{
				Code:    InvalidRequest,
				Message: "Invalid request: must be JSON-RPC 2.0",
			},
			ID: req.ID,
		}
	}

	// Find handler
	s.mu.RLock()
	handler, ok := s.handlers[req.Method]
	s.mu.RUnlock()

	if !ok {
		return &Response{
			JSONRPC: "2.0",
			Error: &Error{
				Code:    MethodNotFound,
				Message: fmt.Sprintf("Method not found: %s", req.Method),
			},
			ID: req.ID,
		}
	}

	// Execute handler
	result, err := handler(ctx, req.Params)
	if err != nil {
		return &Response{
			JSONRPC: "2.0",
			Error: &Error{
				Code:    InternalError,
				Message: err.Error(),
			},
			ID: req.ID,
		}
	}

	return &Response{
		JSONRPC: "2.0",
		Result:  result,
		ID:      req.ID,
	}
}

// sendResponse writes a response to the connection
func (s *Server) sendResponse(conn net.Conn, resp *Response) error {
	data, err := json.Marshal(resp)
	if err != nil {
		return fmt.Errorf("failed to marshal response: %w", err)
	}

	// Write response followed by newline
	if _, err := conn.Write(append(data, '\n')); err != nil {
		return fmt.Errorf("failed to write response: %w", err)
	}

	return nil
}

// handleHealthCheck handles the health check RPC method
func (s *Server) handleHealthCheck(ctx context.Context, params json.RawMessage) (interface{}, error) {
	return &HealthCheckResponse{
		Status:  "ok",
		Version: Version,
	}, nil
}
