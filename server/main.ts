import { createReadStream } from 'node:fs';
import { appendFile, mkdir, readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { AgentEvent } from '../shared/events';
import { aggregate } from '../shared/metrics';
import { BrowserPool } from '../harness/browser';
import { AnthropicModel, type Effort } from '../harness/model';
import { ScriptedModel } from '../harness/scripted-model';
import { startFixtureServer } from '../fixtures/server';
import { TASKS } from '../evals/tasks';
import { DEFAULT_LIMITS, RunManager } from './runs';

try {
  process.loadEnvFile();
} catch {
  // No .env file: rely on the environment.
}

const PORT = Number(process.env.API_PORT ?? 8787);
const MODEL = process.env.AGENT_MODEL ?? 'claude-opus-5-5';
const EFFORT = (process.env.AGENT_EFFORT ?? 'medium') as Effort;
const HAS_KEY = Boolean(process.env.ANTHROPIC_API_KEY);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const LOG = join(ROOT, 'data', 'events.ndjson');

const fixtures = await startFixtureServer(Number(process.env.FIXTURES_PORT ?? 4174));
const pool = await BrowserPool.launch({ headless: !process.env.HEADED });
await mkdir(join(ROOT, 'data'), { recursive: true });

const presets = TASKS.map((task) => ({ id: task.id, skill: task.skill, task: task.prompt, startUrl: `${fixtures.origin}${task.path}` }));

async function readLog(): Promise<AgentEvent[]> {
  const raw = await readFile(LOG, 'utf8').catch(() => '');
  return raw
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as AgentEvent];
      } catch {
        return [];
      }
    });
}

// Appends run in order through one promise chain, so lines never interleave.
let logQueue = Promise.resolve();
function record(event: AgentEvent): void {
  logQueue = logQueue.then(() => appendFile(LOG, `${JSON.stringify(event)}\n`)).catch((error) => console.error('event log write failed', error));
}

const runs = new RunManager({
  pool,
  record,
  modelFor: (request) => {
    if (HAS_KEY) return new AnthropicModel(MODEL, EFFORT);
    const preset = presets.find((p) => p.task === request.task && p.startUrl === request.startUrl);
    const task = preset && TASKS.find((t) => t.id === preset.id);
    if (task) return new ScriptedModel(task.oracle, 600);
    return { error: 'No ANTHROPIC_API_KEY is set, so only the preset tasks can run (with the scripted demo agent). Add a key to .env to run your own tasks.' };
  },
});

const startSchema = z.object({
  task: z.string().trim().min(3).max(2000),
  startUrl: z.url({ protocol: /^https?$/ }),
  allowlist: z.array(z.string().min(1).max(253)).max(20).optional(),
});
const controlSchema = z.object({ action: z.enum(['pause', 'resume', 'stop']) });
const decisionSchema = z.object({ decision: z.enum(['approved', 'denied']) });

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 64_000) throw new Error('Request body too large.');
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function stream(req: IncomingMessage, res: ServerResponse, id: string): void {
  const run = runs.get(id);
  if (!run) return json(res, 404, { error: 'No such run.' });
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
  const send = (event: AgentEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  for (const event of run.events) send(event);
  const unsubscribe = runs.subscribe(id, send);
  const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 15_000);
  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe?.();
  });
}

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

async function serveStatic(res: ServerResponse, pathname: string): Promise<void> {
  const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  let file = join(DIST, safe);
  if (!file.startsWith(DIST) || !(await stat(file).then((s) => s.isFile()).catch(() => false))) file = join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  try {
    if (parts[0] !== 'api') {
      if (process.env.NODE_ENV === 'production') return await serveStatic(res, url.pathname);
      return json(res, 404, { error: 'The UI is served by Vite in development (npm run dev).' });
    }
    const [, resource, id, sub, extra] = parts;
    if (req.method === 'GET' && resource === 'config') {
      return json(res, 200, { mode: HAS_KEY ? 'claude' : 'demo', model: HAS_KEY ? MODEL : 'scripted', effort: EFFORT, limits: DEFAULT_LIMITS, fixturesOrigin: fixtures.origin, presets });
    }
    if (req.method === 'GET' && resource === 'metrics') return json(res, 200, aggregate(await readLog()));
    if (req.method === 'GET' && resource === 'evals') {
      const latest = await readFile(join(ROOT, 'evals', 'results', 'latest.json'), 'utf8').catch(() => null);
      return json(res, 200, latest ? JSON.parse(latest) : null);
    }
    if (resource === 'runs') {
      if (req.method === 'GET' && !id) return json(res, 200, runs.list());
      if (req.method === 'POST' && !id) {
        const parsed = startSchema.safeParse(await body(req));
        if (!parsed.success) return json(res, 400, { error: parsed.error.issues[0]?.message ?? 'Invalid request.' });
        const started = runs.start(parsed.data);
        return 'error' in started ? json(res, 400, started) : json(res, 201, started);
      }
      if (!id) return json(res, 404, { error: 'Not found.' });
      if (req.method === 'GET' && sub === 'events') return stream(req, res, id);
      if (req.method === 'GET' && sub === 'frames' && extra) {
        const frame = runs.frame(id, Number.parseInt(extra, 10));
        if (!frame) return json(res, 404, { error: 'No such frame.' });
        res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'max-age=3600' });
        return res.end(frame);
      }
      if (req.method === 'GET' && !sub) {
        const run = runs.get(id);
        return run ? json(res, 200, run.view) : json(res, 404, { error: 'No such run.' });
      }
      if (req.method === 'POST' && sub === 'control') {
        const parsed = controlSchema.safeParse(await body(req));
        if (!parsed.success) return json(res, 400, { error: 'action must be pause, resume or stop.' });
        return json(res, 200, { changed: runs.control(id, parsed.data.action) });
      }
      if (req.method === 'POST' && sub === 'approvals' && extra) {
        const parsed = decisionSchema.safeParse(await body(req));
        if (!parsed.success) return json(res, 400, { error: 'decision must be approved or denied.' });
        const ok = runs.decide(id, decodeURIComponent(extra), parsed.data.decision);
        return ok ? json(res, 200, { ok }) : json(res, 409, { error: 'That approval is no longer pending.' });
      }
    }
    return json(res, 404, { error: 'Not found.' });
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : 'Server error.' });
  }
});

server.listen(PORT, () => {
  console.log(`API on http://localhost:${PORT} (${HAS_KEY ? `Claude ${MODEL}, effort ${EFFORT}` : 'demo mode: no ANTHROPIC_API_KEY, scripted agent on preset tasks'})`);
  console.log(`Fixture sites on ${fixtures.origin}`);
});

async function shutdown(): Promise<void> {
  runs.stopAll();
  server.close();
  await pool.close().catch(() => undefined);
  await fixtures.close().catch(() => undefined);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
