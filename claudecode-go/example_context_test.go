package claudecode_test

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/humanlayer/humanlayer/claudecode-go"
)

func ExampleSession_WaitContext() {
	// Create a new client
	client, err := claudecode.NewClient()
	if err != nil {
		log.Fatal(err)
	}

	// Configure a session
	config := claudecode.SessionConfig{
		Query:        "What is 2+2?",
		Model:        claudecode.ModelSonnet,
		OutputFormat: claudecode.OutputJSON,
	}

	// Launch the session
	session, err := client.Launch(config)
	if err != nil {
		log.Fatal(err)
	}

	// Create a context with a 30-second timeout
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Wait for completion with context
	result, err := session.WaitContext(ctx)
	if err != nil {
		log.Printf("Session failed: %v", err)
		return
	}

	fmt.Printf("Result: %s\n", result.Result)
}

func ExampleClient_LaunchAndWait_withTimeout() {
	// Create a new client
	client, err := claudecode.NewClient()
	if err != nil {
		log.Fatal(err)
	}

	// Configure a session with a timeout
	config := claudecode.SessionConfig{
		Query:        "Write a long story",
		Model:        claudecode.ModelSonnet,
		OutputFormat: claudecode.OutputJSON,
		Timeout:      10 * time.Second, // Timeout after 10 seconds
	}

	// Launch and wait - will timeout after 10 seconds
	result, err := client.LaunchAndWait(config)
	if err != nil {
		// Will print: "session timed out after 10s"
		log.Printf("Session failed: %v", err)
		return
	}

	fmt.Printf("Result: %s\n", result.Result)
}

func ExampleClient_LaunchAndWaitContext() {
	// Create a new client
	client, err := claudecode.NewClient()
	if err != nil {
		log.Fatal(err)
	}

	// Create a cancellable context
	ctx, cancel := context.WithCancel(context.Background())

	// Cancel after 5 seconds
	go func() {
		time.Sleep(5 * time.Second)
		cancel()
	}()

	// Configure a session
	config := claudecode.SessionConfig{
		Query:        "Count to 100 slowly",
		Model:        claudecode.ModelSonnet,
		OutputFormat: claudecode.OutputJSON,
	}

	// Launch and wait with context
	result, err := client.LaunchAndWaitContext(ctx, config)
	if err != nil {
		// Will print: "session cancelled: context canceled"
		log.Printf("Session failed: %v", err)
		return
	}

	fmt.Printf("Result: %s\n", result.Result)
}
