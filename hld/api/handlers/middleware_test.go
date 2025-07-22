package handlers

import (
	"compress/gzip"
	"io"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRequestIDMiddleware(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("generates new request ID when not provided", func(t *testing.T) {
		router := gin.New()
		router.Use(RequestIDMiddleware())
		router.GET("/test", func(c *gin.Context) {
			requestID, exists := c.Get("request-id")
			assert.True(t, exists)
			assert.NotEmpty(t, requestID)
			c.String(200, "ok")
		})

		w := httptest.NewRecorder()
		req := httptest.NewRequest("GET", "/test", nil)
		router.ServeHTTP(w, req)

		assert.Equal(t, 200, w.Code)
		assert.NotEmpty(t, w.Header().Get("X-Request-ID"))
	})

	t.Run("uses provided request ID", func(t *testing.T) {
		router := gin.New()
		router.Use(RequestIDMiddleware())
		router.GET("/test", func(c *gin.Context) {
			requestID, exists := c.Get("request-id")
			assert.True(t, exists)
			assert.Equal(t, "test-request-id", requestID)
			c.String(200, "ok")
		})

		w := httptest.NewRecorder()
		req := httptest.NewRequest("GET", "/test", nil)
		req.Header.Set("X-Request-ID", "test-request-id")
		router.ServeHTTP(w, req)

		assert.Equal(t, 200, w.Code)
		assert.Equal(t, "test-request-id", w.Header().Get("X-Request-ID"))
	})
}

func TestCompressionMiddleware(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("compresses response when gzip accepted", func(t *testing.T) {
		router := gin.New()
		router.Use(CompressionMiddleware())
		router.GET("/test", func(c *gin.Context) {
			// Send a large response to ensure compression
			c.String(200, strings.Repeat("Hello World! ", 1000))
		})

		w := httptest.NewRecorder()
		req := httptest.NewRequest("GET", "/test", nil)
		req.Header.Set("Accept-Encoding", "gzip")
		router.ServeHTTP(w, req)

		assert.Equal(t, 200, w.Code)
		assert.Equal(t, "gzip", w.Header().Get("Content-Encoding"))
		assert.Equal(t, "Accept-Encoding", w.Header().Get("Vary"))

		// Verify the response is actually gzipped
		reader, err := gzip.NewReader(w.Body)
		require.NoError(t, err)
		defer func() {
			err := reader.Close()
			require.NoError(t, err)
		}()

		decompressed, err := io.ReadAll(reader)
		require.NoError(t, err)
		assert.Contains(t, string(decompressed), "Hello World!")
	})

	t.Run("skips compression when gzip not accepted", func(t *testing.T) {
		router := gin.New()
		router.Use(CompressionMiddleware())
		router.GET("/test", func(c *gin.Context) {
			c.String(200, "Hello World!")
		})

		w := httptest.NewRecorder()
		req := httptest.NewRequest("GET", "/test", nil)
		// Don't set Accept-Encoding header
		router.ServeHTTP(w, req)

		assert.Equal(t, 200, w.Code)
		assert.Empty(t, w.Header().Get("Content-Encoding"))
		assert.Equal(t, "Hello World!", w.Body.String())
	})

	t.Run("skips compression for SSE endpoints", func(t *testing.T) {
		router := gin.New()
		router.Use(CompressionMiddleware())
		router.GET("/api/v1/events", func(c *gin.Context) {
			c.Header("Content-Type", "text/event-stream")
			c.String(200, "data: test\n\n")
		})

		w := httptest.NewRecorder()
		req := httptest.NewRequest("GET", "/api/v1/events", nil)
		req.Header.Set("Accept-Encoding", "gzip")
		router.ServeHTTP(w, req)

		assert.Equal(t, 200, w.Code)
		assert.Empty(t, w.Header().Get("Content-Encoding"))
		assert.Equal(t, "data: test\n\n", w.Body.String())
	})
}
