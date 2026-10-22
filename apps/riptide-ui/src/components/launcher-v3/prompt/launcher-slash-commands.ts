import type { SlashCommand } from '@humanlayer/ui/components/rich-text-editor'
import { HUMANLAYER_SLASH_COMMANDS } from '@humanlayer/ui/constants/humanlayer-skills'
import { RPI_SLASH_COMMANDS } from '@humanlayer/ui/constants/rpi-skills'

// New tasks can invoke bundled skills, but have no session to compact yet.
export const LAUNCHER_FALLBACK_SLASH_COMMANDS: SlashCommand[] = [...HUMANLAYER_SLASH_COMMANDS, ...RPI_SLASH_COMMANDS]
