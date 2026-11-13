import { isTerminal } from '../../shared/events';
import { formatUsd, totalTokens } from '../../shared/pricing';
import type { RunView } from '../../shared/run-view';
import { compact, duration } from '../state/format';
import { Icon } from './Icon';
import { StatusPill } from './StatusPill';

interface Props {
  view: RunView;
  now: number;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

function Meter({ label, value, max, text }: { label: string; value: number; max: number; text: string }) {
  const ratio = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div className="meter">
      <div className="meter-label">
        <span>{label}</span>
        <span className="meter-text">{text}</span>
      </div>
      <div className={`meter-track${ratio > 0.8 ? ' near' : ''}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.round(value * 100) / 100} aria-valuetext={text}>
        <div className="meter-fill" style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}

export function RunHeader({ view, now, onPause, onResume, onStop }: Props) {
  const done = isTerminal(view.status);
  const elapsed = done ? (view.durationMs ?? 0) : view.startedAt !== null ? now - view.startedAt : 0;
  const limits = view.limits;
  const paused = view.status === 'paused';
  const thinking = !done && !paused && view.status === 'running' && !view.steps.some((s) => s.state === 'running');
  const retryIn = view.retrying ? Math.max(0, Math.ceil((view.retrying.until - now) / 1000)) : 0;

  return (
    <header className="run-header">
      <div className="run-title">
        <StatusPill status={view.status} />
        <h2>{view.task}</h2>
      </div>
      <p className="run-sub">
        {view.model === 'scripted' ? 'Scripted demo agent' : view.model} on <span className="mono">{view.startUrl}</span> · {view.turns} model {view.turns === 1 ? 'call' : 'calls'} · {compact(totalTokens(view.usage))} tokens
      </p>

      {limits && (
        <div className="meters">
          <Meter label="Steps" value={view.steps.length} max={limits.maxSteps} text={`${view.steps.length} of ${limits.maxSteps}`} />
          <Meter label="Time" value={elapsed} max={limits.maxDurationMs} text={`${duration(elapsed)} of ${duration(limits.maxDurationMs)}`} />
          <Meter label="Cost" value={view.costUsd} max={limits.maxCostUsd} text={`${formatUsd(view.costUsd)} of ${formatUsd(limits.maxCostUsd)}`} />
        </div>
      )}

      {view.retrying && !done && (
        <p className="banner tone-warn" role="status">
          <Icon name="alert" /> The API is busy ({view.retrying.reason}). Retrying{retryIn ? ` in ${retryIn}s` : ''}, attempt {view.retrying.attempt}.
        </p>
      )}
      {thinking && !view.retrying && (
        <p className="thinking" role="status">
          <span className="dots" aria-hidden="true" /> Deciding the next step
        </p>
      )}

      {!done && (
        <div className="controls" role="group" aria-label="Run controls">
          {paused ? (
            <button type="button" className="btn" onClick={onResume} aria-keyshortcuts="P">
              <Icon name="play" /> Resume <kbd>P</kbd>
            </button>
          ) : (
            <button type="button" className="btn" onClick={onPause} aria-keyshortcuts="P">
              <Icon name="pause" /> Pause <kbd>P</kbd>
            </button>
          )}
          <button type="button" className="btn danger" onClick={onStop} aria-keyshortcuts="Shift+S">
            <Icon name="stop" /> Stop <kbd>⇧S</kbd>
          </button>
          {paused && <span className="hint">Paused before the next action. Nothing runs until you resume.</span>}
        </div>
      )}
    </header>
  );
}
