import { useState, type FormEvent, type KeyboardEvent } from 'react';
import type { Preset } from '../api';

interface Props {
  presets: Preset[];
  demo: boolean;
  defaultUrl: string;
  onStart: (task: string, startUrl: string) => Promise<void>;
}

export function TaskComposer({ presets, demo, defaultUrl, onStart }: Props) {
  const [task, setTask] = useState('');
  const [startUrl, setStartUrl] = useState(defaultUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (busy || !task.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onStart(task.trim(), startUrl.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the run.');
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submit();
  }

  return (
    <section className="composer" aria-labelledby="composer-title">
      <h2 id="composer-title">New task</h2>
      <form onSubmit={submit}>
        <label htmlFor="task">What should the agent do?</label>
        <textarea
          id="task"
          rows={4}
          value={task}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Find the return window for sale items"
          aria-describedby="task-hint"
        />
        <p id="task-hint" className="hint">
          Press <kbd>⌘</kbd> <kbd>Enter</kbd> to run.
        </p>
        <label htmlFor="start-url">Start page</label>
        <input id="start-url" type="url" value={startUrl} onChange={(e) => setStartUrl(e.target.value)} required />
        <p className="hint">The agent may only visit this site. Anything else asks you first.</p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn primary" disabled={busy || !task.trim()}>
          {busy ? 'Starting…' : 'Run task'}
        </button>
      </form>

      <h3 className="presets-title">{demo ? 'Demo tasks' : 'Try one'}</h3>
      {demo && <p className="hint">No API key is set, so a scripted agent replays these. Add a key to run your own.</p>}
      <ul className="presets">
        {presets.map((preset) => (
          <li key={preset.id}>
            <button
              type="button"
              className="preset"
              onClick={() => {
                setTask(preset.task);
                setStartUrl(preset.startUrl);
              }}
            >
              <span className="preset-skill">{preset.skill}</span>
              <span className="preset-task">{preset.task}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
