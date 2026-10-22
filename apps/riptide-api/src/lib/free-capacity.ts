export const STARTER_FREE_CAPACITY = 3

export type StarterCapacityInput = {
	activeMembers: number
	pendingInvitations: number
	requestedInvitations: number
}

export function wouldExceedStarterCapacity(input: StarterCapacityInput): boolean {
	return input.activeMembers + input.pendingInvitations + input.requestedInvitations > STARTER_FREE_CAPACITY
}

export function canUseStarterCapacity(input: {
	activeMembers: number
	pendingInvitations: number
	additionalActiveMembers?: number
}): boolean {
	return (
		input.activeMembers + input.pendingInvitations + (input.additionalActiveMembers ?? 0) <= STARTER_FREE_CAPACITY
	)
}

export function canDowngradeToStarter(input: { activeMembers: number; pendingInvitations: number }): boolean {
	return canUseStarterCapacity(input)
}

export function getStarterFreeCapacityRemaining(input: Omit<StarterCapacityInput, 'requestedInvitations'>): number {
	return Math.max(STARTER_FREE_CAPACITY - input.activeMembers - input.pendingInvitations, 0)
}

export function buildUpgradeRequiredData(input: Omit<StarterCapacityInput, 'requestedInvitations'>) {
	return {
		message:
			'Upgrade to HumanLayer Pro to invite more teammates. Starter is free while your team has three or fewer active members and pending invitations.',
		currentActiveSeats: input.activeMembers,
		pendingInvitations: input.pendingInvitations,
		freeCapacity: STARTER_FREE_CAPACITY,
		actionLabel: 'Upgrade to Pro',
	}
}
