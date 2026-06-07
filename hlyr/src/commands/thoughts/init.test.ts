import { Readable, Writable } from 'stream'
import { describe, expect, it } from 'vitest'
import { createPromptSession } from './init.js'

class NullWritable extends Writable {
  _write(_chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    callback()
  }
}

describe('createPromptSession', () => {
  it('consumes multiple answers from one piped input stream', async () => {
    const input = Readable.from(['\nrepos-dir\nglobal-dir\nalice\n'])
    const output = new NullWritable()
    const session = createPromptSession({ input, output })

    try {
      await expect(session.prompt('Thoughts repository location: ')).resolves.toBe('')
      await expect(session.prompt('Directory name for repos: ')).resolves.toBe('repos-dir')
      await expect(session.prompt('Directory name for global thoughts: ')).resolves.toBe('global-dir')
      await expect(session.prompt('Your username: ')).resolves.toBe('alice')
    } finally {
      session.close()
    }
  })
})
