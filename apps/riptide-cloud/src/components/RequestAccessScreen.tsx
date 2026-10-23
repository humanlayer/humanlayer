import type { RiptideApiOutputs } from '@humanlayer/riptide-api-contract/contract-router'
import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'
import { isDefinedError } from '@orpc/client'
import { useMutation } from '@tanstack/react-query'
import { useAuth } from '@workos-inc/authkit-react'
import { useState } from 'react'

import { useRiptideApi } from '@/api/client'

import { InvitationPendingScreen } from './InvitationPendingScreen'
import { RequestAccessAnonymous } from './RequestAccessAnonymous'
import { RequestAccessLoggedIn } from './RequestAccessLoggedIn'
import { RequestPendingScreenView } from './RequestPendingScreen'

export type ArtifactInfoInaccessible = Extract<
	RiptideApiOutputs['public']['artifacts']['info'],
	{ exists: true; accessible: false }
>

type SubmittedState =
	| { variant: 'logged-in'; email?: string | null; retryAfter?: string | null }
	| { variant: 'anonymous'; email: string }
	| { variant: 'invited' }
	| null

export function RequestAccessScreen({ artifactId, lookup }: { artifactId: string; lookup: ArtifactInfoInaccessible }) {
	const { isLoading, user } = useAuth()
	const { queryClient: apiQueryClient } = useRiptideApi()
	const [submitted, setSubmitted] = useState<SubmittedState>(null)
	const [errorMessage, setErrorMessage] = useState<string | null>(null)

	const createMutation = useMutation(
		apiQueryClient.public.accessRequests.create.mutationOptions({
			onMutate: () => setErrorMessage(null),
			onSuccess: (result, variables) => {
				if (result.alreadyInvited) {
					setSubmitted({ variant: 'invited' })
					return
				}

				if (user?.id) {
					setSubmitted({ variant: 'logged-in', email: user.email ?? variables.email ?? null })
					return
				}

				if (variables.email) {
					setSubmitted({ variant: 'anonymous', email: variables.email })
				}
			},
			onError: (error, variables) => {
				if (isDefinedError(error) && error.code === 'ALREADY_REQUESTED_ACCESS') {
					setSubmitted(
						user?.id
							? {
									variant: 'logged-in',
									email: user.email ?? variables.email ?? null,
									retryAfter: error.data.retryAfter,
								}
							: { variant: 'anonymous', email: variables.email ?? '' },
					)
					return
				}

				if (isDefinedError(error) && error.code === 'FEATURE_DISABLED') {
					setErrorMessage(error.data.message)
					return
				}

				setErrorMessage(error.message || 'Unable to request access. Please try again.')
			},
		}),
	)

	if (isLoading) {
		return (
			<div className="flex min-h-full items-center justify-center p-6">
				<SyncGridAnimation variant="snake" speed={120} className="w-8 text-muted-foreground" />
			</div>
		)
	}

	if (submitted?.variant === 'invited') {
		return <InvitationPendingScreen lookup={lookup} />
	}

	if (submitted?.variant === 'anonymous') {
		return (
			<RequestPendingScreenView
				lookup={lookup}
				variant="anonymous"
				email={submitted.email}
				onStartOver={() => {
					setErrorMessage(null)
					setSubmitted(null)
				}}
			/>
		)
	}

	if (submitted?.variant === 'logged-in') {
		return (
			<RequestPendingScreenView
				lookup={lookup}
				variant="logged-in"
				email={submitted.email ?? undefined}
				retryAfter={submitted.retryAfter}
			/>
		)
	}

	if (user?.id && user.email) {
		return (
			<RequestAccessLoggedIn
				lookup={lookup}
				email={user.email}
				isSubmitting={createMutation.isPending}
				errorMessage={errorMessage}
				onRequestAccess={() => createMutation.mutate({ artifactId, email: user.email })}
			/>
		)
	}

	return (
		<RequestAccessAnonymous
			artifactId={artifactId}
			lookup={lookup}
			isSubmitting={createMutation.isPending}
			errorMessage={errorMessage}
			onRequestAccess={(email) => createMutation.mutate({ artifactId, email })}
		/>
	)
}
