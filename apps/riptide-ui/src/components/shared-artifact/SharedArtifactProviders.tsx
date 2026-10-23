import { HotkeysProvider } from '@humanlayer/react-hotkeys-hook'
import type { PropsWithChildren } from 'react'

export function SharedArtifactProviders({ children }: PropsWithChildren) {
	return <HotkeysProvider initiallyActiveScopes={['*', '.']}>{children}</HotkeysProvider>
}
