import { describe } from 'vitest'

export function hasRealClaudeTestEnv(): boolean {
	if (process.env.CI === 'true') {
		return false
	}

	return process.env.RIPTIDE_RUN_REAL_CLAUDE_TESTS === 'true' && Boolean(process.env.ANTHROPIC_API_KEY)
}

export const describeRealClaude = hasRealClaudeTestEnv() ? describe : describe.skip
