#!/usr/bin/env bash

# Check if a port is available (returns 0 if available, 1 if in use)
is_port_available() {
    local port=$1

    # Prefer lsof as it correctly detects both IPv4 and IPv6
    if command -v lsof >/dev/null 2>&1; then
        # lsof returns 0 if port found = in use
        ! lsof -i :"$port" >/dev/null 2>&1
    elif command -v nc >/dev/null 2>&1; then
        # Check both IPv4 and IPv6 with netcat
        # If either succeeds (port in use), the port is not available
        if nc -z 127.0.0.1 "$port" 2>/dev/null || nc -z ::1 "$port" 2>/dev/null; then
            return 1  # Port is in use
        else
            return 0  # Port is available
        fi
    else
        # If neither tool available, assume port is available
        return 0
    fi
}

# Find available port for daemon (avoids 10000-19999 range used by Vite)
find_available_port() {
    local ticket_num=$1

    # Try the ticket number directly first
    if is_port_available "$ticket_num"; then
        echo "$ticket_num"
        return 0
    fi

    # Try ports in 20000-29999 range to avoid Vite's 10000-19999 range
    for offset in 0 1000 2000 3000 4000 5000 6000 7000 8000 9000; do
        local port=$((20000 + ((ticket_num + offset) % 10000)))

        # Skip if port would exceed our range
        if [ "$port" -gt 29999 ]; then
            break
        fi

        if is_port_available "$port"; then
            echo "$port"
            return 0
        fi
    done

    # Fallback to 40000-49999 range if needed
    for offset in 0 1000 2000 3000 4000 5000 6000 7000 8000 9000; do
        local port=$((40000 + ((ticket_num + offset) % 10000)))

        # Skip if port would exceed our range or maximum valid port
        if [ "$port" -gt 49999 ] || [ "$port" -gt 65535 ]; then
            break
        fi

        if is_port_available "$port"; then
            echo "$port"
            return 0
        fi
    done

    # If all attempts fail, return error
    echo "ERROR: Could not find available port for ticket $ticket_num" >&2
    return 1
}

# Extract ticket number from ticket ID (e.g., ENG-2114 -> 2114)
extract_ticket_number() {
    local ticket=$1
    echo "$ticket" | sed 's/.*-//'
}

# Find available Vite port (uses 10000-19999 and 30000-39999 ranges)
find_available_vite_port() {
    local ticket_num=$1
    local daemon_port=$2  # Optional daemon port to avoid
    local vite_base=$((ticket_num + 10000))

    # If base port is valid, available, and not the daemon port, use it
    if [ "$vite_base" -le 19999 ] && [ "$vite_base" != "$daemon_port" ] && is_port_available "$vite_base"; then
        echo "$vite_base"
        return 0
    fi

    # Try ports in the 30000-39999 range
    for offset in 0 1000 2000 3000 4000 5000 6000 7000 8000 9000; do
        local port=$((30000 + ((ticket_num + offset) % 10000)))

        # Skip if port would exceed our range
        if [ "$port" -gt 39999 ]; then
            break
        fi

        if [ "$port" != "$daemon_port" ] && is_port_available "$port"; then
            echo "$port"
            return 0
        fi
    done

    # Fallback to 50000-59999 range if needed
    for offset in 0 1000 2000 3000 4000 5000 6000 7000 8000 9000; do
        local port=$((50000 + ((ticket_num + offset) % 10000)))

        # Skip if port would exceed our range or maximum valid port
        if [ "$port" -gt 59999 ] || [ "$port" -gt 65535 ]; then
            break
        fi

        if [ "$port" != "$daemon_port" ] && is_port_available "$port"; then
            echo "$port"
            return 0
        fi
    done

    echo "ERROR: Could not find available Vite port for ticket $ticket_num" >&2
    return 1
}