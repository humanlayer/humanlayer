import type { Meta, StoryObj } from '@storybook/react'
import { ConversationEventRow } from './ConversationEventRow'
import type { ConversationEvent } from '@humanlayer/hld-sdk'

const meta = {
  title: 'Internal/ConversationEventRow',
  component: ConversationEventRow,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  decorators: [
    Story => (
      <div className="border border-border p-4 w-full mx-8">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ConversationEventRow>

export default meta
type Story = StoryObj<typeof meta>

const baseUserEvent: ConversationEvent = {
  approvalId: undefined,
  approvalStatus: undefined,
  claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
  content: 'Just say hello',
  createdAt: new Date('2025-09-18T18:44:46Z'),
  eventType: 'message' as const,
  id: 1,
  isCompleted: false,
  role: 'user' as const,
  sequence: 1,
  sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
}

export const UserMessage: Story = {
  args: {
    event: baseUserEvent,
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
  },
}

export const UserMessageLongUnbrokenText: Story = {
  args: {
    ...UserMessage.args,
    event: {
      ...baseUserEvent,
      content: "Thisisaverylongmessagethatwillneverendnomatterhowhardyoutryitremainsthelongestlineintheworldandwilljustgoonandonandonandonuntileitherthiscomputerimplodesarethissolarsystemreachesitsinevitablesundeath",
    },
  },
}

const baseAssistantEvent: ConversationEvent = {
  approvalId: undefined,
  approvalStatus: undefined,
  claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
  content: 'Hello! How can I help you today?',
  createdAt: new Date('2025-09-18T18:44:47Z'),
  eventType: 'message' as const,
  id: 2,
  isCompleted: false,
  role: 'assistant' as const,
  sequence: 2,
  sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
}

export const AssistantMessage: Story = {
  args: {
    event: baseAssistantEvent,
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
  },
}

export const AssistantThinking: Story = {
  args: {
    ...AssistantMessage.args,
    event: {
      ...baseAssistantEvent,
      eventType: 'thinking' as const,
      content: '',
    },
  },
}

export const AssistantThinkingWithContent: Story = {
  args: {
    ...AssistantMessage.args,
    event: {
      ...baseAssistantEvent,
      content: '<thinking>I need to analyze this request carefully...</thinking>',
    },
  },
}

export const AssistantWithCodeBlock: Story = {
  args: {
    ...AssistantMessage.args,
    event: {
      ...baseAssistantEvent,
      content: `Here's a simple Python function:

\`\`\`python
def hello_world():
    print("Hello, World!")
    return True
\`\`\`

This function prints a greeting and returns True.`,
    },
  },
}

export const AssistantLongMessage: Story = {
  args: {
    ...AssistantMessage.args,
    event: {
      ...baseAssistantEvent,
      content: `I'll help you understand this complex topic. Let me break it down into several parts:

## Part 1: Introduction
This is a comprehensive explanation that covers multiple aspects of the subject. We'll explore various dimensions and provide detailed insights.

## Part 2: Technical Details
The technical implementation involves several key components:
- Component A: Handles the primary processing
- Component B: Manages the data flow
- Component C: Provides the user interface

## Part 3: Best Practices
When implementing this solution, consider these important factors:
1. Always validate input data
2. Implement proper error handling
3. Optimize for performance
4. Write comprehensive tests

## Part 4: Conclusion
By following these guidelines, you'll be able to create a robust and maintainable solution that meets all requirements.`,
    },
  },
}

// Stories that demonstrate copy functionality
export const UserMessageFocused: Story = {
  args: {
    ...UserMessage.args,
    isFocused: true,
    event: {
      ...baseUserEvent,
      content: 'This message is focused and should show the copy button on hover',
    },
  },
  parameters: {
    docs: {
      description: {
        story: 'Shows a focused user message. The copy button becomes visible on hover.',
      },
    },
  },
}

export const AssistantMessageFocused: Story = {
  args: {
    ...AssistantMessage.args,
    isFocused: true,
    event: {
      ...baseAssistantEvent,
      content: 'This assistant message is focused. The copy button appears when you hover over the row.',
    },
  },
  parameters: {
    docs: {
      description: {
        story: 'Shows a focused assistant message. The copy button becomes visible on hover.',
      },
    },
  },
}

export const MessageWithMultiLineContent: Story = {
  args: {
    ...UserMessage.args,
    event: {
      ...baseUserEvent,
      content: `Please help me with this multi-line request.
I need to:
1. Parse this data
2. Transform it into a new format
3. Save it to a database

Can you provide a solution?`,
    },
  },
  parameters: {
    docs: {
      description: {
        story: 'Shows a message with multi-line content. The copy button will copy all content including line breaks.',
      },
    },
  },
}

// Tool call stories
const baseBashToolEvent: ConversationEvent = {
  approvalId: 'approval-123',
  approvalStatus: 'pending' as const,
  claudeSessionId: 'a3751d3f-c6c5-402b-a7c6-a6fdfeaf6cd9',
  content: undefined,
  createdAt: new Date('2025-09-18T18:44:48Z'),
  eventType: 'tool_call' as const,
  id: 3,
  isCompleted: false,
  role: 'assistant' as const,
  sequence: 3,
  sessionId: '08f00f98-d110-40e1-8d0b-fdec7f594f18',
  toolName: 'Bash',
  toolInputJson: JSON.stringify({
    command: 'ls -la',
    description: 'List all files in current directory',
  }),
}

export const BashToolCallPending: Story = {
  args: {
    event: baseBashToolEvent,
    shouldIgnoreMouseEvent: () => false,
    setFocusedEventId: () => {},
    setFocusSource: () => {},
    isFocused: false,
    isLast: true,
    responseEditorIsFocused: false,
  },
}

export const BashToolCallApproved: Story = {
  args: {
    ...BashToolCallPending.args,
    event: {
      ...baseBashToolEvent,
      approvalStatus: 'approved' as const,
    },
  },
}

export const BashToolCallCompleted: Story = {
  args: {
    ...BashToolCallPending.args,
    event: {
      ...baseBashToolEvent,
      approvalStatus: 'approved' as const,
      isCompleted: true,
    },
  },
}

export const BashToolCallDenied: Story = {
  args: {
    ...BashToolCallPending.args,
    event: {
      ...baseBashToolEvent,
      approvalStatus: 'denied' as const,
    },
  },
}

export const BashToolCallWithTimeout: Story = {
  args: {
    ...BashToolCallPending.args,
    event: {
      ...baseBashToolEvent,
      toolInputJson: JSON.stringify({
        command: 'npm install',
        description: 'Install dependencies',
        timeout: 60000,
      }),
    },
  },
}

export const BashToolCallBackgroundJob: Story = {
  args: {
    ...BashToolCallPending.args,
    event: {
      ...baseBashToolEvent,
      toolInputJson: JSON.stringify({
        command: 'npm run dev',
        description: 'Start development server',
        run_in_background: true,
      }),
    },
  },
}

export const BashToolCallLongCommand: Story = {
  args: {
    ...BashToolCallPending.args,
    event: {
      ...baseBashToolEvent,
      toolInputJson: JSON.stringify({
        command: 'git log --graph --pretty=format:"%Cred%h%Creset -%C(yellow)%d%Creset %s %Cgreen(%cr) %C(bold blue)<%an>%Creset" --abbrev-commit --date=relative --branches',
        description: 'Show git history with graph',
      }),
    },
  },
}