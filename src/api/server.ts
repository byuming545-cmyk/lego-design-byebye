import 'dotenv/config';
import { setGlobalProxyFromEnv } from 'node:http';
import { createApp } from './app.js';

// Node 24: honor the cloud's inherited HTTPS proxy and CA trust for live inventory.
setGlobalProxyFromEnv();
process.env.NODE_ENV ??= process.argv.includes('--development') ? 'development' : 'production';
const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
const app = createApp();
const server = app.listen(port, '0.0.0.0');
server.once('listening', () => {
  console.info(`Bricklab API listening on http://0.0.0.0:${port}`);
});
server.on('error', () => {
  console.error('Unable to start Bricklab API. Check the port and server configuration.');
  process.exitCode = 1;
});
