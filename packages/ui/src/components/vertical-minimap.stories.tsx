import type { Meta, StoryObj } from '@storybook/react'
import { fn } from 'storybook/test'
import { useState } from 'react'
import { VerticalMinimap, type MinimapEvent, type VerticalMinimapProps } from './vertical-minimap'

const MOCK_EVENTS: MinimapEvent[] = [
  { id: 1, eventType: 'message', role: 'user', content: 'Please help me with this task' },
  { id: 2, eventType: 'message', role: 'assistant', content: 'I\'ll help you with that' },
  {
    id: 3,
    eventType: 'tool_call',
    toolName: 'Read',
    toolId: 'read-1',
    isCompleted: true,
    toolInputJson: '{"file_path": "/src/components/Button.tsx"}',
  },
  { id: 4, eventType: 'tool_result' },
  {
    id: 5,
    eventType: 'tool_call',
    toolName: 'Edit',
    toolId: 'edit-1',
    isCompleted: true,
    toolInputJson: '{"file_path": "/src/components/Button.tsx"}',
  },
  { id: 6, eventType: 'tool_result' },
  { id: 7, eventType: 'message', role: 'assistant', content: 'Changes applied successfully' },
  {
    id: 8,
    eventType: 'tool_call',
    toolName: 'Bash',
    toolId: 'bash-1',
    approvalStatus: 'pending',
    isCompleted: false,
    toolInputJson: '{"command": "npm run build && npm test"}',
  },
]

const MOCK_EVENTS_WITH_SUBTASKS: MinimapEvent[] = [
  { id: 1, eventType: 'message', role: 'user', content: 'Run the test suite' },
  { id: 2, eventType: 'message', role: 'assistant', content: 'Running tests...' },
  {
    id: 3,
    eventType: 'tool_call',
    toolName: 'Task',
    toolId: 'task-1',
    isCompleted: true,
    toolInputJson: '{"subagent_type": "TestRunner", "description": "Execute test suite"}',
  },
  // Sub-task events
  { id: 4, eventType: 'message', role: 'assistant', parentToolUseId: 'task-1', content: 'Preparing tests' },
  {
    id: 5,
    eventType: 'tool_call',
    toolName: 'Read',
    toolId: 'read-1',
    parentToolUseId: 'task-1',
    isCompleted: true,
    toolInputJson: '{"file_path": "package.json"}',
  },
  { id: 6, eventType: 'tool_result', parentToolUseId: 'task-1' },
  {
    id: 7,
    eventType: 'tool_call',
    toolName: 'Bash',
    toolId: 'bash-1',
    parentToolUseId: 'task-1',
    isCompleted: true,
    toolInputJson: '{"command": "bun vitest run"}',
  },
  { id: 8, eventType: 'tool_result', parentToolUseId: 'task-1' },
  // Back to root
  { id: 9, eventType: 'message', role: 'assistant', content: 'Tests completed successfully' },
]

const MOCK_EVENTS_WITH_AGENT_SUBTASKS: MinimapEvent[] = [
  { id: 1, eventType: 'message', role: 'user', content: 'Analyze the codebase' },
  { id: 2, eventType: 'message', role: 'assistant', content: 'Launching agent...' },
  {
    id: 3,
    eventType: 'tool_call',
    toolName: 'Agent',
    toolId: 'agent-1',
    isCompleted: true,
    toolInputJson: '{"subagent_type": "codebase-analyzer", "description": "Analyze patterns"}',
  },
  // Sub-task events
  { id: 4, eventType: 'message', role: 'assistant', parentToolUseId: 'agent-1', content: 'Analyzing patterns' },
  {
    id: 5,
    eventType: 'tool_call',
    toolName: 'Grep',
    toolId: 'grep-1',
    parentToolUseId: 'agent-1',
    isCompleted: true,
    toolInputJson: '{"pattern": "auth", "path": "src/"}',
  },
  { id: 6, eventType: 'tool_result', parentToolUseId: 'agent-1' },
  // Back to root
  { id: 7, eventType: 'message', role: 'assistant', content: 'Analysis complete' },
]

const meta = {
  title: 'Shell Demos/VerticalMinimap',
  component: VerticalMinimap as any,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  args: {
    onEventClick: fn(),
  },
  decorators: [
    (Story) => (
      <div className="w-[280px] h-[500px] border rounded-lg p-2 bg-background">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<VerticalMinimapProps>

export default meta
type Story = StoryObj<typeof meta>

// Interactive wrapper
const MinimapWrapper = ({ events, isRunning = false }: { events: MinimapEvent[]; isRunning?: boolean }) => {
  const [focusedId, setFocusedId] = useState<number | null>(null)
  return (
    <VerticalMinimap
      events={events}
      focusedEventId={focusedId}
      onEventClick={setFocusedId}
      isRunning={isRunning}
    />
  )
}

export const Default: Story = {
  render: () => <MinimapWrapper events={MOCK_EVENTS} />,
}

export const Empty: Story = {
  args: {
    events: [],
    focusedEventId: null,
  },
}

export const Running: Story = {
  render: () => <MinimapWrapper events={MOCK_EVENTS} isRunning />,
}

export const WithPendingApproval: Story = {
  render: () => <MinimapWrapper events={MOCK_EVENTS} />,
}

export const WithSubTasks: Story = {
  render: () => <MinimapWrapper events={MOCK_EVENTS_WITH_SUBTASKS} />,
}

export const WithAgentSubTasks: Story = {
  render: () => <MinimapWrapper events={MOCK_EVENTS_WITH_AGENT_SUBTASKS} />,
}

export const FocusedEvent: Story = {
  args: {
    events: MOCK_EVENTS,
    focusedEventId: 5,
  },
}

export const DeniedApproval: Story = {
  render: () => {
    const eventsWithDenied: MinimapEvent[] = [
      { id: 1, eventType: 'message', role: 'user', content: 'Delete all files' },
      { id: 2, eventType: 'message', role: 'assistant', content: 'I need approval' },
      {
        id: 3,
        eventType: 'tool_call',
        toolName: 'Bash',
        toolId: 'bash-1',
        approvalStatus: 'denied',
        isCompleted: false,
        toolInputJson: '{"command": "rm -rf /*"}',
      },
      { id: 4, eventType: 'message', role: 'assistant', content: 'Approval denied, stopping' },
    ]
    return <MinimapWrapper events={eventsWithDenied} />
  },
}

export const ManyEvents: Story = {
  render: () => {
    const manyEvents: MinimapEvent[] = Array.from({ length: 50 }, (_, i) => {
      const isMessage = i % 3 === 0
      const toolNames = ['Read', 'Edit', 'Bash', 'Grep']
      const filePaths = ['/src/app.ts', '/src/utils.ts', '/tests/app.test.ts', '/README.md']

      return {
        id: i + 1,
        eventType: isMessage ? 'message' : 'tool_call',
        role: isMessage ? (i % 6 === 0 ? 'user' : 'assistant') : undefined,
        content: isMessage ? `Message ${i + 1}` : undefined,
        toolName: !isMessage ? toolNames[i % 4] : undefined,
        toolId: !isMessage ? `tool-${i}` : undefined,
        isCompleted: true,
        toolInputJson:
          !isMessage && toolNames[i % 4] !== 'Bash'
            ? `{"file_path": "${filePaths[i % 4]}"}`
            : `{"command": "git status"}`,
      } as MinimapEvent
    })
    return <MinimapWrapper events={manyEvents} />
  },
}
