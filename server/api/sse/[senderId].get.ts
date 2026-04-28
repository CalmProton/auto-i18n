import { createEventStream } from 'h3'
import { addStream, removeStream } from '../../utils/sse'

export default defineEventHandler(async (event) => {
  const senderId = getRouterParam(event, 'senderId')!
  if (!senderId) throw createError({ statusCode: 400, statusMessage: 'senderId is required' })

  const stream = createEventStream(event)

  addStream(senderId, stream)

  stream.onClosed(async () => {
    removeStream(senderId, stream)
    await stream.close()
  })

  // Send an initial connected event so client knows the stream is live
  await stream.push({
    id: crypto.randomUUID(),
    event: 'connected',
    data: JSON.stringify({ senderId, ts: new Date().toISOString() }),
  })

  return stream.send()
})
