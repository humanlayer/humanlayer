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