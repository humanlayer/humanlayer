import type { UpdateInfo as RpcUpdateInfo } from '@humanlayer/riptide-electron-rpc'
import * as Data from 'effect/Data'

// Internal lifecycle state. Never crosses the RPC boundary, so Data.TaggedEnum
// is correct (not Schema). Dispatch with Match.tagsExhaustive.
export type UpdateState = Data.TaggedEnum<{
	Idle: {}
	UpdateAvailable: { readonly info: RpcUpdateInfo }
	Downloading: { readonly info: RpcUpdateInfo }
	Downloaded: { readonly info: RpcUpdateInfo }
}>
export const UpdateState = Data.taggedEnum<UpdateState>()
