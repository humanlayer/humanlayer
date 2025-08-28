import type { Meta, StoryObj } from '@storybook/react'
import { BaseErrorBoundary } from './BaseErrorBoundary'
import { Button } from './button'
import { useState } from 'react'

// Component that throws an error on demand
const ErrorThrowingComponent = ({
  shouldError = false,
  errorMessage = 'Test error',
  errorType = 'Error',
}) => {
  if (shouldError) {
    const ErrorClass = globalThis[errorType as keyof typeof globalThis] as any
    throw new (ErrorClass || Error)(errorMessage)
  }
  return <div className="p-4 border rounded">Component working normally</div>
}

// Component with error trigger button
const ErrorTriggerComponent = () => {
  const [shouldError, setShouldError] = useState(false)

  return (
    <div className="space-y-4">
      <Button onClick={() => setShouldError(true)}>Trigger Error</Button>
      <ErrorThrowingComponent shouldError={shouldError} />
    </div>
  )
}

const meta: Meta<typeof BaseErrorBoundary> = {
  title: 'UI/BaseErrorBoundary',
  component: BaseErrorBoundary,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof meta>

// Default error boundary
export const Default: Story = {
  render: () => (
    <div className="w-96">
      <BaseErrorBoundary>
        <ErrorTriggerComponent />
      </BaseErrorBoundary>
    </div>
  ),
}

// With custom title and description
export const CustomMessaging: Story = {
  render: () => (
    <div className="w-96">
      <BaseErrorBoundary
        title="Dashboard Load Failed"
        description="We couldn't load your dashboard. This might be due to a temporary issue with the data service."
      >
        <ErrorTriggerComponent />
      </BaseErrorBoundary>
    </div>
  ),
}

// With error details shown
export const WithErrorDetails: Story = {
  render: () => (
    <div className="w-96">
      <BaseErrorBoundary
        title="Development Error"
        description="Error details are shown for debugging purposes."
        showErrorDetails={true}
      >
        <ErrorTriggerComponent />
      </BaseErrorBoundary>
    </div>
  ),
}

// Simulated error state
export const SimulatedError: Story = {
  render: () => (
    <div className="w-96">
      <BaseErrorBoundary
        title="Something went wrong"
        description="An unexpected error occurred while rendering this component."
      >
        <ErrorThrowingComponent shouldError={true} errorMessage="Component failed to render properly" />
      </BaseErrorBoundary>
    </div>
  ),
}

// Different error types
export const TypeError: Story = {
  render: () => (
    <div className="w-96">
      <BaseErrorBoundary showErrorDetails={true} title="Type Error Occurred">
        <ErrorThrowingComponent
          shouldError={true}
          errorMessage="Cannot read property 'map' of undefined"
          errorType="TypeError"
        />
      </BaseErrorBoundary>
    </div>
  ),
}

export const ReferenceError: Story = {
  render: () => (
    <div className="w-96">
      <BaseErrorBoundary showErrorDetails={true} title="Reference Error">
        <ErrorThrowingComponent
          shouldError={true}
          errorMessage="undefinedVariable is not defined"
          errorType="ReferenceError"
        />
      </BaseErrorBoundary>
    </div>
  ),
}

// Custom fallback
export const CustomFallback: Story = {
  render: () => (
    <div className="w-96">
      <BaseErrorBoundary
        fallback={({ error, retry, reload }) => (
          <div className="p-6 border-2 border-dashed border-red-300 bg-red-50 rounded-lg text-center">
            <div className="text-red-600 mb-4">
              <h3 className="text-lg font-semibold">Custom Error Handler</h3>
              <p className="text-sm">Error: {error.message}</p>
            </div>
            <div className="space-x-2">
              <Button onClick={retry} size="sm">
                Try Again
              </Button>
              <Button onClick={reload} variant="outline" size="sm">
                Reload
              </Button>
            </div>
          </div>
        )}
      >
        <ErrorTriggerComponent />
      </BaseErrorBoundary>
    </div>
  ),
}

// With custom error handler
export const WithCustomErrorHandler: Story = {
  render: () => {
    const [errorLog, setErrorLog] = useState<string[]>([])

    return (
      <div className="w-96 space-y-4">
        {errorLog.length > 0 && (
          <div className="p-3 bg-muted rounded text-xs">
            <div className="font-medium mb-2">Error Log:</div>
            {errorLog.map((log, i) => (
              <div key={i}>{log}</div>
            ))}
          </div>
        )}
        <BaseErrorBoundary
          title="Component with Custom Error Logging"
          onError={(error, errorInfo) => {
            setErrorLog(prev => [...prev, `Error caught: ${error.message}`])
            console.log('Custom error handler:', error, errorInfo)
          }}
          contextInfo={{
            userId: 'user-123',
            route: '/dashboard',
            timestamp: new Date().toISOString(),
          }}
        >
          <ErrorTriggerComponent />
        </BaseErrorBoundary>
      </div>
    )
  },
}

// Without retry button
export const NoRetryButton: Story = {
  render: () => (
    <div className="w-96">
      <BaseErrorBoundary
        title="Critical Error"
        description="This error cannot be retried. Please reload the page."
        showRetryButton={false}
      >
        <ErrorTriggerComponent />
      </BaseErrorBoundary>
    </div>
  ),
}

// Without reload button
export const NoReloadButton: Story = {
  render: () => (
    <div className="w-96">
      <BaseErrorBoundary
        title="Temporary Error"
        description="You can try again, but reloading is not necessary."
        showReloadButton={false}
      >
        <ErrorTriggerComponent />
      </BaseErrorBoundary>
    </div>
  ),
}

// Minimal error display
export const Minimal: Story = {
  render: () => (
    <div className="w-96">
      <BaseErrorBoundary
        showRetryButton={false}
        showReloadButton={false}
        title="Error"
        description="Something went wrong."
      >
        <ErrorTriggerComponent />
      </BaseErrorBoundary>
    </div>
  ),
}

// With custom retry handler
export const CustomRetryHandler: Story = {
  render: () => {
    const [retryCount, setRetryCount] = useState(0)

    return (
      <div className="w-96">
        {retryCount > 0 && (
          <div className="mb-4 p-2 bg-blue-50 border border-blue-200 rounded text-sm">
            Custom retry executed {retryCount} time(s)
          </div>
        )}
        <BaseErrorBoundary
          title="Custom Retry Logic"
          description="This error boundary has custom retry logic that performs cleanup before retrying."
          onRetry={() => {
            setRetryCount(prev => prev + 1)
            console.log('Custom retry logic executed')
            // Simulate cleanup or data refresh
            setTimeout(() => {
              console.log('Cleanup completed')
            }, 500)
          }}
        >
          <ErrorTriggerComponent />
        </BaseErrorBoundary>
      </div>
    )
  },
}

// Nested error boundaries
export const NestedErrorBoundaries: Story = {
  render: () => (
    <div className="w-96">
      <BaseErrorBoundary
        title="Outer Error Boundary"
        description="This is the outer error boundary that catches errors from nested components."
      >
        <div className="p-4 border rounded mb-4">
          <h3 className="font-medium mb-2">Outer Component</h3>
          <BaseErrorBoundary
            title="Inner Error Boundary"
            description="This inner error boundary catches errors from deeply nested components."
            className="border-dashed"
          >
            <div className="p-4 border rounded">
              <h4 className="font-medium mb-2">Inner Component</h4>
              <ErrorTriggerComponent />
            </div>
          </BaseErrorBoundary>
        </div>
      </BaseErrorBoundary>
    </div>
  ),
}

// Different styling
export const CustomStyling: Story = {
  render: () => (
    <div className="w-96">
      <BaseErrorBoundary
        className="bg-gradient-to-br from-red-50 to-orange-50"
        title="Styled Error Boundary"
        description="This error boundary has custom styling applied."
      >
        <ErrorTriggerComponent />
      </BaseErrorBoundary>
    </div>
  ),
}

// Production-like error
export const ProductionError: Story = {
  render: () => (
    <div className="w-96">
      <BaseErrorBoundary
        title="Oops! Something went wrong"
        description="We encountered an unexpected error. Our team has been notified and is working on a fix."
        showErrorDetails={false}
        contextInfo={{
          environment: 'production',
          userId: 'user-456',
          feature: 'dashboard',
        }}
        onError={(error, errorInfo) => {
          // Simulate error reporting to external service
          console.log('Error reported to monitoring service:', { error, errorInfo })
        }}
      >
        <ErrorTriggerComponent />
      </BaseErrorBoundary>
    </div>
  ),
}

// Working component (no error)
export const WorkingComponent: Story = {
  render: () => (
    <div className="w-96">
      <BaseErrorBoundary>
        <div className="p-6 border rounded">
          <h3 className="font-medium mb-2">Working Component</h3>
          <p className="text-muted-foreground mb-4">
            This component is working normally. The error boundary is wrapping it but not interfering.
          </p>
          <Button>Interactive Button</Button>
        </div>
      </BaseErrorBoundary>
    </div>
  ),
}
