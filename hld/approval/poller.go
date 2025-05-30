package approval

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"
)

// Poller polls the HumanLayer API for pending approvals
type Poller struct {
	client        APIClient
	store         Store
	interval      time.Duration
	maxBackoff    time.Duration
	backoffFactor float64
	mu            sync.Mutex
	cancel        context.CancelFunc
	failureCount  int
}

// NewPoller creates a new approval poller
func NewPoller(client APIClient, store Store, interval time.Duration) *Poller {
	if interval <= 0 {
		interval = 5 * time.Second
	}
	return &Poller{
		client:        client,
		store:         store,
		interval:      interval,
		maxBackoff:    5 * time.Minute,
		backoffFactor: 2.0,
		failureCount:  0,
	}
}

// Start begins polling for approvals
func (p *Poller) Start(ctx context.Context) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.cancel != nil {
		return fmt.Errorf("poller already started")
	}

	ctx, cancel := context.WithCancel(ctx)
	p.cancel = cancel

	go p.pollLoop(ctx)
	slog.Info("approval poller started", "interval", p.interval)
	return nil
}

// Stop stops the polling loop
func (p *Poller) Stop() {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.cancel != nil {
		p.cancel()
		p.cancel = nil
		slog.Info("approval poller stopped")
	}
}

// IsRunning returns true if the poller is currently running
func (p *Poller) IsRunning() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.cancel != nil
}

// pollLoop continuously polls for approvals
func (p *Poller) pollLoop(ctx context.Context) {
	// Poll immediately on start
	p.poll(ctx)

	for {
		// Calculate next poll interval based on failure count
		interval := p.calculateInterval()

		select {
		case <-ctx.Done():
			return
		case <-time.After(interval):
			p.poll(ctx)
		}
	}
}

// calculateInterval returns the next polling interval with exponential backoff
func (p *Poller) calculateInterval() time.Duration {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.failureCount == 0 {
		return p.interval
	}

	// Calculate backoff: interval * (backoffFactor ^ failureCount)
	backoff := float64(p.interval)
	for i := 0; i < p.failureCount; i++ {
		backoff *= p.backoffFactor
		if time.Duration(backoff) > p.maxBackoff {
			return p.maxBackoff
		}
	}

	return time.Duration(backoff)
}

// poll fetches and stores pending approvals
func (p *Poller) poll(ctx context.Context) {
	// Create a timeout context for this poll
	pollCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	var hadError bool

	// Fetch function calls
	functionCalls, err := p.client.GetPendingFunctionCalls(pollCtx)
	if err != nil {
		slog.Error("failed to fetch function calls", "error", err)
		hadError = true
	} else {
		for _, fc := range functionCalls {
			if err := p.store.StoreFunctionCall(fc); err != nil {
				slog.Error("failed to store function call", "call_id", fc.CallID, "error", err)
			}
		}
		slog.Debug("fetched function calls", "count", len(functionCalls))
	}

	// Fetch human contacts
	humanContacts, err := p.client.GetPendingHumanContacts(pollCtx)
	if err != nil {
		slog.Error("failed to fetch human contacts", "error", err)
		hadError = true
	} else {
		for _, hc := range humanContacts {
			if err := p.store.StoreHumanContact(hc); err != nil {
				slog.Error("failed to store human contact", "call_id", hc.CallID, "error", err)
			}
		}
		slog.Debug("fetched human contacts", "count", len(humanContacts))
	}

	// Update failure count based on results
	p.updateFailureCount(hadError)
}

// updateFailureCount updates the failure count for backoff calculation
func (p *Poller) updateFailureCount(hadError bool) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if hadError {
		p.failureCount++
		nextInterval := p.calculateIntervalLocked()
		slog.Warn("poll failed, backing off",
			"failure_count", p.failureCount,
			"next_interval", nextInterval)
	} else {
		if p.failureCount > 0 {
			slog.Info("poll succeeded, resetting backoff")
			p.failureCount = 0
		}
	}
}

// calculateIntervalLocked returns the next interval (must be called with lock held)
func (p *Poller) calculateIntervalLocked() time.Duration {
	if p.failureCount == 0 {
		return p.interval
	}

	// Calculate backoff: interval * (backoffFactor ^ failureCount)
	backoff := float64(p.interval)
	for i := 0; i < p.failureCount; i++ {
		backoff *= p.backoffFactor
		if time.Duration(backoff) > p.maxBackoff {
			return p.maxBackoff
		}
	}

	return time.Duration(backoff)
}
