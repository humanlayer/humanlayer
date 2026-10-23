export type AttributableMessage = {
	content: string
	authorDisplayName: string | null
	multiplayerPromptingActive: boolean | null
}

export function buildAttributedPrompt(messages: ReadonlyArray<AttributableMessage>): string {
	return messages
		.map((message) => {
			if (message.multiplayerPromptingActive !== true) return message.content

			const openingTag = message.authorDisplayName
				? `<message from="${escapeXmlAttribute(message.authorDisplayName)}">`
				: '<message>'
			return `${openingTag}\n${message.content}\n</message>`
		})
		.join('\n\n')
}

function escapeXmlAttribute(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
