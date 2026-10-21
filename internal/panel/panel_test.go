package panel

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestPanelServesIndexAndFallback(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	enabled := true
	Register(engine, func() bool { return enabled })
	for _, target := range []string{"/panel/", "/panel/accounts", "/panel/../../etc/passwd", "/management.html"} {
		rec := httptest.NewRecorder()
		engine.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, target, nil))
		if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "<html") {
			t.Fatalf("%s: code=%d body=%.80q", target, rec.Code, rec.Body.String())
		}
		if !strings.HasPrefix(rec.Header().Get("Content-Type"), "text/html") {
			t.Fatalf("%s: content-type=%q", target, rec.Header().Get("Content-Type"))
		}
	}
	enabled = false
	for _, target := range []string{"/panel/", "/management.html"} {
		rec := httptest.NewRecorder()
		engine.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, target, nil))
		if rec.Code != http.StatusNotFound {
			t.Fatalf("%s while disabled: code=%d", target, rec.Code)
		}
	}
}
