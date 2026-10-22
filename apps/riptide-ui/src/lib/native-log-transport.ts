import { formatSendProps, type LogLevel, LogTransport, type SendProps } from '@humanlayer/logger/browser'

import { writeHostLog } from '@/integrations/desktop/host-logging'
import { isTauri } from '@/lib/utils'

export class NativeLogTransport extends LogTransport {
	public readonly level: LogLevel

	constructor(level: LogLevel) {
		super()
		this.level = level
		if (isTauri()) {
			void import('@tauri-apps/plugin-log')
				.then((tauriLog) => tauriLog.attachConsole())
				.catch((error) => console.warn('Failed to attach Tauri log console:', error))
		}
	}

	public override send(props: SendProps): void {
		const level = props.level === 'http' ? 'info' : props.level === 'silly' ? 'trace' : props.level
		void writeHostLog({ level, message: formatSendProps(props) }).catch((error) => {
			console.warn('Failed to write native host log:', error)
		})
	}

	public override async shutdown(): Promise<void> {}
}
