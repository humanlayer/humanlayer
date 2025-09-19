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