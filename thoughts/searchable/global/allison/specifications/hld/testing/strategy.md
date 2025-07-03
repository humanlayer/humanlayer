---
component_name: Testing Strategy
component_type: documentation
location: hld/
analyzed_date: 2025-06-26
dependencies: [testify, mockgen]
dependents: [all_components]
test_coverage: 80
---

# HLD Testing Strategy and Patterns

## Overview

This document describes the comprehensive testing strategy employed in the HumanLayer Daemon (hld) project. The approach emphasizes both unit and integration testing with clear separation and appropriate use of mocks.

## Testing Philosophy

1. **Co-location**: Tests live alongside source code
2. **Isolation**: Each test is independent and creates its own resources
3. **Coverage**: Both happy paths and error scenarios
4. **Clarity**: Descriptive test names and table-driven tests
5. **Performance**: Race condition detection for concurrent code

## Testing Stack

### Core Tools
- **Framework**: Go's built-in `testing` package
- **Assertions**: `github.com/stretchr/testify` (v1.10.0)
- **Mocking**: `go.uber.org/mock` (v0.5.2) with `mockgen`
- **Race Detection**: `go test -race`

### Build Infrastructure
- **Make targets**: Automated test execution
- **Build tags**: Separation of integration tests
- **CI/CD**: Automated testing in GitHub Actions

## Test Organization

### Directory Structure
```
hld/
├── component/
│   ├── file.go                    # Source code
│   ├── file_test.go              # Unit tests
│   ├── file_integration_test.go  # Integration tests
│   └── mock_component.go         # Generated mocks
```

### Test Types

#### 1. Unit Tests
- **Files**: `*_test.go`
- **Focus**: Individual functions and methods
- **Dependencies**: Mocked
- **Execution**: Fast, no external dependencies

Example:
```go
func TestManager_LaunchSession(t *testing.T) {
    ctrl := gomock.NewController(t)
    defer ctrl.Finish()
    
    mockStore := store.NewMockStore(ctrl)
    mockStore.EXPECT().CreateSession(gomock.Any(), gomock.Any()).Return(nil)
    
    manager := NewManager(logger, mockStore, eventBus)
    session, err := manager.LaunchSession(ctx, params)
    
    require.NoError(t, err)
    require.NotNil(t, session)
}
```

#### 2. Integration Tests
- **Files**: `*_integration_test.go`
- **Build Tag**: `//go:build integration`
- **Focus**: Component interactions
- **Dependencies**: Real implementations
- **Execution**: Slower, may need setup

Example:
```go
//go:build integration

func TestDaemon_FullLifecycle(t *testing.T) {
    // Create real daemon with temporary resources
    socketPath := testutil.CreateTestSocket(t)
    dbPath := filepath.Join(t.TempDir(), "test.db")
    
    daemon, err := daemon.New(&config.Config{
        SocketPath:   socketPath,
        DatabasePath: dbPath,
    })
    require.NoError(t, err)
    
    // Test full lifecycle
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()
    
    go daemon.Run(ctx)
    // ... test operations ...
}
```

## Testing Patterns

### 1. Table-Driven Tests
```go
func TestValidateDecision(t *testing.T) {
    tests := []struct {
        name     string
        decision Decision
        wantErr  bool
    }{
        {
            name: "valid approve",
            decision: Decision{
                Type:     "function_call",
                Decision: "approve",
            },
            wantErr: false,
        },
        {
            name: "invalid decision type",
            decision: Decision{
                Type:     "function_call",
                Decision: "invalid",
            },
            wantErr: true,
        },
    }
    
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            err := validateDecision(tt.decision)
            if tt.wantErr {
                require.Error(t, err)
            } else {
                require.NoError(t, err)
            }
        })
    }
}
```

### 2. Mock Generation and Usage

#### Makefile Target
```makefile
mocks:
	@echo "Generating mocks..."
	cd approval && mockgen -source=types.go -destination=mock_approval.go -package=approval
	cd bus && mockgen -source=types.go -destination=mock_bus.go -package=bus
	cd client && mockgen -source=types.go -destination=mock_client.go -package=client
	cd session && mockgen -source=types.go -destination=mock_session.go -package=session
	cd store && mockgen -source=store.go -destination=mock_store.go -package=store
```

#### Mock Usage
```go
ctrl := gomock.NewController(t)
defer ctrl.Finish()

mockClient := client.NewMockClient(ctrl)
mockClient.EXPECT().
    FetchApprovals(gomock.Any(), "run_123").
    Return([]*types.Approval{approval}, nil)
```

### 3. Test Helpers

#### Socket Management
```go
// internal/testutil/socket.go
func CreateTestSocket(t *testing.T) string {
    t.Helper()
    socketPath := fmt.Sprintf("/tmp/hld_test_%d.sock", os.Getpid())
    t.Cleanup(func() {
        os.Remove(socketPath)
    })
    return socketPath
}
```

#### Temporary Resources
```go
func setupTestDB(t *testing.T) *sql.DB {
    dbPath := filepath.Join(t.TempDir(), "test.db")
    db, err := sql.Open("sqlite3", dbPath)
    require.NoError(t, err)
    t.Cleanup(func() {
        db.Close()
    })
    return db
}
```

### 4. Concurrent Testing
```go
func TestEventBus_ConcurrentPublishSubscribe(t *testing.T) {
    bus := NewEventBus(logger)
    defer bus.Close()
    
    var wg sync.WaitGroup
    errors := make(chan error, 10)
    
    // Multiple publishers
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            for j := 0; j < 100; j++ {
                bus.Publish(Event{
                    Type: EventNewApproval,
                    Data: fmt.Sprintf("event_%d_%d", id, j),
                })
            }
        }(i)
    }
    
    // Multiple subscribers
    for i := 0; i < 3; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            events := bus.Subscribe([]EventType{EventNewApproval}, nil)
            count := 0
            for range events {
                count++
                if count >= 100 {
                    break
                }
            }
        }(i)
    }
    
    wg.Wait()
}
```

## Test Execution

### Make Targets
```makefile
test: test-unit test-integration

test-unit:
	go test ./... -v

test-integration:
	go test ./... -tags=integration -v

test-race:
	go test ./... -race -v

coverage:
	go test ./... -coverprofile=coverage.out
	go tool cover -html=coverage.out
```

### CI/CD Pipeline
```yaml
- name: Run Tests
  run: |
    make mocks
    make test-unit
    make test-integration
    make test-race
```

## Best Practices

### 1. Test Independence
- Each test creates its own resources
- No shared state between tests
- Proper cleanup with `t.Cleanup()`

### 2. Error Testing
```go
// Test both success and failure paths
t.Run("success", func(t *testing.T) {
    result, err := function(validInput)
    require.NoError(t, err)
    require.Equal(t, expected, result)
})

t.Run("error", func(t *testing.T) {
    _, err := function(invalidInput)
    require.Error(t, err)
    require.Contains(t, err.Error(), "expected error")
})
```

### 3. Context Usage
```go
// Always test with proper context
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()

result, err := manager.Operation(ctx, params)
```

### 4. Assertion Choice
```go
// Use require for critical assertions that should stop the test
require.NoError(t, err)

// Use assert for non-critical checks that allow test to continue
assert.Equal(t, expected, actual)
```

## Coverage Goals

- **Unit Test Coverage**: Minimum 70%
- **Critical Path Coverage**: 90%
- **Error Path Coverage**: 80%
- **Integration Coverage**: Key workflows

## Test Data Management

### 1. Inline Test Data
```go
testSession := &Session{
    ID:     "sess_test123",
    RunID:  "run_test456",
    Status: "running",
    Query:  "test query",
}
```

### 2. Test Fixtures
- Temporary files via `t.TempDir()`
- In-memory SQLite for database tests
- Generated IDs with predictable prefixes

### 3. Cleanup Strategy
```go
t.Cleanup(func() {
    // Cleanup in reverse order of creation
    closeConnection()
    removeSocket()
    deleteDatabase()
})
```

## Performance Testing

While no dedicated benchmarks exist, performance is validated through:
- Race detection (`-race` flag)
- Timeout enforcement in tests
- Concurrent operation testing

## Security Testing

Security is validated through:
- Permission verification tests
- SQL injection prevention tests
- Input validation testing

## Future Improvements

1. **Benchmark Tests**: Add performance benchmarks
2. **Fuzzing**: Add fuzz tests for input validation
3. **Contract Tests**: Verify API contracts
4. **Load Testing**: Stress test concurrent operations
5. **Mutation Testing**: Verify test effectiveness