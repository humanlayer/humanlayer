import { HumanLayer } from './approval'
import { HumanContact } from './models'

test('HumanLayer()#humanAsTool()', async () => {
  const mockBackend: any = {
    functions: jest.fn(),
    contacts: jest.fn(),
  }

  const contacts: any = {
    add: jest.fn(),
    get: jest.fn(),
  }

  mockBackend.contacts.mockReturnValue(contacts)

  contacts.add.mockReturnValue(null)

  const returnValue: HumanContact = {
    run_id: 'generated-id',
    call_id: 'generated-id',
    spec: {
      msg: '867',
    },
    status: {
      response: '5309',
    },
  }
  contacts.get.mockReturnValue(returnValue)

  const hl = new HumanLayer({
    backend: mockBackend,
    sleep: (x: number) => Promise.resolve(),
    genid: (x: string) => 'generated-id',
  })

  const tool = hl.humanAsTool()

  const resp = await tool({ message: '867' })
  expect(resp).toBe('5309')

  expect(contacts.add).toHaveBeenCalledWith({
    run_id: 'generated-id',
    call_id: 'generated-id',
    spec: {
      msg: '867',
    },
  })
  expect(contacts.get).toHaveBeenCalledWith('generated-id')
})

test('HumanLayer(ContactChannel)#humanAsTool()', async () => {
  const mockBackend: any = {
    functions: jest.fn(),
    contacts: jest.fn(),
  }
  const contacts: any = {
    add: jest.fn(),
    get: jest.fn(),
  }

  mockBackend.contacts.mockReturnValue(contacts)

  contacts.add.mockReturnValue(null)

  const returnValue: HumanContact = {
    run_id: 'generated-id',
    call_id: 'generated-id',
    spec: {
      msg: '867',
      channel: {
        slack: {
          channel_or_user_id: 'test-channel',
        },
      },
    },
    status: {
      response: '5309',
    },
  }

  contacts.get.mockReturnValue(returnValue)

  const hl = new HumanLayer({
    backend: mockBackend,
    sleep: (x: number) => Promise.resolve(),
    genid: (x: string) => 'generated-id',
    contactChannel: {
      slack: {
        channel_or_user_id: 'test-channel',
      },
    },
  })

  const tool = hl.humanAsTool()

  const resp = await tool({ message: '867' })
  expect(resp).toBe('5309')

  expect(contacts.add).toHaveBeenCalledWith({
    run_id: 'generated-id',
    call_id: 'generated-id',
    spec: {
      msg: '867',
      channel: {
        slack: {
          channel_or_user_id: 'test-channel',
        },
      },
    },
  })

  expect(contacts.get).toHaveBeenCalledWith('generated-id')
})

test('HumanLayer()#humanAsTool(ContactChannel)', async () => {
  const mockBackend: any = {
    functions: jest.fn(),
    contacts: jest.fn(),
  }

  const contacts: any = {
    add: jest.fn(),
    get: jest.fn(),
  }

  mockBackend.contacts.mockReturnValue(contacts)

  contacts.add.mockReturnValue(null)

  const returnValue: HumanContact = {
    run_id: 'generated-id',
    call_id: 'generated-id',
    spec: {
      msg: '867',
      channel: {
        slack: {
          channel_or_user_id: 'test-channel',
        },
      },
    },
    status: {
      response: '5309',
    },
  }

  contacts.get.mockReturnValue(returnValue)

  const hl = new HumanLayer({
    backend: mockBackend,
    sleep: (x: number) => Promise.resolve(),
    genid: (x: string) => 'generated-id',
  })

  const tool = hl.humanAsTool({
    slack: {
      channel_or_user_id: 'test-channel',
    },
  })

  const resp = await tool({ message: '867' })
  expect(resp).toBe('5309')

  expect(contacts.add).toHaveBeenCalledWith({
    run_id: 'generated-id',
    call_id: 'generated-id',
    spec: {
      msg: '867',
      channel: {
        slack: {
          channel_or_user_id: 'test-channel',
        },
      },
    },
  })

  expect(contacts.get).toHaveBeenCalledWith('generated-id')
})
