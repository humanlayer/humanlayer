import React, { Component, ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'
import { logger } from '@/lib/logging'

interface ResponseEditorErrorBoundaryProps {
  children: ReactNode
}

interface ResponseEditorErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ResponseEditorErrorBoundary extends Component<
  ResponseEditorErrorBoundaryProps,
  ResponseEditorErrorBoundaryState
> {
  constructor(props: ResponseEditorErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logger.error('ResponseEditor Error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col space-y-2 p-3 text-sm text-muted-foreground">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4" />
            <span>Editor unavailable</span>
          </div>
          {this.state.error && (
            <div className="text-xs text-destructive">{this.state.error.message}</div>
          )}
        </div>
      )
    }

    return this.props.children
  }
}
