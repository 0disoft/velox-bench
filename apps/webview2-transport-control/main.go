//go:build windows

package main

import (
	"fmt"
	"mime"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"

	webview2 "github.com/jchv/go-webview2"
)

const transportHost = "transport.velox.invalid"

var transportMode string

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	profile := os.Getenv("VELOX_BENCH_PROFILE")
	if profile == "" {
		return fmt.Errorf("VELOX_BENCH_PROFILE is required")
	}
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	webRoot := filepath.Join(filepath.Dir(executable), "web")
	view := webview2.NewWithOptions(webview2.WebViewOptions{
		DataPath:      profile,
		WindowOptions: webview2.WindowOptions{Title: "Velox Bench", Width: 960, Height: 640, Center: true},
	})
	if view == nil {
		return fmt.Errorf("create WebView2 transport control window")
	}
	defer view.Destroy()
	if err := view.Bind("__veloxReady", func(marker string) error {
		if marker != "dom-2raf" {
			return fmt.Errorf("unexpected ready marker %q", marker)
		}
		view.Dispatch(func() { view.SetTitle("Velox Bench Ready") })
		return nil
	}); err != nil {
		return err
	}

	entryURL, err := configureTransport(view, webRoot)
	if err != nil {
		return err
	}
	view.Navigate(entryURL)
	view.Run()
	return nil
}

func configureTransport(view webview2.WebView, webRoot string) (string, error) {
	switch transportMode {
	case "file-url":
		entry := filepath.Join(webRoot, "index.html")
		return (&url.URL{Scheme: "file", Path: filepath.ToSlash(entry)}).String(), nil
	case "virtual-host":
		if err := view.SetVirtualHostNameToFolderMapping(transportHost, webRoot); err != nil {
			return "", fmt.Errorf("map virtual host: %w", err)
		}
		return "https://" + transportHost + "/index.html", nil
	case "web-resource":
		if err := view.SetWebResourceRequestHandler("https://"+transportHost+"/*", resourceHandler(webRoot)); err != nil {
			return "", fmt.Errorf("install web resource handler: %w", err)
		}
		return "https://" + transportHost + "/index.html", nil
	default:
		return "", fmt.Errorf("unsupported transport mode %q", transportMode)
	}
}

func resourceHandler(webRoot string) webview2.WebResourceRequestHandler {
	return func(rawURL string) (webview2.WebResourceResponse, bool) {
		parsed, err := url.Parse(rawURL)
		if err != nil || parsed.Scheme != "https" || parsed.Host != transportHost || parsed.User != nil {
			return webview2.WebResourceResponse{}, false
		}
		decodedPath, err := url.PathUnescape(parsed.EscapedPath())
		if err != nil || strings.Contains(decodedPath, `\`) {
			return response(400, "Bad Request", "text/plain; charset=utf-8", []byte("bad request")), true
		}
		for _, segment := range strings.Split(decodedPath, "/") {
			if segment == ".." {
				return response(403, "Forbidden", "text/plain; charset=utf-8", []byte("forbidden")), true
			}
		}
		relative := strings.TrimPrefix(path.Clean("/"+decodedPath), "/")
		if relative == "." || relative == "" {
			relative = "index.html"
		}
		candidate := filepath.Join(webRoot, filepath.FromSlash(relative))
		rel, err := filepath.Rel(webRoot, candidate)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return response(403, "Forbidden", "text/plain; charset=utf-8", []byte("forbidden")), true
		}
		info, err := os.Lstat(candidate)
		if err != nil || !info.Mode().IsRegular() {
			return response(404, "Not Found", "text/plain; charset=utf-8", []byte("not found")), true
		}
		content, err := os.ReadFile(candidate)
		if err != nil {
			return response(500, "Internal Server Error", "text/plain; charset=utf-8", []byte("read failed")), true
		}
		contentType := mime.TypeByExtension(filepath.Ext(candidate))
		if contentType == "" {
			contentType = "application/octet-stream"
		}
		return response(200, "OK", contentType, content), true
	}
}

func response(status int, reason, contentType string, content []byte) webview2.WebResourceResponse {
	return webview2.WebResourceResponse{
		Content: content, StatusCode: status, ReasonPhrase: reason,
		Headers: "Content-Type: " + contentType + "\r\nCache-Control: no-store",
	}
}
