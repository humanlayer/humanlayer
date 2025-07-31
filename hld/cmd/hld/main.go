package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/humanlayer/humanlayer/hld/daemon"
)

func main() {
	// Parse command line flags
	debug := flag.Bool("debug", false, "Enable debug logging")
	flag.Parse()

	// Set up structured logging
	level := slog.LevelInfo
	if *debug || os.Getenv("HUMANLAYER_DEBUG") == "true" {
		level = slog.LevelDebug
	}
	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{
		Level: level,
	}))
	slog.SetDefault(logger)

	if level == slog.LevelDebug {
		slog.Debug("debug logging enabled")
	}

	// Create daemon instance
	d, err := daemon.New()
	if err != nil {
		slog.Error("failed to create daemon", "error", err)
		os.Exit(1)
	}

	// Set up signal handling with modern pattern
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// Run the daemon
	if err := d.Run(ctx); err != nil {
		slog.Error("daemon error", "error", err)
		os.Exit(1)
	}

	// After first signal, allow force quit on second signal
	stop()
	slog.Info("shutting down gracefully, press Ctrl+C again to force")
	slog.Info("daemon shutdown complete")
}
