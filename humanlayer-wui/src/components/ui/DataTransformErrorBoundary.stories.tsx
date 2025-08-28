import type { Meta, StoryObj } from '@storybook/react'
import { DataTransformErrorBoundary } from './DataTransformErrorBoundary'
import { Button } from './button'
import { useState } from 'react'

// Component that simulates data transformation operations
const DataTransformComponent = ({
  shouldError = false,
  errorType = 'property',
  data = null,
}: {
  shouldError?: boolean
  errorType?: string
  data?: any
}) => {
  if (shouldError) {
    switch (errorType) {
      case 'property':
        // Simulate trying to access property of undefined
        const obj = undefined as any
        return obj.someProperty.map(() => {})
      case 'method':
        // Simulate calling non-existent method
        const notFunction = 'string' as any
        return notFunction()
      case 'json':
        // Simulate JSON parsing error
        JSON.parse('{invalid json}')
        break
      case 'timestamp':
        // Simulate timestamp parsing error
        const invalidDate = new Date('invalid-date-string')
        return invalidDate.getTime()
      case 'type':
        // Simulate type error
        const num = null as any
        return num.toString()
      default:
        throw new Error('Data transformation failed')
    }
  }

  return (
    <div className="p-4 border rounded">
      <h3 className="font-medium mb-2">Data Processing Component</h3>
      <p className="text-muted-foreground text-sm mb-4">
        This component processes complex data and can fail during transformation.
      </p>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-green-500 rounded-full"></div>
          <span className="text-sm">Data loaded successfully</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-green-500 rounded-full"></div>
          <span className="text-sm">Transformation completed</span>
        </div>
        {data && (
          <div className="mt-4 p-2 bg-muted rounded text-xs">
            <div className="font-medium mb-1">Processed Data:</div>
            <pre>{JSON.stringify(data, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  )
}

const meta: Meta<typeof DataTransformErrorBoundary> = {
  title: 'UI/DataTransformErrorBoundary',
  component: DataTransformErrorBoundary,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof meta>

// Property access error
export const PropertyAccessError: Story = {
  render: () => (
    <div className="w-[500px]">
      <DataTransformErrorBoundary
        dataContext="user session data"
        expectedDataType="SessionData[]"
        extractFailureInfo={error => ({
          operation: 'session parsing',
          dataType: 'session',
          failureLocation: error.message.includes('someProperty') ? 'someProperty field' : 'unknown',
          rawData: { sessions: undefined },
        })}
        fallbackData={[]}
      >
        <DataTransformComponent shouldError={true} errorType="property" />
      </DataTransformErrorBoundary>
    </div>
  ),
}

// Method invocation error
export const MethodInvocationError: Story = {
  render: () => (
    <div className="w-[500px]">
      <DataTransformErrorBoundary
        dataContext="conversation messages"
        expectedDataType="ConversationEvent[]"
        validationConfig={{
          showRawData: true,
          attemptRepair: true,
        }}
        fallbackData={[]}
      >
        <DataTransformComponent shouldError={true} errorType="method" />
      </DataTransformErrorBoundary>
    </div>
  ),
}

// JSON parsing error
export const JSONParsingError: Story = {
  render: () => (
    <div className="w-[500px]">
      <DataTransformErrorBoundary
        dataContext="imported configuration"
        expectedDataType="ConfigObject"
        validationConfig={{
          showRawData: true,
          maxRawDataDisplay: 500,
        }}
        extractFailureInfo={() => ({
          operation: 'JSON parsing',
          dataType: 'configuration',
          rawData: '{invalid json}',
          validationErrors: ['Invalid JSON syntax', 'Missing closing brace'],
        })}
        fallbackData={{ defaultConfig: true }}
      >
        <DataTransformComponent shouldError={true} errorType="json" />
      </DataTransformErrorBoundary>
    </div>
  ),
}

// Timestamp parsing error
export const TimestampError: Story = {
  render: () => (
    <div className="w-[500px]">
      <DataTransformErrorBoundary
        dataContext="event timestamps"
        expectedDataType="ProcessedEvent[]"
        extractFailureInfo={() => ({
          operation: 'timestamp parsing',
          dataType: 'events',
          failureLocation: 'timestamp field',
          rawData: {
            events: [{ id: 1, timestamp: 'invalid-date-string', message: 'Test event' }],
          },
        })}
        validateData={data => {
          if (!Array.isArray(data)) return { valid: false, errors: ['Data must be an array'] }
          const errors: string[] = []
          data.forEach((event, i) => {
            if (!event.timestamp) errors.push(`Event ${i} missing timestamp`)
            if (!event.id) errors.push(`Event ${i} missing id`)
          })
          return { valid: errors.length === 0, errors }
        }}
        fallbackData={[]}
      >
        <DataTransformComponent shouldError={true} errorType="timestamp" />
      </DataTransformErrorBoundary>
    </div>
  ),
}

// Critical data transformation
export const CriticalTransformation: Story = {
  render: () => (
    <div className="w-[500px]">
      <DataTransformErrorBoundary
        dataContext="core application state"
        expectedDataType="ApplicationState"
        critical={true}
        validationConfig={{
          showRawData: true,
          attemptRepair: true,
        }}
        extractFailureInfo={() => ({
          operation: 'state reconstruction',
          dataType: 'application-state',
          failureLocation: 'root state object',
        })}
      >
        <DataTransformComponent shouldError={true} errorType="type" />
      </DataTransformErrorBoundary>
    </div>
  ),
}

// Interactive data error trigger
export const InteractiveDataError: Story = {
  render: () => {
    const [errorType, setErrorType] = useState<string>('')

    const triggerError = (type: string) => {
      setErrorType(type)
    }

    return (
      <div className="w-[500px]">
        <DataTransformErrorBoundary
          dataContext="user-triggered data operation"
          expectedDataType="ProcessedData"
          validationConfig={{
            showRawData: true,
            attemptRepair: true,
          }}
          fallbackData={{ safe: true, data: [] }}
        >
          {errorType ? (
            <DataTransformComponent shouldError={true} errorType={errorType} />
          ) : (
            <div className="space-y-4">
              <div className="p-4 border rounded">
                <h3 className="font-medium mb-4">Trigger Data Transform Errors</h3>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" size="sm" onClick={() => triggerError('property')}>
                    Property Access
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => triggerError('method')}>
                    Method Call
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => triggerError('json')}>
                    JSON Parse
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => triggerError('timestamp')}>
                    Timestamp
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DataTransformErrorBoundary>
      </div>
    )
  },
}

// Custom fallback UI
export const CustomDataFallback: Story = {
  render: () => (
    <div className="w-[500px]">
      <DataTransformErrorBoundary
        dataContext="custom fallback example"
        expectedDataType="CustomData"
        fallback={({ transformFailure, hasFallbackData, useFallbackData, retryWithRepair, retry }) => (
          <div className="p-6 border-2 border-dashed border-purple-300 bg-purple-50 rounded-lg">
            <div className="text-purple-800 mb-4">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <div className="w-3 h-3 bg-purple-500 rounded-full"></div>
                Custom Data Transform Handler
              </h3>
              <p className="text-sm mt-2">Operation: {transformFailure.operation}</p>
              <p className="text-sm">Data Type: {transformFailure.dataType}</p>
              {transformFailure.failureLocation && (
                <p className="text-sm">Failed at: {transformFailure.failureLocation}</p>
              )}
            </div>
            <div className="space-x-2">
              <Button onClick={retryWithRepair} size="sm">
                Try Repair
              </Button>
              {hasFallbackData && (
                <Button onClick={useFallbackData} variant="secondary" size="sm">
                  Use Safe Data
                </Button>
              )}
              <Button onClick={retry} variant="outline" size="sm">
                Retry
              </Button>
            </div>
          </div>
        )}
        fallbackData={{ fallback: true }}
      >
        <DataTransformComponent shouldError={true} errorType="property" />
      </DataTransformErrorBoundary>
    </div>
  ),
}

// With custom retry logic
export const CustomDataRetry: Story = {
  render: () => {
    const [retryLog, setRetryLog] = useState<string[]>([])

    return (
      <div className="w-[500px] space-y-4">
        {retryLog.length > 0 && (
          <div className="p-3 bg-muted rounded text-xs">
            <div className="font-medium mb-2">Data Processing Log:</div>
            {retryLog.map((log, i) => (
              <div key={i}>{log}</div>
            ))}
          </div>
        )}
        <DataTransformErrorBoundary
          dataContext="custom retry data processing"
          expectedDataType="ProcessedData"
          onRetry={async errorInfo => {
            setRetryLog(prev => [
              ...prev,
              `Cleaning up corrupted ${errorInfo.transformFailure.dataType} data`,
            ])
            await new Promise(resolve => setTimeout(resolve, 1000))
            setRetryLog(prev => [...prev, 'Data cleanup completed'])
          }}
          validationConfig={{
            attemptRepair: true,
            showRawData: false,
          }}
          fallbackData={{ cleaned: true, data: [] }}
        >
          <DataTransformComponent shouldError={true} errorType="json" />
        </DataTransformErrorBoundary>
      </div>
    )
  },
}

// Working data component
export const WorkingDataComponent: Story = {
  render: () => (
    <div className="w-[500px]">
      <DataTransformErrorBoundary
        dataContext="normal data processing"
        expectedDataType="ProcessedData"
        validateData={() => ({ valid: true, errors: [] })}
      >
        <DataTransformComponent
          data={{
            processed: true,
            timestamp: new Date().toISOString(),
            items: [1, 2, 3],
          }}
        />
      </DataTransformErrorBoundary>
    </div>
  ),
}

// Non-critical transformation
export const NonCriticalTransformation: Story = {
  render: () => (
    <div className="w-[500px]">
      <DataTransformErrorBoundary
        dataContext="optional widget data"
        expectedDataType="WidgetData"
        critical={false}
        validationConfig={{
          showRawData: true,
          useFallbackData: true,
        }}
        fallbackData={{ widget: 'unavailable' }}
      >
        <DataTransformComponent shouldError={true} errorType="property" />
      </DataTransformErrorBoundary>
    </div>
  ),
}
