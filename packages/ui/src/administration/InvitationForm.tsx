import { CreateAdminInvitationInputSchema } from '@humanlayer/riptide-api-contract/api/auth/admin/invitations-create'
import { Button } from '@humanlayer/ui/components/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@humanlayer/ui/components/field'
import { Input } from '@humanlayer/ui/components/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@humanlayer/ui/components/select'
import { useState } from 'react'
import type { z } from 'zod/v4'

export type CreateInvitationInput = z.output<typeof CreateAdminInvitationInputSchema>

export interface InvitationFormProps {
	defaultEmail?: string
	isPending: boolean
	errorMessage?: string | null
	upgradeRequiredMessage?: string | null
	isUpgradePending?: boolean
	onUpgrade?: () => void
	onSubmit: (input: CreateInvitationInput) => void
}

export function InvitationForm({
	defaultEmail,
	isPending,
	errorMessage,
	upgradeRequiredMessage,
	isUpgradePending = false,
	onUpgrade,
	onSubmit,
}: InvitationFormProps) {
	const [email, setEmail] = useState(defaultEmail ?? '')
	const [roleSlug, setRoleSlug] = useState<'admin' | 'member'>('member')
	const [expiresInDays, setExpiresInDays] = useState(7)
	const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})

	const submit = (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const result = CreateAdminInvitationInputSchema.safeParse({ email, roleSlug, expiresInDays })
		if (!result.success) {
			setValidationErrors(
				Object.fromEntries(result.error.issues.map((issue) => [String(issue.path[0] ?? 'form'), issue.message])),
			)
			return
		}
		setValidationErrors({})
		onSubmit(result.data)
	}

	return (
		<form onSubmit={submit} className="space-y-4">
			{upgradeRequiredMessage ? (
				<div className="border border-border bg-muted/40 p-3 text-sm">
					<p className="font-medium text-foreground">Pro upgrade required</p>
					<p className="mt-1 text-muted-foreground">{upgradeRequiredMessage}</p>
					{onUpgrade ? <Button type="button" variant="outline" className="mt-3" disabled={isUpgradePending} onClick={onUpgrade}>{isUpgradePending ? 'Opening Checkout...' : 'Upgrade to Pro'}</Button> : null}
				</div>
			) : null}
			{errorMessage ? <p className="text-sm text-destructive" role="alert">{errorMessage}</p> : null}
			<Field data-invalid={Boolean(validationErrors.email)}><FieldLabel htmlFor="invitation-email">Email</FieldLabel><Input id="invitation-email" name="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} aria-invalid={Boolean(validationErrors.email)} placeholder="user@example.com" autoComplete="email" />{validationErrors.email ? <FieldError>{validationErrors.email}</FieldError> : null}</Field>
			<Field><FieldLabel htmlFor="invitation-role">Role</FieldLabel><Select onValueChange={(value) => setRoleSlug(value as 'admin' | 'member')} value={roleSlug}><SelectTrigger id="invitation-role"><SelectValue placeholder="Select a role" /></SelectTrigger><SelectContent><SelectItem value="member">Member</SelectItem><SelectItem value="admin">Admin</SelectItem></SelectContent></Select><FieldDescription>The role this user will have in the organization</FieldDescription></Field>
			<Field data-invalid={Boolean(validationErrors.expiresInDays)}><FieldLabel htmlFor="invitation-expiry">Expires in (days)</FieldLabel><Input id="invitation-expiry" name="expiresInDays" type="number" min="1" max="30" value={expiresInDays} onChange={(event) => setExpiresInDays(Number(event.target.value))} aria-invalid={Boolean(validationErrors.expiresInDays)} /><FieldDescription>How many days until the invitation expires</FieldDescription>{validationErrors.expiresInDays ? <FieldError>{validationErrors.expiresInDays}</FieldError> : null}</Field>
			<Button type="submit" className="w-full" disabled={isPending}>{isPending ? 'Sending...' : 'Send Invitation'}</Button>
		</form>
	)
}
