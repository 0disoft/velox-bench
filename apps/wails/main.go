package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	err := wails.Run(&options.App{
		Title:  "Velox Bench",
		Width:  960,
		Height: 640,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
	})
	if err != nil {
		log.Fatal(err)
	}
}

