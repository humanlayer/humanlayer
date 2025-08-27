import React from 'react'
import { logger } from '@/lib/logging'

interface Props {
  children: React.ReactNode
  fallback?: React.ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export class MarkdownErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logger.error('Markdown rendering error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="text-destructive">
            Failed to render content. Raw text shown below:
            <pre className="mt-2 p-2 bg-background-alt border border-border text-muted-foreground text-sm">
              {this.props.children}
            </pre>
          </div>
        )
      )
    }

    return this.props.children
  }
}
