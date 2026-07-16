//go:build windows

package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestTimelineRecorderEmitsOnce(t *testing.T) {
	recorder := newStartupTimeline(true)
	recorder.Mark("environment-created")
	var output bytes.Buffer
	if err := recorder.Emit(&output); err != nil {
		t.Fatal(err)
	}
	if err := recorder.Emit(&output); err != nil {
		t.Fatal(err)
	}
	if strings.Count(output.String(), startupTimelinePrefix) != 1 {
		t.Fatalf("timeline output = %q", output.String())
	}
	if !strings.Contains(output.String(), `"schemaVersion":"velox.host-startup-timeline/v1"`) {
		t.Fatalf("timeline schema missing: %q", output.String())
	}
}

func TestDisabledTimelineRecorderDoesNotEmit(t *testing.T) {
	recorder := newShutdownTimeline(false)
	recorder.Mark("window-close-dispatched")
	var output bytes.Buffer
	if err := recorder.Emit(&output); err != nil {
		t.Fatal(err)
	}
	if output.Len() != 0 {
		t.Fatalf("disabled timeline output = %q", output.String())
	}
}
