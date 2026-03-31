export type MockPortMessageEvent = {
  data: unknown
}

export class MockMessagePort {
  onmessage: ((event: MockPortMessageEvent) => void) | null = null

  peer: MockMessagePort | null = null

  sentMessages: unknown[] = []

  receivedMessages: unknown[] = []

  closed = false

  postMessage(message: unknown) {
    this.sentMessages.push(message)
    if (this.peer) {
      this.peer.receivedMessages.push(message)
    }
    this.peer?.onmessage?.({ data: message })
  }

  start() {}

  close() {
    this.closed = true
  }
}

export function createMessageChannel() {
  const port1 = new MockMessagePort()
  const port2 = new MockMessagePort()
  port1.peer = port2
  port2.peer = port1

  return {
    port1,
    port2,
  }
}

export function createDeterministicIds(values: string[]) {
  const remaining = [...values]

  return () => {
    const next = remaining.shift()
    if (!next) {
      throw new Error('No deterministic IDs remaining for ChatBridge EDD test.')
    }

    return next
  }
}
