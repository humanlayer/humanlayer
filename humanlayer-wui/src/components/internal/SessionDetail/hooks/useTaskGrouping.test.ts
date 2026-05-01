import { describe, test, expect } from 'bun:test'
import { renderHook, act } from '@testing-library/react'
import { useTaskGrouping } from './useTaskGrouping'
import type { ConversationEvent } from '@/lib/daemon/types'
import { ConversationEventEventTypeEnum, ConversationEventApprovalStatusEnum } from '@humanlayer/hld-sdk'

const ConversationEventType = ConversationEventEventTypeEnum
const ApprovalStatus = ConversationEventApprovalStatusEnum

function makeEvent(overrides: Partial<ConversationEvent> & { id: number }): ConversationEvent {
  return {
    sessionId: 'session-1',
    sequence: overrides.id,
    eventType: ConversationEventType.ToolCall,
    createdAt: new Date(),
    ...overrides,
  } as ConversationEvent
}

describe('useTaskGrouping', () => {
  test('events without parentToolUseId are all root events', () => {
    const events = [
      makeEvent({ id: 1, eventType: ConversationEventType.Message }),
      makeEvent({ id: 2, eventType: ConversationEventType.ToolCall, toolId: 'tool-1', toolName: 'Bash' }),
    ]

    const { result } = renderHook(() => useTaskGrouping(events))

    expect(result.current.hasSubTasks).toBe(false)
    expect(result.current.rootEvents).toHaveLength(2)
    expect(result.current.taskGroups.size).toBe(0)
  })

  test('events with parentToolUseId are grouped under their parent Task', () => {
    const events = [
      makeEvent({ id: 1, eventType: ConversationEventType.ToolCall, toolId: 'task-1', toolName: 'Task', toolInputJson: '{"description":"test"}' }),
      makeEvent({ id: 2, eventType: ConversationEventType.ToolCall, toolId: 'sub-1', toolName: 'Bash', parentToolUseId: 'task-1' }),
      makeEvent({ id: 3, eventType: ConversationEventType.ToolCall, toolId: 'sub-2', toolName: 'Read', parentToolUseId: 'task-1' }),
    ]

    const { result } = renderHook(() => useTaskGrouping(events))

    expect(result.current.hasSubTasks).toBe(true)
    expect(result.current.rootEvents).toHaveLength(1)
    expect(result.current.taskGroups.size).toBe(1)
    const group = result.current.taskGroups.get('task-1')!
    expect(group.subTaskEvents).toHaveLength(2)
    expect(group.toolCallCount).toBe(2)
  })

  test('auto-expands task groups with pending approvals', () => {
    const events = [
      makeEvent({ id: 1, eventType: ConversationEventType.ToolCall, toolId: 'task-1', toolName: 'Task', toolInputJson: '{"description":"test"}' }),
      makeEvent({
        id: 2,
        eventType: ConversationEventType.ToolCall,
        toolId: 'sub-1',
        toolName: 'Bash',
        parentToolUseId: 'task-1',
        approvalStatus: ApprovalStatus.Pending,
        approvalId: 'approval-1',
      }),
    ]

    const { result } = renderHook(() => useTaskGrouping(events))

    // Should be auto-expanded because sub-event has pending approval
    expect(result.current.expandedTasks.has('task-1')).toBe(true)
  })

  test('prevents collapsing a task group with pending approval', () => {
    const events = [
      makeEvent({ id: 1, eventType: ConversationEventType.ToolCall, toolId: 'task-1', toolName: 'Task', toolInputJson: '{"description":"test"}' }),
      makeEvent({
        id: 2,
        eventType: ConversationEventType.ToolCall,
        toolId: 'sub-1',
        toolName: 'Bash',
        parentToolUseId: 'task-1',
        approvalStatus: ApprovalStatus.Pending,
        approvalId: 'approval-1',
      }),
    ]

    const { result } = renderHook(() => useTaskGrouping(events))

    // Should be expanded
    expect(result.current.expandedTasks.has('task-1')).toBe(true)

    // Try to toggle (collapse) — should be blocked
    act(() => {
      result.current.toggleTaskGroup('task-1')
    })

    // Should still be expanded
    expect(result.current.expandedTasks.has('task-1')).toBe(true)
  })

  test('allows collapsing a task group without pending approvals', () => {
    const events = [
      makeEvent({ id: 1, eventType: ConversationEventType.ToolCall, toolId: 'task-1', toolName: 'Task', toolInputJson: '{"description":"test"}' }),
      makeEvent({
        id: 2,
        eventType: ConversationEventType.ToolCall,
        toolId: 'sub-1',
        toolName: 'Bash',
        parentToolUseId: 'task-1',
        approvalStatus: ApprovalStatus.Approved,
        approvalId: 'approval-1',
      }),
    ]

    const { result } = renderHook(() => useTaskGrouping(events))

    // Manually expand first
    act(() => {
      result.current.toggleTaskGroup('task-1')
    })
    expect(result.current.expandedTasks.has('task-1')).toBe(true)

    // Toggle again to collapse — should work since no pending approvals
    act(() => {
      result.current.toggleTaskGroup('task-1')
    })
    expect(result.current.expandedTasks.has('task-1')).toBe(false)
  })

  test('expandTaskForEvent expands the parent group for a nested event', () => {
    const events = [
      makeEvent({ id: 1, eventType: ConversationEventType.ToolCall, toolId: 'task-1', toolName: 'Task', toolInputJson: '{"description":"test"}' }),
      makeEvent({
        id: 2,
        eventType: ConversationEventType.ToolCall,
        toolId: 'sub-1',
        toolName: 'Bash',
        parentToolUseId: 'task-1',
      }),
    ]

    const { result } = renderHook(() => useTaskGrouping(events))

    // Not expanded initially (no pending approval)
    expect(result.current.expandedTasks.has('task-1')).toBe(false)

    // Expand via the nested event
    act(() => {
      result.current.expandTaskForEvent(events[1])
    })

    expect(result.current.expandedTasks.has('task-1')).toBe(true)
  })

  test('hasPendingApproval is true when any sub-event has pending status', () => {
    const events = [
      makeEvent({ id: 1, eventType: ConversationEventType.ToolCall, toolId: 'task-1', toolName: 'Task', toolInputJson: '{"description":"test"}' }),
      makeEvent({ id: 2, eventType: ConversationEventType.ToolCall, toolId: 'sub-1', toolName: 'Read', parentToolUseId: 'task-1' }),
      makeEvent({
        id: 3,
        eventType: ConversationEventType.ToolCall,
        toolId: 'sub-2',
        toolName: 'Bash',
        parentToolUseId: 'task-1',
        approvalStatus: ApprovalStatus.Pending,
        approvalId: 'approval-1',
      }),
    ]

    const { result } = renderHook(() => useTaskGrouping(events))

    const group = result.current.taskGroups.get('task-1')!
    expect(group.hasPendingApproval).toBe(true)
  })

  test('restores previous expansion state after approvals are resolved', () => {
    const eventsWithPending = [
      makeEvent({ id: 1, eventType: ConversationEventType.ToolCall, toolId: 'task-1', toolName: 'Task', toolInputJson: '{"description":"test"}' }),
      makeEvent({
        id: 2,
        eventType: ConversationEventType.ToolCall,
        toolId: 'sub-1',
        toolName: 'Bash',
        parentToolUseId: 'task-1',
        approvalStatus: ApprovalStatus.Pending,
        approvalId: 'approval-1',
      }),
    ]

    const { result, rerender } = renderHook(
      ({ events }) => useTaskGrouping(events),
      { initialProps: { events: eventsWithPending } },
    )

    // Should be auto-expanded due to pending approval
    expect(result.current.expandedTasks.has('task-1')).toBe(true)

    // Resolve the approval
    const eventsResolved = [
      makeEvent({ id: 1, eventType: ConversationEventType.ToolCall, toolId: 'task-1', toolName: 'Task', toolInputJson: '{"description":"test"}' }),
      makeEvent({
        id: 2,
        eventType: ConversationEventType.ToolCall,
        toolId: 'sub-1',
        toolName: 'Bash',
        parentToolUseId: 'task-1',
        approvalStatus: ApprovalStatus.Approved,
        approvalId: 'approval-1',
      }),
    ]

    rerender({ events: eventsResolved })

    // Should restore to pre-approval state (was not expanded before)
    expect(result.current.expandedTasks.has('task-1')).toBe(false)
  })
})
