import type { StepView } from '../../shared/run-view';
import { duration, RISK } from '../state/format';
import { Icon, iconForAction } from './Icon';

const STATE_LABEL: Record<StepView['state'], string> = {
  running: 'Running',
  awaiting_approval: 'Waiting for approval',
  done: 'Done',
  failed: 'Failed',
  declined: 'Declined',
};

interface Props {
  steps: StepView[];
  selected: number | null;
  onSelect: (step: number) => void;
}

export function Timeline({ steps, selected, onSelect }: Props) {
  if (!steps.length) return <p className="empty-timeline">Steps appear here as the agent works.</p>;
  return (
    <ol className="timeline" aria-label="Steps">
      {steps.map((step) => (
        <li key={step.step} className={`step state-${step.state}${selected === step.step ? ' selected' : ''}`}>
          <div className="step-rail" aria-hidden="true">
            <span className="step-dot">
              <Icon name={step.state === 'failed' ? 'x' : step.state === 'declined' ? 'shield' : iconForAction(step.action)} size={14} />
            </span>
          </div>
          <div className="step-body">
            <div className="step-top">
              <span className="step-n">Step {step.step}</span>
              <span className="step-label">{step.label}</span>
              <span className={`step-state state-${step.state}`}>{STATE_LABEL[step.state]}</span>
            </div>
            {step.reason && <p className="step-reason">{step.reason}</p>}
            <div className="step-meta">
              {step.summary && <span className={step.state === 'failed' ? 'step-error' : undefined}>{step.summary}</span>}
              {step.ms !== undefined && <span className="muted">{duration(step.ms)}</span>}
              {step.retried && <span className="tag">Retried once</span>}
              {step.approval && (
                <span className={`tag ${step.approval.decision === 'denied' ? 'tone-bad' : step.approval.decision ? 'tone-good' : 'tone-warn'}`}>
                  {RISK[step.approval.risk.kind]}
                  {step.approval.decision && `: ${step.approval.decision}${step.approval.by === 'policy' ? ' by policy' : ''}`}
                </span>
              )}
            </div>
          </div>
          {step.screenshot && (
            <button type="button" className="thumb" onClick={() => onSelect(step.step)} aria-pressed={selected === step.step} aria-label={`Show the page after step ${step.step}`}>
              <img src={step.screenshot} alt="" loading="lazy" width={128} height={80} />
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}
