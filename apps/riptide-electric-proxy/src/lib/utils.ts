export function requireEnvironment(key: string, defaultValue?: string): string {
	const value = process.env[key] ?? defaultValue
	if (!value) throw new Error(`Missing environment variable ${key}`)
	return value
}
