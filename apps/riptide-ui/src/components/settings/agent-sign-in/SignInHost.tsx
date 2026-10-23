import { cn } from '@humanlayer/ui/lib/utils'
import type { ReactNode } from 'react'

export function SignInHost({ dimmed = false, children }: { dimmed?: boolean; children: ReactNode }) {
	return <section className={cn('grid gap-0.5', dimmed && 'opacity-60')}>{children}</section>
}

export function SignInHostHeader({
	name,
	shortId,
	online,
	isThisComputer = false,
	children,
}: {
	name: string
	shortId: string | null
	online: boolean
	isThisComputer?: boolean
	children?: ReactNode
}) {
	return (
		<div
			className={cn(
				'flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm',
				isThisComputer ? 'bg-accent/15' : 'bg-foreground/[0.07]',
			)}
		>
			<span
				className={cn(
					'size-1.5 shrink-0 rounded-full',
					online ? 'bg-[var(--terminal-success)]' : 'bg-muted-foreground',
				)}
			/>
			<span className="font-medium text-foreground">{name}</span>
			{isThisComputer ? (
				<span className="bg-accent/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-accent">
					This computer
				</span>
			) : null}
			{shortId ? <span className="font-mono text-xs text-muted-foreground">{shortId}</span> : null}
			<div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">{children}</div>
		</div>
	)
}

export function SignInAgentRow({ name, children }: { name: string; children: ReactNode }) {
	return (
		<div className="grid grid-cols-[7.5rem_minmax(0,1fr)_auto] items-start gap-x-4 gap-y-3 bg-foreground/[0.035] px-4 py-3 text-sm">
			<span className="pt-px font-medium text-foreground">{name}</span>
			{children}
		</div>
	)
}

export type SignInStatusTone = 'ready' | 'failed' | 'active' | 'idle'

const STATUS_TONE_CLASS: Record<SignInStatusTone, string> = {
	ready: 'text-[var(--terminal-success)]',
	failed: 'text-destructive',
	active: 'text-accent',
	idle: 'text-muted-foreground',
}

export function SignInRowStatus({
	label,
	tone,
	children,
}: {
	label: string
	tone: SignInStatusTone
	children?: ReactNode
}) {
	return (
		<div className="min-w-0 space-y-1 text-xs text-muted-foreground">
			<p className={cn('text-[10px] uppercase tracking-wider', STATUS_TONE_CLASS[tone])}>{label}</p>
			{children}
		</div>
	)
}

export function SignInRowActions({ children }: { children?: ReactNode }) {
	return <div className="flex items-center justify-end gap-2">{children}</div>
}

export function SignInRowDetail({ children }: { children: ReactNode }) {
	return <div className="col-span-2 col-start-2 min-w-0 space-y-2 text-sm text-muted-foreground">{children}</div>
}
