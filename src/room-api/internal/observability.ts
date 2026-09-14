import { createHmac } from 'node:crypto'
import type { RoomObservation } from './service'

export function createRoomObserver(secret: string): (event: RoomObservation) => void {
  return (event) => console.log(JSON.stringify(roomObservationPayload(secret, event)))
}

export function roomObservationPayload(secret: string, event: RoomObservation) {
  const { type, roomId, participantId, ...details } = event
  const output: Record<string, unknown> = {
    type: 'room-event',
    event: type,
    room: anonymize(secret, roomId),
    participant: anonymize(secret, participantId),
    ...details,
  }
  if ('peerId' in event) output.peer = anonymize(secret, event.peerId)
  delete output.peerId
  if (event.type === 'connection-route') output.turnUsed = event.route === 'relay'
  return output
}

function anonymize(secret: string, value: string) {
  return createHmac('sha256', secret).update(value).digest('hex').slice(0, 16)
}
