import { homedir } from 'node:os'
import path from 'node:path'
export function normalizePath(filePath: string) {
	return filePath.startsWith('~') ? path.join(homedir(), filePath.slice(1)) : filePath
}
