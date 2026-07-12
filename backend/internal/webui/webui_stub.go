//go:build !embedui

// In development the Vite dev server serves the frontend and proxies /api,
// so the Go server has no UI to serve.
package webui

import "net/http"

func Handler() http.Handler {
	return nil
}
