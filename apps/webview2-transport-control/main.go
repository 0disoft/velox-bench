//go:build windows

package main

import (
	"fmt"
	"mime"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"

	webview2 "github.com/jchv/go-webview2"
)

const transportHost = "transport.actutum.invalid"

const readyTitle = "Actutum Bench Ready"

var originSuffixPattern = regexp.MustCompile(`^[a-z0-9-]{1,32}$`)

var transportMode string

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	profile := os.Getenv("ACTUTUM_BENCH_PROFILE")
	if profile == "" {
		return fmt.Errorf("ACTUTUM_BENCH_PROFILE is required")
	}
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	webRoot := filepath.Join(filepath.Dir(executable), "web")
	captureTimeline := os.Getenv("ACTUTUM_BENCH_CAPTURE_TIMELINE") == "1"
	startupTimeline := newStartupTimeline(captureTimeline)
	shutdownTimeline := newShutdownTimeline(captureTimeline)
	view := webview2.NewWithOptions(webview2.WebViewOptions{
		DataPath: profile, StartupPhase: startupTimeline.Mark, ShutdownPhase: shutdownTimeline.Mark,
		WindowOptions: webview2.WindowOptions{Title: "Actutum Bench", Width: 960, Height: 640, Center: true},
	})
	if view == nil {
		return fmt.Errorf("create WebView2 transport control window")
	}
	enteredRunLoop := false
	defer func() {
		if !enteredRunLoop {
			view.Destroy()
			view.Run()
		}
	}()
	if err := view.Bind("__actutumReady", func(marker string) error {
		if marker != "dom-2raf" {
			return fmt.Errorf("unexpected ready marker %q", marker)
		}
		browserProcessID, err := view.BrowserProcessID()
		if err != nil {
			return fmt.Errorf("read browser process ID: %w", err)
		}
		startupTimeline.Mark(marker)
		if err := startupTimeline.Emit(os.Stderr); err != nil {
			return err
		}
		title := readyTitle
		if captureTimeline {
			title = fmt.Sprintf("%s %d", readyTitle, browserProcessID)
		}
		view.Dispatch(func() { view.SetTitle(title) })
		return nil
	}); err != nil {
		return err
	}

	entryURL, err := configureTransport(view, webRoot)
	if err != nil {
		return err
	}
	startupTimeline.Mark("transport-configured")
	view.Navigate(entryURL)
	startupTimeline.Mark("navigation-dispatched")
	enteredRunLoop = true
	view.Run()
	shutdownTimeline.Mark("run-loop-exited")
	if err := shutdownTimeline.Emit(os.Stderr); err != nil {
		return err
	}
	return nil
}

func configureTransport(view webview2.WebView, webRoot string) (string, error) {
	host, err := transportHostname(os.Getenv("ACTUTUM_BENCH_ORIGIN_SUFFIX"))
	if err != nil {
		return "", err
	}
	switch transportMode {
	case "file-url":
		entry := filepath.Join(webRoot, "index.html")
		return (&url.URL{Scheme: "file", Path: filepath.ToSlash(entry)}).String(), nil
	case "virtual-host":
		if err := view.SetVirtualHostNameToFolderMapping(host, webRoot); err != nil {
			return "", fmt.Errorf("map virtual host: %w", err)
		}
		return "https://" + host + "/index.html", nil
	case "web-resource":
		if err := view.SetWebResourceRequestHandler("https://"+host+"/*", resourceHandler(webRoot, host)); err != nil {
			return "", fmt.Errorf("install web resource handler: %w", err)
		}
		return "https://" + host + "/index.html", nil
	default:
		return "", fmt.Errorf("unsupported transport mode %q", transportMode)
	}
}

func transportHostname(suffix string) (string, error) {
	if suffix == "" {
		return transportHost, nil
	}
	if !originSuffixPattern.MatchString(suffix) {
		return "", fmt.Errorf("invalid origin suffix %q", suffix)
	}
	return "transport-" + suffix + ".actutum.invalid", nil
}

func resourceHandler(webRoot, host string) webview2.WebResourceRequestHandler {
	return func(rawURL string) (webview2.WebResourceResponse, bool) {
		parsed, err := url.Parse(rawURL)
		if err != nil || parsed.Scheme != "https" || parsed.Host != host || parsed.User != nil {
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
