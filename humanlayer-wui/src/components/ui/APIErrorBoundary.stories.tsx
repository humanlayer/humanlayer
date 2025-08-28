import type { Meta, StoryObj } from '@storybook/react'
import { APIErrorBoundary } from './APIErrorBoundary'
import { Button } from './button'
import { useState } from 'react'

// Mock error classes to simulate API errors
class MockConnectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConnectionError'
  }
}

class MockDaemonError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DaemonError'
  }
}

class MockRPCError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RPCError'
  }
}

// Component that simulates API-dependent behavior
const APIComponent = ({
  shouldError = false,
  errorType = 'connection',
  errorMessage = 'Connection failed',
}) => {
  if (shouldError) {
    switch (errorType) {
      case 'connection':
        throw new MockConnectionError('Cannot connect to daemon on localhost:8000')
      case 'daemon':
        throw new MockDaemonError('Daemon service unavailable')
      case 'rpc':
        throw new MockRPCError('RPC call timed out after 5000ms')
      case 'network':
        throw new TypeError('Failed to fetch: network error')
      case 'timeout':
        throw new Error('Request timed out after 30 seconds')
      default:
        throw new Error(errorMessage)
    }
  }

  return (
    <div className="p-4 border rounded">
      <h3 className="font-medium mb-2">API-Dependent Component</h3>
      <p className="text-muted-foreground text-sm mb-4">
        This component depends on API calls and can fail in various ways.
      </p>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-green-500 rounded-full"></div>
          <span className="text-sm">Connected to daemon</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-green-500 rounded-full"></div>
          <span className="text-sm">API calls successful</span>
        </div>
      </div>
    </div>
  )
}

const meta: Meta<typeof APIErrorBoundary> = {
  title: 'UI/APIErrorBoundary',
  component: APIErrorBoundary,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof meta>

// Connection error
export const ConnectionError: Story = {
  render: () => (
    <div className="w-96">
      <APIErrorBoundary operationContext="connecting to session service" autoReconnect={true}>
        <APIComponent shouldError={true} errorType="connection" />
      </APIErrorBoundary>
    </div>
  ),
}

// Daemon error
export const DaemonError: Story = {
  render: () => (
    <div className="w-96">
      <APIErrorBoundary operationContext="fetching session list" showNetworkDetails={true}>
        <APIComponent shouldError={true} errorType="daemon" />
      </APIErrorBoundary>
    </div>
  ),
}

// RPC error
export const RPCError: Story = {
  render: () => (
    <div className="w-96">
      <APIErrorBoundary
        operationContext="creating new approval"
        retryConfig={{
          maxRetries: 5,
          baseDelay: 2000,
          exponentialBackoff: true,
        }}
      >
        <APIComponent shouldError={true} errorType="rpc" />
      </APIErrorBoundary>
    </div>
  ),
}

// Network error
export const NetworkError: Story = {
  render: () => (
    <div className="w-96">
      <APIErrorBoundary operationContext="uploading file" showNetworkDetails={true}>
        <APIComponent shouldError={true} errorType="network" />
      </APIErrorBoundary>
    </div>
  ),
}

// Timeout error
export const TimeoutError: Story = {
  render: () => (
    <div className="w-96">
      <APIErrorBoundary
        operationContext="processing large dataset"
        retryConfig={{
          maxRetries: 2,
          baseDelay: 5000,
        }}
      >
        <APIComponent shouldError={true} errorType="timeout" />
      </APIErrorBoundary>
    </div>
  ),
}

// Interactive error trigger
export const InteractiveError: Story = {
  render: () => {
    const [errorType, setErrorType] = useState<string>('')

    const triggerError = (type: string) => {
      setErrorType(type)
    }

    return (
      <div className="w-96">
        <APIErrorBoundary
          operationContext="user-triggered operation"
          showNetworkDetails={true}
          autoReconnect={true}
        >
          {errorType ? (
            <APIComponent shouldError={true} errorType={errorType} />
          ) : (
            <div className="space-y-4">
              <div className="p-4 border rounded">
                <h3 className="font-medium mb-4">Trigger API Errors</h3>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" size="sm" onClick={() => triggerError('connection')}>
                    Connection
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => triggerError('daemon')}>
                    Daemon
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => triggerError('rpc')}>
                    RPC
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => triggerError('timeout')}>
                    Timeout
                  </Button>
                </div>
              </div>
            </div>
          )}
        </APIErrorBoundary>
      </div>
    )
  },
}

// Custom retry logic
export const CustomRetryLogic: Story = {
  render: () => {
    const [retryLog, setRetryLog] = useState<string[]>([])

    return (
      <div className="w-96 space-y-4">
        {retryLog.length > 0 && (
          <div className="p-3 bg-muted rounded text-xs">
            <div className="font-medium mb-2">Retry Log:</div>
            {retryLog.map((log, i) => (
              <div key={i}>{log}</div>
            ))}
          </div>
        )}
        <APIErrorBoundary
          operationContext="custom retry example"
          onRetry={async (attempt, error) => {
            setRetryLog(prev => [...prev, `Retry attempt ${attempt}: ${error.message}`])
            // Simulate custom retry logic
            await new Promise(resolve => setTimeout(resolve, 1000))
            console.log('Custom retry logic executed')
          }}
          retryConfig={{
            maxRetries: 3,
            baseDelay: 1000,
            exponentialBackoff: true,
          }}
        >
          <APIComponent shouldError={true} errorType="rpc" />
        </APIErrorBoundary>
      </div>
    )
  },
}

// Custom fallback UI
export const CustomFallback: Story = {
  render: () => (
    <div className="w-96">
      <APIErrorBoundary
        operationContext="custom fallback example"
        fallback={({
          apiErrorType,
          userMessage,
          recoveryActions,
          retryWithBackoff,
          reload,
          retrying,
        }) => (
          <div className="p-6 border-2 border-dashed border-orange-300 bg-orange-50 rounded-lg">
            <div className="text-orange-800 mb-4">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <div className="w-3 h-3 bg-orange-500 rounded-full"></div>
                Custom API Error Handler
              </h3>
              <p className="text-sm mt-2">Type: {apiErrorType}</p>
              <p className="text-sm">{userMessage}</p>
            </div>
            <div className="space-y-2 mb-4">
              <div className="text-sm font-medium">Recovery Options:</div>
              <ul className="text-sm list-disc list-inside">
                {recoveryActions.slice(0, 2).map((action, i) => (
                  <li key={i}>{action}</li>
                ))}
              </ul>
            </div>
            <div className="space-x-2">
              <Button onClick={retryWithBackoff} size="sm" disabled={retrying}>
                {retrying ? 'Retrying...' : 'Smart Retry'}
              </Button>
              <Button onClick={reload} variant="outline" size="sm">
                Reload
              </Button>
            </div>
          </div>
        )}
      >
        <APIComponent shouldError={true} errorType="connection" />
      </APIErrorBoundary>
    </div>
  ),
}

// Production-like API error
export const ProductionAPIError: Story = {
  render: () => (
    <div className="w-96">
      <APIErrorBoundary
        operationContext="loading user dashboard"
        autoReconnect={true}
        showNetworkDetails={false}
        retryConfig={{
          maxRetries: 3,
          baseDelay: 2000,
          exponentialBackoff: true,
        }}
        onRetry={async attempt => {
          console.log(`Production retry attempt ${attempt}`)
          // Simulate telemetry/analytics
        }}
      >
        <APIComponent shouldError={true} errorType="connection" />
      </APIErrorBoundary>
    </div>
  ),
}

// Working API component
export const WorkingAPIComponent: Story = {
  render: () => (
    <div className="w-96">
      <APIErrorBoundary operationContext="normal operation" autoReconnect={true}>
        <APIComponent />
      </APIErrorBoundary>
    </div>
  ),
}

// No auto-reconnect
export const NoAutoReconnect: Story = {
  render: () => (
    <div className="w-96">
      <APIErrorBoundary
        operationContext="manual reconnect only"
        autoReconnect={false}
        showNetworkDetails={true}
      >
        <APIComponent shouldError={true} errorType="connection" />
      </APIErrorBoundary>
    </div>
  ),
}
