package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/humanlayer/humanlayer/hld/daemon"
)

func main() {
	// Set up structured logging
	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	// Create daemon instance
	d, err := daemon.New()
	if err != nil {
		slog.Error("failed to create daemon", "error", err)
		os.Exit(1)
	}

	// Set up signal handling for graceful shutdown
	ctx, cancel := context.WithCancel(context.Background())
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		sig := <-sigChan
		slog.Info("received signal, shutting down", "signal", sig)
		cancel()
	}()

	// Run the daemon
	if err := d.Run(ctx); err != nil {
		slog.Error("daemon error", "error", err)
		os.Exit(1)
	}

	slog.Info("daemon shutdown complete")
}