import { Button } from '@humanlayer/ui/components/button'
import { Card } from '@humanlayer/ui/components/card'
import { Input } from '@humanlayer/ui/components/input'
import { Lock } from 'lucide-react'
import { useId, useState } from 'react'
import z from 'zod/v4'

import {
	ArtifactSummary,
	accessRequestCardClass,
	accessRequestDescriptionClass,
	accessRequestFooterClass,
	accessRequestHeadingClass,
	accessRequestMonoStyle,
	accessRequestPrimaryButtonClass,
	accessRequestSecondaryButtonClass,
	accessRequestShellClass,
} from './RequestAccessLoggedIn'
import type { ArtifactInfoInaccessible } from './RequestAccessScreen'

export function RequestAccessAnonymous({
	artifactId,
	lookup,
	isSubmitting = false,
	errorMessage,
	onRequestAccess,
}: {
	artifactId: string
	lookup: ArtifactInfoInaccessible
	isSubmitting?: boolean
	errorMessage?: string | null
	onRequestAccess: (email: string) => void
}) {
	const emailId = useId()
	const [email, setEmail] = useState('')
	const [validationError, setValidationError] = useState<string | null>(null)

	const submit = (event: React.FormEvent) => {
		event.preventDefault()
		const { data: parsedEmail, success } = z.email().safeParse(email.trim())
		if (!success) {
			setValidationError('Enter a valid email address.')
			return
		}

		setValidationError(null)
		onRequestAccess(parsedEmail.toLowerCase())
	}

	const signInHref = `/auth/signin?returnTo=${encodeURIComponent(`/artifacts/${artifactId}`)}`

	return (
		<div className={accessRequestShellClass} style={accessRequestMonoStyle}>
			<Card className={accessRequestCardClass}>
				<Lock className="mx-auto mb-3 h-12 w-12 text-[#a6adc8]" />
				<h2 className={accessRequestHeadingClass}>Access Required</h2>
				<p className={accessRequestDescriptionClass}>
					Sign in or request access to this organization to view this artifact.
				</p>

				<ArtifactSummary lookup={lookup} />

				<a
					href={signInHref}
					className={`inline-flex items-center justify-center ${accessRequestPrimaryButtonClass}`}
				>
					Sign in
				</a>

				<div className="my-4 flex items-center gap-2.5 text-[10px] uppercase tracking-[0.1em] text-[#6c7086] before:h-px before:flex-1 before:bg-[#45475a] after:h-px after:flex-1 after:bg-[#45475a]">
					Or
				</div>

				<form onSubmit={submit} className="text-left">
					<label
						htmlFor={emailId}
						className="mb-1.5 block text-[11px] uppercase tracking-[0.05em] text-[#a6adc8]"
					>
						Your email
					</label>
					<Input
						id={emailId}
						type="email"
						placeholder="you@company.com"
						className="h-auto min-h-0 rounded-none border-[#45475a] bg-[#313244] px-3 py-2 text-[12px] text-[#cdd6f4] placeholder:text-[#6c7086] focus-visible:border-[#cba6f7] focus-visible:ring-0"
						value={email}
						onChange={(event) => setEmail(event.target.value)}
						aria-invalid={!!validationError}
					/>
					{validationError || errorMessage ? (
						<p className="mt-3 text-[12px] text-destructive">{validationError ?? errorMessage}</p>
					) : null}
					<Button
						disabled={isSubmitting}
						variant="secondary"
						className={`mt-3 ${accessRequestSecondaryButtonClass}`}
						type="submit"
					>
						{isSubmitting ? 'Requesting...' : 'Request access'}
					</Button>
				</form>

				<p className={accessRequestFooterClass}>An org admin will be notified and can grant you access.</p>
			</Card>
		</div>
	)
}
