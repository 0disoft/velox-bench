//go:build windows

package main

import (
	"errors"
	"testing"
	"time"
)

func TestRecoveryScenariosKeepFrameworkOwnership(t *testing.T) {
	cases := map[string]struct {
		framework    string
		freshProfile bool
		freshOrigin  bool
	}{
		"velox-same-profile":        {framework: "velox"},
		"velox-fresh-profile":       {framework: "velox", freshProfile: true},
		"file-url-fresh-profile":    {framework: "fork-file-url", freshProfile: true},
		"virtual-host-fresh-origin": {framework: "fork-virtual-host", freshOrigin: true},
	}
	for id, want := range cases {
		scenario, ok := recoveryScenarios[id]
		if !ok {
			t.Fatalf("scenario %q missing", id)
		}
		if scenario.Framework != want.framework || scenario.FreshRelaunchProfile != want.freshProfile || scenario.FreshRelaunchOrigin != want.freshOrigin {
			t.Fatalf("scenario %q = %#v", id, scenario)
		}
	}
}

func TestReadyTitleCarriesBrowserProcessIDOnlyAsSuffix(t *testing.T) {
	if !titleMatches("Velox Bench Ready", readyTitle, false) {
		t.Fatal("exact ready title did not match")
	}
	if titleMatches("Velox Bench Ready 42", readyTitle, false) {
		t.Fatal("diagnostic title matched without suffix permission")
	}
	if !titleMatches("Velox Bench Ready 42", readyTitle, true) {
		t.Fatal("diagnostic title did not match")
	}
	processID, err := browserProcessIDFromTitle("Velox Bench Ready 42")
	if err != nil || processID != 42 {
		t.Fatalf("browser process = %d, err = %v", processID, err)
	}
	if _, err := browserProcessIDFromTitle("Velox Bench Ready nope"); err == nil {
		t.Fatal("invalid browser process ID was accepted")
	}
}

func TestParseProcessTimelineRejectsReorderedPhases(t *testing.T) {
	valid := startupTimelinePrefix + `{"schemaVersion":"velox.host-startup-timeline/v1","clock":"time-since-host-entry-monotonic","phases":[{"name":"host-entry","elapsedMs":0},{"name":"environment-created","elapsedMs":2.5}]}`
	timeline, err := parseProcessTimeline(valid, startupTimelinePrefix, "velox.host-startup-timeline/v1", "time-since-host-entry-monotonic")
	if err != nil || len(timeline.Phases) != 2 {
		t.Fatalf("valid timeline = %#v, err = %v", timeline, err)
	}
	invalid := startupTimelinePrefix + `{"schemaVersion":"velox.host-startup-timeline/v1","clock":"time-since-host-entry-monotonic","phases":[{"name":"late","elapsedMs":2},{"name":"early","elapsedMs":1}]}`
	if _, err := parseProcessTimeline(invalid, startupTimelinePrefix, "velox.host-startup-timeline/v1", "time-since-host-entry-monotonic"); err == nil {
		t.Fatal("reordered timeline was accepted")
	}
}

func TestBrowserRunningAtPreservesObservedExit(t *testing.T) {
	exited := make(chan processExitResult, 1)
	now := time.Now()
	exited <- processExitResult{ExitedAt: now}
	close(exited)
	running, observed := browserRunningAt(exited)
	if running == nil || *running || observed == nil || !observed.ExitedAt.Equal(now) {
		t.Fatalf("running = %v, observed = %#v", running, observed)
	}
}

func TestDiagnosticLaunchRejectsProcessObservationFailure(t *testing.T) {
	observation := observedLaunch{
		StartupTimeline:  &processTimeline{},
		ShutdownTimeline: &processTimeline{},
		BrowserExit: func() <-chan processExitResult {
			result := make(chan processExitResult, 1)
			result <- processExitResult{Err: errors.New("wait failed")}
			close(result)
			return result
		}(),
	}
	if _, err := diagnosticLaunchFrom(observation, nil, time.Second); err == nil {
		t.Fatal("process observation failure was accepted")
	}
}
