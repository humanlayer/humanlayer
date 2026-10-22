import { StarterCapacityExceededDataSchema } from '@humanlayer/riptide-api-contract/types/billing'
import type { StarterDowngradeEligibility } from '@humanlayer/ui/components/billing/types'
import { isDefinedError, ORPCError } from '@orpc/client'

export function getStarterCapacityExceededMessage(input: {
	activeMemberCount: number
	pendingInvitationCount: number
	freeCapacity: number
}): string {
	return `Starter supports up to ${input.freeCapacity} active members plus pending invitations. This organization has ${input.activeMemberCount} active member${input.activeMemberCount === 1 ? '' : 's'} and ${input.pendingInvitationCount} pending invitation${input.pendingInvitationCount === 1 ? '' : 's'}.`
}

export function getStarterDowngradeEligibility(
	activeMemberCount: number | null,
	pendingInvitationCount: number | null,
	freeCapacity: number | null,
): StarterDowngradeEligibility {
	const active = activeMemberCount ?? 0
	const pending = pendingInvitationCount ?? 0
	const capacity = freeCapacity ?? 0
	const usedCapacity = active + pending
	if (activeMemberCount == null || pendingInvitationCount == null || freeCapacity == null)
		return {
			isEligible: false,
			activeMemberCount: active,
			pendingInvitationCount: pending,
			usedCapacity,
			freeCapacity: capacity,
			disabledReason: 'Starter downgrade eligibility is still syncing. Refresh billing before downgrading.',
		}
	if (usedCapacity > capacity)
		return {
			isEligible: false,
			activeMemberCount: active,
			pendingInvitationCount: pending,
			usedCapacity,
			freeCapacity: capacity,
			disabledReason: getStarterCapacityExceededMessage({
				activeMemberCount: active,
				pendingInvitationCount: pending,
				freeCapacity: capacity,
			}),
		}
	return {
		isEligible: true,
		activeMemberCount: active,
		pendingInvitationCount: pending,
		usedCapacity,
		freeCapacity: capacity,
		disabledReason: null,
	}
}

export function getDowngradeCapacityMessage(error: unknown): string | null {
	if (!(error instanceof ORPCError) || !isDefinedError(error) || error.code !== 'CAPACITY_EXCEEDED') return null
	const parsed = StarterCapacityExceededDataSchema.safeParse(error.data)
	if (!parsed.success) return null
	const { currentActiveSeats, pendingInvitations, freeCapacity } = parsed.data
	return getStarterCapacityExceededMessage({
		activeMemberCount: currentActiveSeats,
		pendingInvitationCount: pendingInvitations,
		freeCapacity,
	})
}
