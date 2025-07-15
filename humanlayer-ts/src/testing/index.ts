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

export function without_env_var(key: string, callback: () => any) {
  const prevValue = process.env[key]
  delete process.env[key]
  try {
    callback()
  } finally {
    if (typeof prevValue !== 'undefined') {
      process.env[key] = prevValue
    }
  }
}
