import 'dotenv/config';

// Serve built assets and API together so forwarded previews need only one port.
// Keep the development API's PORT setting separate from the preview listener.
process.env.PORT = process.env.PREVIEW_PORT ?? '3000';
await import('../dist-server/api/server.js');
