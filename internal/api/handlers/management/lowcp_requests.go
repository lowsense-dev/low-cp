package management

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/requestlog"
)

// ListRequests returns recent client requests, newest first.
// Query: limit (default 200), errors=1 for failures only, q to search.
func (h *Handler) ListRequests(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	entries := requestlog.Default().List(requestlog.Query{Limit: limit, OnlyErrs: c.Query("errors") == "1", Search: c.Query("q")})
	c.JSON(http.StatusOK, gin.H{"entries": entries})
}
