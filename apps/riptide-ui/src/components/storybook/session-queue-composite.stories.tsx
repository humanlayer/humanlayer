import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { uuidv7 } from 'uuidv7'
import { ContinueSessionInputPure } from '../ContinueSessionInput'
import { QueuedMessagesPane } from '../QueuedMessagesPane'

function SessionQueueComposite() {
	const [messages, setMessages] = useState<Array<{ id: string; content: string; created_at: bigint }>>([])
	const [isOpen, setIsOpen] = useState(true)
	const [preferBatchQueueDelivery, setPreferBatchQueueDelivery] = useState(true)

	return (
		<div className="flex h-[600px] flex-col gap-2 bg-background p-4">
			<div className="flex-1 overflow-y-auto rounded-lg border p-4">
				<p className="text-sm text-muted-foreground">[Conversation stream placeholder]</p>
			</div>
			<QueuedMessagesPane
				messages={messages}
				isOpen={isOpen}
				onToggle={() => setIsOpen((prev) => !prev)}
				preferBatchQueueDelivery={preferBatchQueueDelivery}
				capabilities={{ canChangeBatchPreference: true, canDelete: true, canSendNow: true, canEdit: true }}
				onPreferBatchQueueDeliveryChange={setPreferBatchQueueDelivery}
				onDelete={(id) => setMessages((prev) => prev.filter((m) => m.id !== id))}
				onEdit={(id, text) =>
					setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, content: text } : m)))
				}
				onSendNow={(id) => {
					const msg = messages.find((m) => m.id === id)
					if (msg) {
						setMessages((prev) => prev.filter((m) => m.id !== id))
						alert(`[Storybook] Interrupt & send: "${msg.content}"`)
					}
				}}
			/>
			<div className="shrink-0">
				<ContinueSessionInputPure
					sessionId="story-session"
					canPrompt
					canManageSession
					multiplayerPromptingControl={<></>}
					sessionStatus="running"
					onQueue={({ text }) => {
						setMessages((prev) => [...prev, { id: uuidv7(), content: text, created_at: BigInt(Date.now()) }])
						setIsOpen(true)
					}}
					onInterrupt={() => undefined}
					onSubmit={async () => {}}
					isSubmitting={false}
					disabled={false}
					onFocusChange={() => undefined}
					updateSessionModel={() => undefined}
					updateSessionEffort={() => undefined}
					updateSessionFastMode={() => undefined}
				/>
			</div>
		</div>
	)
}

const meta = {
	title: 'Shell Demos/SessionQueueComposite',
	component: SessionQueueComposite,
	parameters: {
		layout: 'fullscreen',
	},
} satisfies Meta<typeof SessionQueueComposite>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
