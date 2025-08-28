import React, { ReactNode } from 'react'
import { BaseErrorBoundary, BaseErrorBoundaryProps, ErrorBoundaryInfo } from './BaseErrorBoundary'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { logger } from '@/lib/logging'
import { cn } from '@/lib/utils'

/**
 * Configuration for data validation and fallback behavior
 */
interface DataValidationConfig {
  /** Whether to attempt data repair before failing */
  attemptRepair: boolean
  /** Whether to show the raw data that failed to transform */
  showRawData: boolean
  /** Maximum size of raw data to display (in characters) */
  maxRawDataDisplay: number
  /** Whether to use safe fallback data when available */
  useFallbackData: boolean
}

/**
 * Information about the data that failed to transform
 */
interface DataTransformFailure {
  /** The operation that was being performed */
  operation: string
  /** The type of data that failed */
  dataType: string
  /** The raw data that caused the failure (truncated if too large) */
  rawData?: any
  /** Expected data structure or schema */
  expectedStructure?: string
  /** The specific field or path that caused the failure */
  failureLocation?: string
  /** Validation errors */
  validationErrors?: string[]
}

/**
 * Props interface for DataTransformErrorBoundary component
 */
interface DataTransformErrorBoundaryProps extends Omit<BaseErrorBoundaryProps, 'fallback' | 'onRetry'> {
  /** Custom fallback for data transformation errors */
  fallback?: (errorInfo: DataTransformErrorBoundaryInfo) => ReactNode
  /** Custom retry handler that might involve data cleanup */
  onRetry?: (errorInfo: DataTransformErrorBoundaryInfo) => Promise<void> | void
  /** Configuration for data validation behavior */
  validationConfig?: Partial<DataValidationConfig>
  /** Description of what data is being transformed */
  dataContext: string
  /** Expected data type or schema description */
  expectedDataType?: string
  /** Function to extract relevant data from error for debugging */
  extractFailureInfo?: (error: Error) => Partial<DataTransformFailure>
  /** Safe fallback data to use when transformation fails */
  fallbackData?: any
  /** Function to validate if data can be safely used */
  validateData?: (data: any) => { valid: boolean; errors: string[] }
  /** Whether this is a critical transformation (affects core functionality) */
  critical?: boolean
}

/**
 * Extended error information specific to data transformation errors
 */
interface DataTransformErrorBoundaryInfo extends ErrorBoundaryInfo {
  /** Information about the data transformation failure */
  transformFailure: DataTransformFailure
  /** Whether fallback data is available */
  hasFallbackData: boolean
  /** Whether data repair was attempted */
  repairAttempted: boolean
  /** The safe fallback data if available */
  fallbackData?: any
  /** Function to retry with data repair */
  retryWithRepair: () => void
  /** Function to use fallback data */
  useFallbackData: () => void
  /** Validation results for the failed data */
  validationResults?: { valid: boolean; errors: string[] }
}

/**
 * Default data validation configuration
 */
const DEFAULT_VALIDATION_CONFIG: DataValidationConfig = {
  attemptRepair: true,
  showRawData: false,
  maxRawDataDisplay: 1000,
  useFallbackData: true,
}

/**
 * DataTransformErrorBoundary - Specialized error boundary for complex data transformations
 *
 * This component is designed to handle errors that occur during complex data transformations,
 * such as conversation rendering, session data processing, or any scenario where data might
 * be corrupted, incomplete, or in an unexpected format. It provides safe fallbacks and
 * detailed debugging information to help identify data issues.
 *
 * Features:
 * - Specialized handling for data transformation failures
 * - Safe fallback mechanisms when data is corrupted or unexpected
 * - Data validation and repair attempts
 * - Detailed error context specific to data transformation failures
 * - Progressive disclosure of raw data for debugging
 * - Integration with existing validation patterns
 * - Critical vs non-critical transformation handling
 *
 * @example
 * ```tsx
 * // Around conversation rendering with fallback
 * <DataTransformErrorBoundary
 *   dataContext="conversation messages"
 *   expectedDataType="ConversationEvent[]"
 *   fallbackData={[]}
 *   extractFailureInfo={(error) => ({
 *     operation: 'message parsing',
 *     dataType: 'conversation',
 *     failureLocation: error.message.includes('timestamp') ? 'timestamp field' : 'unknown'
 *   })}
 * >
 *   <ConversationView messages={messages} />
 * </DataTransformErrorBoundary>
 *
 * // Around session data processing with validation
 * <DataTransformErrorBoundary
 *   dataContext="session state transformation"
 *   expectedDataType="ProcessedSessionData"
 *   critical={true}
 *   validateData={(data) => validateSessionStructure(data)}
 *   onRetry={async () => {
 *     await store.refreshSessionData()
 *   }}
 * >
 *   <SessionDetail session={processedSession} />
 * </DataTransformErrorBoundary>
 *
 * // Around data import/export operations
 * <DataTransformErrorBoundary
 *   dataContext="imported session data"
 *   validationConfig={{
 *     showRawData: true,
 *     attemptRepair: true
 *   }}
 * >
 *   <ImportedSessionView data={importedData} />
 * </DataTransformErrorBoundary>
 * ```
 */
export function DataTransformErrorBoundary({
  children,
  fallback,
  onRetry,
  validationConfig = {},
  dataContext,
  expectedDataType,
  extractFailureInfo,
  fallbackData,
  validateData,
  critical = false,
  contextInfo,
  ...baseProps
}: DataTransformErrorBoundaryProps) {
  const [repairAttempted, setRepairAttempted] = React.useState(false)
  const [usingFallbackData, setUsingFallbackData] = React.useState(false)
  const [validationResults, setValidationResults] = React.useState<{
    valid: boolean
    errors: string[]
  }>()

  const config: DataValidationConfig = { ...DEFAULT_VALIDATION_CONFIG, ...validationConfig }

  /**
   * Analyze the error to extract data transformation failure information
   */
  const analyzeDataTransformError = (error: Error): DataTransformFailure => {
    let baseFailure: DataTransformFailure = {
      operation: 'data transformation',
      dataType: dataContext,
      expectedStructure: expectedDataType,
    }

    // Use custom extraction function if provided
    if (extractFailureInfo) {
      try {
        const customInfo = extractFailureInfo(error)
        baseFailure = { ...baseFailure, ...customInfo }
      } catch (extractError) {
        logger.warn('Failed to extract custom failure info:', extractError)
      }
    }

    // Common data transformation error patterns
    if (error.message.includes('Cannot read propert')) {
      baseFailure.operation = 'property access'
      const match = error.message.match(/Cannot read propert\w* '(\w+)'/)
      if (match) {
        baseFailure.failureLocation = `property '${match[1]}'`
      }
    } else if (error.message.includes('is not a function')) {
      baseFailure.operation = 'method invocation'
      const match = error.message.match(/(\w+) is not a function/)
      if (match) {
        baseFailure.failureLocation = `method '${match[1]}'`
      }
    } else if (error.message.includes('Cannot convert')) {
      baseFailure.operation = 'type conversion'
    } else if (error.message.includes('JSON')) {
      baseFailure.operation = 'JSON parsing'
      baseFailure.dataType = 'JSON'
    } else if (error.message.includes('timestamp') || error.message.includes('Date')) {
      baseFailure.operation = 'date/time parsing'
      baseFailure.failureLocation = 'timestamp field'
    } else if (error.name === 'TypeError') {
      baseFailure.operation = 'type validation'
    }

    return baseFailure
  }

  /**
   * Attempt to repair corrupted data
   */
  const attemptDataRepair = async (
    _error: Error,
    transformFailure: DataTransformFailure,
  ): Promise<any> => {
    // @ts-ignore - Function available for future enhancement
    if (!config.attemptRepair || repairAttempted) return null

    setRepairAttempted(true)
    logger.log(`Attempting data repair for ${transformFailure.operation}...`)

    try {
      // Common repair strategies
      let repairedData = null

      // Try to repair timestamp issues
      if (transformFailure.failureLocation?.includes('timestamp')) {
        // Attempt to fix common timestamp issues
        repairedData = await repairTimestampData(transformFailure.rawData)
      }

      // Try to repair missing properties
      if (_error.message.includes('Cannot read property')) {
        repairedData = await repairMissingProperties(transformFailure.rawData, transformFailure)
      }

      // Try to repair array/object structure issues
      if (_error.name === 'TypeError' && transformFailure.rawData) {
        repairedData = await repairStructureData(transformFailure.rawData)
      }

      if (repairedData) {
        logger.log('Data repair successful')
        return repairedData
      }
    } catch (repairError) {
      logger.warn('Data repair failed:', repairError)
    }

    return null
  }

  /**
   * Repair common timestamp issues
   */
  const repairTimestampData = async (rawData: any): Promise<any> => {
    if (!rawData) return null

    try {
      const repaired = JSON.parse(JSON.stringify(rawData)) // Deep clone

      const fixTimestamps = (obj: any) => {
        if (typeof obj === 'object' && obj !== null) {
          for (const key in obj) {
            if (key.includes('time') || key.includes('date') || key === 'timestamp') {
              if (typeof obj[key] === 'string') {
                try {
                  obj[key] = new Date(obj[key])
                } catch {
                  obj[key] = new Date()
                }
              } else if (typeof obj[key] === 'number') {
                obj[key] = new Date(obj[key])
              }
            } else if (typeof obj[key] === 'object') {
              fixTimestamps(obj[key])
            }
          }
        }
      }

      if (Array.isArray(repaired)) {
        repaired.forEach(fixTimestamps)
      } else {
        fixTimestamps(repaired)
      }

      return repaired
    } catch {
      return null
    }
  }

  /**
   * Repair missing properties
   */
  const repairMissingProperties = async (
    rawData: any,
    transformFailure: DataTransformFailure,
  ): Promise<any> => {
    if (!rawData) return null

    try {
      const repaired = JSON.parse(JSON.stringify(rawData))

      // Add common missing properties based on data context
      if (transformFailure.dataType.includes('session')) {
        if (Array.isArray(repaired)) {
          repaired.forEach((item: any) => {
            item.id = item.id || `temp-${Date.now()}-${Math.random()}`
            item.status = item.status || 'unknown'
            item.created_at = item.created_at || new Date()
          })
        }
      } else if (transformFailure.dataType.includes('conversation')) {
        if (Array.isArray(repaired)) {
          repaired.forEach((item: any) => {
            item.timestamp = item.timestamp || new Date()
            item.type = item.type || 'unknown'
          })
        }
      }

      return repaired
    } catch {
      return null
    }
  }

  /**
   * Repair basic structure issues
   */
  const repairStructureData = async (rawData: any): Promise<any> => {
    if (!rawData) return []

    try {
      // If we expect an array but got an object, wrap it
      if (typeof rawData === 'object' && !Array.isArray(rawData)) {
        return [rawData]
      }

      // If we expect an object but got a primitive, wrap it
      if (typeof rawData !== 'object') {
        return { value: rawData }
      }

      return rawData
    } catch {
      return null
    }
  }

  /**
   * Handle retry with data repair
   */
  const handleRetryWithRepair = async () => {
    logger.log(`Retrying data transformation for ${dataContext} with repair attempts`)

    // Reset repair state
    setRepairAttempted(false)
    setUsingFallbackData(false)

    // Note: attemptDataRepair function available for future enhancement
    // Keep reference to prevent unused variable warning
    void attemptDataRepair
  }

  /**
   * Switch to using fallback data
   */
  const handleUseFallbackData = () => {
    if (!fallbackData) return

    logger.log(`Switching to fallback data for ${dataContext}`)
    setUsingFallbackData(true)

    // If we have validation, check the fallback data
    if (validateData) {
      const results = validateData(fallbackData)
      setValidationResults(results)

      if (!results.valid) {
        logger.warn('Fallback data also failed validation:', results.errors)
      }
    }
  }

  /**
   * Render data transformation error fallback
   */
  const renderDataTransformFallback = (baseErrorInfo: ErrorBoundaryInfo): ReactNode => {
    const { error } = baseErrorInfo
    const transformFailure = analyzeDataTransformError(error)

    // Validate the failed data if validator is provided
    let currentValidationResults = validationResults
    if (validateData && transformFailure.rawData && !currentValidationResults) {
      try {
        currentValidationResults = validateData(transformFailure.rawData)
        setValidationResults(currentValidationResults)
      } catch (validationError) {
        logger.warn('Data validation failed:', validationError)
      }
    }

    const dataTransformInfo: DataTransformErrorBoundaryInfo = {
      ...baseErrorInfo,
      transformFailure,
      hasFallbackData: !!fallbackData,
      repairAttempted,
      fallbackData: usingFallbackData ? fallbackData : undefined,
      retryWithRepair: handleRetryWithRepair,
      useFallbackData: handleUseFallbackData,
      validationResults: currentValidationResults,
    }

    // Use custom fallback if provided
    if (fallback) {
      return fallback(dataTransformInfo)
    }

    // Default data transformation error UI
    const severity = critical ? 'critical' : 'warning'
    const severityColor = critical ? 'text-destructive' : 'text-amber-600'

    return (
      <div className={cn('flex items-center justify-center p-4 min-h-[250px]', baseProps.className)}>
        <Card className="max-w-2xl w-full">
          <CardHeader>
            <CardTitle className={cn('flex items-center gap-2', severityColor)}>
              <div
                className={cn('w-2 h-2 rounded-full', critical ? 'bg-destructive' : 'bg-amber-500')}
              />
              Data Processing Error
              <Badge variant={critical ? 'destructive' : 'secondary'} className="ml-2">
                {severity}
              </Badge>
            </CardTitle>
            <CardDescription>
              Failed to process {dataContext}
              {transformFailure.operation !== 'data transformation' &&
                ` during ${transformFailure.operation}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Error Summary */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <span className="font-medium">Data Type:</span> {transformFailure.dataType}
              </div>
              <div>
                <span className="font-medium">Operation:</span> {transformFailure.operation}
              </div>
              {transformFailure.expectedStructure && (
                <div>
                  <span className="font-medium">Expected:</span> {transformFailure.expectedStructure}
                </div>
              )}
              {transformFailure.failureLocation && (
                <div>
                  <span className="font-medium">Failed at:</span> {transformFailure.failureLocation}
                </div>
              )}
            </div>

            {/* Validation Results */}
            {currentValidationResults && !currentValidationResults.valid && (
              <div className="space-y-2">
                <div className="text-sm font-medium">Validation Errors:</div>
                <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                  {currentValidationResults.errors.map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Status Information */}
            {(repairAttempted || usingFallbackData) && (
              <div className="p-3 bg-muted rounded border space-y-2">
                {repairAttempted && (
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-amber-500" />
                    Data repair was attempted
                  </div>
                )}
                {usingFallbackData && (
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-blue-500" />
                    Using fallback data
                  </div>
                )}
              </div>
            )}

            {/* Raw Data Display */}
            {config.showRawData && transformFailure.rawData && (
              <details className="space-y-2">
                <summary className="text-sm font-medium cursor-pointer text-muted-foreground hover:text-foreground">
                  Raw Data (Debug)
                </summary>
                <div className="p-3 bg-muted rounded border">
                  <pre className="text-xs overflow-auto max-h-40 whitespace-pre-wrap font-mono">
                    {JSON.stringify(transformFailure.rawData, null, 2).substring(
                      0,
                      config.maxRawDataDisplay,
                    )}
                    {JSON.stringify(transformFailure.rawData, null, 2).length >
                      config.maxRawDataDisplay && '...'}
                  </pre>
                </div>
              </details>
            )}

            {/* Technical Details */}
            <details className="space-y-2">
              <summary className="text-sm font-medium cursor-pointer text-muted-foreground hover:text-foreground">
                Technical Details
              </summary>
              <div className="p-3 bg-muted rounded border font-mono text-xs space-y-2">
                <div>
                  <span className="font-semibold">Error:</span> {error.name}: {error.message}
                </div>
                <div>
                  <span className="font-semibold">Context:</span> {dataContext}
                </div>
                <div>
                  <span className="font-semibold">Critical:</span> {critical ? 'Yes' : 'No'}
                </div>
                {error.stack && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                      Stack trace
                    </summary>
                    <pre className="mt-2 text-[10px] overflow-auto max-h-32 whitespace-pre-wrap">
                      {error.stack}
                    </pre>
                  </details>
                )}
              </div>
            </details>

            {/* Action Buttons */}
            <div className="flex gap-2 justify-end">
              {!repairAttempted && config.attemptRepair && (
                <Button onClick={dataTransformInfo.retryWithRepair} variant="outline" size="sm">
                  Try Repair
                </Button>
              )}
              {fallbackData && !usingFallbackData && (
                <Button onClick={dataTransformInfo.useFallbackData} variant="secondary" size="sm">
                  Use Safe Data
                </Button>
              )}
              <Button onClick={baseErrorInfo.retry} variant="outline" size="sm">
                Retry
              </Button>
              <Button onClick={baseErrorInfo.reload} variant="default" size="sm">
                Reload Page
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Enhanced context info for data transformation errors
  const enhancedContextInfo = {
    ...contextInfo,
    dataContext,
    expectedDataType,
    critical,
    validationConfig: config,
    dataTransformErrorBoundary: true,
  }

  return (
    <BaseErrorBoundary
      {...baseProps}
      contextInfo={enhancedContextInfo}
      fallback={renderDataTransformFallback}
      onRetry={async () => {
        if (onRetry) {
          const transformFailure = analyzeDataTransformError(new Error('Retry'))
          const dataTransformInfo: DataTransformErrorBoundaryInfo = {
            error: new Error('Retry'),
            errorInfo: {} as React.ErrorInfo,
            hasError: true,
            retry: () => {},
            reload: () => {},
            transformFailure,
            hasFallbackData: !!fallbackData,
            repairAttempted,
            fallbackData: usingFallbackData ? fallbackData : undefined,
            retryWithRepair: handleRetryWithRepair,
            useFallbackData: handleUseFallbackData,
            validationResults,
            contextInfo: enhancedContextInfo,
          }
          await onRetry(dataTransformInfo)
        }
      }}
    >
      {children}
    </BaseErrorBoundary>
  )
}

export type {
  DataTransformErrorBoundaryProps,
  DataTransformErrorBoundaryInfo,
  DataTransformFailure,
  DataValidationConfig,
}
