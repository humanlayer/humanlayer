import type { PermissionUpdate } from '@humanlayer/db/zodschemas/permission-update'

/**
 * Format a PermissionUpdate as a human-readable label for the approval UI.
 * Wraps rule content / paths / modes in backticks for inline-code styling.
 */
export function formatSuggestionLabel(s: PermissionUpdate): string {
	switch (s.type) {
		case 'addRules': {
			const rule = s.rules[0]
			if (!rule) return 'Allow rule'
			return `Allow \`${rule.toolName}\` \`${rule.ruleContent ?? '*'}\``
		}
		case 'addDirectories': {
			if (s.directories.length === 0) return 'Allow directories'
			return `Allow directories: ${s.directories.map((d) => `\`${d}\``).join(', ')}`
		}
		case 'setMode':
			return `Set permission mode to \`${s.mode}\``
		default: {
			const _exhaustive: never = s
			void _exhaustive
			return 'Apply suggestion'
		}
	}
}
