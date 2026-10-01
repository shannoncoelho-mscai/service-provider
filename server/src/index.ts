import type { Server } from 'http';
import { app } from './app';
import { closePool } from './config/database';
import { env } from './config/env';

const server: Server = app.listen(env.PORT, () => {
  console.log(`✅ ServiceConnect API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  console.log(`   health: http://localhost:${env.PORT}/api/health`);
});

/** Graceful shutdown: stop accepting connections, close the DB pool, exit. */
function shutdown(signal: string): void {
  console.log(`\n${signal} received — shutting down…`);
  server.close(() => {
    void closePool().finally(() => process.exit(0));
  });
  // Hard exit if something hangs (e.g. open keep-alive sockets).
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
