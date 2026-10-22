import type { DaemonStage } from '@humanlayer/schemas/effect/daemon/stage'

import { protocolSchemesByChannel } from './config/electron-channel'

export function rendererSchemeForChannel(channel: DaemonStage): string {
	return protocolSchemesByChannel[channel][0]
}

export function rendererOriginForChannel(channel: DaemonStage): string {
	return `${rendererSchemeForChannel(channel)}://app`
}

export function rendererUrlForChannel(channel: DaemonStage): string {
	return `${rendererOriginForChannel(channel)}/`
}
