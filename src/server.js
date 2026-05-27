import http from 'node:http';
import { loadConfig } from './config.js';
import { TaskStore } from './store.js';
import { GmiClient } from './upstream.js';
import { createServer } from './app.js';

const config = loadConfig();
const store = new TaskStore(config.taskStorePath);
await store.init();

const upstream = new GmiClient(config);
const app = createServer({ config, store, upstream });
const server = http.createServer(app);

server.listen(config.port, '0.0.0.0', () => {
  console.log(`${config.serviceName} listening on :${config.port}`);
  console.log(`GMICloud upstream: ${config.gmiApiBaseUrl}`);
});

function shutdown(signal) {
  console.log(`received ${signal}, shutting down`);
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
