#!/bin/bash
# This script runs the daemon with logging while properly forwarding signals

# Get log file from first argument
LOG_FILE="$1"
shift

# Start the daemon in the background
"$@" 2>&1 | tee -a "$LOG_FILE" &

# Get the PID of the daemon (first process in the pipeline)
DAEMON_PID=$(jobs -p | head -1)

# Forward signals to the daemon
trap 'kill -TERM $DAEMON_PID 2>/dev/null' TERM INT

# Wait for the daemon to exit
wait $DAEMON_PID
EXIT_CODE=$?

# Give tee a moment to flush
sleep 0.1

exit $EXIT_CODE
