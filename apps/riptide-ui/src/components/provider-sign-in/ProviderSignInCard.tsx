import type { ProviderLoginStatus } from '@humanlayer/db/tables/provider-login-requests'
import { Button } from '@humanlayer/ui/components/button'
import { cn } from '@humanlayer/ui/lib/utils'
import { Copy, ExternalLink, RefreshCw } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { toast } from 'sonner'

import { hasProviderSignIn } from '@/services/coding-agent-auth'

import { hostBlockedMessage, providerSignInStatusLabel } from './provider-sign-in-labels'

export type ProviderSignInProvider = 'claude' | 'codex'

/** Whether the selected host can run a sign-in: it must be online and its daemon new enough to pick one up. */
export type ProviderSignInHost =
	| { readonly state: 'ready' }
	| { readonly state: 'offline' }
	| { readonly state: 'outdated'; readonly daemonVersion: string }

export interface ProviderSignInRequest {
	readonly id: string
	readonly status: ProviderLoginStatus
	readonly url: string | null
	readonly userCode: string | null
	readonly submittedCode: string | null
	readonly error: string | null
	readonly accountLabel: string | null
}

export interface ProviderSignInCardProps {
	provider: ProviderSignInProvider
	request: ProviderSignInRequest | null
	/** Card draws its own border, name and status. Inline renders only the body for a host panel. */
	variant: 'card' | 'inline'
	/** Anything but `ready` disables the sign-in button and says why. */
	host: ProviderSignInHost
	isStarting: boolean
	onSignIn: () => void
	onCancel: (requestId: string) => void
	onSubmitCode: (requestId: string, code: string) => void
	onOpenUrl: (url: string) => void
	onOpenDaemonSettings: () => void
	/** Rendered under the actions, for a terminal fallback. */
	children?: ReactNode
}

const PROVIDER_SIGN_IN_LABELS: Record<ProviderSignInProvider, { name: string; signIn: string }> = {
	claude: { name: 'Claude Code', signIn: 'Sign in to Claude' },
	codex: { name: 'Codex', signIn: 'Sign in to ChatGPT' },
}

const STATUS_TONES: Record<ProviderLoginStatus | 'idle', { badge: string; panel: string }> = {
	idle: { badge: 'text-muted-foreground', panel: 'border-border' },
	requested: { badge: 'text-accent', panel: 'border-accent' },
	awaiting_approval: { badge: 'text-accent', panel: 'border-accent' },
	succeeded: {
		badge: 'text-[var(--terminal-success)]',
		panel: 'border-[var(--terminal-success)]/40 bg-[var(--terminal-success)]/5',
	},
	failed: { badge: 'text-muted-foreground', panel: 'border-border' },
	cancelled: { badge: 'text-muted-foreground', panel: 'border-border' },
}

type SignInButtonSize = 'sm' | 'xs'

const ICON_SIZE: Record<SignInButtonSize, string> = { sm: 'size-3.5', xs: 'size-3' }

function CopyButton({ value, label, size }: { value: string; label: string; size: SignInButtonSize }) {
	return (
		<Button
			type="button"
			variant="ghost"
			size={size}
			onClick={() => void navigator.clipboard.writeText(value).then(() => toast.success(`${label} copied`))}
		>
			<Copy className={ICON_SIZE[size]} /> Copy
		</Button>
	)
}

function PasteCodeForm({
	request,
	size,
	onSubmitCode,
}: {
	request: ProviderSignInRequest
	size: SignInButtonSize
	onSubmitCode: (requestId: string, code: string) => void
}) {
	const [code, setCode] = useState('')
	const isChecking = request.submittedCode !== null
	return (
		<form
			className="flex gap-2"
			onSubmit={(event) => {
				event.preventDefault()
				if (code.trim()) onSubmitCode(request.id, code.trim())
			}}
		>
			<input
				aria-label="Code from the browser"
				className="min-w-0 flex-1 border-b bg-transparent px-1 py-2 font-mono text-xs outline-none focus:border-primary"
				placeholder="Paste the code from the browser"
				value={code}
				disabled={isChecking}
				onChange={(event) => setCode(event.target.value)}
			/>
			<Button type="submit" variant="secondary" size={size} disabled={isChecking || !code.trim()}>
				{isChecking ? 'Checking…' : 'Continue'}
			</Button>
		</form>
	)
}

function AwaitingApproval({
	request,
	url,
	size,
	onSubmitCode,
	onOpenUrl,
}: {
	request: ProviderSignInRequest
	url: string
	size: SignInButtonSize
	onSubmitCode: (requestId: string, code: string) => void
	onOpenUrl: (url: string) => void
}) {
	const usesDeviceCode = request.userCode !== null
	return (
		<div className="space-y-2 bg-accent/10 px-3 py-2.5">
			<div className="flex flex-wrap items-center gap-2">
				<span className="text-foreground">
					{usesDeviceCode ? 'Enter this code on the sign-in page' : 'Approve access in the browser'}
				</span>
				<Button type="button" variant="secondary" size={size} onClick={() => onOpenUrl(url)}>
					<ExternalLink className={ICON_SIZE[size]} /> Open sign-in page
				</Button>
				<CopyButton value={url} label="Link" size={size} />
			</div>
			{request.userCode ? (
				<div className="flex items-center gap-2">
					<code className="bg-muted/60 px-3 py-1.5 text-base tracking-[0.2em] text-foreground">
						{request.userCode}
					</code>
					<CopyButton value={request.userCode} label="Code" size={size} />
				</div>
			) : (
				<PasteCodeForm
					key={request.submittedCode ?? ''}
					request={request}
					size={size}
					onSubmitCode={onSubmitCode}
				/>
			)}
			<p className="text-xs">
				{usesDeviceCode
					? 'This finishes on its own once you approve.'
					: 'The sign-in page shows a code after you approve access. Paste it here.'}
			</p>
		</div>
	)
}

export function ProviderSignInMessages({
	request,
	size = 'sm',
	onSubmitCode,
	onOpenUrl,
}: {
	request: ProviderSignInRequest | null
	size?: SignInButtonSize
	onSubmitCode: (requestId: string, code: string) => void
	onOpenUrl: (url: string) => void
}) {
	const status = request?.status ?? 'idle'
	const approvalUrl = request && request.status === 'awaiting_approval' ? request.url : null
	if (!request?.error && status !== 'requested' && !approvalUrl) return null
	return (
		<div className="space-y-2 text-sm text-muted-foreground">
			{request?.error ? (
				<p className={status === 'failed' || status === 'cancelled' ? 'text-xs' : 'text-destructive'}>
					{request.error}
				</p>
			) : null}
			{status === 'requested' ? <p>Asking the daemon on the host to start the sign-in.</p> : null}
			{request && approvalUrl ? (
				<AwaitingApproval
					request={request}
					url={approvalUrl}
					size={size}
					onSubmitCode={onSubmitCode}
					onOpenUrl={onOpenUrl}
				/>
			) : null}
		</div>
	)
}

function signInLabel(
	status: ProviderLoginStatus | 'idle',
	signIn: string,
	signedIn: boolean,
	size: SignInButtonSize,
): ReactNode {
	if (signedIn) {
		return (
			<>
				<RefreshCw className={ICON_SIZE[size]} /> Sign in again
			</>
		)
	}
	return status === 'failed' ? 'Try again' : signIn
}

export function ProviderSignInAction({
	provider,
	request,
	host,
	isStarting,
	hasWorkingSignIn = false,
	size = 'sm',
	onSignIn,
	onCancel,
}: {
	provider: ProviderSignInProvider
	request: ProviderSignInRequest | null
	host: ProviderSignInHost
	isStarting: boolean
	hasWorkingSignIn?: boolean
	size?: SignInButtonSize
	onSignIn: () => void
	onCancel: (requestId: string) => void
}) {
	const status = request?.status ?? 'idle'
	const isActive = status === 'requested' || status === 'awaiting_approval'
	if (isActive && request) {
		return (
			<Button type="button" variant="ghost" size={size} onClick={() => onCancel(request.id)}>
				Cancel
			</Button>
		)
	}
	const signedIn = hasProviderSignIn(request?.status ?? null, hasWorkingSignIn)
	return (
		<Button
			type="button"
			variant={signedIn ? 'secondary' : 'default'}
			size={size}
			disabled={isStarting || host.state !== 'ready'}
			onClick={onSignIn}
		>
			{signInLabel(status, PROVIDER_SIGN_IN_LABELS[provider].signIn, signedIn, size)}
		</Button>
	)
}

export function ProviderSignInCard({
	provider,
	request,
	variant,
	host,
	isStarting,
	onSignIn,
	onCancel,
	onSubmitCode,
	onOpenUrl,
	onOpenDaemonSettings,
	children,
}: ProviderSignInCardProps) {
	const labels = PROVIDER_SIGN_IN_LABELS[provider]
	const status = request?.status ?? 'idle'
	const tone = STATUS_TONES[status]
	const statusLabel = providerSignInStatusLabel(request)

	const body = (
		<>
			<div className="space-y-2 text-sm text-muted-foreground">
				{status === 'succeeded' && request?.accountLabel ? (
					<p className="text-foreground">{request.accountLabel}</p>
				) : null}
				<ProviderSignInMessages request={request} onSubmitCode={onSubmitCode} onOpenUrl={onOpenUrl} />
				{host.state !== 'ready' && !request ? <p className="text-xs">{hostBlockedMessage(host)}</p> : null}
			</div>
			<div className="mt-3 flex items-center gap-2">
				<ProviderSignInAction
					provider={provider}
					request={request}
					host={host}
					isStarting={isStarting}
					onSignIn={onSignIn}
					onCancel={onCancel}
				/>
				{host.state !== 'ready' && !request ? (
					<Button type="button" variant="ghost" size="sm" onClick={onOpenDaemonSettings}>
						Open host settings
					</Button>
				) : null}
			</div>
			{children ? <div className="mt-3">{children}</div> : null}
		</>
	)

	if (variant === 'inline') return <div className="space-y-2">{body}</div>

	return (
		<div className={cn('min-w-0 rounded-md border p-3', tone.panel)}>
			<div className="mb-2 flex items-center justify-between">
				<span className="text-sm font-medium">{labels.name}</span>
				{statusLabel ? (
					<span className={cn('text-[10px] uppercase tracking-wider', tone.badge)}>{statusLabel}</span>
				) : null}
			</div>
			{body}
		</div>
	)
}
