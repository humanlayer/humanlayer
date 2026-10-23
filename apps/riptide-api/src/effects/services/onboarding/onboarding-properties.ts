export const ONBOARDING_EVENT_STARTED = 'onboarding.started'

export const ONBOARDING_SEQUENCE_WELCOME_ONLY = 'onboarding_v1_welcome_only'
export const ONBOARDING_SEQUENCE_LITE = 'onboarding_v1_lite'
export const ONBOARDING_SEQUENCE_FULL = 'onboarding_v1_full'

export type OnboardingSequence =
	| typeof ONBOARDING_SEQUENCE_WELCOME_ONLY
	| typeof ONBOARDING_SEQUENCE_LITE
	| typeof ONBOARDING_SEQUENCE_FULL

export const OnboardingProperties = {
	workosUserId: 'workos_user_id',
	enrolledAt: 'onboarding__enrolled_at',
	sequence: 'onboarding__sequence',
	disabled: 'onboarding__disabled',
	isAdmin: 'onboarding__is_admin',
	// Milestone properties (write-once, blind-patched to "1" when the milestone is
	// proven by a product event). Added in PR Milestone 3 for the day-1 slot.
	rpiTaskCreated: 'onboarding__rpi_task_created',
	trackerConnected: 'onboarding__tracker_connected',
	// Lite-sequence core-aha milestones (PR Milestone 4): day-3 design-doc slot and
	// day-5 inbound-comment slot.
	designDocIterated: 'onboarding__design_doc_iterated',
	designDocInboundCommentReceived: 'onboarding__design_doc_inbound_comment_received',
	designDocInboundCommentResolved: 'onboarding__design_doc_inbound_comment_resolved',
	// Full-sequence tail milestones (PR Milestone 5): day-7 structure-outline slot,
	// day-10 implementation slot (started + complete), and day-13 teammate-work slot.
	structureOutlineCreated: 'onboarding__structure_outline_created',
	implementationStarted: 'onboarding__implementation_started',
	implementationComplete: 'onboarding__implementation_complete',
	commentedOnTeammateDoc: 'onboarding__commented_on_teammate_doc',
} as const

export const initialOnboardingPropertyKeys = [
	OnboardingProperties.workosUserId,
	OnboardingProperties.enrolledAt,
	OnboardingProperties.sequence,
	OnboardingProperties.disabled,
	OnboardingProperties.isAdmin,
] as const
