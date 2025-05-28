package claudecode_test

import (
	"fmt"
	"log"
	
	"github.com/humanlayer/humanlayer/claudecode-go"
)

func ExampleClient_LaunchAndWait() {
	// Create a new client
	client, err := claudecode.NewClient()
	if err != nil {
		log.Fatal(err)
	}
	
	// Simple text output
	result, err := client.LaunchAndWait(claudecode.SessionConfig{
		Prompt:       "Write a hello world function in Go",
		OutputFormat: claudecode.OutputText,
	})
	if err != nil {
		log.Fatal(err)
	}
	
	fmt.Println("Claude says:", result.Result)
}

func ExampleClient_Launch_streaming() {
	// Create a new client
	client, err := claudecode.NewClient()
	if err != nil {
		log.Fatal(err)
	}
	
	// Launch with streaming JSON
	session, err := client.Launch(claudecode.SessionConfig{
		Prompt:       "Build a REST API",
		Model:        claudecode.ModelSonnet,
		OutputFormat: claudecode.OutputStreamJSON,
		MaxTurns:     5,
	})
	if err != nil {
		log.Fatal(err)
	}
	
	// Process events as they arrive
	for event := range session.Events {
		switch event.Type {
		case "system":
			if event.Subtype == "init" {
				fmt.Printf("Session started: %s\n", event.SessionID)
				fmt.Printf("Available tools: %v\n", event.Tools)
			}
		case "assistant":
			// Handle assistant messages
			if event.Message != nil && len(event.Message.Content) > 0 {
				fmt.Printf("Assistant: %s\n", event.Message.Content[0].Text)
			}
		case "result":
			fmt.Printf("Completed! Cost: $%.4f\n", event.CostUSD)
		}
	}
	
	// Wait for completion
	result, err := session.Wait()
	if err != nil {
		log.Fatal(err)
	}
	
	fmt.Printf("Session %s completed in %dms\n", result.SessionID, result.DurationMS)
}

func ExampleClient_Launch_withMCP() {
	client, err := claudecode.NewClient()
	if err != nil {
		log.Fatal(err)
	}
	
	// Configure MCP server for approvals
	mcpConfig := &claudecode.MCPConfig{
		MCPServers: map[string]claudecode.MCPServer{
			"approvals": {
				Command: "npm",
				Args:    []string{"run", "dev", "mcp", "claude_approvals"},
			},
			"filesystem": {
				Command: "npx",
				Args:    []string{"-y", "@modelcontextprotocol/server-filesystem", "/tmp"},
			},
		},
	}
	
	// Launch with MCP and approvals
	session, err := client.Launch(claudecode.SessionConfig{
		Prompt:               "Delete all files in /tmp",
		OutputFormat:         claudecode.OutputStreamJSON,
		MCPConfig:            mcpConfig,
		PermissionPromptTool: "mcp__approvals__request_permission",
		AllowedTools:         []string{"mcp__filesystem__*", "mcp__approvals__*"},
	})
	if err != nil {
		log.Fatal(err)
	}
	
	// Process events
	for event := range session.Events {
		// Handle events...
		_ = event
	}
	
	result, err := session.Wait()
	if err != nil {
		log.Fatal(err)
	}
	
	fmt.Printf("Completed with %d turns\n", result.NumTurns)
}

func ExampleSessionConfig_resume() {
	client, err := claudecode.NewClient()
	if err != nil {
		log.Fatal(err)
	}
	
	// Resume a previous session
	result, err := client.LaunchAndWait(claudecode.SessionConfig{
		SessionID:    "550e8400-e29b-41d4-a716-446655440000",
		Prompt:       "Add error handling to the previous code",
		OutputFormat: claudecode.OutputJSON,
	})
	if err != nil {
		log.Fatal(err)
	}
	
	fmt.Printf("Resumed session cost: $%.4f\n", result.CostUSD)
}