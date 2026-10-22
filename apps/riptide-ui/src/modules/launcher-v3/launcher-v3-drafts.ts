import * as z from 'zod'

import {
	createLauncherV3DefaultValues,
	launcherV3DraftValuesSchema,
	type LauncherV3DraftValues,
	launcherV3FormAttachmentSchema,
	type LauncherV3FormValues,
	type PersistedLauncherV3Draft,
} from './launcher-v3-form'

export const LEGACY_LAUNCHER_V3_DRAFT_EXTRAS_PREFIX = 'riptide:launcher-v3-draft-extras:'
export const LEGACY_LAUNCHER_V3_ACTIVE_RECOVERY_KEY = 'riptide:launcher-v3-active-recovery'
const LAUNCHER_V3_SCOPED_STORAGE_PREFIX = 'riptide:launcher-v3:'
export const LAUNCHER_V3_STORAGE_ENVELOPE_VERSION = 2 as const

const UNTITLED_DRAFT_NAME = 'Untitled Draft'

export interface LauncherV3Storage {
	readonly length: number
	key(index: number): string | null
	getItem(key: string): string | null
	setItem(key: string, value: string): void
	removeItem(key: string): void
}

export interface LauncherV3AuthScope {
	userId: string
	organizationId: string
}

export interface LauncherV3Recovery {
	version: typeof LAUNCHER_V3_STORAGE_ENVELOPE_VERSION
	userId: string
	organizationId: string
	draftId: string
	savedAt: number
	values: LauncherV3DraftValues
}

export type LauncherV3RecoveryInput = Omit<LauncherV3Recovery, 'userId' | 'organizationId'>

export type LauncherV3LaunchIdentity = {
	draftId: string
	firstSessionId: string
	firstEventId: string
	state: 'editing' | 'launching'
}

export interface LauncherV3DraftPersistence {
	readExtras(draftId: string): LauncherV3DraftValues | null
	writeExtras(draftId: string, values: LauncherV3DraftValues): boolean
	removeExtras(draftId: string): void
	readRecovery(): LauncherV3Recovery | null
	writeRecovery(recovery: LauncherV3RecoveryInput): boolean
	removeRecovery(draftId?: string): void
	readLaunchIdentity(draftId: string): LauncherV3LaunchIdentity | null
	writeLaunchIdentity(identity: LauncherV3LaunchIdentity): boolean
	removeLaunchIdentity(draftId: string): void
}

function launcherV3ScopeStoragePrefix(scope: LauncherV3AuthScope): string {
	return `${LAUNCHER_V3_SCOPED_STORAGE_PREFIX}${encodeURIComponent(scope.userId)}:${encodeURIComponent(scope.organizationId)}:`
}

export function launcherV3DraftExtrasKey(scope: LauncherV3AuthScope, draftId: string): string {
	return `${launcherV3ScopeStoragePrefix(scope)}extras:${draftId}`
}

export function launcherV3ActiveRecoveryKey(scope: LauncherV3AuthScope): string {
	return `${launcherV3ScopeStoragePrefix(scope)}recovery`
}

export function launcherV3LaunchIdentityKey(scope: LauncherV3AuthScope, draftId: string): string {
	return `${launcherV3ScopeStoragePrefix(scope)}launch:${draftId}`
}

const unknownRecordSchema = z.record(z.string(), z.unknown())
const storedDraftEnvelopeSchema = z.object({
	version: z.literal(LAUNCHER_V3_STORAGE_ENVELOPE_VERSION),
	userId: z.string(),
	organizationId: z.string(),
	values: z.unknown(),
})
const storedRecoveryEnvelopeSchema = storedDraftEnvelopeSchema.extend({
	draftId: z.string().min(1),
	savedAt: z.number().finite(),
})
const storedLaunchIdentityEnvelopeSchema = z.object({
	version: z.literal(LAUNCHER_V3_STORAGE_ENVELOPE_VERSION),
	userId: z.string(),
	organizationId: z.string(),
	draftId: z.string().min(1),
	firstSessionId: z.string().min(1),
	firstEventId: z.string().min(1),
	state: z.enum(['editing', 'launching']),
})

function parseJson(raw: string | null): unknown {
	if (!raw) return null
	try {
		return JSON.parse(raw) as unknown
	} catch {
		return null
	}
}

function hasMatchingScope(raw: { userId: string; organizationId: string }, scope: LauncherV3AuthScope): boolean {
	return raw.userId === scope.userId && raw.organizationId === scope.organizationId
}

function parseAttachments(raw: unknown): LauncherV3DraftValues['attachments'] {
	if (!Array.isArray(raw)) return []
	const seen = new Set<string>()
	return raw.flatMap((candidate) => {
		const parsed = launcherV3FormAttachmentSchema.safeParse(candidate)
		if (!parsed.success || seen.has(parsed.data.fileName)) return []
		seen.add(parsed.data.fileName)
		return [parsed.data]
	})
}

function parseDraftValues(raw: unknown): LauncherV3DraftValues | null {
	const record = unknownRecordSchema.safeParse(raw)
	if (!record.success) return null
	const values = createLauncherV3DefaultValues()
	for (const field of Object.keys(launcherV3DraftValuesSchema.shape) as Array<keyof LauncherV3DraftValues>) {
		if (field === 'attachments') {
			values.attachments = parseAttachments(record.data.attachments)
			continue
		}
		applyField(values, field, record.data[field])
	}
	return launcherV3DraftValuesSchema.parse(values)
}

function parseExtras(raw: unknown, scope: LauncherV3AuthScope): LauncherV3DraftValues | null {
	const envelope = storedDraftEnvelopeSchema.safeParse(raw)
	if (!envelope.success || !hasMatchingScope(envelope.data, scope)) return null
	return parseDraftValues(envelope.data.values)
}

function parseRecovery(raw: unknown, scope: LauncherV3AuthScope): LauncherV3Recovery | null {
	const envelope = storedRecoveryEnvelopeSchema.safeParse(raw)
	if (!envelope.success || !hasMatchingScope(envelope.data, scope)) return null
	const values = parseDraftValues(envelope.data.values)
	if (!values) return null
	return {
		version: LAUNCHER_V3_STORAGE_ENVELOPE_VERSION,
		userId: scope.userId,
		organizationId: scope.organizationId,
		draftId: envelope.data.draftId,
		savedAt: envelope.data.savedAt,
		values,
	}
}

function parseLaunchIdentity(raw: unknown, scope: LauncherV3AuthScope): LauncherV3LaunchIdentity | null {
	const envelope = storedLaunchIdentityEnvelopeSchema.safeParse(raw)
	if (!envelope.success || !hasMatchingScope(envelope.data, scope)) return null
	return {
		draftId: envelope.data.draftId,
		firstSessionId: envelope.data.firstSessionId,
		firstEventId: envelope.data.firstEventId,
		state: envelope.data.state,
	}
}

/**
 * Creates the imperative, auth-scoped storage boundary for Launcher V3 drafts.
 *
 * This uses a Storage-compatible adapter instead of a React local-storage hook
 * because launch, save, recovery, and commit cleanup must read and remove
 * records at exact points in async event flows rather than from render
 * snapshots. It also manages several dynamic draft keys, validates untrusted
 * stored values, removes legacy and invalid records, isolates records by user
 * and organization, and treats browser storage failures as best effort.
 *
 * Keeping Storage behind this adapter limits raw browser access to the
 * composition root and lets tests inject an in-memory or failing store without
 * rendering React.
 */
export function createLauncherV3DraftPersistence(
	storage: LauncherV3Storage,
	scope: LauncherV3AuthScope,
): LauncherV3DraftPersistence {
	const recoveryKey = launcherV3ActiveRecoveryKey(scope)
	const extrasKey = (draftId: string) => launcherV3DraftExtrasKey(scope, draftId)
	const launchIdentityKey = (draftId: string) => launcherV3LaunchIdentityKey(scope, draftId)

	// Scoped keys coexist across users and organizations. Only remove records from
	// the old unscoped layout; envelope scope stamps remain defense-in-depth.
	try {
		const legacyKeys: string[] = []
		for (let index = 0; index < storage.length; index += 1) {
			const key = storage.key(index)
			if (
				key === LEGACY_LAUNCHER_V3_ACTIVE_RECOVERY_KEY ||
				key?.startsWith(LEGACY_LAUNCHER_V3_DRAFT_EXTRAS_PREFIX)
			) {
				legacyKeys.push(key)
			}
		}
		for (const key of legacyKeys) storage.removeItem(key)
	} catch {}

	const persistence: LauncherV3DraftPersistence = {
		readExtras(draftId) {
			try {
				const key = extrasKey(draftId)
				const raw = storage.getItem(key)
				if (raw === null) return null
				const extras = parseExtras(parseJson(raw), scope)
				if (!extras) storage.removeItem(key)
				return extras
			} catch {
				return null
			}
		},
		writeExtras(draftId, values) {
			try {
				const key = extrasKey(draftId)
				storage.setItem(
					key,
					JSON.stringify({ version: LAUNCHER_V3_STORAGE_ENVELOPE_VERSION, ...scope, values }),
				)
				const confirmed = parseExtras(parseJson(storage.getItem(key)), scope)
				return JSON.stringify(confirmed) === JSON.stringify(values)
			} catch {
				return false
			}
		},
		removeExtras(draftId) {
			try {
				storage.removeItem(extrasKey(draftId))
			} catch {}
		},
		readRecovery() {
			try {
				const raw = storage.getItem(recoveryKey)
				if (raw === null) return null
				const parsedRaw = parseJson(raw)
				const recovery = parseRecovery(parsedRaw, scope)
				if (!recovery) {
					storage.removeItem(recoveryKey)
					const invalidRecovery = storedRecoveryEnvelopeSchema.safeParse(parsedRaw)
					if (invalidRecovery.success) storage.removeItem(extrasKey(invalidRecovery.data.draftId))
				}
				return recovery
			} catch {
				return null
			}
		},
		writeRecovery(recovery) {
			try {
				const envelope = { ...recovery, ...scope }
				storage.setItem(recoveryKey, JSON.stringify(envelope))
				const confirmed = parseRecovery(parseJson(storage.getItem(recoveryKey)), scope)
				return (
					confirmed?.draftId === recovery.draftId &&
					confirmed.savedAt === recovery.savedAt &&
					JSON.stringify(confirmed.values) === JSON.stringify(recovery.values)
				)
			} catch {
				return false
			}
		},
		removeRecovery(draftId) {
			try {
				if (draftId && this.readRecovery()?.draftId !== draftId) return
				storage.removeItem(recoveryKey)
			} catch {}
		},
		readLaunchIdentity(draftId) {
			try {
				const key = launchIdentityKey(draftId)
				const raw = storage.getItem(key)
				if (raw === null) return null
				const identity = parseLaunchIdentity(parseJson(raw), scope)
				if (!identity || identity.draftId !== draftId) storage.removeItem(key)
				return identity?.draftId === draftId ? identity : null
			} catch {
				return null
			}
		},
		writeLaunchIdentity(identity) {
			try {
				const key = launchIdentityKey(identity.draftId)
				storage.setItem(
					key,
					JSON.stringify({ version: LAUNCHER_V3_STORAGE_ENVELOPE_VERSION, ...scope, ...identity }),
				)
				return JSON.stringify(this.readLaunchIdentity(identity.draftId)) === JSON.stringify(identity)
			} catch {
				return false
			}
		},
		removeLaunchIdentity(draftId) {
			try {
				storage.removeItem(launchIdentityKey(draftId))
			} catch {}
		},
	}
	return persistence
}

export interface ImportLauncherV3DraftInput {
	draftRow?: unknown
	localExtras?: unknown
	defaults?: LauncherV3FormValues
}

function firstValue(record: Record<string, unknown>, camel: string, snake = camel): unknown {
	return Object.prototype.hasOwnProperty.call(record, camel) ? record[camel] : record[snake]
}

function applyField<K extends keyof LauncherV3DraftValues>(
	values: LauncherV3FormValues,
	field: K,
	candidate: unknown,
): void {
	if (candidate === undefined) return
	const parsed = launcherV3DraftValuesSchema.shape[field].safeParse(candidate)
	if (parsed.success) values[field] = parsed.data as LauncherV3FormValues[K]
}

function applyDurable(values: LauncherV3FormValues, raw: unknown): void {
	const record = unknownRecordSchema.safeParse(raw)
	if (!record.success) return
	const name = firstValue(record.data, 'name')
	if (typeof name === 'string' && name !== UNTITLED_DRAFT_NAME) applyField(values, 'title', name)
	applyField(values, 'slug', firstValue(record.data, 'slug'))
	applyField(values, 'directory', firstValue(record.data, 'defaultWorkingDirectory', 'default_working_directory'))
	const description = firstValue(record.data, 'ticketDescription', 'ticket_description')
	if (typeof description === 'string') applyField(values, 'prompt', description.trim() ? description : null)
	const workflowType = firstValue(record.data, 'workflowType', 'workflow_type')
	applyField(values, 'workflowType', workflowType === 'rpi' ? 'outline_only' : workflowType)
	applyField(values, 'worktreeTiming', firstValue(record.data, 'worktreeTiming', 'worktree_timing'))
	const autoAdvanceFields = [
		firstValue(record.data, 'autoAdvanceQuestionsToResearch', 'auto_advance_questions_to_research'),
		firstValue(record.data, 'autoAdvanceResearchToDesign', 'auto_advance_research_to_design'),
		firstValue(record.data, 'autoAdvancePlanToWorktree', 'auto_advance_plan_to_worktree'),
		firstValue(record.data, 'autoAdvanceWorktreeToImplementation', 'auto_advance_worktree_to_implementation'),
		firstValue(record.data, 'autoAdvanceImplementationToPr', 'auto_advance_implementation_to_pr'),
	]
	if (autoAdvanceFields.some((value) => typeof value === 'boolean')) {
		applyField(
			values,
			'autoAdvance',
			autoAdvanceFields.some((value) => value === true),
		)
	}
	applyDurableTicket(values, record.data)
}

/**
 * Rebuild the ticket chip from a durable V2/V3 row. Local extras overwrite this
 * with the fully resolved attachment (name, slug, url) when they exist.
 */
function applyDurableTicket(values: LauncherV3FormValues, raw: Record<string, unknown>): void {
	const provider = firstValue(raw, 'ticketProvider', 'ticket_provider')
	const ticketId = firstValue(raw, 'ticketId', 'ticket_id')
	if (typeof provider !== 'string' || typeof ticketId !== 'string' || !ticketId.trim()) return
	const url = firstValue(raw, 'ticketUrl', 'ticket_url')
	const connectionId = firstValue(raw, 'githubConnectionId', 'github_connection_id')
	const repositoryId = firstValue(raw, 'ticketRepositoryId', 'ticket_repository_id')
	const fullName = firstValue(raw, 'ticketRepositoryFullName', 'ticket_repository_full_name')
	const githubRepository =
		typeof connectionId === 'string' && typeof repositoryId === 'string' && typeof fullName === 'string'
			? {
					connectionId,
					repositoryId,
					fullName,
					accountLogin: fullName.split('/')[0] ?? fullName,
					private: false,
					archived: false,
				}
			: null
	applyField(values, 'ticket', {
		provider,
		ticketId: ticketId.trim(),
		name: '',
		slug: '',
		url: typeof url === 'string' && url ? url : null,
		githubRepository,
	})
}

function applyExtras(values: LauncherV3FormValues, raw: unknown): void {
	const record = unknownRecordSchema.safeParse(raw)
	if (!record.success) return
	for (const field of Object.keys(launcherV3DraftValuesSchema.shape) as Array<keyof LauncherV3DraftValues>) {
		if (field === 'attachments') {
			values.attachments = parseAttachments(record.data.attachments)
			continue
		}
		applyField(values, field, record.data[field])
	}
}

/** Merge current defaults, a V2/V3 server row, then current V3 extras. */
export function importLauncherV3Draft(input: ImportLauncherV3DraftInput = {}): LauncherV3FormValues {
	const values = createLauncherV3DefaultValues(input.defaults)
	applyDurable(values, input.draftRow)
	applyExtras(values, input.localExtras)
	return createLauncherV3DefaultValues(values)
}

export function recoveryFromDraft(
	draftId: string,
	values: PersistedLauncherV3Draft['local'],
	savedAt = Date.now(),
): LauncherV3RecoveryInput {
	return { version: LAUNCHER_V3_STORAGE_ENVELOPE_VERSION, draftId, savedAt, values }
}
