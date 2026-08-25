import { createRoomApi } from '../src/room-api/index.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required to run database migrations.');

const roomApi = createRoomApi({ databaseUrl, participantCapacity: 12 });
try {
  await roomApi.migrate();
  console.log('Room database schema is up to date.');
} finally {
  await roomApi.close();
}
