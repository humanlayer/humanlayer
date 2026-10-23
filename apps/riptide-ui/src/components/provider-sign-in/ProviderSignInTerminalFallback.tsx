import { CLAUDE_SIGN_IN_VARIANT, CODING_AGENT_SETUP_VARIANTS } from '@/lib/coding-agent-setup'

import type { ProviderSignInProvider } from './ProviderSignInCard'
import { SetupCommandList } from './SetupCommandList'

const TERMINAL_COMMANDS: Record<ProviderSignInProvider, readonly string[]> = {
	claude: CLAUDE_SIGN_IN_VARIANT.setupCommands,
	codex: CODING_AGENT_SETUP_VARIANTS['codelayer:codex'].setupCommands,
}

/** The pre-in-app sign-in path, tucked behind a collapsed disclosure so it stays a fallback. */
export function ProviderSignInTerminalFallback({ provider }: { provider: ProviderSignInProvider }) {
	return (
		<details className="text-xs text-muted-foreground">
			<summary className="cursor-pointer hover:text-foreground">Use the terminal instead</summary>
			<div className="mt-2">
				<SetupCommandList commands={TERMINAL_COMMANDS[provider]} />
			</div>
		</details>
	)
}
