import { Button } from '@humanlayer/ui/components/button'
import { Link } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import { Lock } from 'lucide-react'
import type { ReactNode } from 'react'

export function CommitTrackingCallout({
	title,
	description,
	recordedSpend,
}: {
	title: string
	description: string
	recordedSpend?: { usd: string; days: number }
}) {
	const { roles } = useAuth()
	const canReachSettings = roles?.includes('admin') ?? false

	return (
		<div className="flex flex-wrap items-start gap-4 border border-amber-500/35 bg-amber-500/5 p-4">
			<Lock className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden="true" />
			<div className="flex min-w-[20rem] flex-1 flex-col gap-1">
				<strong className="font-medium text-sm">{title}</strong>
				<p className="text-muted-foreground text-sm">{description}</p>
				{recordedSpend && (
					<p className="pt-1 text-muted-foreground text-xs">
						<span className="font-medium text-foreground tabular-nums">{recordedSpend.usd}</span> of token
						spend over the last{' '}
						<span className="font-medium text-foreground tabular-nums">{recordedSpend.days}</span> days is
						already recorded, and ready to divide.
					</p>
				)}
			</div>
			{/* /settings refuses non-admins, so offering them the button would dead-end them there. */}
			{canReachSettings ? (
				<Button asChild size="sm">
					<Link to="/settings">Turn on commit tracking</Link>
				</Button>
			) : (
				<p className="text-muted-foreground text-sm">An admin can turn on commit tracking in settings.</p>
			)}
		</div>
	)
}

export function SampleChartPreview({ children }: { children: ReactNode }) {
	return (
		<div className="relative" aria-hidden="true">
			<span className="absolute top-2 right-3 z-10 border border-amber-500/40 bg-background/90 px-2 py-0.5 text-[10px] text-amber-500 uppercase tracking-widest">
				Sample data
			</span>
			<div className="pointer-events-none select-none opacity-40 blur-[2.5px]">{children}</div>
			<div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-background/35 to-background/70" />
		</div>
	)
}
