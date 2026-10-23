import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import {
	type CreatePersonalAccessTokenInput,
	CreatePersonalAccessTokenInputSchema,
	PersonalAccessTokenExpiryDaysSchema,
} from '@humanlayer/riptide-api-contract/api/auth/user/personal-access-tokens'
import { Button } from '@humanlayer/ui/components/button'
import { Field, FieldError, FieldLabel } from '@humanlayer/ui/components/field'
import { Input } from '@humanlayer/ui/components/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@humanlayer/ui/components/select'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, KeyRound, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { toast } from 'sonner'

import { useRiptideApi } from '@/orpc/client'

import { PersonalAccessTokenRevokeDialog } from './PersonalAccessTokenRevokeDialog'

const EXPIRY_OPTIONS = [7, 14, 30, 60, 90] as const

type RevokeTarget = {
	id: string
	name: string
}

export function PersonalAccessTokensSettingsSection() {
	const { queryClient: api } = useRiptideApi()
	const queryClient = useQueryClient()
	const [createdValue, setCreatedValue] = useState<string | null>(null)
	const [revokeTarget, setRevokeTarget] = useState<RevokeTarget | null>(null)
	const form = useForm<CreatePersonalAccessTokenInput>({
		resolver: standardSchemaResolver(CreatePersonalAccessTokenInputSchema),
		defaultValues: { name: '', expiresInDays: 30 },
		mode: 'onChange',
	})
	const { data, isLoading } = useQuery(api.auth.user.personalAccessTokens.list.queryOptions({ input: {} }))
	const invalidateTokens = () =>
		queryClient.invalidateQueries({ queryKey: api.auth.user.personalAccessTokens.list.queryKey() })

	const { mutate: createToken, isPending: isCreating } = useMutation(
		api.auth.user.personalAccessTokens.create.mutationOptions({
			onSuccess: (result) => {
				setCreatedValue(result.value)
				form.reset()
				invalidateTokens()
					.then(() => toast.success('Personal access token created'))
					.catch(() => toast.error('Token created, but the token list could not be refreshed'))
			},
			onError: () => toast.error('Failed to create personal access token'),
		}),
	)

	const { mutate: revokeToken, isPending: isRevoking } = useMutation(
		api.auth.user.personalAccessTokens.revoke.mutationOptions({
			onSuccess: () => {
				setRevokeTarget(null)
				invalidateTokens()
					.then(() => toast.success('Personal access token revoked'))
					.catch(() => toast.error('Token revoked, but the token list could not be refreshed'))
			},
			onError: () => toast.error('Failed to revoke personal access token'),
		}),
	)

	const submitCreate = form.handleSubmit((input) => createToken(input))
	const copyCreatedValue = () => {
		if (createdValue === null) return
		navigator.clipboard
			.writeText(createdValue)
			.then(() => toast.success('Copied to clipboard'))
			.catch(() => toast.error('Failed to copy token'))
	}
	const confirmRevoke = () => {
		if (revokeTarget === null) return
		revokeToken({ id: revokeTarget.id })
	}

	return (
		<div className="space-y-8">
			<section className="space-y-4">
				<div>
					<h3 className="text-sm font-semibold text-foreground">Create a personal access token</h3>
					<p className="text-sm text-muted-foreground">
						Use a PAT for HumanLayer automation. The secret is shown only once.
					</p>
				</div>
				<form onSubmit={submitCreate} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto]">
					<Controller
						control={form.control}
						name="name"
						render={({ field, fieldState }) => (
							<Field data-invalid={fieldState.invalid}>
								<FieldLabel htmlFor="personal-access-token-name">Token name</FieldLabel>
								<Input
									{...field}
									id="personal-access-token-name"
									placeholder="GitHub Actions"
									disabled={isCreating}
								/>
								{fieldState.error && <FieldError errors={[fieldState.error]} />}
							</Field>
						)}
					/>
					<Controller
						control={form.control}
						name="expiresInDays"
						render={({ field }) => (
							<Field>
								<FieldLabel htmlFor="personal-access-token-expiry">Expiration</FieldLabel>
								<Select
									value={String(field.value)}
									onValueChange={(value) =>
										field.onChange(PersonalAccessTokenExpiryDaysSchema.parse(Number(value)))
									}
									disabled={isCreating}
								>
									<SelectTrigger
										id="personal-access-token-expiry"
										className="w-full"
										onBlur={field.onBlur}
									>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{EXPIRY_OPTIONS.map((days) => (
											<SelectItem key={days} value={String(days)}>
												{days} days
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</Field>
						)}
					/>
					<Button type="submit" className="self-end" disabled={!form.formState.isValid || isCreating}>
						{isCreating ? 'Creating...' : 'Create token'}
					</Button>
				</form>
			</section>

			{createdValue !== null && (
				<section className="space-y-3 border border-warning/50 bg-warning/10 p-4">
					<div className="flex items-center gap-2">
						<KeyRound className="size-4" />
						<h3 className="text-sm font-semibold">Copy this token now</h3>
					</div>
					<p className="text-xs text-muted-foreground">
						You will not be able to view it again after leaving this page.
					</p>
					<div className="flex gap-2">
						<code className="min-w-0 flex-1 break-all border bg-background p-2 text-xs">
							{createdValue}
						</code>
						<Button variant="outline" size="icon" aria-label="Copy token" onClick={copyCreatedValue}>
							<Copy className="size-4" />
						</Button>
					</div>
				</section>
			)}

			<section className="space-y-3">
				<h3 className="text-sm font-semibold">Existing tokens</h3>
				{isLoading ? (
					<p className="text-sm text-muted-foreground">Loading...</p>
				) : !data?.tokens.length ? (
					<p className="text-sm text-muted-foreground">No personal access tokens.</p>
				) : (
					data.tokens.map((token) => (
						<div key={token.id} className="flex items-center gap-4 border bg-muted/30 p-3">
							<div className="min-w-0 flex-1">
								<p className="text-sm font-medium">{token.name}</p>
								<p className="text-xs text-muted-foreground">
									{token.obfuscatedValue} · Expires{' '}
									{token.expiresAt ? new Date(token.expiresAt).toLocaleDateString() : 'never'}
									{token.lastUsedAt
										? ` · Last used ${new Date(token.lastUsedAt).toLocaleDateString()}`
										: ''}
								</p>
							</div>
							<Button
								variant="destructive"
								size="sm"
								disabled={isRevoking}
								onClick={() => setRevokeTarget({ id: token.id, name: token.name })}
							>
								<Trash2 className="size-3.5" />
								Revoke
							</Button>
						</div>
					))
				)}
			</section>

			<PersonalAccessTokenRevokeDialog
				open={revokeTarget !== null}
				tokenName={revokeTarget?.name ?? ''}
				isPending={isRevoking}
				onOpenChange={(open) => {
					if (!open) setRevokeTarget(null)
				}}
				onConfirm={confirmRevoke}
			/>
		</div>
	)
}
