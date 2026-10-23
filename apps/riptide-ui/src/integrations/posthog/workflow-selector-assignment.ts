import { useSyncExternalStore } from 'react'

import type { WorkflowSelectorPresentation } from '@/modules/launcher-v3/launcher-v3-workflow'

import { onWorkflowSelectorFlag } from './posthog'

type WorkflowSelectorAssignment = {
	userId: string
	presentation: WorkflowSelectorPresentation
}

let latestAssignment: WorkflowSelectorAssignment | undefined
let subscribedUserId: string | undefined
const listeners = new Set<() => void>()

function publishPresentation(userId: string, presentation: WorkflowSelectorPresentation): void {
	latestAssignment = { userId, presentation }
	for (const listener of listeners) listener()
}

function clearPresentation(userId: string): void {
	if (latestAssignment?.userId !== userId) return
	latestAssignment = undefined
	for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener)
	return () => listeners.delete(listener)
}

export function resolveWorkflowSelectorPresentation(
	assignment: WorkflowSelectorPresentation | undefined,
): WorkflowSelectorPresentation {
	return assignment === 'task-size' ? 'task-size' : 'named'
}

export function subscribeToWorkflowSelectorAssignment(
	userId: string,
	dependencies = { subscribe: onWorkflowSelectorFlag },
): () => void {
	subscribedUserId = userId
	clearPresentation(userId)
	let active = true
	const unsubscribe = dependencies.subscribe((presentation) => {
		if (active && subscribedUserId === userId) publishPresentation(userId, presentation)
	})
	return () => {
		active = false
		unsubscribe()
		if (subscribedUserId === userId) subscribedUserId = undefined
		clearPresentation(userId)
	}
}

export function useWorkflowSelectorPresentation(userId: string | undefined): WorkflowSelectorPresentation | undefined {
	const getSnapshot = () => {
		const assignment = latestAssignment
		return assignment && assignment.userId === userId ? assignment.presentation : undefined
	}
	return useSyncExternalStore(subscribe, getSnapshot, () => undefined)
}
