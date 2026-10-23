// The riptide-api routes this extension calls. Their types come from riptide-api's own contract,
// through @humanlayer/session-sdk-base, so a contract change breaks this package's typecheck.
// daemonCall() and prepare() add the credentials.

import type { PrepareBody, Prepared } from '@humanlayer/session-sdk-auth'
import type { DaemonPath, DaemonRequest, DaemonResponse } from '@humanlayer/session-sdk-base'
import type { RepositoriesReport } from '@humanlayer/session-sdk-sessions'

import { client, withDaemonToken } from './auth.ts'
import type { Channel } from './config.ts'
import type { CloudEvent } from './mapper.ts'
import { rpc } from './rpc.ts'

export type { DaemonPath, DaemonRequest, DaemonResponse }

type WithoutSession<T> = Omit<T, 'sessionId'>

// ---- sessions (sessionId is added by the sender, for the bound session) ----

/** The statuses a daemon reports. The API sets the rest (resuming, interrupt_requested, ...). */
export type SessionStatus = Extract<
	NonNullable<DaemonRequest<'sessions/update'>['status']>,
	'running' | 'ready_for_input' | 'interrupted' | 'failed'
>

export type SessionUpdate = WithoutSession<DaemonRequest<'sessions/update'>> & { status?: SessionStatus }
export type { RepositoriesReport }

/** One queued call about the bound session. */
export type SessionCall =
	| { path: 'sessions/update'; body: SessionUpdate }
	| { path: 'sessions/events/create'; body: CloudEvent }
	| { path: 'sessions/repositories/report'; body: RepositoriesReport }

// ---- automation/run/prepare (api plane) ----

export type { PrepareBody, Prepared }

// ---- comments (the HumanLayer tools) ----

export type { ArtifactComment, CommentUpdateResult, DiffComment, DiffThread } from '@humanlayer/session-sdk-tools'

// ---- slash commands for the web composer ----

/** A command the web composer offers for sessions of this agent, host and folder. */
export type AgentSkill = DaemonRequest<'agentCommands/report'>['skills'][number]

/** One daemon-plane call with this host's daemon token, re-minted once if the cloud refuses it. */
export const daemonCall = client.daemonCall

/** Sends a queued session call for the cloud session it belongs to. */
export function sendSessionCall(
	channel: Channel,
	call: SessionCall,
	sessionId: string,
	signal?: AbortSignal,
): Promise<unknown> {
	const body = { ...call.body, sessionId }
	return withDaemonToken(channel, signal, (token) => rpc(channel, 'daemon', call.path, body, token, signal))
}

/** automation/run/prepare, with the signed-in user's bearer. */
export const prepare = client.prepare
