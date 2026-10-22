import { Button } from '@humanlayer/ui/components/button'
import { Card } from '@humanlayer/ui/components/card'
import { CompanyLogo } from '@humanlayer/ui/components/company-logo'
import { Building2, Lock } from 'lucide-react'

import type { ArtifactInfoInaccessible } from './RequestAccessScreen'

export const accessRequestShellClass = 'flex min-h-full items-center justify-center bg-[#1e1e2e] p-6'
export const accessRequestCardClass =
	'w-full max-w-[400px] gap-0 rounded-none border border-[#45475a] bg-[#1e1e2e] p-8 text-center text-[#cdd6f4] shadow-none'
export const accessRequestMonoStyle = { fontFamily: '"IBM Plex Mono", Consolas, monospace' }
export const accessRequestHeadingClass =
	'mb-2 text-[14px] font-semibold uppercase leading-none tracking-[0.1em] text-[#cdd6f4]'
export const accessRequestDescriptionClass = 'mb-4 text-[12px] leading-[1.5] text-[#a6adc8]'
export const accessRequestPrimaryButtonClass =
	'h-auto min-h-0 w-full rounded-none border border-[#cba6f7] !bg-[rgba(203,166,247,0.2)] px-4 py-2 text-[12px] uppercase tracking-[0.05em] !text-[#cba6f7] hover:!bg-[#cba6f7] hover:!text-[#1e1e2e] disabled:cursor-not-allowed disabled:opacity-50'
export const accessRequestGhostButtonClass =
	'h-auto min-h-0 rounded-none !bg-transparent px-4 py-1 text-[12px] !text-[#a6adc8] hover:!bg-transparent hover:!text-[#cdd6f4]'
export const accessRequestSecondaryButtonClass =
	'h-auto min-h-0 w-full rounded-none border border-[#45475a] !bg-transparent px-4 py-2 text-[12px] uppercase tracking-[0.05em] !text-[#a6adc8] hover:!bg-[#313244] hover:border-[#a6adc8] hover:!text-[#cdd6f4] disabled:cursor-not-allowed disabled:opacity-50'
export const accessRequestFooterClass = 'mt-7 border-t border-[#45475a] pt-3 text-[11px] text-[#a6adc8]'

export function RequestAccessLoggedIn({
	lookup,
	email,
	isSubmitting = false,
	errorMessage,
	onRequestAccess,
}: {
	lookup: ArtifactInfoInaccessible
	email: string
	isSubmitting?: boolean
	errorMessage?: string | null
	onRequestAccess: () => void
}) {
	return (
		<div className={accessRequestShellClass} style={accessRequestMonoStyle}>
			<Card className={accessRequestCardClass}>
				<Lock className="mx-auto mb-3 h-12 w-12 text-[#a6adc8]" />
				<h2 className={accessRequestHeadingClass}>Access Required</h2>
				<p className={accessRequestDescriptionClass}>
					You need to join this organization to view this artifact.
				</p>

				<ArtifactSummary lookup={lookup} />

				<Button
					disabled={isSubmitting}
					className={`mt-2 ${accessRequestPrimaryButtonClass}`}
					onClick={onRequestAccess}
				>
					{isSubmitting ? 'Requesting...' : 'Request Access'}
				</Button>
				<Button variant="ghost" className={`mt-6 ${accessRequestGhostButtonClass}`} asChild>
					<a href="/">Back to Home</a>
				</Button>
				<div className={accessRequestFooterClass}>Logged in as {email}</div>
				{errorMessage ? <p className="mt-3 text-[12px] text-destructive">{errorMessage}</p> : null}
			</Card>
		</div>
	)
}

export function ArtifactSummary({ lookup }: { lookup: ArtifactInfoInaccessible }) {
	return (
		<div className="mb-4 flex items-center gap-2 border border-[#45475a] bg-[#313244] p-3 text-left leading-tight">
			<div className="flex size-6 shrink-0 items-center justify-center">
				{lookup.domain ? (
					<CompanyLogo domain={lookup.domain} className="size-6 rounded-sm" />
				) : (
					<Building2 className="size-5 text-[#a6adc8]" />
				)}
			</div>
			<div className="truncate text-[12px] font-medium text-[#cdd6f4]">{lookup.organizationName}</div>
		</div>
	)
}
