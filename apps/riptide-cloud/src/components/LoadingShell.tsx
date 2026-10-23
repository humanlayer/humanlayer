import { CodeLayerToaster } from '@humanlayer/ui/components/CodeLayerToaster'
import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'
import type { ReactNode } from 'react'

export function FullScreenShell({ children }: { children: ReactNode }) {
	return (
		<div className="flex flex-col min-h-dvh h-dvh max-h-dvh bg-background text-foreground">
			<CodeLayerToaster />
			<main className="flex-1 overflow-auto">{children}</main>
		</div>
	)
}

export function LoadingShell() {
	return (
		<FullScreenShell>
			<div className="flex h-full items-center justify-center">
				<SyncGridAnimation variant="snake" speed={120} className="w-8 text-muted-foreground" />
			</div>
		</FullScreenShell>
	)
}
