//go:build windows

package main

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"

	webview2 "github.com/jchv/go-webview2"
)

func main() {
	profile := os.Getenv("ACTUTUM_BENCH_PROFILE")
	if profile == "" {
		fmt.Fprintln(os.Stderr, "ACTUTUM_BENCH_PROFILE is required")
		os.Exit(2)
	}
	executable, err := os.Executable()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	entry := filepath.Join(filepath.Dir(executable), "web", "index.html")
	entryURL := (&url.URL{Scheme: "file", Path: filepath.ToSlash(entry)}).String()
	view := webview2.NewWithOptions(webview2.WebViewOptions{
		DataPath:      profile,
		WindowOptions: webview2.WindowOptions{Title: "Actutum Bench", Width: 960, Height: 640, Center: true},
	})
	if view == nil {
		fmt.Fprintln(os.Stderr, "create WebView2 control window")
		os.Exit(1)
	}
	defer view.Destroy()
	if err := view.Bind("__actutumReady", func(marker string) error {
		if marker != "dom-2raf" {
			return fmt.Errorf("unexpected ready marker %q", marker)
		}
		view.Dispatch(func() { view.SetTitle("Actutum Bench Ready") })
		return nil
	}); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	view.Navigate(entryURL)
	view.Run()
}
