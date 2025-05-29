// Package claudecode provides a Go SDK for programmatically interacting with Claude Code,
// Anthropic's AI coding assistant.
//
// This package allows you to launch Claude Code sessions, manage their lifecycle,
// and process their output in various formats (text, JSON, or streaming JSON).
//
// Basic usage:
//
//	client, err := claudecode.NewClient()
//	if err != nil {
//	    log.Fatal(err)
//	}
//
//	result, err := client.LaunchAndWait(claudecode.SessionConfig{
//	    Prompt: "Write a hello world function",
//	})
//	fmt.Println(result.Result)
//
// For streaming output:
//
//	session, err := client.Launch(claudecode.SessionConfig{
//	    Prompt:       "Build a web server",
//	    OutputFormat: claudecode.OutputStreamJSON,
//	})
//
//	for event := range session.Events {
//	    // Process events as they arrive
//	}
//
// The SDK supports all Claude Code CLI options including MCP servers,
// session resumption, and custom system prompts.
package claudecode
