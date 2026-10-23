import { DesktopRpc } from '@humanlayer/riptide-electron-rpc'
import * as Context from 'effect/Context'
import type * as RpcClient from 'effect/rpc/RpcClient'
import type { RpcClientError } from 'effect/rpc/RpcClientError'

export type ElectronRpcClientShape = RpcClient.FromGroup<typeof DesktopRpc, RpcClientError>

export class ElectronRpcClient extends Context.Service<ElectronRpcClient, ElectronRpcClientShape>()(
	'ElectronRpcClient',
) {}
