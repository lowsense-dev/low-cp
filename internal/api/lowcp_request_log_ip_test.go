package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
)

func TestRequestLogClientIPUsesCurrentTrustedProxies(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := &config.Config{}
	got := ""
	engine := gin.New()
	engine.Use(func(c *gin.Context) {
		got = requestLogClientIP(c, func() *config.Config { return cfg })
		c.Status(http.StatusNoContent)
	})
	engine.POST("/v1/chat/completions", func(c *gin.Context) { c.Status(http.StatusNoContent) })

	request := func(xff string) {
		req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
		req.RemoteAddr = "127.0.0.1:43123"
		if xff != "" {
			req.Header.Set("X-Forwarded-For", xff)
		}
		engine.ServeHTTP(httptest.NewRecorder(), req)
	}

	request("203.0.113.5")
	if got != "127.0.0.1" {
		t.Fatalf("untrusted loopback peer IP = %q, want 127.0.0.1", got)
	}

	// A hot-reloaded config takes effect without rebuilding the Gin engine.
	cfg.TrustedProxies = []string{"127.0.0.1", "::1"}
	request("203.0.113.5")
	if got != "203.0.113.5" {
		t.Fatalf("forwarded client IP = %q, want 203.0.113.5", got)
	}

	// The rightmost untrusted hop wins, so a client cannot prepend a fake address.
	request("192.0.2.1, 203.0.113.5")
	if got != "203.0.113.5" {
		t.Fatalf("forwarded chain client IP = %q, want 203.0.113.5", got)
	}

	cfg.TrustedProxies = nil
	request("203.0.113.5")
	if got != "127.0.0.1" {
		t.Fatalf("client IP after disabling trust = %q, want 127.0.0.1", got)
	}
}
