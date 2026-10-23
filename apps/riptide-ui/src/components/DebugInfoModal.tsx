import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@humanlayer/ui/components/dialog'
import { useQuery } from '@tanstack/react-query'
import { Bug } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { riptideApiOrigin, useRiptideApi } from '@/orpc/client'

const ENV_VARS = {
	VITE_PUBLIC_RIPTIDE_API_ORIGIN: riptideApiOrigin,
	VITE_PUBLIC_WORKOS_CLIENT_ID: import.meta.env.VITE_PUBLIC_WORKOS_CLIENT_ID,
	VITE_PUBLIC_SENTRY_DSN: import.meta.env.VITE_PUBLIC_SENTRY_DSN,
	VITE_PUBLIC_SYNC_ORIGIN: import.meta.env.VITE_PUBLIC_SYNC_ORIGIN,
	VITE_PUBLIC_POSTHOG_KEY: import.meta.env.VITE_PUBLIC_POSTHOG_KEY,
	VITE_PUBLIC_BUILD_TYPE: import.meta.env.VITE_PUBLIC_BUILD_TYPE,
	VITE_PUBLIC_BUILD_VERSION: import.meta.env.VITE_PUBLIC_BUILD_VERSION,
	DEV: import.meta.env.DEV,
	MODE: import.meta.env.MODE,
	PROD: import.meta.env.PROD,
	BASE_URL: import.meta.env.BASE_URL,
}

function DebugInfoRow({ label, children, valueTitle }: { label: string; children: ReactNode; valueTitle?: string }) {
	return (
		<div className="flex justify-between gap-4">
			<span className="text-muted-foreground shrink-0">{label}</span>
			<span className="text-foreground truncate" title={valueTitle}>
				{children}
			</span>
		</div>
	)
}

export function DebugInfoModal() {
	const [isOpen, setIsOpen] = useState(false)
	const { queryClient } = useRiptideApi()

	const {
		data: userInfoData,
		isLoading: userInfoIsLoading,
		error: userInfoError,
	} = useQuery(
		queryClient.auth.user.info.queryOptions({
			enabled: isOpen,
		}),
	)
	let userInfoContent: ReactNode = <p className="text-muted-foreground">No data</p>
	if (userInfoIsLoading) userInfoContent = <p className="text-muted-foreground">Loading…</p>
	else if (userInfoError) userInfoContent = <p className="text-destructive">Error: {userInfoError.message}</p>
	else if (userInfoData) {
		userInfoContent = (
			<>
				<DebugInfoRow label="userId:">{userInfoData.userId}</DebugInfoRow>
				<DebugInfoRow label="workosOrganizationId:">{userInfoData.workosOrganizationId}</DebugInfoRow>
				<DebugInfoRow label="organizationId:">{userInfoData.organizationId}</DebugInfoRow>
			</>
		)
	}

	return (
		<Dialog open={isOpen} onOpenChange={setIsOpen}>
			<DialogTrigger asChild>
				<button
					type="button"
					aria-label="Open debug information"
					className=" cursor-pointer px-1.5 py-0.5 text-xs font-mono border border-border bg-background text-foreground hover:bg-accent/10 transition-colors focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none"
				>
					<Bug className="w-3 h-3" />
				</button>
			</DialogTrigger>
			<DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Debug Information</DialogTitle>
				</DialogHeader>

				<div className="space-y-6">
					{/* User Info Section */}
					<section>
						<h3 className="text-sm font-semibold mb-2 text-muted-foreground">User Info</h3>
						<div className="bg-muted/50 rounded-md p-3 font-mono text-xs space-y-1">{userInfoContent}</div>
					</section>

					{/* Environment Variables Section */}
					<section>
						<h3 className="text-sm font-semibold mb-2 text-muted-foreground">Environment Variables</h3>
						<div className="bg-muted/50 rounded-md p-3 font-mono text-xs space-y-1">
							{Object.entries(ENV_VARS).map(([key, value]) => (
								<DebugInfoRow key={key} label={`${key}:`} valueTitle={String(value ?? 'undefined')}>
									{value === undefined ? (
										<span className="text-muted-foreground/50">undefined</span>
									) : value === '' ? (
										<span className="text-muted-foreground/50">(empty)</span>
									) : (
										String(value)
									)}
								</DebugInfoRow>
							))}
						</div>
					</section>
				</div>
			</DialogContent>
		</Dialog>
	)
}
