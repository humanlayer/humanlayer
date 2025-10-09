import type { Meta, StoryObj } from '@storybook/react'
import { TaskGroupEventRow } from './TaskGroupEventRow'
import type { ConversationEvent, Session } from '@humanlayer/hld-sdk'
import type { TaskEventGroup } from '@/components/internal/SessionDetail/hooks/useTaskGrouping'
import { SessionStatus } from '@/lib/daemon/types'

const meta = {
  title: 'Internal/TaskGroupEventRow',
  component: TaskGroupEventRow,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  decorators: [
    Story => (
      <div className="border border-border w-full mx-8 min-w-[800px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TaskGroupEventRow>

export default meta
type Story = StoryObj<typeof meta>

// Mock session for stories - minimal fields required
const mockSession: Session = {
  id: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
  runId: 'run-123',
  status: SessionStatus.Running,
  createdAt: new Date('2025-09-22T10:00:00Z'),
  workingDir: '/workspace',
} as Session

// Base task event that spawns sub-tasks
const baseParentTask: ConversationEvent = {
  approvalId: 'approval-task-parent-1',
  approvalStatus: 'approved' as const,
  claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
  content: undefined,
  createdAt: new Date('2025-09-22T10:00:00Z'),
  eventType: 'tool_call' as const,
  id: 100,
  isCompleted: false,
  role: 'assistant' as const,
  sequence: 10,
  sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
  toolName: 'Task',
  toolId: 'task-100',
  toolInputJson: JSON.stringify({
    description: 'Find and analyze authentication implementation',
    prompt:
      'Search the codebase for authentication logic, including login, logout, and session management',
    subagent_type: 'codebase-locator',
  }),
}

// Sub-task events
const subTaskEvents: ConversationEvent[] = [
  {
    approvalId: undefined,
    approvalStatus: undefined,
    claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
    content: 'Searching for authentication files...',
    createdAt: new Date('2025-09-22T10:00:05Z'),
    eventType: 'message' as const,
    id: 101,
    isCompleted: false,
    role: 'assistant' as const,
    sequence: 11,
    sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
    parentToolUseId: 'task-100',
  },
  {
    approvalId: undefined,
    approvalStatus: undefined,
    claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
    content: undefined,
    createdAt: new Date('2025-09-22T10:00:10Z'),
    eventType: 'tool_call' as const,
    id: 102,
    isCompleted: true,
    role: 'assistant' as const,
    sequence: 12,
    sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
    toolName: 'Grep',
    toolId: 'grep-102',
    parentToolUseId: 'task-100',
    toolInputJson: JSON.stringify({
      pattern: 'login|auth|session',
      path: '/src',
      output_mode: 'files_with_matches',
    }),
  },
  {
    approvalId: undefined,
    approvalStatus: undefined,
    claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
    content: undefined,
    createdAt: new Date('2025-09-22T10:00:15Z'),
    eventType: 'tool_call' as const,
    id: 103,
    isCompleted: true,
    role: 'assistant' as const,
    sequence: 13,
    sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
    toolName: 'Read',
    toolId: 'read-103',
    parentToolUseId: 'task-100',
    toolInputJson: JSON.stringify({
      file_path: '/src/auth/login.tsx',
    }),
  },
]

const subTaskWithApproval: ConversationEvent[] = [
  {
    approvalId: 'approval-sub-1',
    approvalStatus: 'pending' as const,
    claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
    content: undefined,
    createdAt: new Date('2025-09-22T10:00:20Z'),
    eventType: 'tool_call' as const,
    id: 104,
    isCompleted: false,
    role: 'assistant' as const,
    sequence: 14,
    sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
    toolName: 'Write',
    toolId: 'write-104',
    parentToolUseId: 'task-100',
    toolInputJson: JSON.stringify({
      file_path: '/src/auth/improved-login.tsx',
      content: '// Improved authentication logic\nexport function login() { /* ... */ }',
    }),
  },
]

// Create task groups
const baseTaskGroup: TaskEventGroup = {
  parentTask: baseParentTask,
  subTaskEvents: subTaskEvents,
  toolCallCount: 2,
  latestEvent: subTaskEvents[subTaskEvents.length - 1],
  hasPendingApproval: false,
}

const taskGroupWithApproval: TaskEventGroup = {
  parentTask: baseParentTask,
  subTaskEvents: [...subTaskEvents, ...subTaskWithApproval],
  toolCallCount: 3,
  latestEvent: subTaskWithApproval[0],
  hasPendingApproval: true,
}

const completedTaskGroup: TaskEventGroup = {
  parentTask: {
    ...baseParentTask,
    isCompleted: true,
  },
  subTaskEvents: subTaskEvents.map(event => ({ ...event, isCompleted: true })),
  toolCallCount: 2,
  latestEvent: subTaskEvents[subTaskEvents.length - 1],
  hasPendingApproval: false,
}

// Stories
export const CollapsedRunning: Story = {
  args: {
    group: baseTaskGroup,
    session: mockSession,
    isExpanded: false,
    onToggle: () => console.log('Toggle clicked'),
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
    toolResultsByKey: {},
    focusedEventId: null,
  },
  parameters: {
    docs: {
      description: {
        story: 'Shows a collapsed task group that is currently running.',
      },
    },
  },
}

export const CollapsedWithApproval: Story = {
  args: {
    ...CollapsedRunning.args,
    group: taskGroupWithApproval,
  },
  parameters: {
    docs: {
      description: {
        story: 'Shows a collapsed task group with a pending approval.',
      },
    },
  },
}

export const CollapsedCompleted: Story = {
  args: {
    ...CollapsedRunning.args,
    group: completedTaskGroup,
  },
  parameters: {
    docs: {
      description: {
        story: 'Shows a collapsed task group that has completed.',
      },
    },
  },
}

export const CollapsedInterrupted: Story = {
  args: {
    ...CollapsedRunning.args,
    session: {
      ...mockSession,
      status: SessionStatus.Interrupted,
    },
  },
  parameters: {
    docs: {
      description: {
        story: 'Shows a collapsed task group with interrupted session badge.',
      },
    },
  },
}

export const ExpandedRunning: Story = {
  args: {
    ...CollapsedRunning.args,
    isExpanded: true,
  },
  parameters: {
    docs: {
      description: {
        story: 'Shows an expanded task group with sub-events visible.',
      },
    },
  },
}

export const ExpandedWithApproval: Story = {
  args: {
    ...CollapsedRunning.args,
    group: taskGroupWithApproval,
    isExpanded: true,
  },
  parameters: {
    docs: {
      description: {
        story: 'Shows an expanded task group with a pending approval in a sub-task.',
      },
    },
  },
}

export const ExpandedCompleted: Story = {
  args: {
    ...CollapsedRunning.args,
    group: completedTaskGroup,
    isExpanded: true,
  },
  parameters: {
    docs: {
      description: {
        story: 'Shows an expanded completed task group with all sub-tasks visible.',
      },
    },
  },
}

export const FocusedCollapsed: Story = {
  args: {
    ...CollapsedRunning.args,
    isFocused: true,
  },
  parameters: {
    docs: {
      description: {
        story: 'Shows a focused collapsed task group with highlighted border.',
      },
    },
  },
}

export const FocusedExpanded: Story = {
  args: {
    ...CollapsedRunning.args,
    isExpanded: true,
    isFocused: true,
  },
  parameters: {
    docs: {
      description: {
        story: 'Shows a focused expanded task group.',
      },
    },
  },
}

// Complex task group with many sub-tasks
const complexTaskGroup: TaskEventGroup = {
  parentTask: {
    ...baseParentTask,
    toolInputJson: JSON.stringify({
      description: 'Refactor entire authentication system',
      prompt: 'Analyze and refactor the authentication system to use JWT tokens and improve security',
      subagent_type: 'general-purpose',
    }),
  },
  subTaskEvents: [
    ...subTaskEvents,
    {
      approvalId: undefined,
      approvalStatus: undefined,
      claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
      content: 'Found 15 files related to authentication. Analyzing current implementation...',
      createdAt: new Date('2025-09-22T10:00:25Z'),
      eventType: 'message' as const,
      id: 105,
      isCompleted: false,
      role: 'assistant' as const,
      sequence: 15,
      sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
      parentToolUseId: 'task-100',
    },
    {
      approvalId: undefined,
      approvalStatus: undefined,
      claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
      content: undefined,
      createdAt: new Date('2025-09-22T10:00:30Z'),
      eventType: 'tool_call' as const,
      id: 106,
      isCompleted: true,
      role: 'assistant' as const,
      sequence: 16,
      sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
      toolName: 'Bash',
      toolId: 'bash-106',
      parentToolUseId: 'task-100',
      toolInputJson: JSON.stringify({
        command: 'npm list jsonwebtoken',
        description: 'Check if JWT library is installed',
      }),
    },
    {
      approvalId: undefined,
      approvalStatus: undefined,
      claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
      content: undefined,
      createdAt: new Date('2025-09-22T10:00:35Z'),
      eventType: 'tool_call' as const,
      id: 107,
      isCompleted: false,
      role: 'assistant' as const,
      sequence: 17,
      sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
      toolName: 'TodoWrite',
      toolId: 'todo-107',
      parentToolUseId: 'task-100',
      toolInputJson: JSON.stringify({
        todos: [
          {
            content: 'Analyze current auth implementation',
            status: 'completed',
            activeForm: 'Analyzing',
          },
          { content: 'Design JWT token structure', status: 'completed', activeForm: 'Designing' },
          {
            content: 'Implement JWT generation',
            status: 'in_progress',
            activeForm: 'Implementing JWT',
          },
          { content: 'Update login endpoint', status: 'pending', activeForm: 'Updating endpoint' },
          { content: 'Add refresh token logic', status: 'pending', activeForm: 'Adding refresh' },
          { content: 'Test authentication flow', status: 'pending', activeForm: 'Testing' },
        ],
      }),
    },
  ],
  toolCallCount: 5,
  latestEvent: null,
  hasPendingApproval: false,
}

export const ComplexTaskGroup: Story = {
  args: {
    ...CollapsedRunning.args,
    group: complexTaskGroup,
    isExpanded: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Shows a complex task group with many different types of sub-tasks.',
      },
    },
  },
}

export const ComplexTaskGroupExpanded: Story = {
  args: {
    ...ComplexTaskGroup.args,
    isExpanded: true,
  },
  parameters: {
    docs: {
      description: {
        story: 'Shows a complex expanded task group with various sub-task types visible.',
      },
    },
  },
}

// Web research task group
const webResearchTaskGroup: TaskEventGroup = {
  parentTask: {
    ...baseParentTask,
    toolInputJson: JSON.stringify({
      description: 'Research React 19 features',
      prompt: 'Find the latest information about React 19 features and breaking changes',
      subagent_type: 'web-search-researcher',
    }),
  },
  subTaskEvents: [
    {
      approvalId: undefined,
      approvalStatus: undefined,
      claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
      content: undefined,
      createdAt: new Date('2025-09-22T10:00:40Z'),
      eventType: 'tool_call' as const,
      id: 108,
      isCompleted: true,
      role: 'assistant' as const,
      sequence: 18,
      sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
      toolName: 'WebSearch',
      toolId: 'search-108',
      parentToolUseId: 'task-100',
      toolInputJson: JSON.stringify({
        query: 'React 19 new features 2025',
      }),
    },
    {
      approvalId: undefined,
      approvalStatus: undefined,
      claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
      content: undefined,
      createdAt: new Date('2025-09-22T10:00:45Z'),
      eventType: 'tool_call' as const,
      id: 109,
      isCompleted: false,
      role: 'assistant' as const,
      sequence: 19,
      sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
      toolName: 'WebFetch',
      toolId: 'fetch-109',
      parentToolUseId: 'task-100',
      toolInputJson: JSON.stringify({
        url: 'https://react.dev/blog/2025/01/15/react-19',
        prompt: 'Extract the key features and breaking changes',
      }),
    },
  ],
  toolCallCount: 2,
  latestEvent: null,
  hasPendingApproval: false,
}

export const WebResearchTask: Story = {
  args: {
    ...CollapsedRunning.args,
    group: webResearchTaskGroup,
  },
  parameters: {
    docs: {
      description: {
        story: 'Shows a web research task group with WebSearch and WebFetch sub-tasks.',
      },
    },
  },
}

export const WebResearchTaskExpanded: Story = {
  args: {
    ...WebResearchTask.args,
    isExpanded: true,
  },
  parameters: {
    docs: {
      description: {
        story: 'Shows an expanded web research task group.',
      },
    },
  },
}

// Edge case: Empty sub-tasks (task just started)
const emptyTaskGroup: TaskEventGroup = {
  parentTask: baseParentTask,
  subTaskEvents: [],
  toolCallCount: 0,
  latestEvent: null,
  hasPendingApproval: false,
}

export const EmptyTaskGroup: Story = {
  args: {
    ...CollapsedRunning.args,
    group: emptyTaskGroup,
  },
  parameters: {
    docs: {
      description: {
        story: 'Shows a task group that just started with no sub-tasks yet.',
      },
    },
  },
}

// Multiple task groups in sequence (simulating actual usage)
export const MultipleTaskGroups: Story = {
  render: args => (
    <div className="space-y-0">
      <TaskGroupEventRow {...args} group={completedTaskGroup} isExpanded={false} />
      <TaskGroupEventRow {...args} group={baseTaskGroup} isExpanded={true} />
      <TaskGroupEventRow {...args} group={taskGroupWithApproval} isExpanded={false} isLast={true} />
    </div>
  ),
  args: {
    ...CollapsedRunning.args,
  },
  parameters: {
    docs: {
      description: {
        story: 'Shows multiple task groups as they would appear in a conversation stream.',
      },
    },
  },
}
