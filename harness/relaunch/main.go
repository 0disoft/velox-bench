//go:build windows

package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"github.com/jchv/go-webview2/webviewloader"
	"golang.org/x/sys/windows"
)

const (
	readyTitle = "Velox Bench Ready"
	wmClose    = 0x0010

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
	SchemaVersion     string       `json:"schemaVersion"`
	Suite             string       `json:"suite"`
	Framework         string       `json:"framework"`
	FrameworkRevision string       `json:"frameworkRevision"`
	ProfileControl    string       `json:"profileControl"`
	Sample            int          `json:"sample"`
	Outcome           string       `json:"outcome"`
	StartedAtUTC      string       `json:"startedAtUtc"`
	FinishedAtUTC     string       `json:"finishedAtUtc"`
	Environment       environment  `json:"environment"`
	Measurement       *measurement `json:"measurement"`
	Failure           *failure     `json:"failure"`
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

type launch struct {
	ReadyMS    float64 `json:"readyMs"`
	HostExitMS float64 `json:"hostExitMs"`
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

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	framework := flag.String("framework", "", "framework identifier")
	revision := flag.String("revision", "", "immutable framework revision")
	executable := flag.String("executable", "", "application executable")
	workdir := flag.String("workdir", "", "application working directory")
	profile := flag.String("profile", "", "shared WebView profile directory")
	profileControl := flag.String("profile-control", "", "explicit-udf or framework-managed-app-directory")
	output := flag.String("output", "", "result JSON path")
	sample := flag.Int("sample", -1, "sample index")
	flag.Parse()
	if flag.NArg() != 0 || *framework == "" || *revision == "" || *executable == "" || *workdir == "" || *profile == "" || *output == "" || *sample < 0 || *sample > 9 {
		return errors.New("framework, revision, executable, workdir, profile, output, and sample are required")
	}
	if *profileControl != "explicit-udf" && *profileControl != "framework-managed-app-directory" {
		return errors.New("invalid profile-control")
	}
	started := time.Now().UTC()
	result := result{
		SchemaVersion: "velox.relaunch-control/v1", Suite: "same-profile-immediate-relaunch",
		Framework: *framework, FrameworkRevision: *revision, ProfileControl: *profileControl, Sample: *sample,
		Outcome: "success", StartedAtUTC: started.Format(time.RFC3339Nano), Environment: currentEnvironment(),
	}
	first, firstExitedAt, err := runLaunch(*framework, *executable, *workdir, *profile)
	if err != nil {
		result.Outcome, result.Failure = "failure", &failure{Phase: failurePhase(err, "first-launch"), Code: "PHASE_FAILED"}
	} else {
		immediateStartedAt := time.Now()
		immediate, _, immediateErr := runLaunch(*framework, *executable, *workdir, *profile)
		if immediateErr != nil {
			result.Outcome, result.Failure = "failure", &failure{Phase: failurePhase(immediateErr, "immediate-launch"), Code: "PHASE_FAILED"}
		} else {
			result.Measurement = &measurement{
				ReadyBoundary: "process-start-to-framework-ready-after-domcontentloaded-plus-two-animation-frames",
				ImmediateProcessStartAfterFirstHostExitMS: milliseconds(immediateStartedAt.Sub(firstExitedAt)),
				First: first, Immediate: immediate,
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

func runLaunch(framework, executable, workdir, profile string) (launch, time.Time, error) {
	var pipe windows.Handle
	var pipeName string
	if framework == "velox" {
		pipeName = fmt.Sprintf(`\\.\pipe\velox-relaunch-%d`, time.Now().UnixNano())
		var err error
		pipe, err = createPipe(pipeName)
		if err != nil {
			return launch{}, time.Time{}, runFailure{phase: "ready-pipe-create", err: err}
		}
		defer windows.CloseHandle(pipe)
		defer disconnectNamedPipe.Call(uintptr(pipe))
	}
	started := time.Now()
	command := exec.Command(executable)
	command.Dir = workdir
	command.Env = append(os.Environ(), "VELOX_BENCH_PROFILE="+profile, "VELOX_DATA_DIR="+profile)
	if pipeName != "" {
		command.Env = append(command.Env, "VELOX_BENCH_PIPE="+pipeName)
	}
	command.Stdin = nil
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	if err := command.Start(); err != nil {
		return launch{}, time.Time{}, runFailure{phase: "process-start", err: err}
	}
	processID := uint32(command.Process.Pid)
	var err error
	var hwnd uintptr
	var readyAt time.Time
	if pipe != 0 {
		readyAt, err = waitForVeloxReady(pipe, 15*time.Second)
		if err == nil {
			hwnd, _, err = waitForWindow(processID, "", 5*time.Second)
		}
	} else {
		hwnd, readyAt, err = waitForWindow(processID, readyTitle, 15*time.Second)
	}
	if err != nil {
		_ = command.Process.Kill()
		if pipe != 0 {
			cancelIoEx.Call(uintptr(pipe), 0)
		}
		_, _ = command.Process.Wait()
		return launch{}, time.Time{}, runFailure{phase: "framework-ready", err: err}
	}
	posted, _, postErr := procPostMessageW.Call(hwnd, wmClose, 0, 0)
	if posted == 0 {
		_ = command.Process.Kill()
		_, _ = command.Process.Wait()
		return launch{}, time.Time{}, runFailure{phase: "window-close", err: postErr}
	}
	exit := make(chan error, 1)
	go func() { exit <- command.Wait() }()
	select {
	case err := <-exit:
		if err != nil {
			return launch{}, time.Time{}, runFailure{phase: "host-exit", err: err}
		}
	case <-time.After(5 * time.Second):
		_ = command.Process.Kill()
		<-exit
		return launch{}, time.Time{}, runFailure{phase: "host-exit", err: errors.New("timeout")}
	}
	exitedAt := time.Now()
	return launch{ReadyMS: milliseconds(readyAt.Sub(started)), HostExitMS: milliseconds(exitedAt.Sub(readyAt))}, exitedAt, nil
}

func waitForWindow(processID uint32, title string, timeout time.Duration) (uintptr, time.Time, error) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if hwnd := findWindow(processID, title); hwnd != 0 {
			return hwnd, time.Now(), nil
		}
		time.Sleep(10 * time.Millisecond)
	}
	return 0, time.Time{}, errors.New("ready title timeout")
}

func findWindow(processID uint32, title string) uintptr {
	var found uintptr
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
		if syscall.UTF16ToString(buffer[:int(length)]) == title {
			found = hwnd
			return 0
		}
		return 1
	})
	_, _, _ = procEnumWindows.Call(callback, 0)
	return found
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

func waitForVeloxReady(pipe windows.Handle, timeout time.Duration) (time.Time, error) {
	type readyResult struct {
		at  time.Time
		err error
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
		done <- readyResult{at: time.Now()}
	}()
	select {
	case result := <-done:
		return result.at, result.err
	case <-time.After(timeout):
		cancelIoEx.Call(uintptr(pipe), 0)
		return time.Time{}, errors.New("Velox ready marker timeout")
	}
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
