import { createArtifactSidePanelTraceSession } from '@humanlayer/ui/artifact-viewer-v2'
import { toast } from 'sonner'

import { useDiagnosticStore } from '@/hooks/stores/diagnosticStore'
import { saveArtifactTrace } from '@/integrations/tauri/artifact-trace'
import { isTauri } from '@/lib/utils'

type NodeKind = 'viewer' | 'outline' | 'rail' | 'workspace'

interface BoundNode {
	node: HTMLElement
	cleanup: () => void
	frameIds: Set<number>
}

const session = createArtifactSidePanelTraceSession()
const instances = new Map<string, Map<NodeKind, BoundNode>>()
const lastStyles = new Map<string, string>()
let enabled = false
let globalCleanup: (() => void) | null = null
let pendingOutputTimer: ReturnType<typeof setTimeout> | null = null
let pendingOutputEndsAt: number | null = null
let pendingOutputGeneration: number | null = null
let generation = 0
let styleGeneration = 0
let outputRequest = 0
let outputState: ArtifactTraceOutputState = { phase: 'idle', savedPath: null, error: null }
const runtimeListeners = new Set<() => void>()

export interface ArtifactTraceRuntimeStatus {
	eventCount: number
	markedAt: number | null
	captureEndsAt: number | null
	isCapturing: boolean
	output: ArtifactTraceOutputState
}

interface ArtifactTraceOutputState {
	phase: 'idle' | 'capturing' | 'saving' | 'ready-download' | 'download-requested' | 'saved' | 'error'
	savedPath: string | null
	error: string | null
}

let currentRuntimeStatus: ArtifactTraceRuntimeStatus = { ...session.status(), output: outputState }

function emitRuntimeStatus() {
	currentRuntimeStatus = { ...session.status(), output: outputState }
	for (const listener of runtimeListeners) listener()
}

function setOutputState(next: ArtifactTraceOutputState) {
	outputState = next
	emitRuntimeStatus()
}

function schedulePendingOutput(captureEndsAt: number, captureGeneration: number) {
	if (
		pendingOutputTimer != null &&
		pendingOutputEndsAt === captureEndsAt &&
		pendingOutputGeneration === captureGeneration
	)
		return
	if (pendingOutputTimer != null) clearTimeout(pendingOutputTimer)
	pendingOutputEndsAt = captureEndsAt
	pendingOutputGeneration = captureGeneration
	setOutputState({ phase: 'capturing', savedPath: null, error: null })
	pendingOutputTimer = setTimeout(
		() => {
			pendingOutputTimer = null
			pendingOutputEndsAt = null
			pendingOutputGeneration = null
			if (!enabled || captureGeneration !== generation) return
			if (isTauri()) void outputNow(captureGeneration)
			else {
				setOutputState({ phase: 'ready-download', savedPath: null, error: null })
				toast.info('Artifact trace ready to download', {
					action: {
						label: 'Download',
						onClick: () => artifactSidePanelTrace.downloadFallback(),
					},
				})
			}
		},
		Math.max(0, captureEndsAt - Date.now()),
	)
}

function snapshotStyle(instanceId: string, kind: NodeKind, node: HTMLElement, reason: string) {
	if (!enabled || !node.isConnected) return
	const style = getComputedStyle(node)
	const data = {
		instanceId,
		kind,
		reason,
		backgroundColor: style.backgroundColor,
		opacity: style.opacity,
		display: style.display,
		visibility: style.visibility,
		transform: style.transform,
		terminalBg: style.getPropertyValue('--terminal-bg').trim(),
		terminalAccent: style.getPropertyValue('--terminal-accent').trim(),
		rectWidth: Math.round(node.getBoundingClientRect().width),
		rectHeight: Math.round(node.getBoundingClientRect().height),
	}
	const { reason: _reason, ...watchedData } = data
	const signature = JSON.stringify(watchedData)
	const key = `${instanceId}:${kind}`
	if (lastStyles.get(key) === signature) return
	lastStyles.set(key, signature)
	session.record('panel-style', data)
}

function sampleFrames(instanceId: string, kind: NodeKind, node: HTMLElement, reason: string) {
	const bound = instances.get(instanceId)?.get(kind)
	if (!bound || bound.node !== node) return
	const sampleGeneration = styleGeneration
	snapshotStyle(instanceId, kind, node, reason)
	const firstFrame = requestAnimationFrame(() => {
		bound.frameIds.delete(firstFrame)
		if (!enabled || sampleGeneration !== styleGeneration || instances.get(instanceId)?.get(kind) !== bound) return
		snapshotStyle(instanceId, kind, node, `${reason}-frame-1`)
		const secondFrame = requestAnimationFrame(() => {
			bound.frameIds.delete(secondFrame)
			if (!enabled || sampleGeneration !== styleGeneration || instances.get(instanceId)?.get(kind) !== bound)
				return
			snapshotStyle(instanceId, kind, node, `${reason}-frame-2`)
		})
		bound.frameIds.add(secondFrame)
	})
	bound.frameIds.add(firstFrame)
}

function unbindNode(instanceId: string, kind: NodeKind) {
	const nodes = instances.get(instanceId)
	const bound = nodes?.get(kind)
	if (!bound) return
	for (const frameId of bound.frameIds) cancelAnimationFrame(frameId)
	bound.frameIds.clear()
	bound.cleanup()
	nodes?.delete(kind)
	lastStyles.delete(`${instanceId}:${kind}`)
	if (nodes?.size === 0) instances.delete(instanceId)
	session.record('panel-node', { instanceId, kind, attached: false })
}

export function bindArtifactTraceNode(instanceId: string, kind: NodeKind, node: HTMLElement | null) {
	const current = instances.get(instanceId)?.get(kind)
	if (current?.node === node) return
	unbindNode(instanceId, kind)
	if (!node || !enabled) return

	const observer = new MutationObserver((records) => {
		for (const record of records) {
			session.record('dom-mutation', {
				instanceId,
				kind,
				mutationType: record.type,
				attribute: record.attributeName,
				added: record.addedNodes.length,
				removed: record.removedNodes.length,
			})
		}
		sampleFrames(instanceId, kind, node, 'mutation')
	})
	observer.observe(node, { attributes: true, attributeFilter: ['class', 'style'], childList: true })
	const nodes = instances.get(instanceId) ?? new Map<NodeKind, BoundNode>()
	nodes.set(kind, { node, cleanup: () => observer.disconnect(), frameIds: new Set() })
	instances.set(instanceId, nodes)
	session.record('panel-node', { instanceId, kind, attached: true, nodeId: `${instanceId}-${kind}` })
	sampleFrames(instanceId, kind, node, 'mount')
}

export function sampleArtifactTraceStyles(instanceId: string, reason: string) {
	for (const [kind, bound] of instances.get(instanceId) ?? []) {
		sampleFrames(instanceId, kind, bound.node, reason)
	}
}

export function releaseArtifactTraceInstance(instanceId: string) {
	const boundKinds = instances.get(instanceId)?.keys() ?? []
	for (const kind of [...boundKinds]) unbindNode(instanceId, kind)
}

function pointerRegion(target: HTMLElement | null): 'outline' | 'rail' | 'document' | 'outside' {
	if (target?.closest('.artifact-viewer-v2-outline')) return 'outline'
	if (target?.closest('.artifact-viewer-v2-review-rail')) return 'rail'
	if (target?.closest('.artifact-viewer-v2')) return 'document'
	return 'outside'
}

function startGlobalTracing() {
	session.clear()
	session.record('session-start', {
		build: import.meta.env.VITE_PUBLIC_BUILD_VERSION,
		appMode: import.meta.env.MODE,
		userAgentFamily: navigator.userAgentData?.brands?.map((brand) => brand.brand).join(', ') ?? 'unavailable',
		theme: document.documentElement.className,
	})
	let lastPointerAt = 0
	const onPointerMove = (event: PointerEvent) => {
		const now = performance.now()
		if (now - lastPointerAt < 50) return
		lastPointerAt = now
		const target = event.target instanceof HTMLElement ? event.target : null
		session.record('pointer', {
			x: Math.round(event.clientX),
			y: Math.round(event.clientY),
			region: pointerRegion(target),
			targetTag: target?.tagName.toLowerCase(),
			targetClass: target?.classList.item(0) ?? null,
			hasBlockTarget: target?.closest('[data-block-id]') != null,
		})
	}
	document.addEventListener('pointermove', onPointerMove, { passive: true })
	const rootObserver = new MutationObserver((records) => {
		for (const record of records) {
			session.record('root-mutation', {
				attribute: record.attributeName,
				theme: document.documentElement.className,
			})
		}
	})
	rootObserver.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ['class', 'style', 'data-theme'],
	})
	const performanceObservers: PerformanceObserver[] = []
	if (typeof PerformanceObserver !== 'undefined') {
		for (const entryType of ['layout-shift', 'longtask']) {
			try {
				const observer = new PerformanceObserver((list) => {
					for (const entry of list.getEntries()) {
						session.record('performance', {
							entryType: entry.entryType,
							duration: Math.round(entry.duration),
						})
					}
				})
				observer.observe({ type: entryType, buffered: true })
				performanceObservers.push(observer)
			} catch {
				// The WebView does not support every performance entry type.
			}
		}
	}
	globalCleanup = () => {
		document.removeEventListener('pointermove', onPointerMove)
		rootObserver.disconnect()
		for (const observer of performanceObservers) observer.disconnect()
	}
}

export function setArtifactTraceEnabled(next: boolean) {
	if (enabled === next) return
	enabled = next
	generation++
	styleGeneration++
	outputRequest++
	if (enabled) {
		startGlobalTracing()
		return
	}
	globalCleanup?.()
	globalCleanup = null
	for (const instanceId of [...instances.keys()]) releaseArtifactTraceInstance(instanceId)
	if (pendingOutputTimer != null) clearTimeout(pendingOutputTimer)
	pendingOutputTimer = null
	pendingOutputEndsAt = null
	pendingOutputGeneration = null
	setOutputState({ phase: 'idle', savedPath: null, error: null })
}

function downloadNow() {
	const blob = new Blob([JSON.stringify(session.exportTrace(), null, 2)], { type: 'application/json' })
	const link = document.createElement('a')
	const url = URL.createObjectURL(blob)
	link.href = url
	link.download = `artifact-side-panel-trace-${new Date().toISOString().replaceAll(':', '-')}.json`
	link.click()
	setTimeout(() => URL.revokeObjectURL(url), 0)
}

async function outputNow(captureGeneration = generation) {
	if (!enabled || session.status().eventCount === 0) return false
	if (!isTauri()) {
		setOutputState({ phase: 'ready-download', savedPath: null, error: null })
		return false
	}

	const request = ++outputRequest
	setOutputState({ phase: 'saving', savedPath: null, error: null })
	try {
		const path = await saveArtifactTrace(JSON.stringify(session.exportTrace(), null, 2))
		if (!enabled || captureGeneration !== generation || request !== outputRequest) return false
		setOutputState({ phase: 'saved', savedPath: path, error: null })
		toast.success('Artifact trace saved', { description: path })
		return true
	} catch (error) {
		if (!enabled || captureGeneration !== generation || request !== outputRequest) return false
		setOutputState({
			phase: 'error',
			savedPath: null,
			error: error instanceof Error ? error.message : String(error),
		})
		toast.error('Failed to save artifact trace', {
			description: error instanceof Error ? error.message : String(error),
		})
		return false
	}
}

export const artifactSidePanelTrace = {
	record: (type: string, data?: Record<string, unknown>) => enabled && session.record(type, data),
	mark: () => {
		if (!enabled) return false
		generation++
		outputRequest++
		session.mark('saw-flicker')
		const captureEndsAt = session.status().captureEndsAt
		if (captureEndsAt != null) schedulePendingOutput(captureEndsAt, generation)
		return true
	},
	clear() {
		generation++
		styleGeneration++
		outputRequest++
		if (pendingOutputTimer != null) clearTimeout(pendingOutputTimer)
		pendingOutputTimer = null
		pendingOutputEndsAt = null
		pendingOutputGeneration = null
		session.clear()
		setOutputState({ phase: 'idle', savedPath: null, error: null })
	},
	status: () => currentRuntimeStatus,
	subscribe(listener: () => void) {
		runtimeListeners.add(listener)
		return () => runtimeListeners.delete(listener)
	},
	output() {
		if (!enabled || session.status().eventCount === 0) return false
		const status = session.status()
		if (status.isCapturing && status.captureEndsAt != null) {
			schedulePendingOutput(status.captureEndsAt, generation)
			return true
		}
		void outputNow()
		return true
	},
	downloadFallback() {
		if (!enabled || session.status().eventCount === 0) return false
		downloadNow()
		setOutputState({ phase: 'download-requested', savedPath: null, error: null })
		return true
	},
}

session.subscribe(() => {
	const status = session.status()
	if (pendingOutputTimer != null && status.isCapturing && status.captureEndsAt != null) {
		schedulePendingOutput(status.captureEndsAt, generation)
	}
	emitRuntimeStatus()
})

declare global {
	interface Window {
		__artifactOutlineTrace?: typeof artifactSidePanelTrace
	}
	interface Navigator {
		userAgentData?: { brands?: Array<{ brand: string }> }
	}
}

if (typeof window !== 'undefined') {
	window.__artifactOutlineTrace = artifactSidePanelTrace
	setArtifactTraceEnabled(useDiagnosticStore.getState().artifactSidePanelTraceEnabled)
	useDiagnosticStore.subscribe((state, previous) => {
		if (state.artifactSidePanelTraceEnabled !== previous.artifactSidePanelTraceEnabled) {
			setArtifactTraceEnabled(state.artifactSidePanelTraceEnabled)
		}
	})
}
