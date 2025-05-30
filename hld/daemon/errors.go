package daemon

import "errors"

// ErrDaemonAlreadyRunning is returned when attempting to start a daemon when one is already running
var ErrDaemonAlreadyRunning = errors.New("daemon already running")
