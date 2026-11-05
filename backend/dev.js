// Development runner accepts the standard host/port flags used by preview tools.
// Production always starts backend/server.js with the systemd environment.
import { parseArgs } from 'node:util';
import { createApp } from './server.js';

const { values } = parseArgs({ options: {
  host: { type: 'string', default: process.env.HOST || '127.0.0.1' },
  port: { type: 'string', default: process.env.PORT || '3001' },
  strictPort: { type: 'boolean', default: true }
} });
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口无效。');
const app = await createApp();
const server = app.listen(port, values.host, () => console.log(`Answer dev: http://${values.host}:${port}`));
server.on('error', error => { console.error(error); process.exitCode = 1; });
