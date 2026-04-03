import net from 'node:net';
import { getServerEnvConfig } from './config/env.js';

const { port, host } = getServerEnvConfig();

const server = net.createServer();

server.once('error', (err: NodeJS.ErrnoException) => {
  console.error('\x1b[31m%s\x1b[0m', `\n[Preflight Check Failed] Cannot bind to ${host}:${port}.`);
  if (err.code === 'EACCES') {
    console.error(
      '\x1b[33m%s\x1b[0m',
      `  Permission denied. On this Windows machine, excluded TCP ranges can block nearby 30xx ports. The hardened local default is 127.0.0.1:3201.`
    );
  } else if (err.code === 'EADDRINUSE') {
    console.error('\x1b[33m%s\x1b[0m', `  Port ${port} is already in use by another process.`);
  } else {
    console.error('\x1b[33m%s\x1b[0m', `  Reason: ${err.message}`);
  }
  process.exit(1);
});

server.once('listening', () => {
  server.close();
  process.exit(0);
});

server.listen(port, host);
