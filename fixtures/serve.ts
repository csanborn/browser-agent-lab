import { startFixtureServer } from './server';

const port = Number(process.env.FIXTURES_PORT ?? 4174);
const server = await startFixtureServer(port);
console.log(`Fixture sites at ${server.origin}`);
