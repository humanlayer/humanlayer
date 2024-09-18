export function with_env_var(key: string, value: string, callback: () => any) {
  const prevValue = process.env[key]
  process.env[key] = value
  try {
    callback()
  } finally {
    if (typeof prevValue !== 'undefined') {
      process.env[key] = prevValue
    } else {
      delete process.env[key]
    }
  }
}
