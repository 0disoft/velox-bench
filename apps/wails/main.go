package main

import (
	"context"
	"embed"
	"fmt"
	"log"
	"os"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed all:frontend/dist
var assets embed.FS

type Bench struct {
	context context.Context
}

func (b *Bench) startup(ctx context.Context) {
	b.context = ctx
}

func (b *Bench) Ready(marker string) error {
	if marker != "dom-2raf" {
		return fmt.Errorf("unexpected ready marker %q", marker)
	}
	runtime.WindowSetTitle(b.context, "Velox Bench Ready")
	return nil
}

func main() {
	bench := &Bench{}
	err := wails.Run(&options.App{
		Title:  "Velox Bench",
		Width:  960,
		Height: 640,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		Windows:   &windows.Options{WebviewUserDataPath: os.Getenv("VELOX_BENCH_PROFILE")},
		OnStartup: bench.startup,
		Bind:      []interface{}{bench},
	})
	if err != nil {
		log.Fatal(err)
	}
}
