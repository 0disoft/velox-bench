module github.com/0disoft/actutum-bench/apps/webview2-transport-control

go 1.26.0

require github.com/jchv/go-webview2 v0.0.0

require (
	github.com/jchv/go-winloader v0.0.0-20250406163304-c1995be93bd1 // indirect
	golang.org/x/sys v0.47.0 // indirect
)

replace github.com/jchv/go-webview2 => ../../.bench/actutum-source/third_party/go-webview2
