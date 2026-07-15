module github.com/0disoft/velox-bench/apps/webview2-transport-control

go 1.26.0

require github.com/jchv/go-webview2 v0.0.0

require (
	github.com/jchv/go-winloader v0.0.0-20250406163304-c1995be93bd1 // indirect
	golang.org/x/sys v0.0.0-20220412211240-33da011f77ad // indirect
)

replace github.com/jchv/go-webview2 => ../../.bench/velox-source/third_party/go-webview2
