package api

import (
	"bytes"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/logging"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/requestlog"
)

// errorCaptureWriter keeps the first bytes of a response body so failed
// requests can show their error text in the panel.
type errorCaptureWriter struct {
	gin.ResponseWriter
	head bytes.Buffer
}

func (w *errorCaptureWriter) Write(data []byte) (int, error) {
	w.capture(data)
	return w.ResponseWriter.Write(data)
}

func (w *errorCaptureWriter) WriteString(s string) (int, error) {
	w.capture([]byte(s))
	return w.ResponseWriter.WriteString(s)
}

func (w *errorCaptureWriter) capture(data []byte) {
	if room := 2048 - w.head.Len(); room > 0 {
		if len(data) > room {
			data = data[:room]
		}
		w.head.Write(data)
	}
}

// requestLogMiddleware records every client request in the in-memory request log.
// It runs first in the chain so it also sees requests rejected by authentication.
func requestLogMiddleware() gin.HandlerFunc {
	log := requestlog.Default()
	return func(c *gin.Context) {
		start := time.Now()
		model := ""
		if c.Request.Method == http.MethodPost && c.ContentType() == "application/json" {
			model, _ = requestedModel(c)
		}
		writer := &errorCaptureWriter{ResponseWriter: c.Writer}
		c.Writer = writer
		c.Next()
		c.Writer = writer.ResponseWriter

		id := logging.GetGinRequestID(c)
		if id == "" {
			return
		}
		key, _ := c.Get("userApiKey")
		keyString, _ := key.(string)
		entry := requestlog.Entry{
			ID:         id,
			Time:       start,
			IP:         c.ClientIP(),
			Key:        keyString,
			Method:     c.Request.Method,
			Path:       c.Request.URL.Path,
			Status:     writer.Status(),
			DurationMs: time.Since(start).Milliseconds(),
			Model:      model,
		}
		if entry.Status >= http.StatusBadRequest {
			entry.Error = writer.head.String()
		}
		log.Complete(entry)
	}
}
