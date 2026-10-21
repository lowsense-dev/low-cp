// Package panel serves the embedded low-cp management web UI.
package panel

import (
	"embed"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"

	"github.com/gin-gonic/gin"
)

//go:embed all:dist
var assets embed.FS

// BasePath is where the panel is mounted.
const BasePath = "/panel"

var dist, _ = fs.Sub(assets, "dist")

// Register mounts the panel. The legacy /management.html path serves the same app
// (assets use absolute /panel/ URLs). enabled gates every panel route, so Home mode
// and management.disable-control-panel hide it.
func Register(engine *gin.Engine, enabled func() bool) {
	gate := func(handler gin.HandlerFunc) gin.HandlerFunc {
		return func(c *gin.Context) {
			if !enabled() {
				c.AbortWithStatus(http.StatusNotFound)
				return
			}
			handler(c)
		}
	}
	engine.GET("/management.html", gate(serve))
	engine.GET(BasePath, gate(func(c *gin.Context) { c.Redirect(http.StatusFound, BasePath+"/") }))
	engine.GET(BasePath+"/*filepath", gate(serve))
}

func serve(c *gin.Context) {
	name := strings.TrimPrefix(path.Clean("/"+c.Param("filepath")), "/")
	if name == "" || !fileExists(name) {
		// SPA fallback: client-side routes resolve to index.html.
		name = "index.html"
	}
	if strings.HasPrefix(name, "assets/") {
		// Vite emits content-hashed asset names.
		c.Header("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		c.Header("Cache-Control", "no-cache")
	}
	data, err := fs.ReadFile(dist, name)
	if err != nil {
		c.AbortWithStatus(http.StatusNotFound)
		return
	}
	contentType := mime.TypeByExtension(path.Ext(name))
	if contentType == "" {
		contentType = http.DetectContentType(data)
	}
	c.Data(http.StatusOK, contentType, data)
}

func fileExists(name string) bool {
	info, err := fs.Stat(dist, name)
	return err == nil && !info.IsDir()
}
