package handlers

import (
	"os"
	"strings"
	"testing"
)

func TestTerminalSession_getSafeEnv(t *testing.T) {
	originalEnv := os.Environ()
	defer func() {
		os.Clearenv()
		for _, e := range originalEnv {
			parts := strings.SplitN(e, "=", 2)
			if len(parts) == 2 {
				_ = os.Setenv(parts[0], parts[1])
			}
		}
	}()

	os.Clearenv()
	_ = os.Setenv("PATH", "/bin")
	_ = os.Setenv("HOME", "/home/test")
	_ = os.Setenv("USER", "tester")
	_ = os.Setenv("UNSAFE_VAR", "should-not-be-passed")

	ts := &terminalSession{}
	env := ts.getSafeEnv()

	envMap := make(map[string]string, len(env))
	for _, e := range env {
		parts := strings.SplitN(e, "=", 2)
		if len(parts) == 2 {
			envMap[parts[0]] = parts[1]
		}
	}

	if len(envMap) != 4 {
		t.Fatalf("expected 4 environment vars, got %d: %#v", len(envMap), envMap)
	}

	if envMap["PATH"] != "/bin" {
		t.Fatalf("expected PATH to be preserved, got %q", envMap["PATH"])
	}
	if envMap["HOME"] != "/home/test" {
		t.Fatalf("expected HOME to be preserved, got %q", envMap["HOME"])
	}
	if envMap["USER"] != "tester" {
		t.Fatalf("expected USER to be preserved, got %q", envMap["USER"])
	}
	if envMap["TERM"] != "xterm-256color" {
		t.Fatalf("expected TERM to be set, got %q", envMap["TERM"])
	}
	if _, exists := envMap["UNSAFE_VAR"]; exists {
		t.Fatalf("expected UNSAFE_VAR to be filtered out")
	}
}
