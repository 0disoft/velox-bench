//go:build windows

package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"github.com/jchv/go-webview2/webviewloader"
	"golang.org/x/sys/windows"
)

const (
	readyTitle                    = "Velox Bench Ready"
	delaySchemaVersion            = "velox.asset-transport-delay/v1"
	recoverySchemaVersion         = "velox.asset-transport-recovery/v1"
	wmClose                       = 0x0010
	startupTimelinePrefix         = "velox-bench-timeline "
	shutdownTimelinePrefix        = "velox-bench-shutdown-timeline "
	browserExitObservationTimeout = 15 * time.Second

	pipeAccessInbound = 0x00000001
	pipeTypeByte      = 0x00000000
	pipeWait          = 0x00000000
)

var (
	user32                 = syscall.NewLazyDLL("user32.dll")
	procEnumWindows        = user32.NewProc("EnumWindows")
	procGetWindowTextW     = user32.NewProc("GetWindowTextW")
	procGetWindowThreadPID = user32.NewProc("GetWindowThreadProcessId")
	procIsWindowVisible    = user32.NewProc("IsWindowVisible")
	procPostMessageW       = user32.NewProc("PostMessageW")
	kernel32               = windows.NewLazySystemDLL("kernel32.dll")
	createNamedPipeW       = kernel32.NewProc("CreateNamedPipeW")
	connectNamedPipe       = kernel32.NewProc("ConnectNamedPipe")
	disconnectNamedPipe    = kernel32.NewProc("DisconnectNamedPipe")
	cancelIoEx             = kernel32.NewProc("CancelIoEx")
)

type result struct {
	SchemaVersion     string      `json:"schemaVersion"`
	Suite             string      `json:"suite"`
	Framework         string      `json:"framework"`
	FrameworkRevision string      `json:"frameworkRevision"`
	ProfileControl    string      `json:"profileControl"`
	Sample            int         `json:"sample"`
	Scenario          *string     `json:"scenario,omitempty"`
	RequestedDelayMS  *int        `json:"requestedDelayMs,omitempty"`
	Outcome           string      `json:"outcome"`
	StartedAtUTC      string      `json:"startedAtUtc"`
	FinishedAtUTC     string      `json:"finishedAtUtc"`
	Environment       environment `json:"environment"`
	Measurement       any         `json:"measurement"`
	Failure           *failure    `json:"failure"`
}

type environment struct {
	OS                 string `json:"os"`
	Architecture       string `json:"architecture"`
	RunnerImage        string `json:"runnerImage"`
	RunnerImageVersion string `json:"runnerImageVersion"`
	WebView2Version    string `json:"webView2Version"`
	RepositoryCommit   string `json:"repositoryCommit"`
	RunID              string `json:"runId"`
	RunAttempt         string `json:"runAttempt"`
}

type measurement struct {
	ReadyBoundary                             string  `json:"readyBoundary"`
	ImmediateProcessStartAfterFirstHostExitMS float64 `json:"immediateProcessStartAfterFirstHostExitMs"`
	First                                     launch  `json:"first"`
	Immediate                                 launch  `json:"immediate"`
}

type delayMeasurement struct {
	ReadyBoundary                          string  `json:"readyBoundary"`
	ActualProcessStartAfterFirstHostExitMS float64 `json:"actualProcessStartAfterFirstHostExitMs"`
	First                                  launch  `json:"first"`
	Relaunched                             launch  `json:"relaunched"`
}

type recoveryMeasurement struct {
	ReadyBoundary                          string           `json:"readyBoundary"`
	ActualProcessStartAfterFirstHostExitMS float64          `json:"actualProcessStartAfterFirstHostExitMs"`
	BrowserExitObservationTimeoutMS        int              `json:"browserExitObservationTimeoutMs"`
	FirstBrowserRunningAtRelaunchStart     bool             `json:"firstBrowserRunningAtRelaunchStart"`
	BrowserProcessSharedAcrossPair         bool             `json:"browserProcessSharedAcrossPair"`
	First                                  diagnosticLaunch `json:"first"`
	Relaunched                             diagnosticLaunch `json:"relaunched"`
}

type diagnosticLaunch struct {
	ReadyMS                    float64         `json:"readyMs"`
	HostExitMS                 float64         `json:"hostExitMs"`
	HostProcessID              uint32          `json:"hostProcessId"`
	BrowserProcessID           uint32          `json:"browserProcessId"`
	BrowserExitAfterHostExitMS *float64        `json:"browserExitAfterHostExitMs"`
	StartupTimeline            processTimeline `json:"startupTimeline"`
	ShutdownTimeline           processTimeline `json:"shutdownTimeline"`
}

type processTimeline struct {
	SchemaVersion string          `json:"schemaVersion"`
	Clock         string          `json:"clock"`
	Phases        []timelinePhase `json:"phases"`
}

type timelinePhase struct {
	Name      string  `json:"name"`
	ElapsedMS float64 `json:"elapsedMs"`
}

type launch struct {
	ReadyMS    float64 `json:"readyMs"`
	HostExitMS float64 `json:"hostExitMs"`
}

type observedLaunch struct {
	launch
	HostProcessID    uint32
	BrowserProcessID uint32
	StartupTimeline  *processTimeline
	ShutdownTimeline *processTimeline
	HostExitedAt     time.Time
	BrowserExit      <-chan processExitResult
}

type processExitResult struct {
	ExitedAt time.Time
	Err      error
}

type recoveryScenario struct {
	ID                   string
	Framework            string
	FreshRelaunchProfile bool
	FreshRelaunchOrigin  bool
}

type failure struct {
	Phase string `json:"phase"`
	Code  string `json:"code"`
}

type runFailure struct {
	phase string
	err   error
}

func (e runFailure) Error() string { return e.phase + ": " + e.err.Error() }

var recoveryScenarios = map[string]recoveryScenario{
	"velox-same-profile":         {ID: "velox-same-profile", Framework: "velox"},
	"velox-fresh-profile":        {ID: "velox-fresh-profile", Framework: "velox", FreshRelaunchProfile: true},
	"file-url-same-profile":      {ID: "file-url-same-profile", Framework: "fork-file-url"},
	"file-url-fresh-profile":     {ID: "file-url-fresh-profile", Framework: "fork-file-url", FreshRelaunchProfile: true},
	"virtual-host-same-profile":  {ID: "virtual-host-same-profile", Framework: "fork-virtual-host"},
	"virtual-host-fresh-profile": {ID: "virtual-host-fresh-profile", Framework: "fork-virtual-host", FreshRelaunchProfile: true},
	"virtual-host-fresh-origin":  {ID: "virtual-host-fresh-origin", Framework: "fork-virtual-host", FreshRelaunchOrigin: true},
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	schemaVersion := flag.String("schema-version", "velox.relaunch-control/v1", "result schema version")
	suite := flag.String("suite", "same-profile-immediate-relaunch", "measurement suite identifier")
	framework := flag.String("framework", "", "framework identifier")
	revision := flag.String("revision", "", "immutable framework revision")
	executable := flag.String("executable", "", "application executable")
	workdir := flag.String("workdir", "", "application working directory")
	profile := flag.String("profile", "", "shared WebView profile directory")
	profileControl := flag.String("profile-control", "", "explicit-udf or framework-managed-app-directory")
	output := flag.String("output", "", "result JSON path")
	sample := flag.Int("sample", -1, "sample index")
	relaunchDelayMS := flag.Int("relaunch-delay-ms", 0, "delay after first host exit before relaunch")
	scenarioID := flag.String("scenario", "", "recovery scenario identifier")
	flag.Parse()
	if flag.NArg() != 0 || *schemaVersion == "" || *suite == "" || *framework == "" || *revision == "" || *executable == "" || *workdir == "" || *profile == "" || *output == "" || *sample < 0 || *sample > 9 {
		return errors.New("schema-version, suite, framework, revision, executable, workdir, profile, output, and sample are required")
	}
	if *profileControl != "explicit-udf" && *profileControl != "framework-managed-app-directory" {
		return errors.New("invalid profile-control")
	}
	if *relaunchDelayMS < 0 || *relaunchDelayMS > 60_000 {
		return errors.New("relaunch-delay-ms must be between 0 and 60000")
	}
	if *schemaVersion != delaySchemaVersion && *schemaVersion != recoverySchemaVersion && *relaunchDelayMS != 0 {
		return errors.New("relaunch-delay-ms requires an asset transport delay or recovery schema")
	}
	isRecovery := *schemaVersion == recoverySchemaVersion
	var scenario recoveryScenario
	if isRecovery {
		var ok bool
		scenario, ok = recoveryScenarios[*scenarioID]
		if !ok || scenario.Framework != *framework || *profileControl != "explicit-udf" {
			return errors.New("recovery schema requires a matching scenario, framework, and explicit-udf profile control")
		}
	} else if *scenarioID != "" {
		return errors.New("scenario requires the asset transport recovery schema")
	}
	started := time.Now().UTC()
	result := result{
		SchemaVersion: *schemaVersion, Suite: *suite,
		Framework: *framework, FrameworkRevision: *revision, ProfileControl: *profileControl, Sample: *sample,
		Outcome: "success", StartedAtUTC: started.Format(time.RFC3339Nano), Environment: currentEnvironment(),
	}
	if *schemaVersion == delaySchemaVersion || isRecovery {
		result.RequestedDelayMS = relaunchDelayMS
	}
	if isRecovery {
		result.Scenario = scenarioID
	}
	first, err := runLaunch(*framework, *executable, *workdir, *profile, "", isRecovery)
	if err != nil {
		result.Outcome, result.Failure = "failure", &failure{Phase: failurePhase(err, "first-launch"), Code: "PHASE_FAILED"}
	} else {
		if *relaunchDelayMS > 0 {
			time.Sleep(time.Duration(*relaunchDelayMS) * time.Millisecond)
		}
		relaunchStartedAt := time.Now()
		relaunchProfile := *profile
		relaunchOriginSuffix := ""
		if isRecovery && scenario.FreshRelaunchProfile {
			relaunchProfile += "-relaunch"
		}
		if isRecovery && scenario.FreshRelaunchOrigin {
			relaunchOriginSuffix = "relaunch"
		}
		firstBrowserRunning, firstBrowserExitResult := browserRunningAt(first.BrowserExit)
		relaunched, relaunchErr := runLaunch(*framework, *executable, *workdir, relaunchProfile, relaunchOriginSuffix, isRecovery)
		if relaunchErr != nil {
			failurePrefix := "immediate-launch"
			if *schemaVersion == delaySchemaVersion || isRecovery {
				failurePrefix = "relaunch-launch"
			}
			result.Outcome, result.Failure = "failure", &failure{Phase: failurePhase(relaunchErr, failurePrefix), Code: "PHASE_FAILED"}
		} else {
			if isRecovery {
				firstDiagnostic, firstDiagnosticErr := diagnosticLaunchFrom(first, firstBrowserExitResult, browserExitObservationTimeout)
				relaunchedDiagnostic, relaunchedDiagnosticErr := diagnosticLaunchFrom(relaunched, nil, browserExitObservationTimeout)
				if firstDiagnosticErr != nil {
					result.Outcome, result.Failure = "failure", &failure{Phase: "first-launch/browser-process-observation", Code: "PHASE_FAILED"}
				} else if relaunchedDiagnosticErr != nil {
					result.Outcome, result.Failure = "failure", &failure{Phase: "relaunch-launch/browser-process-observation", Code: "PHASE_FAILED"}
				} else {
					result.Measurement = &recoveryMeasurement{
						ReadyBoundary:                          "process-start-to-framework-ready-after-domcontentloaded-plus-two-animation-frames",
						ActualProcessStartAfterFirstHostExitMS: milliseconds(relaunchStartedAt.Sub(first.HostExitedAt)),
						BrowserExitObservationTimeoutMS:        int(browserExitObservationTimeout / time.Millisecond),
						FirstBrowserRunningAtRelaunchStart:     *firstBrowserRunning,
						BrowserProcessSharedAcrossPair:         first.BrowserProcessID != 0 && first.BrowserProcessID == relaunched.BrowserProcessID,
						First:                                  firstDiagnostic, Relaunched: relaunchedDiagnostic,
					}
				}
			} else if *schemaVersion == delaySchemaVersion {
				result.Measurement = &delayMeasurement{
					ReadyBoundary:                          "process-start-to-framework-ready-after-domcontentloaded-plus-two-animation-frames",
					ActualProcessStartAfterFirstHostExitMS: milliseconds(relaunchStartedAt.Sub(first.HostExitedAt)),
					First:                                  first.launch, Relaunched: relaunched.launch,
				}
			} else {
				result.Measurement = &measurement{
					ReadyBoundary: "process-start-to-framework-ready-after-domcontentloaded-plus-two-animation-frames",
					ImmediateProcessStartAfterFirstHostExitMS: milliseconds(relaunchStartedAt.Sub(first.HostExitedAt)),
					First: first.launch, Immediate: relaunched.launch,
				}
			}
		}
	}
	result.FinishedAtUTC = time.Now().UTC().Format(time.RFC3339Nano)
	if err := writeJSON(*output, result); err != nil {
		return err
	}
	if result.Outcome != "success" {
		return errors.New("relaunch measurement failed")
	}
	return nil
}

func runLaunch(framework, executable, workdir, profile, originSuffix string, captureDiagnostics bool) (observedLaunch, error) {
	var pipe windows.Handle
	var pipeName string
	if framework == "velox" {
		pipeName = fmt.Sprintf(`\\.\pipe\velox-relaunch-%d`, time.Now().UnixNano())
		var err error
		pipe, err = createPipe(pipeName)
		if err != nil {
			return observedLaunch{}, runFailure{phase: "ready-pipe-create", err: err}
		}
		defer windows.CloseHandle(pipe)
		defer disconnectNamedPipe.Call(uintptr(pipe))
	}
	started := time.Now()
	command := exec.Command(executable)
	command.Dir = workdir
	command.Env = append(os.Environ(), "VELOX_BENCH_PROFILE="+profile, "VELOX_DATA_DIR="+profile)
	if captureDiagnostics {
		command.Env = append(command.Env, "VELOX_BENCH_CAPTURE_TIMELINE=1")
	}
	if originSuffix != "" {
		command.Env = append(command.Env, "VELOX_BENCH_ORIGIN_SUFFIX="+originSuffix)
	}
	if pipeName != "" {
		command.Env = append(command.Env, "VELOX_BENCH_PIPE="+pipeName)
	}
	command.Stdin = nil
	command.Stdout = os.Stdout
	var stderr bytes.Buffer
	command.Stderr = io.MultiWriter(os.Stderr, &stderr)
	if err := command.Start(); err != nil {
		return observedLaunch{}, runFailure{phase: "process-start", err: err}
	}
	processID := uint32(command.Process.Pid)
	browserProcessID := uint32(0)
	var err error
	var hwnd uintptr
	var readyAt time.Time
	if pipe != 0 {
		readyAt, browserProcessID, err = waitForVeloxReady(pipe, 15*time.Second)
		if err == nil {
			hwnd, _, _, err = waitForWindow(processID, "", false, 5*time.Second)
		}
	} else {
		var observedTitle string
		hwnd, readyAt, observedTitle, err = waitForWindow(processID, readyTitle, captureDiagnostics, 15*time.Second)
		if err == nil && captureDiagnostics {
			browserProcessID, err = browserProcessIDFromTitle(observedTitle)
		}
	}
	if err != nil {
		_ = command.Process.Kill()
		if pipe != 0 {
			cancelIoEx.Call(uintptr(pipe), 0)
		}
		_, _ = command.Process.Wait()
		return observedLaunch{}, runFailure{phase: "framework-ready", err: err}
	}
	var browserExit <-chan processExitResult
	if captureDiagnostics {
		if browserProcessID == 0 {
			_ = command.Process.Kill()
			_, _ = command.Process.Wait()
			return observedLaunch{}, runFailure{phase: "browser-process", err: errors.New("browser process ID is unavailable")}
		}
		browserExit, err = observeProcessExit(browserProcessID)
		if err != nil {
			_ = command.Process.Kill()
			_, _ = command.Process.Wait()
			return observedLaunch{}, runFailure{phase: "browser-process", err: err}
		}
	}
	posted, _, postErr := procPostMessageW.Call(hwnd, wmClose, 0, 0)
	if posted == 0 {
		_ = command.Process.Kill()
		_, _ = command.Process.Wait()
		return observedLaunch{}, runFailure{phase: "window-close", err: postErr}
	}
	exit := make(chan error, 1)
	go func() { exit <- command.Wait() }()
	select {
	case err := <-exit:
		if err != nil {
			return observedLaunch{}, runFailure{phase: "host-exit", err: err}
		}
	case <-time.After(5 * time.Second):
		_ = command.Process.Kill()
		<-exit
		return observedLaunch{}, runFailure{phase: "host-exit", err: errors.New("timeout")}
	}
	exitedAt := time.Now()
	observation := observedLaunch{
		launch:        launch{ReadyMS: milliseconds(readyAt.Sub(started)), HostExitMS: milliseconds(exitedAt.Sub(readyAt))},
		HostProcessID: processID, BrowserProcessID: browserProcessID, HostExitedAt: exitedAt, BrowserExit: browserExit,
	}
	if captureDiagnostics {
		observation.StartupTimeline, err = parseProcessTimeline(stderr.String(), startupTimelinePrefix, "velox.host-startup-timeline/v1", "time-since-host-entry-monotonic")
		if err != nil {
			return observedLaunch{}, runFailure{phase: "startup-timeline", err: err}
		}
		observation.ShutdownTimeline, err = parseProcessTimeline(stderr.String(), shutdownTimelinePrefix, "velox.host-shutdown-timeline/v1", "time-since-shutdown-request-monotonic")
		if err != nil {
			return observedLaunch{}, runFailure{phase: "shutdown-timeline", err: err}
		}
	}
	return observation, nil
}

func waitForWindow(processID uint32, title string, allowTitleSuffix bool, timeout time.Duration) (uintptr, time.Time, string, error) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if hwnd, observedTitle := findWindow(processID, title, allowTitleSuffix); hwnd != 0 {
			return hwnd, time.Now(), observedTitle, nil
		}
		time.Sleep(10 * time.Millisecond)
	}
	return 0, time.Time{}, "", errors.New("ready title timeout")
}

func findWindow(processID uint32, title string, allowTitleSuffix bool) (uintptr, string) {
	var found uintptr
	var foundTitle string
	callback := syscall.NewCallback(func(hwnd uintptr, _ uintptr) uintptr {
		visible, _, _ := procIsWindowVisible.Call(hwnd)
		if visible == 0 {
			return 1
		}
		var owner uint32
		_, _, _ = procGetWindowThreadPID.Call(hwnd, uintptr(unsafe.Pointer(&owner)))
		if owner != processID {
			return 1
		}
		if title == "" {
			found = hwnd
			return 0
		}
		buffer := make([]uint16, 256)
		length, _, _ := procGetWindowTextW.Call(hwnd, uintptr(unsafe.Pointer(&buffer[0])), uintptr(len(buffer)))
		observedTitle := syscall.UTF16ToString(buffer[:int(length)])
		if titleMatches(observedTitle, title, allowTitleSuffix) {
			found = hwnd
			foundTitle = observedTitle
			return 0
		}
		return 1
	})
	_, _, _ = procEnumWindows.Call(callback, 0)
	return found, foundTitle
}

func createPipe(name string) (windows.Handle, error) {
	nameUTF16, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return windows.InvalidHandle, err
	}
	handle, _, callErr := createNamedPipeW.Call(
		uintptr(unsafe.Pointer(nameUTF16)), pipeAccessInbound, pipeTypeByte|pipeWait,
		1, 4096, 4096, 0, 0,
	)
	if handle == uintptr(windows.InvalidHandle) {
		return windows.InvalidHandle, fmt.Errorf("CreateNamedPipeW: %w", callErr)
	}
	return windows.Handle(handle), nil
}

func waitForVeloxReady(pipe windows.Handle, timeout time.Duration) (time.Time, uint32, error) {
	type readyResult struct {
		at               time.Time
		browserProcessID uint32
		err              error
	}
	done := make(chan readyResult, 1)
	go func() {
		connected, _, err := connectNamedPipe.Call(uintptr(pipe), 0)
		if connected == 0 && err != windows.ERROR_PIPE_CONNECTED {
			done <- readyResult{err: err}
			return
		}
		buffer := make([]byte, 128)
		n, err := windows.Read(pipe, buffer)
		if err != nil {
			done <- readyResult{err: err}
			return
		}
		fields := strings.Fields(string(buffer[:n]))
		if len(fields) != 3 || fields[0] != "ready" || fields[1] != "dom-2raf" {
			done <- readyResult{err: fmt.Errorf("unexpected Velox ready marker %q", buffer[:n])}
			return
		}
		processID, err := strconv.ParseUint(fields[2], 10, 32)
		if err != nil || processID == 0 {
			done <- readyResult{err: fmt.Errorf("invalid Velox browser process ID %q", fields[2])}
			return
		}
		done <- readyResult{at: time.Now(), browserProcessID: uint32(processID)}
	}()
	select {
	case result := <-done:
		return result.at, result.browserProcessID, result.err
	case <-time.After(timeout):
		cancelIoEx.Call(uintptr(pipe), 0)
		return time.Time{}, 0, errors.New("Velox ready marker timeout")
	}
}

func titleMatches(observed, expected string, allowSuffix bool) bool {
	if observed == expected {
		return true
	}
	return allowSuffix && strings.HasPrefix(observed, expected+" ")
}

func browserProcessIDFromTitle(title string) (uint32, error) {
	fields := strings.Fields(title)
	if len(fields) != 4 || strings.Join(fields[:3], " ") != readyTitle {
		return 0, fmt.Errorf("ready title has no browser process ID: %q", title)
	}
	processID, err := strconv.ParseUint(fields[3], 10, 32)
	if err != nil || processID == 0 {
		return 0, fmt.Errorf("invalid browser process ID in ready title %q", title)
	}
	return uint32(processID), nil
}

func observeProcessExit(processID uint32) (<-chan processExitResult, error) {
	handle, err := windows.OpenProcess(windows.SYNCHRONIZE, false, processID)
	if err != nil {
		return nil, fmt.Errorf("open browser process %d: %w", processID, err)
	}
	exited := make(chan processExitResult, 1)
	go func() {
		defer windows.CloseHandle(handle)
		result, waitErr := windows.WaitForSingleObject(handle, windows.INFINITE)
		if waitErr != nil {
			exited <- processExitResult{Err: waitErr}
		} else if result != windows.WAIT_OBJECT_0 {
			exited <- processExitResult{Err: fmt.Errorf("unexpected wait result %d", result)}
		} else {
			exited <- processExitResult{ExitedAt: time.Now()}
		}
		close(exited)
	}()
	return exited, nil
}

func browserRunningAt(exited <-chan processExitResult) (*bool, *processExitResult) {
	if exited == nil {
		return nil, nil
	}
	select {
	case result, ok := <-exited:
		if !ok {
			closed := processExitResult{Err: errors.New("browser process observation closed without a result")}
			return nil, &closed
		}
		if result.Err != nil {
			return nil, &result
		}
		running := false
		return &running, &result
	default:
		running := true
		return &running, nil
	}
}

func diagnosticLaunchFrom(observation observedLaunch, alreadyObserved *processExitResult, timeout time.Duration) (diagnosticLaunch, error) {
	exitResult := alreadyObserved
	if exitResult == nil && observation.BrowserExit != nil {
		select {
		case value, ok := <-observation.BrowserExit:
			if !ok {
				return diagnosticLaunch{}, errors.New("browser process observation closed without a result")
			}
			exitResult = &value
		case <-time.After(timeout):
		}
	}
	if exitResult != nil && exitResult.Err != nil {
		return diagnosticLaunch{}, exitResult.Err
	}
	var browserExitAfterHost *float64
	if exitResult != nil {
		value := milliseconds(exitResult.ExitedAt.Sub(observation.HostExitedAt))
		browserExitAfterHost = &value
	}
	return diagnosticLaunch{
		ReadyMS: observation.ReadyMS, HostExitMS: observation.HostExitMS,
		HostProcessID: observation.HostProcessID, BrowserProcessID: observation.BrowserProcessID,
		BrowserExitAfterHostExitMS: browserExitAfterHost,
		StartupTimeline:            *observation.StartupTimeline, ShutdownTimeline: *observation.ShutdownTimeline,
	}, nil
}

func parseProcessTimeline(output, prefix, schemaVersion, clock string) (*processTimeline, error) {
	var timeline *processTimeline
	for _, line := range strings.Split(output, "\n") {
		if !strings.HasPrefix(line, prefix) {
			continue
		}
		if timeline != nil {
			return nil, fmt.Errorf("multiple %s timelines were emitted", schemaVersion)
		}
		decoded := &processTimeline{}
		if err := json.Unmarshal([]byte(strings.TrimPrefix(line, prefix)), decoded); err != nil {
			return nil, fmt.Errorf("decode %s timeline: %w", schemaVersion, err)
		}
		timeline = decoded
	}
	if timeline == nil {
		return nil, fmt.Errorf("%s timeline was not emitted", schemaVersion)
	}
	if timeline.SchemaVersion != schemaVersion || timeline.Clock != clock || len(timeline.Phases) == 0 {
		return nil, fmt.Errorf("invalid %s timeline metadata", schemaVersion)
	}
	previous := -1.0
	for _, phase := range timeline.Phases {
		if phase.Name == "" || phase.ElapsedMS < previous {
			return nil, fmt.Errorf("invalid %s timeline phase order", schemaVersion)
		}
		previous = phase.ElapsedMS
	}
	return timeline, nil
}

func currentEnvironment() environment {
	value := func(name string) string {
		if raw := strings.TrimSpace(os.Getenv(name)); raw != "" {
			return raw
		}
		return "local-unverified"
	}
	webView2Version, err := webviewloader.GetInstalledVersion()
	if err != nil || strings.TrimSpace(webView2Version) == "" {
		webView2Version = "unavailable"
	}
	return environment{
		OS: runtime.GOOS, Architecture: runtime.GOARCH, RunnerImage: value("ImageOS"),
		RunnerImageVersion: value("ImageVersion"), WebView2Version: webView2Version,
		RepositoryCommit: value("GITHUB_SHA"), RunID: value("GITHUB_RUN_ID"), RunAttempt: value("GITHUB_RUN_ATTEMPT"),
	}
}

func failurePhase(err error, fallback string) string {
	var target runFailure
	if errors.As(err, &target) {
		return fallback + "/" + target.phase
	}
	return fallback
}

func milliseconds(duration time.Duration) float64 {
	return float64(duration) / float64(time.Millisecond)
}

func writeJSON(path string, value any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	body, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	body = append(body, '\n')
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, body, 0o644); err != nil {
		return err
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	return nil
}
