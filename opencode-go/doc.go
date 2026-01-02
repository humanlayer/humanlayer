// Package opencode provides a Go SDK for programmatically interacting with OpenCode,
// an AI coding assistant that supports multiple LLM providers.
//
// This package allows you to launch OpenCode sessions, manage their lifecycle,
// and process their output in various formats (text or streaming JSON).
//
// Basic usage:
//
//	client, err := opencode.NewClient()
//	if err != nil {
//	    log.Fatal(err)
//	}
//
//	result, err := client.LaunchAndWait(opencode.SessionConfig{
//	    Query: "Write a hello world function",
//	})
//	fmt.Println(result.Result)
//
// For streaming output:
//
//	session, err := client.Launch(opencode.SessionConfig{
//	    Query:        "Build a web server",
//	    OutputFormat: opencode.OutputJSON,
//	})
//
//	for event := range session.Events {
//	    // Process events as they arrive
//	}
//
// The SDK supports OpenCode CLI options including session resumption,
// model selection, and file attachments.
package opencode
