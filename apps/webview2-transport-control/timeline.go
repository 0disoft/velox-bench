//go:build windows

package main

import (
	"encoding/json"
	"fmt"
	"io"
	"sync"
	"time"
)

const (
	startupTimelinePrefix  = "velox-bench-timeline "
	shutdownTimelinePrefix = "velox-bench-shutdown-timeline "
)

type timelinePhase struct {
	Name      string  `json:"name"`
	ElapsedMS float64 `json:"elapsedMs"`
}

type controlTimeline struct {
	SchemaVersion string          `json:"schemaVersion"`
	Clock         string          `json:"clock"`
	Phases        []timelinePhase `json:"phases"`
}

type timelineRecorder struct {
	mu            sync.Mutex
	enabled       bool
	prefix        string
	schemaVersion string
	clock         string
	started       time.Time
	phases        []timelinePhase
	emitted       bool
}

func newStartupTimeline(enabled bool) *timelineRecorder {
	recorder := &timelineRecorder{
		enabled: enabled, prefix: startupTimelinePrefix,
		schemaVersion: "velox.host-startup-timeline/v1", clock: "time-since-host-entry-monotonic",
		started: time.Now(),
	}
	if enabled {
		recorder.phases = append(recorder.phases, timelinePhase{Name: "host-entry", ElapsedMS: 0})
	}
	return recorder
}

func newShutdownTimeline(enabled bool) *timelineRecorder {
	return &timelineRecorder{
		enabled: enabled, prefix: shutdownTimelinePrefix,
		schemaVersion: "velox.host-shutdown-timeline/v1", clock: "time-since-shutdown-request-monotonic",
	}
}

func (r *timelineRecorder) Mark(name string) {
	if r == nil || !r.enabled {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	current := time.Now()
	if r.started.IsZero() {
		r.started = current
	}
	r.phases = append(r.phases, timelinePhase{
		Name: name, ElapsedMS: float64(current.Sub(r.started)) / float64(time.Millisecond),
	})
}

func (r *timelineRecorder) Emit(writer io.Writer) error {
	if r == nil || !r.enabled {
		return nil
	}
	r.mu.Lock()
	if r.emitted {
		r.mu.Unlock()
		return nil
	}
	r.emitted = true
	timeline := controlTimeline{
		SchemaVersion: r.schemaVersion, Clock: r.clock,
		Phases: append([]timelinePhase(nil), r.phases...),
	}
	r.mu.Unlock()
	if len(timeline.Phases) == 0 {
		return nil
	}
	body, err := json.Marshal(timeline)
	if err != nil {
		return fmt.Errorf("encode control timeline: %w", err)
	}
	if _, err := fmt.Fprintf(writer, "%s%s\n", r.prefix, body); err != nil {
		return fmt.Errorf("write control timeline: %w", err)
	}
	return nil
}
