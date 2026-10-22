import { type ReactNode, type RefObject, useRef } from 'react'
import { type GroupImperativeHandle, useDefaultLayout } from 'react-resizable-panels'

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../../components/resizable'
import { useMountEffect } from '../../hooks/use-mount-effect'
import { cn } from '../../lib/utils'
import type { ArtifactTracePort } from '../trace/artifact-side-panel-trace'

export interface ArtifactViewerWorkspaceProps {
	/**
	 * Outline navigation rendered in a user-resizable panel beside the document.
	 * Pass `null` when the outline is closed; open/closed state is owned by the
	 * consuming composition.
	 */
	outline?: ReactNode
	/**
	 * Review rail rendered in a user-resizable panel to the document's right.
	 * Pass `null` when no review surface is mounted. This is a layout slot like
	 * `outline` — comment data and behavior stay in the consuming composition.
	 */
	rail?: ReactNode
	children: ReactNode
	className?: string
	/**
	 * Distinguishes persisted panel layouts between host surfaces (e.g. the
	 * sidebar panel vs the fullscreen viewer). Without it, a clamped layout
	 * saved by a narrow instance would misapply to a wide one.
	 */
	layoutId?: string
	/** Reports that destination size constraints and its saved layout are settled. */
	onLayoutReady?: () => void
	/** Remounts only the readiness observer for a new host transition. */
	layoutReadyKey?: string | number
	trace?: ArtifactTracePort
	traceInstanceId?: string
}

/**
 * Workspace shell that lays out the document beside the caller-supplied
 * outline and review-rail children. The outline sits in a resizable panel to
 * the left of the document and the review rail to its right; both widths
 * persist locally across viewers. Which children exist (outline open/closed,
 * review rail present) is owned by the consuming composition.
 */
export function ArtifactViewerWorkspace({
	outline,
	rail,
	children,
	className,
	layoutId,
	onLayoutReady,
	layoutReadyKey,
	trace,
	traceInstanceId,
}: ArtifactViewerWorkspaceProps) {
	// "-left" versions the persisted layout: earlier iterations stored sizes for
	// a [document, outline] order, which would misapply to the current
	// [outline, document] arrangement. The rail suffix versions it again: a
	// layout saved for [outline, document] must not misapply to
	// [outline, document, rail] (different panel count).
	const { defaultLayout, onLayoutChanged } = useDefaultLayout({
		id: `artifact-viewer-v2-workspace-left-${layoutId ?? 'default'}${rail != null ? '-rail' : ''}`,
		onlySaveAfterUserInteractions: true,
	})
	const workspaceLayoutId = `artifact-viewer-v2-workspace-left-${layoutId ?? 'default'}${rail != null ? '-rail' : ''}`
	const groupRef = useRef<GroupImperativeHandle | null>(null)
	const groupElementRef = useRef<HTMLDivElement | null>(null)
	const layoutApplicationRef = useRef({ destination: '', applied: false })
	const applyDestinationLayout = () => {
		if (layoutApplicationRef.current.destination !== workspaceLayoutId) {
			layoutApplicationRef.current = { destination: workspaceLayoutId, applied: false }
		}
		if (!groupRef.current) return false
		if (layoutApplicationRef.current.applied) return true
		const expectedIds = [...(outline != null ? ['outline'] : []), 'document', ...(rail != null ? ['review-rail'] : [])]
		if (expectedIds.length === 1) {
			layoutApplicationRef.current.applied = true
			return true
		}
		const current = groupRef.current.getLayout()
		const currentIds = Object.keys(current)
		if (currentIds.length !== expectedIds.length || expectedIds.some((id) => !(id in current))) return false
		if (!defaultLayout) {
			layoutApplicationRef.current.applied = true
			return true
		}
		if (
			currentIds.every((id) => id in defaultLayout) &&
			currentIds.length === Object.keys(defaultLayout).length
		) {
			layoutApplicationRef.current.applied = true
			groupRef.current.setLayout(defaultLayout)
			return true
		}
		// The destination is ready but this saved panel combination is not
		// currently mounted. A topology-keyed applier retries if it appears.
		return true
	}

	return (
		<>
			<ResizablePanelGroup
				groupRef={groupRef}
				elementRef={groupElementRef}
				orientation="horizontal"
				className={cn('artifact-viewer-v2-workspace', className)}
				defaultLayout={defaultLayout}
				// Only persist while the outline is mounted so closing it (document
				// panel becomes 100%) does not clobber the saved outline width.
				onLayoutChanged={(layout, panelGroup) => {
					if (outline == null) return
					trace?.record('workspace-layout', {
						instanceId: traceInstanceId,
						layoutId: workspaceLayoutId,
						layout: JSON.stringify(layout),
					})
					onLayoutChanged(layout, panelGroup)
				}}
			>
				{outline != null && (
					<>
						<ResizablePanel
							id="outline"
							className="artifact-viewer-v2-outline-panel"
							defaultSize="14rem"
							minSize="8rem"
							maxSize="40%"
						>
							{outline}
						</ResizablePanel>
						<ResizableHandle withHandle className="artifact-viewer-v2-workspace-handle" />
					</>
				)}
				<ResizablePanel id="document" minSize="40%">
					{children}
				</ResizablePanel>
				{rail != null && (
					<>
						<ResizableHandle withHandle className="artifact-viewer-v2-rail-handle" />
						<ResizablePanel
							id="review-rail"
							className="artifact-viewer-v2-rail-panel"
							defaultSize="18rem"
							minSize="12rem"
							maxSize="40%"
						>
							{rail}
						</ResizablePanel>
					</>
				)}
			</ResizablePanelGroup>
			<WorkspaceLayoutApplier
				key={`${workspaceLayoutId}:${outline != null}:${layoutReadyKey ?? 'default'}`}
				groupElementRef={groupElementRef}
				applyLayout={applyDestinationLayout}
				onLayoutReady={onLayoutReady}
			/>
		</>
	)
}

/** Apply only after ResizeObserver has refreshed pixel-derived panel constraints. */
function WorkspaceLayoutApplier({
	groupElementRef,
	applyLayout,
	onLayoutReady,
}: {
	groupElementRef: RefObject<HTMLDivElement | null>
	applyLayout: () => boolean
	onLayoutReady?: () => void
}) {
	useMountEffect(() => {
		const node = groupElementRef.current
		let frame = 0
		const settle = (observer?: ResizeObserver) => {
			cancelAnimationFrame(frame)
			frame = requestAnimationFrame(() => {
				const rect = node?.getBoundingClientRect()
				if (observer && (!rect || rect.width <= 0 || rect.height <= 0)) return
				if (applyLayout()) {
					observer?.disconnect()
					onLayoutReady?.()
				}
			})
		}
		if (!node || typeof ResizeObserver === 'undefined') {
			settle()
			return () => cancelAnimationFrame(frame)
		}
		const observer = new ResizeObserver((entries) => {
			const entry = entries.find((candidate) => candidate.target === node)
			if (!entry || entry.contentRect.width <= 0 || entry.contentRect.height <= 0) {
				cancelAnimationFrame(frame)
				frame = 0
				return
			}
			settle(observer)
		})
		observer.observe(node)
		return () => {
			observer.disconnect()
			cancelAnimationFrame(frame)
		}
	})
	return null
}
