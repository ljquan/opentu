import { createApiServer } from '../api/_lib/standalone-server';
import { closeDatabase } from '../api/_lib/db';
import { closeLocalAuth } from '../api/_lib/local-auth';
const server = createApiServer();
server.listen(Number(process.env.PORT || 3101), '127.0.0.1', () => console.log('OpenTu API ready on loopback.'));
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => {
  server.close(() => { void Promise.all([closeDatabase(), closeLocalAuth()]).finally(() => process.exit(0)); });
  setTimeout(() => process.exit(1), 85000).unref();
});
