package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := application.New(application.Options{
		Name: "Velox Bench",
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
	})
	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:  "Velox Bench",
		Width:  960,
		Height: 640,
	})
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
