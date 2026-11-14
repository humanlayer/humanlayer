import * as resend from '@humanlayer/pulumi-resend'
import type * as pulumi from '@pulumi/pulumi'

import type { OnboardingTemplates } from './onboarding-templates'

export function createOnboardingAutomation(opts: {
	provider: pulumi.ProviderResource
	templates: OnboardingTemplates
}) {
	const startedEvent = new resend.Event(
		'onboarding-started-event',
		{
			name: 'onboarding.started',
			schema: {
				userId: 'string',
				organizationId: 'string',
				sequence: 'string',
			},
		},
		{ provider: opts.provider },
	)

	// firstName is wired to the contact's standard first_name field (set during
	// enrollMember upsert). Automation send_email steps do not auto-resolve
	// template variables from the contact, so each `{{{var}}}` is mapped here.
	const firstNameVar = { firstName: { var: 'contact.first_name' } }

	const automation = new resend.Automation(
		'onboarding-v1',
		{
			name: 'onboarding-v1',
			status: 'enabled',
			steps: [
				{ key: 'trigger', type: 'trigger', config: { event_name: 'onboarding.started' } },
				{ key: 'delay-welcome', type: 'delay', config: { duration: '1 minute' } },
				{
					key: 'disabled-check',
					type: 'condition',
					config: {
						type: 'rule',
						field: 'contact.properties.onboarding__disabled',
						operator: 'eq',
						value: '1',
					},
				},
				{
					key: 'send-welcome',
					type: 'send_email',
					config: {
						template: { id: opts.templates.welcome.id, variables: firstNameVar },
					},
				},

				// --- Day-1 slot (slot 1): first RPI task / connect tracker ---
				// Real cadence (PR Milestone 7). After Welcome, wait, then branch by sequence arm.
				{ key: 'delay-day1', type: 'delay', config: { duration: '1 day' } },
				{
					// Welcome-only users end here: their arm has no day-1 send.
					key: 'welcome-only-check',
					type: 'condition',
					config: {
						type: 'rule',
						field: 'contact.properties.onboarding__sequence',
						operator: 'eq',
						value: 'onboarding_v1_welcome_only',
					},
				},
				{
					// Slot-1 gating milestone 1: has the user created a launched RPI task?
					key: 'rpi-task-check',
					type: 'condition',
					config: {
						type: 'rule',
						field: 'contact.properties.onboarding__rpi_task_created',
						operator: 'eq',
						value: '1',
					},
				},
				{
					// RPI task NOT created -> default copy (create your first RPI task).
					key: 'send-rpi-task-default',
					type: 'send_email',
					config: {
						template: { id: opts.templates.rpiTaskDefault.id, variables: firstNameVar },
					},
				},
				{
					// RPI task created -> check whether a tracker is connected.
					key: 'tracker-check',
					type: 'condition',
					config: {
						type: 'rule',
						field: 'contact.properties.onboarding__tracker_connected',
						operator: 'eq',
						value: '1',
					},
				},
				{
					// RPI task created but tracker NOT connected -> already-done variant
					// (connect Linear/Jira). Both done -> tracker-check condition_met has
					// no outgoing edge, so the slot is skipped.
					key: 'send-rpi-task-tracker-variant',
					type: 'send_email',
					config: {
						template: { id: opts.templates.rpiTaskTrackerVariant.id, variables: firstNameVar },
					},
				},

				// --- Day-3 slot (slot 2): your first design doc ---
				// Real cadence (PR Milestone 7). lite + full both reach this slot; welcome-only already ended.
				{ key: 'delay-day3', type: 'delay', config: { duration: '3 days' } },
				{
					// Gating milestone: has the user iterated a design discussion (>=2 versions)?
					key: 'design-doc-check',
					type: 'condition',
					config: {
						type: 'rule',
						field: 'contact.properties.onboarding__design_doc_iterated',
						operator: 'eq',
						value: '1',
					},
				},
				{
					// Not iterated -> default copy (walk through the design phase).
					key: 'send-design-doc-default',
					type: 'send_email',
					config: {
						template: { id: opts.templates.designDocDefault.id, variables: firstNameVar },
					},
				},
				{
					// Iterated -> already-done copy. Split admin vs non-admin: admins get an
					// appended invite-your-team P.S. (separate template, not an inline block).
					key: 'design-doc-admin-check',
					type: 'condition',
					config: {
						type: 'rule',
						field: 'contact.properties.onboarding__is_admin',
						operator: 'eq',
						value: '1',
					},
				},
				{
					// Iterated + admin -> done variant with the invite P.S.
					key: 'send-design-doc-done-admin',
					type: 'send_email',
					config: {
						template: { id: opts.templates.designDocDoneAdmin.id, variables: firstNameVar },
					},
				},
				{
					// Iterated + non-admin -> done variant without the invite P.S.
					key: 'send-design-doc-done-non-admin',
					type: 'send_email',
					config: {
						template: { id: opts.templates.designDocDoneNonAdmin.id, variables: firstNameVar },
					},
				},

				// --- Day-5 slot (slot 3): get a comment on your design doc (real aha) ---
				// Real cadence (PR Milestone 7). Lite users end after this slot; full continues into the tail.
				{ key: 'delay-day5', type: 'delay', config: { duration: '5 days' } },
				{
					// Gating milestone 1: has an inbound human comment landed on the doc?
					key: 'design-comment-received-check',
					type: 'condition',
					config: {
						type: 'rule',
						field: 'contact.properties.onboarding__design_doc_inbound_comment_received',
						operator: 'eq',
						value: '1',
					},
				},
				{
					// No inbound comment yet -> default copy (share to get one).
					key: 'send-design-comment-default',
					type: 'send_email',
					config: {
						template: { id: opts.templates.designCommentDefault.id, variables: firstNameVar },
					},
				},
				{
					// Inbound comment exists -> is it resolved?
					key: 'design-comment-resolved-check',
					type: 'condition',
					config: {
						type: 'rule',
						field: 'contact.properties.onboarding__design_doc_inbound_comment_resolved',
						operator: 'eq',
						value: '1',
					},
				},
				{
					// Inbound but UNRESOLVED -> act-on-it variant. Resolved -> the
					// resolved-check condition_met has no outgoing edge, so the slot is
					// skipped (loop closed).
					key: 'send-design-comment-unresolved',
					type: 'send_email',
					config: {
						template: { id: opts.templates.designCommentUnresolvedVariant.id, variables: firstNameVar },
					},
				},

				// --- Full-sequence tail (PR Milestone 5). Lite users ended after the
				// day-5 slot; only full-arm users reach the day-7/10/13 branches below.
				// Real cadence (PR Milestone 7).

				// --- Day-7 slot (slot 4): your first structure outline ---
				{ key: 'delay-day7', type: 'delay', config: { duration: '7 days' } },
				{
					// Lite users end here; only full continues into the tail.
					key: 'lite-check',
					type: 'condition',
					config: {
						type: 'rule',
						field: 'contact.properties.onboarding__sequence',
						operator: 'eq',
						value: 'onboarding_v1_lite',
					},
				},
				{
					// Gating milestone: has the user produced a structure outline?
					key: 'structure-outline-check',
					type: 'condition',
					config: {
						type: 'rule',
						field: 'contact.properties.onboarding__structure_outline_created',
						operator: 'eq',
						value: '1',
					},
				},
				{
					// Not created -> default copy (take a task through the outline phase).
					key: 'send-structure-outline-default',
					type: 'send_email',
					config: {
						template: { id: opts.templates.structureOutlineDefault.id, variables: firstNameVar },
					},
				},
				{
					// Created -> already-done copy (vertical-slice habit).
					key: 'send-structure-outline-done',
					type: 'send_email',
					config: {
						template: { id: opts.templates.structureOutlineDoneVariant.id, variables: firstNameVar },
					},
				},

				// --- Day-10 slot (slot 5): running implementation ---
				{ key: 'delay-day10', type: 'delay', config: { duration: '10 days' } },
				{
					// Gating milestone 1: has an implementation started?
					key: 'implementation-started-check',
					type: 'condition',
					config: {
						type: 'rule',
						field: 'contact.properties.onboarding__implementation_started',
						operator: 'eq',
						value: '1',
					},
				},
				{
					// Not started -> default copy (run your first implementation).
					key: 'send-implementation-default',
					type: 'send_email',
					config: {
						template: { id: opts.templates.implementationDefault.id, variables: firstNameVar },
					},
				},
				{
					// Started -> gating milestone 2: is it complete (pr-description exists)?
					key: 'implementation-complete-check',
					type: 'condition',
					config: {
						type: 'rule',
						field: 'contact.properties.onboarding__implementation_complete',
						operator: 'eq',
						value: '1',
					},
				},
				{
					// Started but NOT complete -> steer-it variant.
					key: 'send-implementation-started',
					type: 'send_email',
					config: {
						template: { id: opts.templates.implementationStartedVariant.id, variables: firstNameVar },
					},
				},
				{
					// Complete -> congrats + iterate-across-sessions variant.
					key: 'send-implementation-complete',
					type: 'send_email',
					config: {
						template: { id: opts.templates.implementationCompleteVariant.id, variables: firstNameVar },
					},
				},

				// --- Day-13 slot (slot 6): see your team's work ---
				{ key: 'delay-day13', type: 'delay', config: { duration: '13 days' } },
				{
					// Gating milestone: has the user commented on a teammate's doc?
					key: 'team-work-check',
					type: 'condition',
					config: {
						type: 'rule',
						field: 'contact.properties.onboarding__commented_on_teammate_doc',
						operator: 'eq',
						value: '1',
					},
				},
				{
					// Not yet -> default copy (open a teammate's doc and comment). Achieved
					// (condition_met) has no outgoing edge -> skip (no already-done variant).
					key: 'send-team-work-default',
					type: 'send_email',
					config: {
						template: { id: opts.templates.teamWorkDefault.id, variables: firstNameVar },
					},
				},
			],
			connections: [
				{ from: 'trigger', to: 'delay-welcome' },
				{ from: 'delay-welcome', to: 'disabled-check' },
				// condition_met (onboarding__disabled == '1') has no outgoing edge: the run ends and no Welcome is sent.
				{ from: 'disabled-check', to: 'send-welcome', type: 'condition_not_met' },

				// Day-1 slot wiring.
				{ from: 'send-welcome', to: 'delay-day1' },
				{ from: 'delay-day1', to: 'welcome-only-check' },
				// condition_met (sequence == welcome_only) has no outgoing edge: welcome-only ends after Welcome.
				{ from: 'welcome-only-check', to: 'rpi-task-check', type: 'condition_not_met' },
				// RPI task not yet created -> send the default "create your first RPI task" email.
				{ from: 'rpi-task-check', to: 'send-rpi-task-default', type: 'condition_not_met' },
				// RPI task already created -> evaluate tracker state next.
				{ from: 'rpi-task-check', to: 'tracker-check', type: 'condition_met' },
				// Tracker not connected -> send the "connect your tracker" variant.
				// Tracker connected (condition_met) has no outgoing edge: both milestones hit, slot skipped.
				{ from: 'tracker-check', to: 'send-rpi-task-tracker-variant', type: 'condition_not_met' },

				// Day-1 slot leaves converge into the day-3 slot for lite + full.
				// (tracker-check condition_met = both done = slot skipped: route it onward too.)
				{ from: 'send-rpi-task-default', to: 'delay-day3' },
				{ from: 'send-rpi-task-tracker-variant', to: 'delay-day3' },
				{ from: 'tracker-check', to: 'delay-day3', type: 'condition_met' },

				// Day-3 slot wiring.
				{ from: 'delay-day3', to: 'design-doc-check' },
				// Not iterated -> default copy.
				{ from: 'design-doc-check', to: 'send-design-doc-default', type: 'condition_not_met' },
				// Iterated -> admin vs non-admin done variant.
				{ from: 'design-doc-check', to: 'design-doc-admin-check', type: 'condition_met' },
				{ from: 'design-doc-admin-check', to: 'send-design-doc-done-admin', type: 'condition_met' },
				{ from: 'design-doc-admin-check', to: 'send-design-doc-done-non-admin', type: 'condition_not_met' },

				// Day-3 slot leaves converge into the day-5 slot.
				{ from: 'send-design-doc-default', to: 'delay-day5' },
				{ from: 'send-design-doc-done-admin', to: 'delay-day5' },
				{ from: 'send-design-doc-done-non-admin', to: 'delay-day5' },

				// Day-5 slot wiring.
				{ from: 'delay-day5', to: 'design-comment-received-check' },
				// No inbound comment -> default copy (share to get one).
				{ from: 'design-comment-received-check', to: 'send-design-comment-default', type: 'condition_not_met' },
				// Inbound comment -> check resolved state.
				{ from: 'design-comment-received-check', to: 'design-comment-resolved-check', type: 'condition_met' },
				// Inbound but unresolved -> act-on-it variant. Resolved (condition_met) has
				// no outgoing edge: loop closed, slot skipped.
				{
					from: 'design-comment-resolved-check',
					to: 'send-design-comment-unresolved',
					type: 'condition_not_met',
				},

				// Day-5 slot leaves converge into the day-7 slot (full tail, PR Milestone 5).
				// The lite-check at day-7 ends lite users; full continues. (resolved =
				// loop closed = slot skipped: route it onward too.)
				{ from: 'send-design-comment-default', to: 'delay-day7' },
				{ from: 'send-design-comment-unresolved', to: 'delay-day7' },
				{ from: 'design-comment-resolved-check', to: 'delay-day7', type: 'condition_met' },

				// Day-7 slot wiring.
				{ from: 'delay-day7', to: 'lite-check' },
				// condition_met (sequence == lite) has no outgoing edge: lite ends after day-5 content.
				{ from: 'lite-check', to: 'structure-outline-check', type: 'condition_not_met' },
				// Not created -> default copy.
				{ from: 'structure-outline-check', to: 'send-structure-outline-default', type: 'condition_not_met' },
				// Created -> already-done copy.
				{ from: 'structure-outline-check', to: 'send-structure-outline-done', type: 'condition_met' },

				// Day-7 slot leaves converge into the day-10 slot.
				{ from: 'send-structure-outline-default', to: 'delay-day10' },
				{ from: 'send-structure-outline-done', to: 'delay-day10' },

				// Day-10 slot wiring.
				{ from: 'delay-day10', to: 'implementation-started-check' },
				// Not started -> default copy.
				{ from: 'implementation-started-check', to: 'send-implementation-default', type: 'condition_not_met' },
				// Started -> evaluate completion.
				{ from: 'implementation-started-check', to: 'implementation-complete-check', type: 'condition_met' },
				// Started but not complete -> steer-it variant.
				{ from: 'implementation-complete-check', to: 'send-implementation-started', type: 'condition_not_met' },
				// Complete -> congrats variant.
				{ from: 'implementation-complete-check', to: 'send-implementation-complete', type: 'condition_met' },

				// Day-10 slot leaves converge into the day-13 slot.
				{ from: 'send-implementation-default', to: 'delay-day13' },
				{ from: 'send-implementation-started', to: 'delay-day13' },
				{ from: 'send-implementation-complete', to: 'delay-day13' },

				// Day-13 slot wiring (final full-sequence slot).
				{ from: 'delay-day13', to: 'team-work-check' },
				// Not yet commented -> default copy. Achieved (condition_met) has no
				// outgoing edge: skip (no already-done variant). The full sequence ends here.
				{ from: 'team-work-check', to: 'send-team-work-default', type: 'condition_not_met' },
			],
		},
		{
			provider: opts.provider,
			dependsOn: [
				startedEvent,
				opts.templates.welcome,
				opts.templates.rpiTaskDefault,
				opts.templates.rpiTaskTrackerVariant,
				opts.templates.designDocDefault,
				opts.templates.designDocDoneAdmin,
				opts.templates.designDocDoneNonAdmin,
				opts.templates.designCommentDefault,
				opts.templates.designCommentUnresolvedVariant,
				opts.templates.structureOutlineDefault,
				opts.templates.structureOutlineDoneVariant,
				opts.templates.implementationDefault,
				opts.templates.implementationStartedVariant,
				opts.templates.implementationCompleteVariant,
				opts.templates.teamWorkDefault,
			],
		},
	)

	return { startedEvent, automation }
}

export type OnboardingAutomation = ReturnType<typeof createOnboardingAutomation>
