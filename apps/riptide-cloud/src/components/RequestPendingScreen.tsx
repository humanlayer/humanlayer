import type { RiptideApiOutputs } from '@humanlayer/riptide-api-contract/contract-router'
import { Badge } from '@humanlayer/ui/components/badge'
import { Button } from '@humanlayer/ui/components/button'
import { Card } from '@humanlayer/ui/components/card'
import { isDefinedError } from '@orpc/client'
import { useMutation } from '@tanstack/react-query'
import { useAuth } from '@workos-inc/authkit-react'
import { Clock } from 'lucide-react'
import { useState } from 'react'

import { useRiptideApi } from '@/api/client'

import { InvitationPendingScreen } from './InvitationPendingScreen'
import {
	accessRequestCardClass,
	accessRequestDescriptionClass,
	accessRequestFooterClass,
	accessRequestGhostButtonClass,
	accessRequestHeadingClass,
	accessRequestMonoStyle,
	accessRequestShellClass,
} from './RequestAccessLoggedIn'
import type { ArtifactInfoInaccessible } from './RequestAccessScreen'

type RequestLookup = Extract<RiptideApiOutputs['public']['artifacts']['info'], { exists: true; accessible: false }>

export function RequestPendingScreen({ artifactId, lookup }: { artifactId: string; lookup: RequestLookup }) {
	const { user } = useAuth()
	const { queryClient: apiQueryClient } = useRiptideApi()
	const [retryAfter, setRetryAfter] = useState<string | null>(null)
	const [errorMessage, setErrorMessage] = useState<string | null>(null)
	const [invited, setInvited] = useState(false)

	const requestAgainMutation = useMutation(
		apiQueryClient.public.accessRequests.create.mutationOptions({
			onMutate: () => setErrorMessage(null),
			onSuccess: (result) => {
				setRetryAfter(null)
				if (result.alreadyInvited) setInvited(true)
			},
			onError: (error) => {
				if (isDefinedError(error) && error.code === 'ALREADY_REQUESTED_ACCESS') {
					setRetryAfter(error.data.retryAfter)
					return
				}

				setErrorMessage(error.message || 'Unable to request again. Please try later.')
			},
		}),
	)

	if (invited) {
		return <InvitationPendingScreen lookup={lookup} />
	}

	return (
		<RequestPendingScreenView
			lookup={lookup}
			variant={user?.id ? 'logged-in' : 'anonymous'}
			email={user?.email ?? undefined}
			retryAfter={retryAfter}
			isSubmitting={requestAgainMutation.isPending}
			errorMessage={errorMessage}
			onRequestAgain={
				user?.id
					? () => requestAgainMutation.mutate({ artifactId, email: user?.email ?? undefined })
					: undefined
			}
		/>
	)
}

export function RequestPendingScreenView({
	lookup,
	variant,
	email,
	retryAfter,
	isSubmitting = false,
	errorMessage,
	onRequestAgain,
	onStartOver,
}: {
	lookup: ArtifactInfoInaccessible
	variant: 'logged-in' | 'anonymous'
	email?: string
	retryAfter?: string | null
	isSubmitting?: boolean
	errorMessage?: string | null
	onRequestAgain?: () => void
	onStartOver?: () => void
}) {
	const retryHint = retryAfter ? formatRetryHint(retryAfter) : null

	return (
		<div className={accessRequestShellClass} style={accessRequestMonoStyle}>
			<Card className={`${accessRequestCardClass} !max-w-[440px]`}>
				<Clock className="mx-auto mb-3 h-12 w-12 text-[#f9e2af]" />
				<h2 className={accessRequestHeadingClass}>Request Pending</h2>
				<Badge
					variant="outline"
					className="mx-auto mb-4 w-fit border-[#f9e2af] bg-[rgba(249,226,175,0.2)] px-2 py-0.5 text-[10px] uppercase tracking-[0.05em] text-[#f9e2af]"
				>
					Awaiting Approval
				</Badge>
				<p className={accessRequestDescriptionClass}>
					{variant === 'anonymous' ? (
						<>
							Your request is in the queue. An admin at {lookup.organizationName} will email you an invite
							if approved
							{email ? (
								<>
									{' - check your inbox for '}
									<strong className="font-semibold text-[#cdd6f4]">{email}</strong>.
								</>
							) : (
								'.'
							)}
						</>
					) : (
						"You've already requested access to this organization. We'll notify you by email when your request is approved."
					)}
				</p>

				<RequestInfo lookup={lookup} email={variant === 'anonymous' ? email : undefined} />

				{variant === 'logged-in' ? (
					<>
						<Button
							disabled={isSubmitting}
							className="mb-2 h-auto min-h-0 w-full rounded-none border border-[#45475a] !bg-transparent px-4 py-2 text-[12px] uppercase tracking-[0.05em] !text-[#cba6f7] hover:border-[#cba6f7] hover:!bg-transparent disabled:cursor-not-allowed disabled:opacity-50"
							onClick={onRequestAgain}
						>
							{isSubmitting ? 'Requesting...' : 'Request Again'}
						</Button>
						<p className="mb-4 text-[10px] text-[#a6adc8]">
							{retryHint ?? 'This will send another notification to all admins'}
						</p>
					</>
				) : (
					<>
						<Button
							disabled
							className="mb-2 h-auto min-h-0 w-full rounded-none border border-[#45475a] !bg-transparent px-4 py-2 text-[12px] uppercase tracking-[0.05em] !text-[#cba6f7] disabled:cursor-not-allowed disabled:opacity-50"
						>
							Request Again
						</Button>
						<p className="mb-4 text-[10px] text-[#a6adc8]">You can re-request once per day.</p>
					</>
				)}

				{variant === 'logged-in' ? (
					<Button variant="ghost" className={accessRequestGhostButtonClass} asChild>
						<a href="/">Back to Home</a>
					</Button>
				) : null}

				{variant === 'logged-in' && email ? (
					<div className={accessRequestFooterClass}>Logged in as {email}</div>
				) : null}
				{variant === 'anonymous' ? (
					<div className={accessRequestFooterClass}>
						Wrong email?{' '}
						{onStartOver ? (
							<button
								type="button"
								onClick={onStartOver}
								className="cursor-pointer border-0 bg-transparent p-0 text-[#cba6f7] no-underline hover:underline"
							>
								Start over
							</button>
						) : (
							<a href="." className="text-[#cba6f7] no-underline hover:underline">
								Start over
							</a>
						)}{' '}
						&nbsp;&middot;&nbsp; Have an account?{' '}
						<a href="/auth/signin" className="text-[#cba6f7] no-underline hover:underline">
							Sign in
						</a>
					</div>
				) : null}
				{errorMessage ? <p className="mt-3 text-[12px] text-destructive">{errorMessage}</p> : null}
			</Card>
		</div>
	)
}

function RequestInfo({ lookup, email }: { lookup: ArtifactInfoInaccessible; email?: string }) {
	return (
		<div className="mb-4 border border-[#45475a] bg-[#313244] p-3 text-left text-[11px] leading-tight text-[#cdd6f4]">
			<RequestInfoRow label="Organization:" value={lookup.organizationName} />
			{email ? <RequestInfoRow label="Your email:" value={email} /> : null}
			<RequestInfoRow label="Requested:" value={formatRequestedAt(lookup.lastRequestedAt)} />
		</div>
	)
}

function RequestInfoRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="mb-1 flex justify-between gap-3 last:mb-0">
			<span className="text-[#a6adc8]">{label}</span>
			<span className="truncate text-right">{value}</span>
		</div>
	)
}

function formatRequestedAt(value: string | null) {
	if (!value) return 'Just now'
	const requestedAt = new Date(value)
	if (Number.isNaN(requestedAt.getTime())) return 'Recently'
	const distance = formatRelativeDistance(requestedAt, new Date())
	return distance === 'just now' ? distance : `${distance} ago`
}

function formatRetryHint(value: string) {
	const retryAt = new Date(value)
	if (Number.isNaN(retryAt.getTime())) return 'You can re-request once per day.'

	const now = new Date()
	if (retryAt <= now) return 'This will send another notification to all admins'

	return `You can re-request once per day - try again in ${formatRelativeDistance(now, retryAt)}`
}

function formatRelativeDistance(from: Date, to: Date) {
	const diffMs = Math.max(0, to.getTime() - from.getTime())
	const minutes = Math.round(diffMs / 60_000)
	if (minutes < 1) return 'just now'
	if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`

	const hours = Math.round(minutes / 60)
	if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`

	const days = Math.round(hours / 24)
	return `${days} day${days === 1 ? '' : 's'}`
}
