import type { ProviderSignInProvider } from '@/components/provider-sign-in/ProviderSignInCard'
import { useSettingsStore } from '@/hooks/stores/settingsStore'

const IN_APP_SIGN_IN_FLAGS = {
	claude: 'claudeInAppSignInEnabled',
	codex: 'codexInAppSignInEnabled',
} as const satisfies Record<ProviderSignInProvider, 'claudeInAppSignInEnabled' | 'codexInAppSignInEnabled'>

/** The provider when its in-app sign-in experiment is on, otherwise null so callers fall back to the terminal. */
export function useInAppSignInProvider(provider: ProviderSignInProvider | null): ProviderSignInProvider | null {
	const enabled = useSettingsStore((state) => (provider ? state[IN_APP_SIGN_IN_FLAGS[provider]] : false))
	return enabled ? provider : null
}
