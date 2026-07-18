//go:build windows

package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResourceHandlerServesOnlyRegularFilesUnderRoot(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte("ok"), 0o644); err != nil {
		t.Fatal(err)
	}
	handler := resourceHandler(root, transportHost)

	served, handled := handler("https://" + transportHost + "/index.html")
	if !handled || served.StatusCode != 200 || string(served.Content) != "ok" {
		t.Fatalf("served = %#v, handled = %t", served, handled)
	}
	missing, handled := handler("https://" + transportHost + "/missing.js")
	if !handled || missing.StatusCode != 404 {
		t.Fatalf("missing = %#v, handled = %t", missing, handled)
	}
	if _, handled := handler("https://example.com/index.html"); handled {
		t.Fatal("foreign host was handled")
	}
}

func TestResourceHandlerRejectsEscapedTraversal(t *testing.T) {
	handler := resourceHandler(t.TempDir(), transportHost)
	result, handled := handler("https://" + transportHost + "/%2e%2e/secret")
	if !handled || result.StatusCode != 403 {
		t.Fatalf("result = %#v, handled = %t", result, handled)
	}
}

func TestTransportHostnameScopesOriginVariant(t *testing.T) {
	host, err := transportHostname("relaunch")
	if err != nil {
		t.Fatal(err)
	}
	if host != "transport-relaunch.actutum.invalid" {
		t.Fatalf("host = %q", host)
	}
	if _, err := transportHostname("../escape"); err == nil {
		t.Fatal("invalid origin suffix was accepted")
	}
}
