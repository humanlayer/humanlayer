import type { SlashCommand } from '../components/slash-command-list'

export const HUMANLAYER_SLASH_COMMANDS: SlashCommand[] = [
	{
		name: '/hl:orchestrate',
		source: 'bundled',
	},
	{
		name: '/hl:show-me',
		source: 'bundled',
	},
	{
		name: '/hl:teleport',
		source: 'bundled',
	},
]
