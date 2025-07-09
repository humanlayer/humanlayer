---
component_name: Client Implementation Guide
component_type: interface
location: hld/client/
analyzed_date: 2025-06-26
dependencies: []
dependents: [hlyr, tui, wui]
test_coverage: n/a
---

# HLD Client Implementation Guide (Any Language)

## Overview

This guide provides step-by-step instructions for implementing a client library that communicates with the HumanLayer Daemon in any programming language.

## Client Architecture

```
┌─────────────────────────────────────────────────────┐
│                 Client Library                       │
├─────────────────────────────────────────────────────┤
│  Connection     │  Protocol      │  API Methods     │
│  Manager        │  Handler       │  ├─ launchSession│
│  ├─ connect    │  ├─ encode     │  ├─ listSessions│
│  ├─ disconnect │  ├─ decode     │  ├─ getState    │
│  └─ reconnect  │  └─ validate   │  └─ ...         │
├─────────────────────────────────────────────────────┤
│           Unix Domain Socket Transport               │
└─────────────────────────────────────────────────────┘
```

## 1. Connection Management

### Socket Connection
```python
# Python example (adapt to your language)
class Connection:
    def __init__(self, socket_path="~/.humanlayer/daemon.sock"):
        self.socket_path = os.path.expanduser(socket_path)
        self.socket = None
        self.reader = None
        self.writer = None
        self.request_id = 0
    
    def connect(self):
        # Create Unix domain socket
        self.socket = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        
        # Set socket options
        self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 1048576)
        self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 1048576)
        
        # Connect to daemon
        self.socket.connect(self.socket_path)
        
        # Create buffered reader/writer
        self.reader = self.socket.makefile('rb', buffering=1048576)
        self.writer = self.socket.makefile('wb', buffering=0)
    
    def disconnect(self):
        if self.socket:
            self.socket.close()
```

### Connection Pooling
```python
class ConnectionPool:
    def __init__(self, socket_path, max_connections=10):
        self.socket_path = socket_path
        self.max_connections = max_connections
        self.available = queue.Queue(maxsize=max_connections)
        self.in_use = set()
    
    def get_connection(self):
        try:
            conn = self.available.get_nowait()
        except queue.Empty:
            if len(self.in_use) < self.max_connections:
                conn = Connection(self.socket_path)
                conn.connect()
            else:
                conn = self.available.get(timeout=30)
        
        self.in_use.add(conn)
        return conn
    
    def return_connection(self, conn):
        self.in_use.remove(conn)
        self.available.put(conn)
```

## 2. Protocol Implementation

### Message Encoding
```python
def encode_request(method, params, request_id):
    request = {
        "jsonrpc": "2.0",
        "method": method,
        "params": params or {},
        "id": request_id
    }
    # Convert to JSON and add newline
    return json.dumps(request).encode('utf-8') + b'\n'
```

### Message Decoding
```python
def decode_response(line):
    # Remove trailing newline and decode
    json_str = line.rstrip(b'\n').decode('utf-8')
    response = json.loads(json_str)
    
    # Validate JSON-RPC format
    if response.get("jsonrpc") != "2.0":
        raise ProtocolError("Invalid JSON-RPC version")
    
    return response
```

### Request-Response Correlation
```python
class Client:
    def __init__(self, connection):
        self.connection = connection
        self.pending_requests = {}
        self.next_id = 1
    
    def send_request(self, method, params=None):
        request_id = self.next_id
        self.next_id += 1
        
        # Encode and send
        message = encode_request(method, params, request_id)
        self.connection.writer.write(message)
        self.connection.writer.flush()
        
        # Wait for response
        line = self.connection.reader.readline()
        if not line:
            raise ConnectionError("Connection closed")
        
        response = decode_response(line)
        
        # Validate response ID
        if response.get("id") != request_id:
            raise ProtocolError("Response ID mismatch")
        
        # Check for error
        if "error" in response:
            raise RPCError(
                code=response["error"]["code"],
                message=response["error"]["message"],
                data=response["error"].get("data")
            )
        
        return response.get("result")
```

## 3. API Method Implementations

### Basic Methods
```python
class HLDClient:
    def __init__(self, socket_path="~/.humanlayer/daemon.sock"):
        self.connection = Connection(socket_path)
        self.connection.connect()
        self.client = Client(self.connection)
    
    def health(self):
        """Check daemon health."""
        return self.client.send_request("health")
    
    def launch_session(self, query, **kwargs):
        """Launch a new Claude session."""
        params = {"query": query}
        params.update(kwargs)  # model, mcp_config, etc.
        return self.client.send_request("launchSession", params)
    
    def list_sessions(self):
        """List all sessions."""
        return self.client.send_request("listSessions")
    
    def get_session_state(self, session_id):
        """Get session details."""
        return self.client.send_request("getSessionState", {
            "session_id": session_id
        })
    
    def get_conversation(self, session_id=None, claude_session_id=None):
        """Get conversation history."""
        if not session_id and not claude_session_id:
            raise ValueError("Either session_id or claude_session_id required")
        
        params = {}
        if session_id:
            params["session_id"] = session_id
        if claude_session_id:
            params["claude_session_id"] = claude_session_id
        
        return self.client.send_request("getConversation", params)
    
    def continue_session(self, session_id, query, **kwargs):
        """Continue from existing session."""
        params = {
            "session_id": session_id,
            "query": query
        }
        params.update(kwargs)
        return self.client.send_request("continueSession", params)
    
    def interrupt_session(self, session_id):
        """Interrupt a running session."""
        return self.client.send_request("interruptSession", {
            "session_id": session_id
        })
    
    def fetch_approvals(self, session_id=None):
        """Fetch pending approvals."""
        params = {}
        if session_id:
            params["session_id"] = session_id
        return self.client.send_request("fetchApprovals", params)
    
    def send_decision(self, call_id, type_, decision, comment=None):
        """Send approval decision."""
        params = {
            "call_id": call_id,
            "type": type_,
            "decision": decision
        }
        if comment:
            params["comment"] = comment
        return self.client.send_request("sendDecision", params)
```

### Subscription Implementation
```python
class Subscription:
    def __init__(self, client, connection):
        self.client = client
        self.connection = connection
        self.running = False
        self.event_handlers = {}
    
    def subscribe(self, event_types=None, session_id=None, run_id=None):
        """Start subscription."""
        params = {}
        if event_types:
            params["event_types"] = event_types
        if session_id:
            params["session_id"] = session_id
        if run_id:
            params["run_id"] = run_id
        
        # Send subscription request
        response = self.client.send_request("Subscribe", params)
        self.subscription_id = response["subscription_id"]
        self.running = True
        
        # Start event loop
        return self._event_loop()
    
    def _event_loop(self):
        """Yield events as they arrive."""
        while self.running:
            try:
                # Read next message (with timeout)
                line = self._read_with_timeout(35)  # 30s heartbeat + buffer
                if not line:
                    continue
                
                message = decode_response(line)
                result = message.get("result", {})
                
                # Handle heartbeat
                if result.get("type") == "heartbeat":
                    continue
                
                # Yield event
                if "event" in result:
                    yield result["event"]
                    
            except TimeoutError:
                # No heartbeat received
                raise ConnectionError("Subscription timeout")
            except Exception as e:
                self.running = False
                raise
    
    def unsubscribe(self):
        """Stop subscription."""
        self.running = False
        self.connection.disconnect()
```

## 4. Error Handling

### Error Types
```python
class RPCError(Exception):
    """JSON-RPC error."""
    def __init__(self, code, message, data=None):
        self.code = code
        self.message = message
        self.data = data
        super().__init__(f"RPC Error {code}: {message}")

class ConnectionError(Exception):
    """Connection-related error."""
    pass

class ProtocolError(Exception):
    """Protocol violation error."""
    pass

class TimeoutError(Exception):
    """Operation timeout."""
    pass
```

### Error Handling Strategy
```python
def with_retry(func, max_attempts=3, backoff_factor=2):
    """Retry with exponential backoff."""
    attempt = 0
    delay = 1
    
    while attempt < max_attempts:
        try:
            return func()
        except ConnectionError as e:
            attempt += 1
            if attempt >= max_attempts:
                raise
            time.sleep(delay)
            delay *= backoff_factor
        except RPCError as e:
            # Don't retry RPC errors
            raise
```

## 5. Complete Example Usage

```python
# Initialize client
client = HLDClient()

try:
    # Check health
    health = client.health()
    print(f"Daemon status: {health['status']}")
    
    # Launch session
    session = client.launch_session(
        query="Help me build a REST API",
        model="opus",
        working_dir="/home/user/project"
    )
    print(f"Session started: {session['session_id']}")
    
    # Subscribe to events
    subscription = Subscription(client, Connection())
    for event in subscription.subscribe(
        event_types=["session_status_changed", "new_approval"],
        session_id=session['session_id']
    ):
        print(f"Event: {event['type']}")
        
        if event['type'] == 'new_approval':
            # Handle approval
            approvals = client.fetch_approvals(session['session_id'])
            for approval in approvals['approvals']:
                if approval['function_name'] == 'dangerous_function':
                    client.send_decision(
                        approval['call_id'],
                        'function_call',
                        'deny',
                        'Too risky'
                    )
                else:
                    client.send_decision(
                        approval['call_id'],
                        'function_call',
                        'approve'
                    )
        
        elif event['type'] == 'session_status_changed':
            if event['data']['new_status'] == 'completed':
                break
    
    # Get final conversation
    conversation = client.get_conversation(session_id=session['session_id'])
    for event in conversation['events']:
        if event['event_type'] == 'message':
            print(f"{event['role']}: {event['content']}")

finally:
    client.close()
```

## 6. Language-Specific Considerations

### Python
- Use `socket` module for Unix sockets
- Use `json` module for JSON encoding
- Use `threading` for concurrent operations

### JavaScript/Node.js
```javascript
const net = require('net');
const client = net.createConnection('/tmp/daemon.sock');
client.on('data', (data) => {
    const lines = data.toString().split('\n');
    lines.forEach(line => {
        if (line) {
            const response = JSON.parse(line);
            // Handle response
        }
    });
});
```

### Java
```java
import java.nio.channels.SocketChannel;
import java.nio.file.Paths;
import jnr.unixsocket.UnixSocketAddress;
import jnr.unixsocket.UnixSocketChannel;

UnixSocketChannel channel = UnixSocketChannel.open();
channel.connect(new UnixSocketAddress("/tmp/daemon.sock"));
```

### Go
```go
import "net"

conn, err := net.Dial("unix", "/tmp/daemon.sock")
if err != nil {
    return err
}
defer conn.Close()
```

### Rust
```rust
use std::os::unix::net::UnixStream;

let stream = UnixStream::connect("/tmp/daemon.sock")?;
```

## 7. Testing Your Client

### Unit Tests
```python
def test_encode_request():
    encoded = encode_request("test", {"param": "value"}, 1)
    expected = b'{"jsonrpc":"2.0","method":"test","params":{"param":"value"},"id":1}\n'
    assert encoded == expected

def test_decode_response():
    line = b'{"jsonrpc":"2.0","result":{"status":"ok"},"id":1}\n'
    response = decode_response(line)
    assert response["result"]["status"] == "ok"
```

### Integration Tests
```python
def test_health_check():
    client = HLDClient()
    result = client.health()
    assert result["status"] == "ok"
    assert "version" in result
```

### Mock Server
```python
class MockDaemon:
    def __init__(self, socket_path):
        self.socket_path = socket_path
        self.handlers = {
            "health": lambda p: {"status": "ok", "version": "0.1.0"},
            "listSessions": lambda p: {"sessions": []},
        }
    
    def handle_request(self, request):
        method = request["method"]
        params = request.get("params", {})
        
        if method in self.handlers:
            result = self.handlers[method](params)
            return {
                "jsonrpc": "2.0",
                "result": result,
                "id": request["id"]
            }
        else:
            return {
                "jsonrpc": "2.0",
                "error": {
                    "code": -32601,
                    "message": "Method not found"
                },
                "id": request["id"]
            }
```

## 8. Performance Optimization

1. **Connection Reuse**: Keep connections open for multiple requests
2. **Buffering**: Use buffered I/O for better performance
3. **Async I/O**: Use async/await or callbacks for non-blocking operations
4. **Message Batching**: Send multiple requests in one connection
5. **Compression**: Not needed for Unix sockets (local communication)

## 9. Debugging Tips

1. **Enable Debug Logging**: Set `HUMANLAYER_DEBUG=true`
2. **Monitor Socket**: Use `socat` to inspect traffic
3. **Check Permissions**: Ensure socket file has correct permissions
4. **Validate JSON**: Use JSON validator on messages
5. **Test Incrementally**: Start with health check, then build up