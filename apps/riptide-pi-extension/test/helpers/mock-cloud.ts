// A node:http mock of the HumanLayer clouds: WorkOS (device code) and riptide-api (auth, the
// automation prepare route, and the daemon-plane session and artifact routes). One server answers
// both, since tests point HUMANLAYER_API_URL and HUMANLAYER_WORKOS_URL at the same origin. See
// plan.md §9's "Mock cloud".
//
// Every call runs one pipeline: an armed failure (fail()) first, then the route's auth, then its
// zod body check (contracts.ts), then the handler. Errors use the oRPC body shape
// {defined, code, status, message, data?}. createUpload's uploadUrl points back here: PUT
// /__upload/<id> stands in for S3 and checks the bytes against the createUpload call.

import { createHash, randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

import { z } from 'zod'

import type { Plane } from '../../src/rpc.ts'
import { decodeJwtPayload } from '../../src/util.ts'
import {
	artifactCreateUploadInput,
	artifactUpsertInput,
	daemonTokenCreateInput,
	eventCreateInput,
	agentCommandsReportInput,
	approvalCreateInput,
	approvalResolveInput,
	sessionRenameInput,
	taskRenameInput,
	heartbeatInput,
	organizationsListInput,
	repositoriesReportInput,
	runPrepareInput,
	type SessionStatus,
	sessionUpdateInput,
	type taskConfigInput,
	tokenRefreshInput,
} from './contracts.ts'

// A login against the mock must not open its example.invalid device page in a real browser.
process.env.HUMANLAYER_PI_NO_BROWSER = '1'

/** A PAT the mock accepts out of the box (see MockState.pats), e.g. HUMANLAYER_PAT for e2e runs. */
export const MOCK_PAT = 'hl-pat-mock'

export type DeviceScriptStep = 'pending' | 'slow_down'

export interface MockOrg {
	organizationId: string
	organizationName: string
	role: string
	signInUrl: string
	domains: string[]
	/** Not part of the real API response; carried in minted token claims only. */
	internalOrgId: string
}

export interface MockState {
	userId: string
	email: string
	orgs: MockOrg[]
	activeOrganizationId: string | null
	accessTokenTtlSeconds: number
	/** Whether the next device-login access token carries org_id/internal_org_id claims, like a
	 *  real WorkOS token already scoped to an org. Set false to model a token with none yet. */
	deviceTokenHasOrgClaims: boolean
	/** Consumed (shifted) by the next authorize/device call, then cleared. */
	nextDeviceScript: DeviceScriptStep[]
	/** Polls of each device code that answer authorization_pending after its script, before the
	 *  login is approved. Read at each poll, so lowering it lets a held login through. */
	pendingPolls: number
	validRefreshTokens: Set<string>
	/** PATs accepted as a Bearer, for state.userId in the active org. Like riptide-api, any bearer
	 *  that is not JWT-shaped is looked up here. Seeded with MOCK_PAT. */
	pats: Set<string>
	/** Bearer or daemon token values to reject with 401 exactly once, then treat as valid again. */
	force401Once: Set<string>
}

export type RequestPlane = Plane | 'workos' | 'upload' | 'sync'

export interface RecordedRequest {
	method: string
	/** "api" or "daemon" for /rpc/{plane}/v1/... paths, "upload" for PUT /__upload/<id>, "sync" for the
	 *  Electric sessions shape (GET /v1/sessions/<hostId>), else "workos". */
	plane: RequestPlane
	/** The full URL path, e.g. "/rpc/daemon/v1/sessions/events/create". */
	path: string
	/** 0 when an armed network or hang failure gave no answer. */
	status: number
	/** The body as sent: parsed JSON for riptide-api, form fields for WorkOS, {contentType, size,
	 *  sha256} for an upload. */
	body: unknown
}

type PrepareInput = z.output<typeof runPrepareInput>
type SessionUpdateInput = z.output<typeof sessionUpdateInput>
type EventInput = z.output<typeof eventCreateInput>
type RepositoriesReportInput = z.output<typeof repositoriesReportInput>
type ModelUsage = NonNullable<SessionUpdateInput['modelUsage']>
type UpsertInput = z.output<typeof artifactUpsertInput>
type CreateUploadInput = z.output<typeof artifactCreateUploadInput>

/** A task made by prepare's "ensure" (its parsed task config) or by seedTask(). */
export type MockTask = z.output<typeof taskConfigInput> & { id: string; slug: string }

/** A session as prepare made it, with every sessions/update field applied since. */
export type MockSession = Pick<
	PrepareInput,
	'hostId' | 'codingAgent' | 'provider' | 'model' | 'prompt' | 'workingDirectory' | 'sessionName'
> &
	Omit<SessionUpdateInput, 'sessionId' | 'status' | 'model' | 'usageReportKey'> & {
		id: string
		taskId: string
		userId: string
		status: SessionStatus
	}

/** A stored event: the parsed events/create body (tool ids cut to 256) with its eventId filled in. */
export type MockEvent = Omit<EventInput, 'eventId' | 'codingAgentSessionId'> & {
	eventId: string
	/** Absent only on the first user event, which prepare writes itself. */
	codingAgentSessionId?: string
}

export type MockRepository = RepositoriesReportInput['repositories'][number]

/** An approval as the approvals table holds it. */
export interface MockApproval {
	id: string
	sessionId: string
	hostId: string
	toolName: string
	toolInput: unknown
	toolUseId?: string
	status: 'pending' | 'approved' | 'denied'
	comment?: string
}

/** A task file as the artifacts table holds it: the newest upsert or createUpload for its fileName. */
export interface MockArtifact {
	id: string
	fileName: string
	storageType: 'postgres' | 's3'
	/** The text with NUL bytes removed, as the server stores it; "" for s3. */
	content: string
	/** The server's ohash of content, or createUpload's contentHash. */
	contentHash: string
	/** s3 only. */
	contentType?: string
	fileSizeBytes?: number
	/** Text only, as sent. */
	operationType?: UpsertInput['operationType']
	operationContents?: Record<string, unknown>
	frontmatter?: Record<string, unknown>
	sessionId?: string
}

/** A PUT to an uploadUrl whose Content-Type, size and sha256 matched its createUpload. */
export interface MockUpload {
	taskId: string
	fileName: string
	contentType: string
	size: number
	sha256: string
}

/** An armed failure: fail(rule), or POST /__mock/fail with rule as the JSON body. */
export interface FailRule {
	/** A full path, or its tail after a "/": "sessions/update", "automation/run/prepare",
	 *  "token/refresh". "__upload" matches every upload PUT. */
	route: string
	/** HTTP status, default 500. Ignored when network is true. */
	status?: number
	/** Default by status: 400 BAD_REQUEST, 401 UNAUTHORIZED, 402 BILLING_REQUIRED, 403 FORBIDDEN,
	 *  404 NOT_FOUND, 500 INTERNAL_SERVER_ERROR, 503 SERVICE_UNAVAILABLE, else INJECTED_FAILURE. */
	code?: string
	message?: string
	data?: unknown
	/** Close the socket with no response, so fetch rejects as on a dropped connection. */
	network?: boolean
	/** Never answer: the call waits until the client gives up or close() cuts it. */
	hang?: boolean
	/** How many matching calls fail: a count (default 1; 0 clears the rule) or "always" until reset(). */
	times?: number | 'always'
}

export interface MockCloud {
	url: string
	/** Every call except the /__mock/* control routes, in arrival order. A live array. */
	requests: RecordedRequest[]
	state: MockState
	/** Tasks in creation order. */
	tasks(): MockTask[]
	/** Sessions in creation order. */
	sessions(): MockSession[]
	/** The session's events in arrival order; the first is the prompt, which prepare writes. */
	events(sessionId: string): MockEvent[]
	/** Every status the session has had: "ready_for_launch" from prepare, then each one sessions/update set. */
	statuses(sessionId: string): SessionStatus[]
	/** Every repository reported for the session, upserted by localPath like the server's rows. */
	repositories(sessionId: string): MockRepository[]
	/** The task's files, one per fileName. */
	artifacts(taskId: string): MockArtifact[]
	/** Upload PUTs that matched their createUpload, in arrival order. */
	uploads(): MockUpload[]
	/** Calls a hang rule holds that the client has not given up on yet. */
	hung(): number
	/** What riptide-api's sessions.v2.continue does for an idle session: writes the user event, sets
	 *  the prompt and moves the session to resuming, which the sessions shape then carries. */
	continueSession(sessionId: string, prompt: string): void
	/** The web stop button: moves the session to interrupt_requested. */
	interruptSession(sessionId: string): void
	/** Rotates the sessions shape's handle, so the next request with the old one gets a 409. */
	rotateShape(): void
	/** The session's approvals in creation order (approvals/create). */
	approvals(sessionId: string): MockApproval[]
	/** What riptide-api's approvals.resolve does for a web user: answers a pending approval, and
	 *  moves the session back to running once none is pending. Already answered is a no-op. */
	resolveApproval(approvalId: string, decision: 'approve' | 'deny', comment?: string): void
	/** Adds a task for "use" (attach) tests. id defaults to a fresh uuid, name to the slug. */
	seedTask(task: { id?: string; slug: string; name?: string }): MockTask
	/** Answers every call to a daemon-plane route (full path or tail, as in FailRule) with 200 and
	 *  body, after the daemon-token check. For routes the mock does not model, e.g. comments/get. */
	stub(route: string, body: unknown): void
	/** Arms a failure. A new rule for the same route replaces the old one. */
	fail(rule: FailRule): void
	/** Clears tasks, sessions, events, artifacts, uploads, recorded requests and armed failures (POST
	 *  /__mock/reset does the same). Keeps auth state (users, orgs, tokens, PATs), so logins stay valid. */
	reset(): void
	close(): Promise<void>
}

type Handled = { status: number; body: unknown }

/** The statuses riptide-api's events/create moves to running when an event proves the agent works. */
const REPAIRABLE = new Set<string>([
	'lost',
	'waiting_for_usage_limit',
	'failed',
	'interrupted',
	'ready_for_input',
	'launching',
])

/** One Electric shape: a change log for every host, filtered per request. An offset is an index into it. */
interface Feed {
	handle: string
	log: { hostId: string; message: unknown }[]
}

interface Caller {
	userId: string
	organizationId: string
}

interface SessionRecord {
	session: MockSession
	events: MockEvent[]
	statuses: SessionStatus[]
	repositories: Map<string, MockRepository>
	/** The server keeps the last 20 applied usage report keys. */
	usageReportKeys: string[]
}

const DEFAULT_ERROR_CODES: Record<number, string> = {
	400: 'BAD_REQUEST',
	401: 'UNAUTHORIZED',
	402: 'BILLING_REQUIRED',
	403: 'FORBIDDEN',
	404: 'NOT_FOUND',
	500: 'INTERNAL_SERVER_ERROR',
	503: 'SERVICE_UNAVAILABLE',
}

export interface MockCloudOptions {
	/** Orgs the user is in (0-1000, default 1): Acme (org_default, active), then Org 2 (org_2) and so on. */
	orgs?: number
	/** MockState.pendingPolls (default 0: approved at the first poll). */
	pendingPolls?: number
}

const configurationInput = z
	.object({
		orgs: z.number().int().min(0).max(1000).optional(),
		pendingPolls: z.number().int().nonnegative().optional(),
	})
	.strict()

function defaultState(opts: MockCloudOptions): MockState {
	const orgs = Array.from({ length: opts.orgs ?? 1 }, (_, i): MockOrg => {
		const organizationId = i === 0 ? 'org_default' : `org_${i + 1}`
		const signInUrl = `https://example.invalid/sign-in/${organizationId}`
		const organizationName = i === 0 ? 'Acme' : `Org ${i + 1}`
		return {
			organizationId,
			organizationName,
			role: i === 0 ? 'admin' : 'member',
			signInUrl,
			domains: [],
			internalOrgId: randomUUID(),
		}
	})
	return {
		userId: `user_${randomUUID()}`,
		email: 'test@example.com',
		orgs,
		// The real server's activeOrganizationId is auth.organizationId: the internal org uuid,
		// not a WorkOS "org_..." id (verified server facts). Mirroring that here is what exposed
		// the org-pick bug this file's login tests cover.
		activeOrganizationId: orgs[0]?.internalOrgId ?? null,
		accessTokenTtlSeconds: 3600,
		deviceTokenHasOrgClaims: true,
		nextDeviceScript: [],
		pendingPolls: opts.pendingPolls ?? 0,
		validRefreshTokens: new Set(),
		pats: new Set([MOCK_PAT]),
		force401Once: new Set(),
	}
}

function base64url(input: string): string {
	return Buffer.from(input, 'utf8').toString('base64url')
}

/** Not a real JWT (no signature), only shaped like one so decodeJwtPayload can read it back. */
function fakeJwt(claims: Record<string, unknown>): string {
	return `${base64url(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${base64url(JSON.stringify(claims))}.mock-signature`
}

/** Decoded claims, or null when the value is not JWT-shaped. */
function jwtClaims(token: string): Record<string, unknown> | null {
	try {
		return decodeJwtPayload(token)
	} catch {
		return null
	}
}

function stringClaim(claims: Record<string, unknown> | null, key: string): string | undefined {
	const value = claims?.[key]
	return typeof value === 'string' ? value : undefined
}

function orpcError(status: number, code: string, message: string, data?: unknown): Handled {
	return { status, body: { defined: true, code, status, message, ...(data === undefined ? {} : { data }) } }
}

function unauthorized(): Handled {
	return orpcError(401, 'UNAUTHORIZED', 'Unauthorized')
}

/** riptide-api's enrichValidationError: a failed input check becomes 400 INPUT_VALIDATION_FAILED,
 *  with the zod issues as the message. An interceptor throws it, so it is not `defined`. */
function invalidInput(error: z.ZodError): Handled {
	const body = {
		defined: false,
		code: 'INPUT_VALIDATION_FAILED',
		status: 400,
		message: z.prettifyError(error),
		data: z.flattenError(error),
	}
	return { status: 400, body }
}

function withInput<T>(schema: z.ZodType<T>, body: unknown, handle: (input: T) => Handled): Handled {
	const parsed = schema.safeParse(body)
	return parsed.success ? handle(parsed.data) : invalidInput(parsed.error)
}

/** The server's mergeModelUsage: sums each model's token counts; a count absent on both sides stays absent. */
function mergeModelUsage(existing: ModelUsage, incoming: ModelUsage): ModelUsage {
	const merged: ModelUsage = { ...existing }
	for (const [model, usage] of Object.entries(incoming)) {
		const sum: Record<string, number | undefined> = { ...merged[model] }
		for (const [key, count] of Object.entries(usage)) if (count !== undefined) sum[key] = (sum[key] ?? 0) + count
		merged[model] = sum as ModelUsage[string]
	}
	return merged
}

/** The server's content hash for text artifacts: ohash of a string, which quotes it and takes
 *  sha256 in base64url (the real server strips NUL bytes first; callers pass stripped text). */
function textHash(content: string): string {
	return createHash('sha256').update(`'${content}'`, 'utf8').digest('base64url')
}

function readBody(req: IncomingMessage): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = []
		req.on('data', (chunk: Buffer) => chunks.push(chunk))
		req.on('end', () => resolve(Buffer.concat(chunks)))
		req.on('error', reject)
	})
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
	const text = JSON.stringify(body)
	res.writeHead(status, { 'content-type': 'application/json' })
	res.end(text)
}

/** Starts the mock. Defaults to an OS-assigned port. Call close() when done, including on test failure. */
export async function startMockCloud(port = 0, opts: MockCloudOptions = {}): Promise<MockCloud> {
	const state = defaultState(configurationInput.parse(opts))
	const requests: RecordedRequest[] = []
	const deviceCodes = new Map<string, { script: DeviceScriptStep[]; organizationId: string; polls: number }>()
	const failures = new Map<string, FailRule>()
	const stubs = new Map<string, unknown>()
	const tasks: MockTask[] = []
	const records = new Map<string, SessionRecord>()
	const eventIds = new Set<string>() // across sessions, like the events table's primary key
	const files = new Map<string, Map<string, MockArtifact>>() // taskId -> fileName -> row
	const uploadTargets = new Map<string, CreateUploadInput>() // uploadUrl id -> its createUpload
	const uploadsDone: MockUpload[] = []
	const held = new Set<ServerResponse>() // hung calls whose client is still connected
	// The Electric shape of sessions the sync proxy serves at /v1/sessions/<hostId>: one change log
	// for every host, filtered per request. An offset is an index into it.
	const shape: Feed = { handle: randomUUID(), log: [] }
	// The approvals shape the sync proxy serves at /v1/daemon/approvals, for the token's host.
	const approvalsShape: Feed = { handle: randomUUID(), log: [] }
	const approvalRows = new Map<string, MockApproval>()
	const shapeWaiters = new Set<() => void>()
	let url = ''
	let lastTransactionId = 0

	function fail(rule: FailRule): void {
		const times = rule.times ?? 1
		if (times !== 'always' && times <= 0) failures.delete(rule.route)
		else failures.set(rule.route, { ...rule, times })
	}

	/** The first armed rule that matches path, counted down. */
	function takeFailure(path: string): FailRule | undefined {
		for (const [route, rule] of failures) {
			if (path !== route && !path.endsWith(`/${route}`)) continue
			if (typeof rule.times === 'number' && --rule.times <= 0) failures.delete(route)
			return rule
		}
		return undefined
	}

	function reset(): void {
		requests.length = 0
		failures.clear()
		stubs.clear()
		tasks.length = 0
		records.clear()
		eventIds.clear()
		files.clear()
		uploadTargets.clear()
		uploadsDone.length = 0
		shape.log.length = 0
		approvalsShape.log.length = 0
		approvalRows.clear()
	}

	/** Adds a row change to the sessions shape and wakes the live requests waiting on it. An update
	 *  carries only the columns that changed, as Electric's default replica mode does. */
	function publish(session: MockSession, operation: 'insert' | 'update', value: Record<string, unknown>): void {
		const message = {
			headers: { operation },
			key: `"public"."sessions"/"${session.id}"`,
			value: { id: session.id, ...value },
		}
		shape.log.push({ hostId: session.hostId, message })
		wakeShape()
	}

	function wakeShape(): void {
		for (const wake of [...shapeWaiters]) wake()
	}

	function setWebStatus(sessionId: string, status: SessionStatus, prompt?: string): void {
		const rec = records.get(sessionId)
		if (!rec) throw new Error(`no session ${sessionId}`)
		rec.session.status = status
		rec.statuses.push(status)
		// The server stamps each change, so two stops on one session are two actions.
		const updated_at = new Date().toISOString()
		if (prompt === undefined) return publish(rec.session, 'update', { status, updated_at })
		rec.session.prompt = prompt
		const event: MockEvent = {
			eventId: randomUUID(),
			sessionId,
			eventType: 'message',
			role: 'user',
			content: prompt,
		}
		eventIds.add(event.eventId)
		rec.events.push(event)
		publish(rec.session, 'update', { status, prompt, updated_at })
	}

	function publishApproval(
		approval: MockApproval,
		operation: 'insert' | 'update',
		value: Record<string, unknown>,
	): void {
		approvalsShape.log.push({
			hostId: approval.hostId,
			message: {
				headers: { operation },
				key: `"public"."approvals"/"${approval.id}"`,
				value: { id: approval.id, ...value },
			},
		})
		wakeShape()
	}

	function setStatus(rec: SessionRecord, status: SessionStatus): void {
		rec.session.status = status
		rec.statuses.push(status)
		publish(rec.session, 'update', { status })
	}

	/** approvals/create: a pending approval, and the session waits on it. */
	function handleApprovalCreate(rec: SessionRecord, input: z.output<typeof approvalCreateInput>): unknown {
		const approval: MockApproval = {
			id: randomUUID(),
			sessionId: rec.session.id,
			hostId: rec.session.hostId,
			toolName: input.toolName,
			toolInput: input.toolInput,
			status: 'pending',
		}
		if (input.toolUseId) approval.toolUseId = input.toolUseId
		approvalRows.set(approval.id, approval)
		publishApproval(approval, 'insert', {
			session_id: approval.sessionId,
			host_id: approval.hostId,
			tool_name: approval.toolName,
			tool_input: approval.toolInput,
			tool_use_id: approval.toolUseId ?? null,
			status: 'pending',
			comment: null,
		})
		setStatus(rec, 'needs_approval')
		return { approvalId: approval.id, transactionId: String(++lastTransactionId) }
	}

	function resolveApproval(approvalId: string, decision: 'approve' | 'deny', comment?: string): Handled {
		const approval = approvalRows.get(approvalId)
		if (!approval) return orpcError(404, 'NOT_FOUND', 'Not Found')
		const transactionId = String(++lastTransactionId)
		if (approval.status !== 'pending') return { status: 200, body: { success: true, transactionId } }
		approval.status = decision === 'approve' ? 'approved' : 'denied'
		if (comment !== undefined) approval.comment = comment
		publishApproval(approval, 'update', { status: approval.status, comment: comment ?? null })
		const rec = records.get(approval.sessionId)
		const pending = [...approvalRows.values()].some(
			(a) => a.sessionId === approval.sessionId && a.status === 'pending',
		)
		if (rec && !pending) setStatus(rec, 'running')
		return { status: 200, body: { success: true, transactionId } }
	}

	/** The sync proxy's sessions route: the daemon token (401), its host (403), then Electric's
	 *  protocol: a stale handle is a 409, and a live request waits for a change or a short timeout. */
	async function shapeRoute(
		req: IncomingMessage,
		res: ServerResponse,
		path: string,
		feed: Feed = shape,
	): Promise<void> {
		const query = new URL(req.url ?? '/', 'http://mock').searchParams
		const record = (status: number) =>
			requests.push({
				method: 'GET',
				plane: 'sync',
				path,
				status,
				body: { offset: query.get('offset'), handle: query.get('handle'), live: query.get('live') },
			})
		const failure = takeFailure(path)
		if (failure) {
			record(failure.status ?? 500)
			return sendJson(res, failure.status ?? 500, { message: failure.message ?? 'injected failure' })
		}
		const caller = daemonCaller(req)
		if (!caller) {
			record(401)
			return sendJson(res, 401, { error: 'Unauthorized' })
		}
		if (feed === shape && path !== `/v1/sessions/${caller.hostId}`) {
			record(403)
			return sendJson(res, 403, { error: 'hostId mismatch' })
		}
		const offset = query.get('offset') ?? '-1'
		const from = offset === '-1' ? 0 : Number(offset)
		const stale = () => {
			const handle = query.get('handle')
			return handle !== null && handle !== feed.handle
		}
		if (!stale() && query.get('live') === 'true' && from >= feed.log.length) {
			await new Promise<void>((resolve) => {
				const done = () => {
					clearTimeout(timer)
					shapeWaiters.delete(done)
					resolve()
				}
				const timer = setTimeout(done, 300)
				shapeWaiters.add(done)
				res.on('close', done)
			})
		}
		if (stale()) {
			record(409)
			res.writeHead(409, { 'content-type': 'application/json', 'electric-handle': feed.handle })
			return void res.end(JSON.stringify([{ headers: { control: 'must-refetch' } }]))
		}
		const messages = feed.log
			.slice(from)
			.filter((entry) => entry.hostId === caller.hostId)
			.map((entry) => entry.message)
		record(200)
		res.writeHead(200, {
			'content-type': 'application/json',
			'electric-handle': feed.handle,
			'electric-offset': String(feed.log.length),
			'electric-cursor': String(Date.now()),
		})
		res.end(JSON.stringify([...messages, { headers: { control: 'up-to-date' } }]))
	}

	function addTask(task: MockTask): MockTask {
		tasks.push(task)
		return task
	}

	function sessions(): MockSession[] {
		return [...records.values()].map((rec) => rec.session)
	}

	function events(sessionId: string): MockEvent[] {
		return records.get(sessionId)?.events ?? []
	}

	function statuses(sessionId: string): SessionStatus[] {
		return records.get(sessionId)?.statuses ?? []
	}

	function repositories(sessionId: string): MockRepository[] {
		return [...(records.get(sessionId)?.repositories.values() ?? [])]
	}

	function artifacts(taskId: string): MockArtifact[] {
		return [...(files.get(taskId)?.values() ?? [])]
	}

	/** GET /__mock/state: what the accessors return, keyed by session or task id where they take one. */
	function snapshot(): unknown {
		const bySession = <T>(pick: (sessionId: string) => T): Record<string, T> =>
			Object.fromEntries([...records.keys()].map((id) => [id, pick(id)]))
		return {
			config: { orgs: state.orgs.length, pendingPolls: state.pendingPolls },
			requests,
			tasks,
			sessions: sessions(),
			events: bySession(events),
			statuses: bySession(statuses),
			repositories: bySession(repositories),
			artifacts: Object.fromEntries([...files.keys()].map((id) => [id, artifacts(id)])),
			uploads: uploadsDone,
			approvals: [...approvalRows.values()],
		}
	}

	function mintAccessToken(org: MockOrg | undefined, opts?: { omitOrgClaims?: boolean }): string {
		return fakeJwt({
			sub: state.userId,
			...(opts?.omitOrgClaims || !org ? {} : { org_id: org.organizationId, internal_org_id: org.internalOrgId }),
			exp: Math.floor(Date.now() / 1000) + state.accessTokenTtlSeconds,
			jti: randomUUID(), // exp has 1s resolution; jti keeps back-to-back mints distinct
		})
	}

	function mintRefreshToken(): string {
		const token = `mock_refresh_${randomUUID()}`
		state.validRefreshTokens.add(token)
		return token
	}

	/** Like riptide-api's auth context: a JWT-shaped bearer is an access token, anything else a PAT.
	 *  force401Once.delete() is true only the first time a forced token shows up. */
	function bearerCaller(req: IncomingMessage): Caller | null {
		const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]
		if (!token || state.force401Once.delete(token)) return null
		const claims = jwtClaims(token)
		if (!claims)
			return state.pats.has(token)
				? { userId: state.userId, organizationId: state.activeOrganizationId ?? '' }
				: null
		const userId = stringClaim(claims, 'sub')
		return userId ? { userId, organizationId: stringClaim(claims, 'internal_org_id') ?? '' } : null
	}

	function bearerRoute<T>(
		req: IncomingMessage,
		body: unknown,
		schema: z.ZodType<T>,
		handle: (input: T, caller: Caller) => Handled,
	): Handled {
		const caller = bearerCaller(req)
		return caller ? withInput(schema, body, (input) => handle(input, caller)) : unauthorized()
	}

	/** The host and user of the daemon token that handleDaemonTokenCreate mints, or null (401). */
	function daemonCaller(req: IncomingMessage): { hostId: string; userId: string } | null {
		const token = req.headers['x-daemon-authorization']
		const claims = typeof token === 'string' && !state.force401Once.delete(token) ? jwtClaims(token) : null
		const hostId = stringClaim(claims, 'hostId')
		const userId = stringClaim(claims, 'userId')
		return hostId && userId ? { hostId, userId } : null
	}

	/** Daemon-plane checks, in the server's order: the daemon token (401), the body (400), the
	 *  session (404), then its host and creator (403). */
	function daemonRoute<T extends { sessionId: string }>(
		req: IncomingMessage,
		body: unknown,
		schema: z.ZodType<T>,
		apply: (rec: SessionRecord, input: T) => unknown,
	): Handled {
		const caller = daemonCaller(req)
		if (!caller) return unauthorized()
		return withInput(schema, body, (input) => {
			const rec = records.get(input.sessionId)
			if (!rec) return orpcError(404, 'NOT_FOUND', 'Not Found')
			if (rec.session.hostId !== caller.hostId || rec.session.userId !== caller.userId)
				return orpcError(403, 'FORBIDDEN', 'Forbidden')
			return { status: 200, body: apply(rec, input) }
		})
	}

	/** A host route: the daemon token (401), the body (400), then a hostId that is not the token's (403). */
	function hostRoute<T extends { hostId: string }>(
		req: IncomingMessage,
		body: unknown,
		schema: z.ZodType<T>,
		answer: unknown,
	): Handled {
		const caller = daemonCaller(req)
		if (!caller) return unauthorized()
		return withInput(schema, body, (input) =>
			input.hostId === caller.hostId ? { status: 200, body: answer } : orpcError(403, 'FORBIDDEN', 'Forbidden'),
		)
	}

	/** Daemon-plane artifact routes: the daemon token (401), the body (400), then the task (404).
	 *  The server's 403 (no edit right on the task) is left to fail(). */
	function taskRoute<T extends { taskId: string; fileName: string }>(
		req: IncomingMessage,
		body: unknown,
		schema: z.ZodType<T>,
		apply: (rows: Map<string, MockArtifact>, input: T) => unknown,
	): Handled {
		if (!daemonCaller(req)) return unauthorized()
		return withInput(schema, body, (input) => {
			if (!tasks.some((t) => t.id === input.taskId)) return orpcError(404, 'NOT_FOUND', 'Not Found')
			const rows = files.get(input.taskId) ?? new Map<string, MockArtifact>()
			files.set(input.taskId, rows)
			return { status: 200, body: apply(rows, input) }
		})
	}

	function handleAuthorizeDevice(): Handled {
		const deviceCode = `mock_device_${randomUUID()}`
		const userCode = randomUUID().slice(0, 8).toUpperCase()
		deviceCodes.set(deviceCode, {
			script: [...state.nextDeviceScript],
			organizationId: state.activeOrganizationId ?? state.orgs[0]?.organizationId ?? '',
			polls: 0,
		})
		state.nextDeviceScript = []
		return {
			status: 200,
			body: {
				device_code: deviceCode,
				user_code: userCode,
				verification_uri_complete: `https://example.invalid/device?code=${userCode}`,
				interval: 1,
				expires_in: 60,
			},
		}
	}

	function handleAuthenticate(deviceCode: string): Handled {
		const entry = deviceCodes.get(deviceCode)
		if (!entry) return { status: 400, body: { error: 'invalid_grant' } }
		const next = entry.script.shift() ?? (entry.polls++ < state.pendingPolls ? 'pending' : undefined)
		if (next === 'pending') return { status: 400, body: { error: 'authorization_pending' } }
		if (next === 'slow_down') return { status: 400, body: { error: 'slow_down' } }
		deviceCodes.delete(deviceCode)
		const org =
			state.orgs.find(
				(o) => o.internalOrgId === entry.organizationId || o.organizationId === entry.organizationId,
			) ?? state.orgs[0]
		return {
			status: 200,
			body: {
				access_token: mintAccessToken(org, { omitOrgClaims: !state.deviceTokenHasOrgClaims }),
				refresh_token: mintRefreshToken(),
				user: { id: state.userId, email: state.email },
			},
		}
	}

	function handleOrganizationsList(): Handled {
		return {
			status: 200,
			body: {
				organizations: state.orgs.map(({ internalOrgId, ...pub }) => pub),
				activeOrganizationId: state.activeOrganizationId,
			},
		}
	}

	function handleTokenRefresh(input: z.output<typeof tokenRefreshInput>): Handled {
		// The real route is public and answers any failure with 400 (research-06).
		if (!state.validRefreshTokens.has(input.refreshToken))
			return orpcError(400, 'BAD_REQUEST', 'Failed to refresh token')
		state.validRefreshTokens.delete(input.refreshToken)
		const org =
			(input.organizationId ? state.orgs.find((o) => o.organizationId === input.organizationId) : undefined) ??
			state.orgs.find((o) => o.internalOrgId === state.activeOrganizationId) ??
			state.orgs[0]
		if (!org) return orpcError(400, 'BAD_REQUEST', 'unknown organization')
		return { status: 200, body: { accessToken: mintAccessToken(org), refreshToken: mintRefreshToken() } }
	}

	function handleDaemonTokenCreate(input: z.output<typeof daemonTokenCreateInput>, caller: Caller): Handled {
		const { userId, organizationId } = caller
		const token = fakeJwt({ userId, organizationId, hostId: input.hostId, createdAt: new Date().toISOString() })
		return { status: 200, body: { token } }
	}

	function handlePrepare(input: PrepareInput, caller: Caller): Handled {
		const task =
			input.taskMode === 'ensure'
				? (tasks.find((t) => t.slug === input.slug) ??
					addTask({ ...input.task, id: randomUUID(), slug: input.slug }))
				: tasks.find((t) => t.id === input.taskIdOrSlug || t.slug === input.taskIdOrSlug)
		if (!task) return orpcError(404, 'NOT_FOUND', 'Not Found', { message: 'Task not found' })
		const session: MockSession = {
			id: randomUUID(),
			taskId: task.id,
			userId: caller.userId,
			hostId: input.hostId,
			codingAgent: input.codingAgent,
			provider: input.provider,
			model: input.model,
			prompt: input.prompt,
			workingDirectory: input.workingDirectory,
			sessionName: input.sessionName,
			status: 'ready_for_launch',
		}
		// The server writes the prompt as the session's first event, so the extension must not send it.
		const first: MockEvent = {
			eventId: randomUUID(),
			sessionId: session.id,
			eventType: 'message',
			role: 'user',
			content: input.prompt,
		}
		eventIds.add(first.eventId)
		publish(session, 'insert', { status: session.status, prompt: session.prompt, host_id: session.hostId })
		records.set(session.id, {
			session,
			events: [first],
			statuses: [session.status],
			repositories: new Map(),
			usageReportKeys: [],
		})
		return {
			status: 200,
			body: { taskId: task.id, userId: caller.userId, hostId: input.hostId, sessionId: session.id },
		}
	}

	function handleSessionUpdate(rec: SessionRecord, input: SessionUpdateInput): unknown {
		const { sessionId: _, usageReportKey, totalCostUsd, modelUsage, ...fields } = input
		Object.assign(rec.session, fields) // no transition gating, like the server
		if (fields.status) {
			rec.statuses.push(fields.status)
			publish(rec.session, 'update', { status: fields.status })
		}
		// The server's usage rule: with no key, usage overwrites; a new key adds the cost and sums the
		// tokens per model; a key among the last 20 applied is a retry replay and is skipped.
		if (totalCostUsd !== undefined || modelUsage !== undefined) {
			const s = rec.session
			if (usageReportKey === undefined) {
				if (totalCostUsd !== undefined) s.totalCostUsd = totalCostUsd
				if (modelUsage !== undefined) s.modelUsage = modelUsage
			} else if (!rec.usageReportKeys.includes(usageReportKey)) {
				if (totalCostUsd !== undefined) s.totalCostUsd = (s.totalCostUsd ?? 0) + totalCostUsd
				if (modelUsage !== undefined) s.modelUsage = mergeModelUsage(s.modelUsage ?? {}, modelUsage)
				rec.usageReportKeys = [...rec.usageReportKeys, usageReportKey].slice(-20)
			}
		}
		return { success: true, transactionId: String(++lastTransactionId) }
	}

	function handleEventCreate(rec: SessionRecord, input: EventInput): unknown {
		const eventId = input.eventId ?? randomUUID()
		// Idempotent on eventId (the server's ON CONFLICT DO NOTHING): a replay stores nothing.
		if (!eventIds.has(eventId)) {
			eventIds.add(eventId)
			rec.events.push({ ...input, eventId })
			// riptide-api's events/create: an event that proves the agent is working moves a resting
			// session back to running (EVENT_REPAIRABLE_SESSION_STATUSES).
			const working =
				(input.role === 'assistant' && ['message', 'thinking', 'tool_call'].includes(input.eventType)) ||
				(input.role === 'user' && input.eventType === 'tool_result')
			if (working && REPAIRABLE.has(rec.session.status)) {
				rec.session.status = 'running'
				rec.statuses.push('running')
				publish(rec.session, 'update', { status: 'running' })
			}
		}
		return { eventId, transactionId: String(++lastTransactionId) }
	}

	function handleRepositoriesReport(rec: SessionRecord, input: RepositoriesReportInput): unknown {
		// The server dedupes the snapshot by localPath and upserts a row per repository; one that a
		// later snapshot leaves out keeps its row.
		const snapshot = new Map(input.repositories.map((repo) => [repo.localPath, repo]))
		for (const [localPath, repo] of snapshot) rec.repositories.set(localPath, repo)
		return { recorded: snapshot.size }
	}

	function handleArtifactUpsert(rows: Map<string, MockArtifact>, input: UpsertInput): unknown {
		const { fileName, operationType, operationContents, frontmatter, sessionId } = input
		const content = input.content.replaceAll('\0', '')
		const old = rows.get(fileName)
		const id = old?.id ?? randomUUID()
		const row: MockArtifact = {
			id,
			fileName,
			storageType: 'postgres',
			content,
			contentHash: textHash(content),
			operationType,
			operationContents,
			frontmatter: frontmatter ?? {},
			sessionId,
		}
		rows.set(fileName, row)
		// The server makes a version row only when a text row's content changed.
		const changed = old !== undefined && old.contentHash !== row.contentHash
		return {
			artifactId: row.id,
			transactionId: String(++lastTransactionId),
			created: !old,
			...(changed ? { versionNumber: 1 } : {}),
		}
	}

	function handleCreateUpload(rows: Map<string, MockArtifact>, input: CreateUploadInput): unknown {
		const { fileName, contentHash, contentType, fileSizeBytes } = input
		const id = rows.get(fileName)?.id ?? randomUUID()
		rows.set(fileName, { id, fileName, storageType: 's3', content: '', contentHash, contentType, fileSizeBytes })
		const key = randomUUID()
		uploadTargets.set(key, input)
		return { artifactId: id, uploadUrl: `${url}/__upload/${key}`, transactionId: String(++lastTransactionId) }
	}

	/** Stands in for S3's presigned PUT, which signs the Content-Type; size and sha256 are checked too. */
	function handleUpload(key: string, contentType: string | undefined, bytes: Buffer): Handled {
		const target = uploadTargets.get(key)
		if (!target) return orpcError(404, 'NOT_FOUND', 'no such upload')
		const sha256 = createHash('sha256').update(bytes).digest('hex')
		if (contentType !== target.contentType)
			return orpcError(403, 'FORBIDDEN', `Content-Type ${contentType} is not the signed ${target.contentType}`)
		if (bytes.length !== target.fileSizeBytes || sha256 !== target.contentHash)
			return orpcError(400, 'BAD_REQUEST', 'bytes do not match createUpload')
		uploadsDone.push({ taskId: target.taskId, fileName: target.fileName, contentType, size: bytes.length, sha256 })
		return { status: 200, body: {} }
	}

	function handle(req: IncomingMessage, method: string, path: string, body: unknown): Handled {
		if (method === 'POST') {
			switch (path) {
				case '/user_management/authorize/device':
					return handleAuthorizeDevice()
				case '/user_management/authenticate':
					return handleAuthenticate((body as Record<string, string>).device_code ?? '')
				case '/rpc/api/v1/auth/user/organizations/list':
					return bearerRoute(req, body, organizationsListInput, handleOrganizationsList)
				case '/rpc/api/v1/auth/token/refresh': // public: no bearer
					return withInput(tokenRefreshInput, body, handleTokenRefresh)
				case '/rpc/api/v1/auth/daemon/token/create':
					return bearerRoute(req, body, daemonTokenCreateInput, handleDaemonTokenCreate)
				case '/rpc/api/v1/automation/run/prepare':
					return bearerRoute(req, body, runPrepareInput, handlePrepare)
				case '/rpc/daemon/v1/sessions/update':
					return daemonRoute(req, body, sessionUpdateInput, handleSessionUpdate)
				case '/rpc/daemon/v1/sessions/events/create':
					return daemonRoute(req, body, eventCreateInput, handleEventCreate)
				case '/rpc/daemon/v1/sessions/repositories/report':
					return daemonRoute(req, body, repositoriesReportInput, handleRepositoriesReport)
				case '/rpc/daemon/v1/artifacts/upsert':
					return taskRoute(req, body, artifactUpsertInput, handleArtifactUpsert)
				case '/rpc/daemon/v1/artifacts/createUpload':
					return taskRoute(req, body, artifactCreateUploadInput, handleCreateUpload)
				case '/rpc/daemon/v1/hosts/heartbeat':
					return hostRoute(req, body, heartbeatInput, { updateRequest: null })
				case '/rpc/daemon/v1/agentCommands/report':
					return hostRoute(req, body, agentCommandsReportInput, { updated: true })
				case '/rpc/daemon/v1/approvals/create':
					return daemonRoute(req, body, approvalCreateInput, handleApprovalCreate)
				case '/rpc/api/v1/sessions/update':
					return bearerRoute(req, body, sessionRenameInput, (input) => {
						const rec = records.get(input.sessionId)
						if (!rec) return orpcError(404, 'NOT_FOUND', 'Not Found')
						if (input.title !== undefined) rec.session.sessionName = input.title
						return { status: 200, body: { success: true, transactionId: String(++lastTransactionId) } }
					})
				case '/rpc/api/v1/tasks/update':
					return bearerRoute(req, body, taskRenameInput, (input) => {
						const task = tasks.find((t) => t.id === input.taskId)
						if (!task) return orpcError(404, 'NOT_FOUND', 'Not Found')
						if (input.name !== undefined) task.name = input.name
						return { status: 200, body: { success: true, transactionId: String(++lastTransactionId) } }
					})
				case '/rpc/api/v1/approvals/resolve':
					return bearerRoute(req, body, approvalResolveInput, (input) =>
						resolveApproval(input.approvalId, input.decision, input.comment),
					)
			}
		}
		return orpcError(404, 'NOT_FOUND', `no mock route for ${method} ${path}`)
	}

	/** A stub's answer for a daemon-plane path, once the daemon token checks out. */
	function stubbed(req: IncomingMessage, path: string): Handled | undefined {
		if (!path.startsWith('/rpc/daemon/v1/')) return undefined
		for (const [route, body] of stubs) {
			if (path !== route && !path.endsWith(`/${route}`)) continue
			return daemonCaller(req) ? { status: 200, body } : unauthorized()
		}
		return undefined
	}

	async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const method = req.method ?? 'GET'
		const path = (req.url ?? '/').split('?')[0]!

		if (method === 'GET' && path === '/__mock/state') return sendJson(res, 200, snapshot())
		if (method === 'GET' && path.startsWith('/v1/sessions/')) return shapeRoute(req, res, path)
		if (method === 'GET' && path === '/v1/daemon/approvals') return shapeRoute(req, res, path, approvalsShape)
		const bytes = await readBody(req)
		const rawBody = bytes.toString('utf8')
		if (method === 'POST' && path === '/__mock/config') {
			let body: unknown
			try {
				body = JSON.parse(rawBody)
			} catch {
				return sendJson(res, 400, orpcError(400, 'BAD_REQUEST', 'Expected JSON configuration').body)
			}
			const result = withInput(configurationInput, body, (config) => {
				if (config.orgs !== undefined) {
					const defaults = defaultState({ orgs: config.orgs }).orgs
					state.orgs = defaults.map((org, i) => state.orgs[i] ?? org)
					if (!state.orgs.some((org) => org.internalOrgId === state.activeOrganizationId)) {
						state.activeOrganizationId = state.orgs[0]?.internalOrgId ?? null
					}
				}
				if (config.pendingPolls !== undefined) state.pendingPolls = config.pendingPolls
				return { status: 200, body: { orgs: state.orgs.length, pendingPolls: state.pendingPolls } }
			})
			return sendJson(res, result.status, result.body)
		}
		if (method === 'POST' && path === '/__mock/fail') {
			fail(JSON.parse(rawBody) as FailRule)
			return sendJson(res, 200, { ok: true })
		}
		if (method === 'POST' && path === '/__mock/reset') {
			reset()
			return sendJson(res, 200, { ok: true })
		}

		const upload = method === 'PUT' && path.startsWith('/__upload/') ? path.slice('/__upload/'.length) : undefined
		const rpcPlane = /^\/rpc\/(api|daemon)\/v1\//.exec(path)?.[1]
		const plane: RequestPlane =
			upload !== undefined ? 'upload' : rpcPlane === 'api' || rpcPlane === 'daemon' ? rpcPlane : 'workos'
		const contentType = req.headers['content-type']
		// riptide-api takes JSON bodies, WorkOS form-encoded ones; an upload is raw bytes.
		let body: unknown = Object.fromEntries(new URLSearchParams(rawBody))
		if (plane === 'api' || plane === 'daemon') body = rawBody ? JSON.parse(rawBody) : undefined
		if (plane === 'upload')
			body = { contentType, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }

		const failure = takeFailure(upload !== undefined ? '/__upload' : path)
		if (failure?.network || failure?.hang) {
			requests.push({ method, plane, path, status: 0, body })
			if (failure.network) req.socket.destroy()
			else {
				held.add(res)
				res.on('close', () => held.delete(res))
			}
			return
		}
		const status = failure?.status ?? 500
		const result = failure
			? orpcError(
					status,
					failure.code ?? DEFAULT_ERROR_CODES[status] ?? 'INJECTED_FAILURE',
					failure.message ?? `injected failure for ${path}`,
					failure.data,
				)
			: upload !== undefined
				? handleUpload(upload, contentType, bytes)
				: (stubbed(req, path) ?? handle(req, method, path, body))
		requests.push({ method, plane, path, status: result.status, body })
		sendJson(res, result.status, result.body)
	}

	const server = createServer((req, res) => {
		route(req, res).catch((err: unknown) => {
			sendJson(res, 500, {
				defined: false,
				code: 'INTERNAL_SERVER_ERROR',
				status: 500,
				message: err instanceof Error ? err.message : String(err),
			})
		})
	})

	await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
	const address = server.address()
	if (address === null || typeof address === 'string') throw new Error('HumanLayer mock cloud failed to bind a port')
	url = `http://127.0.0.1:${address.port}`

	return {
		url,
		requests,
		state,
		tasks: () => tasks,
		sessions,
		events,
		statuses,
		repositories,
		artifacts,
		uploads: () => uploadsDone,
		hung: () => held.size,
		seedTask: ({ id = randomUUID(), slug, name = slug }) => addTask({ id, slug, name }),
		stub: (route, body) => stubs.set(route, body),
		continueSession: (sessionId, prompt) => setWebStatus(sessionId, 'resuming', prompt),
		interruptSession: (sessionId) => setWebStatus(sessionId, 'interrupt_requested'),
		rotateShape() {
			shape.handle = randomUUID()
			wakeShape()
		},
		approvals: (sessionId) => [...approvalRows.values()].filter((a) => a.sessionId === sessionId),
		resolveApproval(approvalId, decision, comment) {
			const out = resolveApproval(approvalId, decision, comment)
			if (out.status !== 200) throw new Error(`resolveApproval: ${out.status}`)
		},
		fail,
		reset,
		close(): Promise<void> {
			return new Promise((resolve, reject) => {
				server.close((err) => (err ? reject(err) : resolve()))
				wakeShape()
				server.closeAllConnections() // hung calls too
			})
		},
	}
}
