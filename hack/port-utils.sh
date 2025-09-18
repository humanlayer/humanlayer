#!/usr/bin/env bash

# Check if a port is available (returns 0 if available, 1 if in use)
is_port_available() {
    local port=$1
    if command -v nc >/dev/null 2>&1; then
        # Use netcat to check port (nc returns 0 if connection succeeds = port in use)
        ! nc -z 127.0.0.1 "$port" 2>/dev/null
    elif command -v lsof >/dev/null 2>&1; then
        # Fallback to lsof (returns 0 if port found = in use)
        ! lsof -i :"$port" >/dev/null 2>&1
    else
        # If neither tool available, assume port is available
        return 0
    fi
}

# Find available port using progressive prefix fallback
find_available_port() {
    local ticket_num=$1

    # Try the ticket number directly first
    if is_port_available "$ticket_num"; then
        echo "$ticket_num"
        return 0
    fi

    # Try with progressive prefixes (1-6)
    for prefix in 1 2 3 4 5 6; do
        local port="${prefix}${ticket_num}"
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

# Find available Vite port (adds 10000 to ticket number and uses same fallback)
find_available_vite_port() {
    local ticket_num=$1
    local vite_base=$((ticket_num + 10000))
    find_available_port "$vite_base"
}