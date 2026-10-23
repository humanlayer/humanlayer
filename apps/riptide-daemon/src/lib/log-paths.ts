import { homedir } from 'node:os'
import path from 'node:path'

import { BUILD_TYPE as BUILD_TYPE_MACRO, BUILD_VERSION, LOG_BASE } from '@/lib/macros'

const normalizeLogPath = (filePath: string) =>
	filePath.startsWith('~') ? path.join(homedir(), filePath.slice(1)) : filePath

const buildType = process.env.BUILD_TYPE ?? BUILD_TYPE_MACRO ?? 'local'
const logBase = process.env.LOG_BASE ?? LOG_BASE ?? '~/.humanlayer/riptide/logs'
const now = new Date()
const timeString = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}_${now.getHours()}-${now.getMinutes()}-${now.getSeconds()}`
const buildIdentity = `${buildType}-${BUILD_VERSION ?? 'dev'}-${timeString}`

export const daemonLogFilePath = normalizeLogPath(`${logBase}/riptided-${buildIdentity}.jsonl`)
export const daemonErrorLogFilePath = normalizeLogPath(`${logBase}/error-riptided-${buildIdentity}.jsonl`)
export const daemonEffectLogFilePath = normalizeLogPath(`${logBase}/effect-riptided-${buildIdentity}.jsonl`)
export const workspaceSetupLogDirectory = normalizeLogPath(`${logBase}/workspace-setup`)
