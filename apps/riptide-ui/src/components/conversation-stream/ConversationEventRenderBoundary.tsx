import type { ConversationEvent } from '@humanlayer/ui/components/conversation-stream'
import * as Sentry from '@sentry/react'
import React from 'react'

import { logger } from '@/lib/logger'

import { ConversationEventErrorFallback } from './ConversationEventErrorFallback'

interface ConversationEventRenderBoundaryProps {
	children: React.ReactNode
	event: ConversationEvent
	componentName?: string
}

interface State {
	hasError: boolean
	error?: Error
}

/**
 * Error boundary for conversation event content rendering.
 * Wraps the content slot (not the whole row) so row chrome remains visible
 * when content fails to render.
 */
class ConversationEventRenderBoundaryCore extends React.Component<ConversationEventRenderBoundaryProps, State> {
	constructor(props: ConversationEventRenderBoundaryProps) {
		super(props)
		this.state = { hasError: false }
	}

	static getDerivedStateFromError(error: Error): State {
		return { hasError: true, error }
	}

	componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
		const { event, componentName = 'ConversationEventRow.content' } = this.props

		logger.error(`${componentName} render error:`, error, {
			eventId: event.id,
			eventType: event.eventType,
			toolName: event.toolName,
			componentStack: errorInfo.componentStack,
		})

		// Report to Sentry with event context
		Sentry.captureException(error, {
			contexts: {
				react: {
					componentStack: errorInfo.componentStack,
				},
				conversationEvent: {
					eventId: event.id,
					eventType: event.eventType,
					toolName: event.toolName,
					sessionId: event.sessionId,
				},
			},
			tags: {
				errorBoundary: true,
				errorBoundaryVariant: 'conversation-event',
				componentName,
				eventType: event.eventType,
				toolName: event.toolName || undefined,
			},
		})
	}

	render() {
		if (this.state.hasError && this.state.error) {
			return <ConversationEventErrorFallback error={this.state.error} event={this.props.event} />
		}

		return this.props.children
	}
}

// Export wrapped version with Sentry integration
export const ConversationEventRenderBoundary = Sentry.withErrorBoundary(ConversationEventRenderBoundaryCore, {
	showDialog: false,
})
