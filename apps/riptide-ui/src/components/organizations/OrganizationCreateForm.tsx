import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { Button } from '@humanlayer/ui/components/button'
import { Checkbox } from '@humanlayer/ui/components/checkbox'
import { Field, FieldError, FieldLabel } from '@humanlayer/ui/components/field'
import { Input } from '@humanlayer/ui/components/input'
import { Label } from '@humanlayer/ui/components/label'
import { Separator } from '@humanlayer/ui/components/separator'
import { Textarea } from '@humanlayer/ui/components/textarea'
import { normalizeOrganizationDomain } from '@humanlayer/ui/lib/organization-domain'
import { isDefinedError } from '@orpc/client'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useFieldArray, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import z from 'zod/v4'

import { useBrowserAuth } from '@/hooks/use-browser-auth'
import { useRiptideApi } from '@/orpc/client'
import { getCloudOrigin } from '@/utils/artifact-links'

import { DomainInputRow } from './DomainInputRow'

const formSchema = z.object({
	organizationName: z.string().min(2, 'Name must be at least 2 characters').max(64),
	domains: z.array(
		z.object({
			hostname: z.string().min(6, 'Domain must be at least 6 characters').optional().or(z.literal('')),
		}),
	),
	inviteEmails: z.string(),
	eulaAccepted: z.literal(true, { error: 'You must accept the EULA to create an organization' }),
})

type FormValues = z.infer<typeof formSchema>

export function OrganizationCreateForm() {
	const navigate = useNavigate()
	const queryClient = useQueryClient()
	const { switchOrganization } = useBrowserAuth()
	const { queryClient: api } = useRiptideApi()

	const form = useForm<FormValues>({
		resolver: standardSchemaResolver(formSchema),
		defaultValues: { organizationName: '', domains: [], inviteEmails: '' },
	})

	const { fields, append, remove } = useFieldArray({
		control: form.control,
		name: 'domains',
	})

	const createMutation = useMutation(
		api.auth.user.organizations.create.mutationOptions({
			onError: (error) => {
				if (isDefinedError(error)) {
					toast.error(error.message || 'Failed to create organization')
				} else {
					toast.error('Failed to create organization')
				}
			},
			onSuccess: async (result) => {
				if (result.failedInvites && result.failedInvites.length > 0) {
					const cloudOrigin = getCloudOrigin()
					const manage = cloudOrigin
						? ` Manage invitations at ${cloudOrigin}/admin/invitations`
						: ' Manage invitations in HumanLayer Cloud.'
					toast.warning(
						`Organization created, but ${result.failedInvites.length} invite(s) failed.${manage}`,
						{ duration: 8000 },
					)
				}
				await queryClient.invalidateQueries({
					queryKey: api.auth.user.organizations.list.key(),
				})
				await switchOrganization({ organizationId: result.workosOrganizationId })
				navigate({ to: '/' })
			},
		}),
	)

	const handleSubmit = form.handleSubmit((data) => {
		const domains: string[] = []
		for (const { hostname } of data.domains) {
			if (!hostname) continue
			const normalizedHostname = normalizeOrganizationDomain(hostname)
			if (normalizedHostname) domains.push(normalizedHostname)
		}
		const inviteEmails = (data.inviteEmails || '')
			.split(/[\s,]+/)
			.map((e: string) => e.trim())
			.filter((e: string) => e.includes('@'))
		createMutation.mutate({ name: data.organizationName, domains, inviteEmails, eulaAccepted: data.eulaAccepted })
	})

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-4">
			<Field data-invalid={!!form.formState.errors.organizationName}>
				<FieldLabel>Organization Name</FieldLabel>
				<Input
					{...form.register('organizationName')}
					placeholder="My Organization"
					disabled={createMutation.isPending}
				/>
				{form.formState.errors.organizationName && (
					<FieldError errors={[form.formState.errors.organizationName]} />
				)}
			</Field>

			<Separator />

			<div className="flex flex-col gap-2">
				<FieldLabel>Domains (optional)</FieldLabel>
				{fields.map((field, index) => (
					<DomainInputRow
						key={field.id}
						value={form.watch(`domains.${index}.hostname`) || ''}
						onChange={(v) => form.setValue(`domains.${index}.hostname`, v)}
						onRemove={() => remove(index)}
						disabled={createMutation.isPending}
						error={form.formState.errors.domains?.[index]?.hostname?.message}
					/>
				))}
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={() => append({ hostname: '' })}
					disabled={createMutation.isPending}
				>
					<Plus className="size-4 mr-2" /> Add domain
				</Button>
			</div>

			<Separator />

			<Field>
				<FieldLabel>Invite Team Members (optional)</FieldLabel>
				<Textarea
					{...form.register('inviteEmails')}
					placeholder={'alice@example.com\nbob@example.com'}
					disabled={createMutation.isPending}
					rows={3}
				/>
				<p className="text-xs text-muted-foreground">Separate emails with commas, spaces, or new lines</p>
				<p className="text-xs text-muted-foreground">
					Starter is free while your team has three or fewer active members. You can invite up to two
					teammates now; larger teams can upgrade after setup.
				</p>
			</Field>

			<Separator />

			<div className="flex items-center gap-2 py-2">
				<Checkbox
					id="eula-accepted"
					checked={form.watch('eulaAccepted') === true}
					onCheckedChange={(checked) =>
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						form.setValue('eulaAccepted', (checked === true ? true : undefined) as any, {
							shouldValidate: form.formState.isSubmitted,
						})
					}
					disabled={createMutation.isPending}
				/>
				<Label htmlFor="eula-accepted" className="text-sm text-muted-foreground cursor-pointer">
					I agree to the{' '}
					<a
						href="https://humanlayer.dev/legal/eula"
						target="_blank"
						rel="noopener noreferrer"
						className="underline text-foreground hover:text-primary"
					>
						End User License Agreement
					</a>
				</Label>
			</div>
			{form.formState.errors.eulaAccepted && <FieldError errors={[form.formState.errors.eulaAccepted]} />}

			<div className="grid grid-cols-2 gap-2">
				<Button
					type="button"
					variant="secondary"
					onClick={() => navigate({ to: '/auth/organizations/select' })}
					disabled={createMutation.isPending}
				>
					Back
				</Button>
				<Button type="submit" disabled={createMutation.isPending || !form.watch('eulaAccepted')}>
					{createMutation.isPending ? 'Creating...' : 'Create'}
				</Button>
			</div>
		</form>
	)
}
