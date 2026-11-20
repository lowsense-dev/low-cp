package api

import (
	"bytes"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
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

// requestModelContextKey carries the model parsed after authentication for the
// request log; the log itself must not touch the body before auth.
const requestModelContextKey = "lowcpRequestModel"

// requestModelMiddleware parses the requested model after authentication so the
// body is only read once the request is authorized.
func requestModelMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if model, found := requestedModel(c); found {
			c.Set(requestModelContextKey, model)
		}
		c.Next()
	}
}

// requestLogMiddleware records every client request in the in-memory request log.
// It runs first in the chain so it also sees requests rejected by authentication,
// and it never reads the request body.
func requestLogMiddleware() gin.HandlerFunc {
	return requestLogMiddlewareWithConfig(nil)
}

// requestLogMiddlewareWithConfig resolves forwarded addresses against the latest
// config, unlike Gin's trusted-proxy settings which are fixed at server startup.
func requestLogMiddlewareWithConfig(getConfig func() *config.Config) gin.HandlerFunc {
	log := requestlog.Default()
	return func(c *gin.Context) {
		start := time.Now()
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
		model, _ := c.Get(requestModelContextKey)
		modelString, _ := model.(string)
		entry := requestlog.Entry{
			ID:         id,
			Time:       start,
			IP:         requestLogClientIP(c, getConfig),
			Key:        keyString,
			Method:     c.Request.Method,
			Path:       c.Request.URL.Path,
			Status:     writer.Status(),
			DurationMs: time.Since(start).Milliseconds(),
			Model:      modelString,
		}
		if entry.Status >= http.StatusBadRequest {
			entry.Error = writer.head.String()
		}
		log.Complete(entry)
	}
}

func requestLogClientIP(c *gin.Context, getConfig func() *config.Config) string {
	if getConfig == nil {
		return c.ClientIP()
	}
	cfg := getConfig()
	if cfg == nil {
		return c.ClientIP()
	}
	remote := requestLogRemoteIP(c.Request.RemoteAddr)
	remoteAddr, err := netip.ParseAddr(remote)
	if err != nil || !requestLogTrustedProxy(remoteAddr, cfg.TrustedProxies) {
		return remote
	}
	for _, header := range []string{"X-Forwarded-For", "X-Real-IP"} {
		values := c.Request.Header.Values(header)
		if len(values) == 0 {
			continue
		}
		hops := strings.Split(strings.Join(values, ","), ",")
		for i := len(hops) - 1; i >= 0; i-- {
			ip, err := netip.ParseAddr(strings.Trim(strings.TrimSpace(hops[i]), "[]"))
			if err != nil {
				return remote
			}
			if !requestLogTrustedProxy(ip, cfg.TrustedProxies) {
				return ip.String()
			}
		}
	}
	return remote
}

func requestLogRemoteIP(remoteAddr string) string {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	ip, err := netip.ParseAddr(strings.Trim(strings.TrimSpace(host), "[]"))
	if err != nil {
		return strings.TrimSpace(host)
	}
	return ip.String()
}

func requestLogTrustedProxy(ip netip.Addr, trusted []string) bool {
	for _, entry := range trusted {
		entry = strings.TrimSpace(entry)
		if prefix, err := netip.ParsePrefix(entry); err == nil && prefix.Contains(ip) {
			return true
		}
		if proxy, err := netip.ParseAddr(entry); err == nil && proxy == ip {
			return true
		}
	}
	return false
}
