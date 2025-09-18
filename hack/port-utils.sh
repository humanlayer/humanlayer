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

        # Skip if port would exceed maximum valid port number
        if [ "$port" -gt 65535 ]; then
            continue
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

# Find available Vite port with a different strategy to avoid exceeding port limits
find_available_vite_port() {
    local ticket_num=$1
    local vite_base=$((ticket_num + 10000))

    # If base port is valid and available, use it
    if [ "$vite_base" -le 65535 ] && is_port_available "$vite_base"; then
        echo "$vite_base"
        return 0
    fi

    # For high ticket numbers or if base is taken, use a different strategy
    # Try ports in the 30000-65000 range with offsets
    for offset in 0 100 200 300 400 500 600 700 800 900; do
        local port=$((30000 + (ticket_num % 30000) + offset))
        if [ "$port" -le 65535 ] && is_port_available "$port"; then
            echo "$port"
            return 0
        fi
    done

    # If still no port found, try the 40000-50000 range
    for offset in 0 1 2 3 4 5 6 7 8 9; do
        local port=$((40000 + (ticket_num % 10000) + offset * 100))
        if [ "$port" -le 65535 ] && is_port_available "$port"; then
            echo "$port"
            return 0
        fi
    done

    echo "ERROR: Could not find available Vite port for ticket $ticket_num" >&2
    return 1
}