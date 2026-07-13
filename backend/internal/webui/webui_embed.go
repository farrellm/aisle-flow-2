//go:build embedui

// Package webui serves the built frontend from the binary in production
// (§4). Build with -tags embedui after copying frontend/dist here.
package webui

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"
)

//go:embed all:dist
var distFS embed.FS

// Handler serves the SPA: static assets when they exist, index.html for any
// other non-/api path (SPA fallback).
func Handler() http.Handler {
	dist, err := fs.Sub(distFS, "dist")
	if err != nil {
		panic(err)
	}
	fileServer := http.FileServer(http.FS(dist))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path != "" {
			if _, err := fs.Stat(dist, path); err == nil {
				w.Header().Set("Cache-Control", cacheControl(path))
				fileServer.ServeHTTP(w, r)
				return
			}
		}
		r.URL.Path = "/"
		w.Header().Set("Cache-Control", "no-cache")
		fileServer.ServeHTTP(w, r)
	})
}

// cacheControl: Vite emits content-hashed filenames under assets/, safe to
// cache forever; everything else (index.html, sw.js, manifest) must
// revalidate so app updates roll out.
func cacheControl(path string) string {
	if strings.HasPrefix(path, "assets/") {
		return "public, max-age=31536000, immutable"
	}
	return "no-cache"
}
