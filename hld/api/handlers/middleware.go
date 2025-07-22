package handlers

import (
	"compress/gzip"
	"io"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// RequestIDMiddleware adds a unique request ID to each request
func RequestIDMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		requestID := c.GetHeader("X-Request-ID")
		if requestID == "" {
			requestID = uuid.New().String()
		}
		c.Set("request-id", requestID)
		c.Header("X-Request-ID", requestID)
		c.Next()
	}
}

// CompressionMiddleware provides gzip compression for responses
// Skip compression for SSE endpoints as they need raw streaming
func CompressionMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Skip compression for SSE endpoints
		if strings.Contains(c.Request.URL.Path, "/events") {
			c.Next()
			return
		}

		// Check if client accepts gzip
		if !strings.Contains(c.GetHeader("Accept-Encoding"), "gzip") {
			c.Next()
			return
		}

		// Wrap the response writer
		gz := gzip.NewWriter(c.Writer)
		defer func() {
			gz.Close()
			c.Header("Content-Length", "")
		}()

		c.Header("Content-Encoding", "gzip")
		c.Header("Vary", "Accept-Encoding")
		c.Writer = &gzipWriter{ResponseWriter: c.Writer, Writer: gz}
		c.Next()
	}
}

// gzipWriter wraps gin's ResponseWriter to provide gzip compression
type gzipWriter struct {
	gin.ResponseWriter
	Writer io.Writer
}

func (g *gzipWriter) Write(data []byte) (int, error) {
	return g.Writer.Write(data)
}