import { Button } from '@humanlayer/ui/components/button'
import { ExternalLink, Link2, RefreshCw } from 'lucide-react'
import { type FC, useState } from 'react'

export interface IntegrationCTAProps {
	name: string
	needsReauth: boolean
	isAdmin: boolean
	/** Undefined when the build has no cloud origin; onOpenExternal then says so. */
	settingsUrl: string | undefined
	onOpenExternal: (e: React.MouseEvent) => void
	onConnect?: () => Promise<void>
}

export const IntegrationCTA: FC<IntegrationCTAProps> = ({
	name,
	needsReauth,
	isAdmin,
	settingsUrl,
	onOpenExternal,
	onConnect,
}) => {
	const [isPending, setIsPending] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const Icon = needsReauth ? RefreshCw : Link2
	const action = needsReauth ? 'Reconnect' : 'Connect'

	const handleConnect = async () => {
		if (!onConnect || isPending) return
		setError(null)
		setIsPending(true)
		try {
			await onConnect()
		} catch {
			setError(`Unable to ${action.toLowerCase()} ${name}. Open settings to try again.`)
		} finally {
			setIsPending(false)
		}
	}

	return (
		<div className="rounded-lg border border-dashed border-muted-foreground/25 px-4 py-3">
			<div className="flex items-start gap-3">
				<div className="rounded-md bg-muted p-2 mt-0.5">
					<Icon className="size-4 text-muted-foreground" />
				</div>
				<div className="flex-1 space-y-1.5">
					<p className="text-sm font-medium">
						{action} {name}
					</p>
					<p className="text-xs text-muted-foreground">
						{isAdmin
							? `${action} your ${name} integration to import tickets directly.`
							: `Ask your admin to ${action.toLowerCase()} ${name} to enable ticket import.`}
					</p>
					{isAdmin && (
						<div className="flex flex-wrap items-center gap-2 pt-0.5">
							{onConnect && (
								<Button type="button" size="sm" onClick={handleConnect} disabled={isPending}>
									{isPending ? `${action}ing...` : `${action} ${name}`}
								</Button>
							)}
							<a
								href={settingsUrl}
								onClick={onOpenExternal}
								className="inline-flex items-center gap-1 text-xs text-accent hover:text-accent/80 transition-colors"
							>
								Open settings
								<ExternalLink className="size-3" />
							</a>
						</div>
					)}
					{error && (
						<p role="alert" className="text-xs text-destructive">
							{error}
						</p>
					)}
				</div>
			</div>
		</div>
	)
}
