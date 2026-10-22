import { Data } from 'effect'

import type { ResendError } from '../resend/resend-errors'
import type { WorkosError } from '../workos/workos.errors'

export type OnboardingOperation = 'workos_profile_lookup' | 'contact_lookup' | 'contact_patch' | 'automation_start'

export class ContactLookupFailed extends Data.TaggedError('ContactLookupFailed')<{
	userId: string
	email?: string
	operation: OnboardingOperation
	cause: ResendError | WorkosError | Error
}> {}

export class EnrollmentResendFailed extends Data.TaggedError('EnrollmentResendFailed')<{
	userId: string
	email?: string
	operation: OnboardingOperation
	cause: ResendError | Error
}> {}

export class AutomationStartFailed extends Data.TaggedError('AutomationStartFailed')<{
	userId: string
	email: string
	cause: ResendError | Error
}> {}

/**
 * Milestone names that drive Automation send-time branch conditions. Used to tag
 * `MilestonePatchFailed` so detached failure observability carries the campaign
 * milestone alongside the user/source context.
 */
export type OnboardingMilestone =
	| 'rpi_task_created'
	| 'tracker_connected'
	| 'design_doc_iterated'
	| 'design_doc_inbound_comment_received'
	| 'design_doc_inbound_comment_resolved'
	| 'structure_outline_created'
	| 'implementation_started'
	| 'implementation_complete'
	| 'commented_on_teammate_doc'

export class MilestonePatchFailed extends Data.TaggedError('MilestonePatchFailed')<{
	userId: string
	milestone: OnboardingMilestone
	cause: ResendError | Error
}> {}

export type OnboardingError =
	| ContactLookupFailed
	| EnrollmentResendFailed
	| AutomationStartFailed
	| MilestonePatchFailed
