// TODO: maybe use a real lib
export const logger = {
  debug: (...args: any[]) => {
    console.debug(...args)
  },
  info: (...args: any[]) => {
    console.info(...args)
  },
  error: (...args: any[]) => {
    console.error(...args)
  },
}
