import { mkdir, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { BrowserPool } from '../harness/browser';
import { AnthropicModel, type Effort } from '../harness/model';
import { ScriptedModel } from '../harness/scripted-model';
import { runAll, runTask } from './runner';
import { summarize, toMarkdown } from './report';
import { TASKS } from './tasks';

try {
  process.loadEnvFile();
} catch {
  // No .env file: rely on the environment.
}

const { values } = parseArgs({
  options: {
    scripted: { type: 'boolean', default: false },
    task: { type: 'string', multiple: true },
    concurrency: { type: 'string', default: '3' },
    model: { type: 'string', default: process.env.AGENT_MODEL ?? 'claude-opus-5-5' },
    effort: { type: 'string', default: process.env.AGENT_EFFORT ?? 'medium' },
  },
});

if (!values.scripted && !process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is not set. Add it to .env (see .env.example), or run `npm run eval -- --scripted` to check the suite without Claude.');
  process.exit(1);
}

const tasks = values.task?.length ? TASKS.filter((task) => values.task!.includes(task.id)) : TASKS;
const effort = values.effort as Effort;
const label = values.scripted ? 'scripted' : values.model;
const startedAt = new Date();
console.log(`Running ${tasks.length} tasks with ${label}${values.scripted ? '' : ` (effort ${effort})`}\n`);

const pool = await BrowserPool.launch({ headless: !process.env.HEADED });
try {
  const results = await runAll(tasks, Number(values.concurrency), async (task) => {
    const model = values.scripted ? new ScriptedModel(task.oracle) : new AnthropicModel(values.model, effort);
    const result = await runTask(task, pool, model);
    console.log(`${result.pass ? 'PASS' : 'FAIL'}  ${task.id}  ${result.status}, ${result.steps} steps${result.pass ? '' : `  (${result.why})`}`);
    return result;
  });
  const summary = summarize(label, values.scripted ? 'n/a' : effort, startedAt, results);
  const table = toMarkdown(summary);
  console.log(`\n${table}\n`);

  const dir = new URL('./results/', import.meta.url);
  await mkdir(dir, { recursive: true });
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
  const json = JSON.stringify(summary, null, 2);
  await writeFile(new URL(`${stamp}-${label}.json`, dir), json);
  if (!values.scripted && !values.task?.length) {
    await writeFile(new URL('latest.json', dir), json);
    await writeFile(new URL('latest.md', dir), `${table}\n`);
  }
  console.log(`Saved to evals/results/${stamp}-${label}.json`);
  process.exitCode = values.scripted && summary.passed !== summary.total ? 1 : 0;
} finally {
  await pool.close();
}
