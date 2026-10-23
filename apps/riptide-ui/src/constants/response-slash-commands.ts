import type { SlashCommand } from '@humanlayer/ui/components/rich-text-editor'
import { HUMANLAYER_SLASH_COMMANDS } from '@humanlayer/ui/constants/humanlayer-skills'
import { RPI_SLASH_COMMANDS } from '@humanlayer/ui/constants/rpi-skills'
import { COMPACT_COMMAND, SYSTEM_SLASH_COMMANDS } from '@humanlayer/ui/constants/system-slash-commands'

export const SIMPLE_RESPONSE_RESTATE_COMMAND = '/bro'
export const SIMPLE_RESPONSE_RESTATE_PROMPT =
	'Restate your last message. Stop using jargon and speak coherently. State it more simply and concisely, like one human talking to another.'
export const COMPACT_RESPONSE_COMMAND = COMPACT_COMMAND

export const RESPONSE_SLASH_COMMANDS: SlashCommand[] = [
	{ name: SIMPLE_RESPONSE_RESTATE_COMMAND, source: 'bundled' },
	...SYSTEM_SLASH_COMMANDS,
	...HUMANLAYER_SLASH_COMMANDS,
	...RPI_SLASH_COMMANDS,
]
