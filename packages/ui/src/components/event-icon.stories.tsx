import type { Meta, StoryObj } from '@storybook/react'
import { EventIcon } from './event-icon'

const meta: Meta<typeof EventIcon> = {
  title: 'UI/EventIcon',
  component: EventIcon,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="flex items-center gap-4 p-4">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof EventIcon>

export const UserMessage: Story = {
  args: {
    eventType: 'message',
    role: 'user',
  },
}

export const AssistantMessage: Story = {
  args: {
    eventType: 'message',
    role: 'assistant',
  },
}

export const ThinkingAssistant: Story = {
  args: {
    eventType: 'message',
    role: 'assistant',
    isThinking: true,
  },
}

export const ToolCallBash: Story = {
  args: {
    eventType: 'tool_call',
    toolName: 'Bash',
    isCompleted: true,
  },
}

export const ToolCallPending: Story = {
  args: {
    eventType: 'tool_call',
    toolName: 'Edit',
    isCompleted: false,
  },
}

export const ToolCallTask: Story = {
  args: {
    eventType: 'tool_call',
    toolName: 'Task',
    isCompleted: true,
  },
}

export const ToolCallSubAgent: Story = {
  args: {
    eventType: 'tool_call',
    toolName: 'Task',
    isNamedSubagent: true,
    isCompleted: true,
  },
}

export const ToolCallAgent: Story = {
  args: {
    eventType: 'tool_call',
    toolName: 'Agent',
    isCompleted: true,
  },
}

export const ToolCallAgentSubagent: Story = {
  args: {
    eventType: 'tool_call',
    toolName: 'Agent',
    isNamedSubagent: true,
    isCompleted: true,
  },
}

export const ToolCallMCP: Story = {
  args: {
    eventType: 'tool_call',
    toolName: 'mcp__playwright__browser_click',
    isCompleted: true,
  },
}

export const AllToolIcons: Story = {
  render: () => (
    <div className="grid grid-cols-4 gap-4">
      {['Edit', 'Read', 'Write', 'Bash', 'Glob', 'Grep', 'TodoWrite', 'WebSearch', 'ExitPlanMode', 'Task'].map(
        (toolName) => (
          <div key={toolName} className="flex items-center gap-2">
            <EventIcon eventType="tool_call" toolName={toolName} isCompleted={true} />
            <span className="text-xs">{toolName}</span>
          </div>
        ),
      )}
    </div>
  ),
}

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <EventIcon eventType="tool_call" toolName="Bash" isCompleted={true} size="sm" />
      <EventIcon eventType="tool_call" toolName="Bash" isCompleted={true} size="md" />
      <EventIcon eventType="tool_call" toolName="Bash" isCompleted={true} size="lg" />
    </div>
  ),
}
