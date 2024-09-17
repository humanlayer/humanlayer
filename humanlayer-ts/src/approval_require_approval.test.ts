import { AgentBackend, AgentStore } from './protocol'
import { FunctionCall } from './models'
import { HumanLayer } from './approval'

test('Humanlayer#requireApproval()', async () => {
  const mockBackend: any = {
    functions: jest.fn(),
    contacts: jest.fn(),
  }

  const functions: any = {
    add: jest.fn(),
    get: jest.fn(),
  }

  mockBackend.functions.mockReturnValue(functions)

  functions.add.mockReturnValue(null)

  const mockFunction = jest.fn()
  mockFunction.mockReturnValue('bosh')
  Object.defineProperty(mockFunction, 'name', { value: '_fn_', writable: false })

  const hl = new HumanLayer({
    backend: mockBackend,
    genid: (x: string) => 'generated-id',
    sleep: (x: number) => Promise.resolve(),
  })

  const wrapped = hl.requireApproval()(mockFunction)

  const returnValue: FunctionCall = {
    run_id: 'generated-id',
    call_id: 'generated-id',
    spec: {
      fn: '_fn_',
      kwargs: { bar: 'baz' },
    },
    status: {
      requested_at: new Date(),
      approved: true,
    },
  }
  functions.get.mockReturnValue(returnValue)

  const ret = await wrapped({ bar: 'baz' })

  expect(functions.add).toHaveBeenCalledWith({
    run_id: 'generated-id',
    call_id: 'generated-id',
    spec: {
      fn: '_fn_',
      kwargs: { bar: 'baz' },
    },
  })

  expect(functions.get).toHaveBeenCalledWith('generated-id')
  expect(mockFunction).toHaveBeenCalledWith({ bar: 'baz' })
})

test('Humanlayer(contactChannel)#requireApproval()', async () => {
  const mockBackend: any = {
    functions: jest.fn(),
    contacts: jest.fn(),
  }

  const functions: any = {
    add: jest.fn(),
    get: jest.fn(),
  }

  mockBackend.functions.mockReturnValue(functions)

  functions.add.mockReturnValue(null)

  const mockFunction = jest.fn()
  mockFunction.mockReturnValue('bosh')
  Object.defineProperty(mockFunction, 'name', { value: '_fn_', writable: false })

  const hl = new HumanLayer({
    contactChannel: {
      slack: {
        channel_or_user_id: 'U8675309',
        context_about_channel_or_user: 'a dm with the librarian',
      },
    },
    backend: mockBackend,
    genid: (x: string) => 'generated-id',
    sleep: (x: number) => Promise.resolve(),
  })

  const wrapped = hl.requireApproval()(mockFunction)

  const returnValue: FunctionCall = {
    run_id: 'generated-id',
    call_id: 'generated-id',
    spec: {
      fn: '_fn_',
      kwargs: { bar: 'baz' },
      channel: {
        slack: {
          channel_or_user_id: 'U8675309',
          context_about_channel_or_user: 'a dm with the librarian',
        },
      },
    },
    status: {
      requested_at: new Date(),
      approved: true,
    },
  }
  functions.get.mockReturnValue(returnValue)

  const ret = await wrapped({ bar: 'baz' })

  expect(functions.add).toHaveBeenCalledWith({
    run_id: 'generated-id',
    call_id: 'generated-id',
    spec: {
      fn: '_fn_',
      kwargs: { bar: 'baz' },
      channel: {
        slack: {
          channel_or_user_id: 'U8675309',
          context_about_channel_or_user: 'a dm with the librarian',
        },
      },
    },
  })

  expect(functions.get).toHaveBeenCalledWith('generated-id')
  expect(mockFunction).toHaveBeenCalledWith({ bar: 'baz' })
})

test('Humanlayer()#requireApproval(contactChannel)', async () => {
  const mockBackend: any = {
    functions: jest.fn(),
    contacts: jest.fn(),
  }

  const functions: any = {
    add: jest.fn(),
    get: jest.fn(),
  }

  mockBackend.functions.mockReturnValue(functions)

  functions.add.mockReturnValue(null)

  const mockFunction = jest.fn()
  mockFunction.mockReturnValue('bosh')
  Object.defineProperty(mockFunction, 'name', { value: '_fn_', writable: false })

  const hl = new HumanLayer({
    backend: mockBackend,
    genid: (x: string) => 'generated-id',
    sleep: (x: number) => Promise.resolve(),
  })

  const wrapped = hl.requireApproval({
    slack: {
      channel_or_user_id: 'U8675309',
      context_about_channel_or_user: 'a dm with the librarian',
    },
  })(mockFunction)

  const returnValue: FunctionCall = {
    run_id: 'generated-id',
    call_id: 'generated-id',
    spec: {
      fn: '_fn_',
      kwargs: { bar: 'baz' },
      channel: {
        slack: {
          channel_or_user_id: 'U8675309',
          context_about_channel_or_user: 'a dm with the librarian',
        },
      },
    },
    status: {
      requested_at: new Date(),
      approved: true,
    },
  }
  functions.get.mockReturnValue(returnValue)

  const ret = await wrapped({ bar: 'baz' })

  expect(functions.add).toHaveBeenCalledWith({
    run_id: 'generated-id',
    call_id: 'generated-id',
    spec: {
      fn: '_fn_',
      kwargs: { bar: 'baz' },
      channel: {
        slack: {
          channel_or_user_id: 'U8675309',
          context_about_channel_or_user: 'a dm with the librarian',
        },
      },
    },
  })

  expect(functions.get).toHaveBeenCalledWith('generated-id')
  expect(mockFunction).toHaveBeenCalledWith({ bar: 'baz' })
})

test('Humanlayer()#requireApproval() with deny', async () => {
  const mockBackend: any = {
    functions: jest.fn(),
    contacts: jest.fn(),
  }

  const functions: any = {
    add: jest.fn(),
    get: jest.fn(),
  }

  mockBackend.functions.mockReturnValue(functions)

  functions.add.mockReturnValue(null)

  const mockFunction = jest.fn()
  mockFunction.mockReturnValue('bosh')
  Object.defineProperty(mockFunction, 'name', { value: '_fn_', writable: false })

  const hl = new HumanLayer({
    backend: mockBackend,
    genid: (x: string) => 'generated-id',
    sleep: (x: number) => Promise.resolve(),
  })

  const wrapped = hl.requireApproval()(mockFunction)

  const returnValue: FunctionCall = {
    run_id: 'generated-id',
    call_id: 'generated-id',
    spec: {
      fn: '_fn_',
      kwargs: { bar: 'baz' },
    },
    status: {
      requested_at: new Date(),
      approved: false,
      comment: 'nope',
    },
  }
  functions.get.mockReturnValue(returnValue)

  const ret = await wrapped({ bar: 'baz' })

  expect(functions.add).toHaveBeenCalledWith({
    run_id: 'generated-id',
    call_id: 'generated-id',
    spec: {
      fn: '_fn_',
      kwargs: { bar: 'baz' },
    },
  })

  expect(functions.get).toHaveBeenCalledWith('generated-id')
  expect(ret).toBe('User denied function _fn_ with comment: nope')
})
