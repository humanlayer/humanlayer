import type { CodexDiagnosticsContext, CodexDiagnosticSeverity } from '@humanlayer/agentlayer-provider-openai-codex'
import * as NodeLogger from '@humanlayer/logger/node'

import { Sentry } from '@/instrument'
import { normalizePath } from '@/lib/utils'
import logger from '@/logger'

const DIAGNOSTICS_LOG_PATH = normalizePath('~/.humanlayer/riptide/logs/codex-provider-logs.jsonl')

const diagnosticsLogger = new NodeLogger.Logger({
	name: 'codex-diagnostics',
	properties: { source: 'codex-provider-diagnostics' },
	transports: [new NodeLogger.FileTransport('debug', DIAGNOSTICS_LOG_PATH)],
})

const SEVERITY_TO_LOG: Record<CodexDiagnosticSeverity, 'error' | 'warn' | 'info' | 'debug'> = {
	error: 'error',
	warning: 'warn',
	info: 'info',
	debug: 'debug',
}

const SEVERITY_TO_SENTRY: Record<CodexDiagnosticSeverity, 'error' | 'warning' | 'info'> = {
	error: 'error',
	warning: 'warning',
	info: 'info',
	debug: 'info',
}

export function createDaemonCodexDiagnostics(sessionId: string, modelId: string): CodexDiagnosticsContext {
	return {
		annotations: { sessionId, model: modelId, provider: 'codex' },
		onEvent(record) {
			const level = SEVERITY_TO_LOG[record.severity]
			const data = { sessionId, event: record.event, transport: record.transport, ...record.metadata }
			const msg = `codex.provider: ${record.event}`

			logger[level](data, msg)
			diagnosticsLogger[level](data, msg)

			Sentry.addBreadcrumb({
				category: 'codex.provider',
				message: record.event,
				level: SEVERITY_TO_SENTRY[record.severity],
				data: { transport: record.transport, ...record.metadata },
			})

			if (record.severity === 'error') {
				const openUnproductiveGapMs =
					typeof record.metadata.openUnproductiveGapMs === 'number'
						? record.metadata.openUnproductiveGapMs
						: undefined
				const tags: {
					codex: boolean
					'codex.transport': string
					'codex.error_event': string
					'codex.productive_at_end'?: boolean
				} = {
					codex: true,
					'codex.transport': record.transport,
					'codex.error_event': record.event,
				}
				// Did a productive token land within 10s of this terminal event? Populated when
				// the stream carries productivity metrics (e.g. max_stream_duration). CORE-1446.
				if (openUnproductiveGapMs !== undefined) {
					tags['codex.productive_at_end'] = openUnproductiveGapMs < 10_000
				}
				Sentry.captureException(new Error((record.metadata.error as string) ?? record.event), {
					// Group by event name so e.g. max_stream_duration and productive_first_event
					// are distinct issues (all codex errors are captured from this one line).
					fingerprint: ['codex-provider', record.event],
					tags,
					contexts: {
						codex_provider_error: { ...record.metadata, sessionId },
					},
				})
			}
		},
	}
}
