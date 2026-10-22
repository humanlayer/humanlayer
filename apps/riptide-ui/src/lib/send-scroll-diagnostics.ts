import { logger } from '@/lib/logger'

const TRACE_DURATION_MS = 2_000
const MAX_SAMPLES = 64
const MAX_TRACES_PER_HOUR = 100
const ONE_HOUR_MS = 60 * 60 * 1_000

interface DiagnosticTrace {
	id: string
	sessionId: string
	startedAt: number
	startedWallTime: string
	initialRootScrollTop: number
	maxRootScrollTop: number
	samples: DiagnosticSample[]
	droppedSamples: number
	cleanupListeners: () => void
	timer: number
}

interface DiagnosticSample {
	phase: string
	elapsedMs: number
	details?: Record<string, unknown>
	geometry: ReturnType<typeof captureGeometry>
}

let activeTrace: DiagnosticTrace | null = null
const traceStartTimes: number[] = []

function rounded(value: number): number {
	return Math.round(value * 100) / 100
}

function rectSnapshot(element: Element | null) {
	if (!element) return null
	const rect = element.getBoundingClientRect()
	return {
		top: rounded(rect.top),
		bottom: rounded(rect.bottom),
		left: rounded(rect.left),
		right: rounded(rect.right),
		width: rounded(rect.width),
		height: rounded(rect.height),
	}
}

function activeElementKind(): 'editor' | 'button' | 'body' | 'other' | 'none' {
	const activeElement = document.activeElement
	if (!activeElement) return 'none'
	if (activeElement === document.body || activeElement === document.documentElement) return 'body'
	if (activeElement.closest('[data-session-composer]')?.querySelector('[contenteditable="true"]') === activeElement) {
		return 'editor'
	}
	if (activeElement instanceof HTMLButtonElement) return 'button'
	return 'other'
}

function captureGeometry() {
	const root = document.scrollingElement
	const conversation = document.querySelector('[data-conversation-container]')
	const composer = document.querySelector('[data-session-composer]')
	const visualViewport = window.visualViewport
	const conversationElement = conversation instanceof HTMLElement ? conversation : null

	return {
		document: {
			scrollingElement: root?.tagName ?? null,
			scrollTop: rounded(root?.scrollTop ?? 0),
			scrollLeft: rounded(root?.scrollLeft ?? 0),
			scrollHeight: root?.scrollHeight ?? null,
			clientHeight: root?.clientHeight ?? null,
			documentElementScrollTop: rounded(document.documentElement.scrollTop),
			bodyScrollTop: rounded(document.body.scrollTop),
		},
		window: {
			scrollX: rounded(window.scrollX),
			scrollY: rounded(window.scrollY),
			innerWidth: window.innerWidth,
			innerHeight: window.innerHeight,
		},
		visualViewport: visualViewport
			? {
					offsetTop: rounded(visualViewport.offsetTop),
					offsetLeft: rounded(visualViewport.offsetLeft),
					pageTop: rounded(visualViewport.pageTop),
					pageLeft: rounded(visualViewport.pageLeft),
					width: rounded(visualViewport.width),
					height: rounded(visualViewport.height),
					scale: rounded(visualViewport.scale),
				}
			: null,
		conversation: conversationElement
			? {
					scrollTop: rounded(conversationElement.scrollTop),
					scrollHeight: conversationElement.scrollHeight,
					clientHeight: conversationElement.clientHeight,
					bottomDistance: rounded(
						conversationElement.scrollHeight -
							conversationElement.scrollTop -
							conversationElement.clientHeight,
					),
					rect: rectSnapshot(conversationElement),
				}
			: null,
		composer: rectSnapshot(composer),
		focus: {
			kind: activeElementKind(),
			insideComposer: !!document.activeElement?.closest('[data-session-composer]'),
		},
	}
}

function rootScrollOffset(geometry: ReturnType<typeof captureGeometry>): number {
	return Math.max(
		geometry.document.scrollTop,
		geometry.document.documentElementScrollTop,
		geometry.document.bodyScrollTop,
		geometry.window.scrollY,
	)
}

function appendSample(trace: DiagnosticTrace, phase: string, details?: Record<string, unknown>) {
	const geometry = captureGeometry()
	trace.maxRootScrollTop = Math.max(trace.maxRootScrollTop, rootScrollOffset(geometry))
	if (trace.samples.length >= MAX_SAMPLES) {
		trace.droppedSamples += 1
		return
	}

	trace.samples.push({
		phase,
		elapsedMs: rounded(performance.now() - trace.startedAt),
		details,
		geometry,
	})
}

function finishTrace(trace: DiagnosticTrace, reason: string) {
	if (activeTrace !== trace) return
	activeTrace = null
	window.clearTimeout(trace.timer)
	trace.cleanupListeners()
	appendSample(trace, 'trace_finished', { reason })
	const finalGeometry = captureGeometry()
	trace.maxRootScrollTop = Math.max(trace.maxRootScrollTop, rootScrollOffset(finalGeometry))

	const rootMoved = trace.maxRootScrollTop !== trace.initialRootScrollTop || trace.maxRootScrollTop !== 0
	const report = {
		traceId: trace.id,
		sessionId: trace.sessionId,
		startedAt: trace.startedWallTime,
		durationMs: rounded(performance.now() - trace.startedAt),
		rootMoved,
		initialRootScrollTop: trace.initialRootScrollTop,
		maxRootScrollTop: trace.maxRootScrollTop,
		droppedSamples: trace.droppedSamples,
		finalGeometry,
		samples: trace.samples,
	}

	if (rootMoved) {
		logger.warn('[send-scroll-diagnostic] document root moved during send', report)
	} else {
		logger.info('[send-scroll-diagnostic] send trace completed', report)
	}
}

export function startSendScrollDiagnostic(sessionId: string): void {
	const now = Date.now()
	while (traceStartTimes.length > 0 && traceStartTimes[0] !== undefined && now - traceStartTimes[0] >= ONE_HOUR_MS) {
		traceStartTimes.shift()
	}
	if (traceStartTimes.length >= MAX_TRACES_PER_HOUR) return
	traceStartTimes.push(now)

	if (activeTrace) finishTrace(activeTrace, 'superseded_by_next_send')

	const initialGeometry = captureGeometry()
	const rootScrollTop = rootScrollOffset(initialGeometry)
	const trace = {
		id: crypto.randomUUID(),
		sessionId,
		startedAt: performance.now(),
		startedWallTime: new Date().toISOString(),
		initialRootScrollTop: rounded(rootScrollTop),
		maxRootScrollTop: rounded(rootScrollTop),
		samples: [],
		droppedSamples: 0,
		cleanupListeners: () => {},
		timer: 0,
	} satisfies DiagnosticTrace

	const onRootScroll = () => appendSample(trace, 'root_scroll_event')
	const onVisualViewportChange = (event: Event) =>
		appendSample(trace, event.type === 'resize' ? 'visual_viewport_resize' : 'visual_viewport_scroll')
	window.addEventListener('scroll', onRootScroll, { passive: true })
	window.visualViewport?.addEventListener('resize', onVisualViewportChange, { passive: true })
	window.visualViewport?.addEventListener('scroll', onVisualViewportChange, { passive: true })
	trace.cleanupListeners = () => {
		window.removeEventListener('scroll', onRootScroll)
		window.visualViewport?.removeEventListener('resize', onVisualViewportChange)
		window.visualViewport?.removeEventListener('scroll', onVisualViewportChange)
	}

	activeTrace = trace
	appendSample(trace, 'send_started')
	trace.timer = window.setTimeout(() => finishTrace(trace, 'timeout'), TRACE_DURATION_MS)
}

export function recordSendScrollDiagnostic(phase: string, details?: Record<string, unknown>): void {
	if (!activeTrace) return
	appendSample(activeTrace, phase, details)
}
