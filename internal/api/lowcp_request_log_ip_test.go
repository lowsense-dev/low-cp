package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/logging"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/requestlog"
)

func TestRequestLogClientIP(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := &config.Config{}
	got := ""
	engine := gin.New()
	engine.Use(func(c *gin.Context) {
		got = requestLogClientIP(c, func() *config.Config { return cfg })
		c.Status(http.StatusNoContent)
	})
	engine.POST("/v1/chat/completions", func(c *gin.Context) { c.Status(http.StatusNoContent) })

	request := func(remoteAddr, xff string) {
		req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
		req.RemoteAddr = remoteAddr
		if xff != "" {
			req.Header.Set("X-Forwarded-For", xff)
		}
		engine.ServeHTTP(httptest.NewRecorder(), req)
	}

	// Local reverse proxies work without extra configuration.
	request("127.0.0.1:43123", "203.0.113.5")
	if got != "203.0.113.5" {
		t.Fatalf("loopback-forwarded client IP = %q, want 203.0.113.5", got)
	}

	// The rightmost untrusted hop wins, so a client cannot prepend a fake address.
	request("127.0.0.1:43123", "192.0.2.1, 203.0.113.5")
	if got != "203.0.113.5" {
		t.Fatalf("forwarded chain client IP = %q, want 203.0.113.5", got)
	}

	// Direct external peers cannot spoof their address.
	request("198.51.100.20:43123", "203.0.113.5")
	if got != "198.51.100.20" {
		t.Fatalf("untrusted peer IP = %q, want 198.51.100.20", got)
	}

	// Non-loopback proxies follow the latest hot-reloaded configuration.
	request("192.0.2.10:43123", "203.0.113.5")
	if got != "192.0.2.10" {
		t.Fatalf("untrusted proxy peer IP = %q, want 192.0.2.10", got)
	}
	cfg.TrustedProxies = []string{"192.0.2.0/24"}
	request("192.0.2.10:43123", "203.0.113.5")
	if got != "203.0.113.5" {
		t.Fatalf("trusted proxy client IP = %q, want 203.0.113.5", got)
	}
}

func TestRequestLogRecordsForwardedIP(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(func(c *gin.Context) { logging.SetGinRequestID(c, "lowcp-forwarded-ip-test") })
	engine.Use(requestLogMiddlewareWithConfig(func() *config.Config { return &config.Config{} }))
	engine.GET("/v1/models", func(c *gin.Context) { c.Status(http.StatusOK) })
	req := httptest.NewRequest(http.MethodGet, "/v1/models", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	req.Header.Set("X-Forwarded-For", "203.0.113.10")
	engine.ServeHTTP(httptest.NewRecorder(), req)
	for _, entry := range requestlog.Default().List(requestlog.Query{Search: "203.0.113.10"}) {
		if entry.ID == "lowcp-forwarded-ip-test" && entry.IP == "203.0.113.10" {
			return
		}
	}
	t.Fatal("forwarded IP not recorded")
}
