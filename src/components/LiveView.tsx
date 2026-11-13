import type { RunView } from '../../shared/run-view';
import { isTerminal } from '../../shared/events';

interface Props {
  view: RunView;
  selected: number | null;
  onLive: () => void;
}

export function LiveView({ view, selected, onLive }: Props) {
  const withFrames = view.steps.filter((s) => s.screenshot);
  const chosen = selected !== null ? view.steps.find((s) => s.step === selected) : withFrames.at(-1);
  const live = selected === null;
  const url = chosen?.url ?? view.startUrl;

  return (
    <section className="live" aria-label="Browser view">
      <div className="live-bar">
        <span className={`live-dot${live && !isTerminal(view.status) ? ' on' : ''}`} aria-hidden="true" />
        <span className="live-mode">{live ? (isTerminal(view.status) ? 'Final page' : 'Live') : `After step ${selected}`}</span>
        <span className="live-url mono" title={url}>
          {url || 'about:blank'}
        </span>
        {!live && (
          <button type="button" className="btn small" onClick={onLive}>
            Back to latest
          </button>
        )}
      </div>
      <div className="live-frame">
        {chosen?.screenshot ? (
          <img src={chosen.screenshot} alt={`Browser after step ${chosen.step}: ${chosen.label}`} width={1280} height={800} />
        ) : (
          <p className="live-empty">{view.runId ? 'Waiting for the first action…' : 'The agent’s browser shows up here.'}</p>
        )}
      </div>
    </section>
  );
}
