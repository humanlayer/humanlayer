import type { FileMatch, FilesystemDirectory, PathStat } from '@humanlayer/riptide-electron-rpc'

import { electronClientRuntime } from '@/effects/electron-rpc/electron-client-runtime'
import { ElectronRpcClient } from '@/effects/electron-rpc/electron-rpc-client.service'

export const getHomeDirectory = (): Promise<string> =>
	electronClientRuntime.runPromise(ElectronRpcClient.use((client) => client.GetHomeDirectory()))

export const statPath = (path: string): Promise<PathStat> =>
	electronClientRuntime.runPromise(ElectronRpcClient.use((client) => client.StatPath({ path })))

export const readTextFile = (path: string): Promise<string> =>
	electronClientRuntime.runPromise(ElectronRpcClient.use((client) => client.ReadTextFile({ path })))

export const readFile = (path: string): Promise<Uint8Array> =>
	electronClientRuntime.runPromise(ElectronRpcClient.use((client) => client.ReadFile({ path })))

export const browseDirectories = (path: string): Promise<ReadonlyArray<FilesystemDirectory>> =>
	electronClientRuntime.runPromise(ElectronRpcClient.use((client) => client.BrowseDirectories({ path })))

export const pickDirectory = (): Promise<string | null> =>
	electronClientRuntime.runPromise(ElectronRpcClient.use((client) => client.PickDirectory()))

export const listDirectory = (input: {
	readonly path: string
	readonly prefix?: string
	readonly limit?: number
}): Promise<ReadonlyArray<FileMatch>> =>
	electronClientRuntime.runPromise(ElectronRpcClient.use((client) => client.ListDirectory(input)))

export const fuzzySearchFiles = (input: {
	readonly query: string
	readonly paths: ReadonlyArray<string>
	readonly limit?: number
}): Promise<ReadonlyArray<FileMatch>> =>
	electronClientRuntime.runPromise(ElectronRpcClient.use((client) => client.FuzzySearchFiles(input)))
