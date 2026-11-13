import type { RunView } from '../../shared/run-view';
import { confidenceLevel, duration, STATUS } from '../state/format';

export function ReportCard({ view }: { view: RunView }) {
  const report = view.report;
  if (!report && !view.error) return null;
  const level = report ? confidenceLevel(report.confidence) : null;
  return (
    <section className={`report tone-${STATUS[view.status].tone}`} aria-labelledby="report-title">
      <h3 id="report-title">{report?.status === 'not_possible' ? 'The agent could not do this' : report ? 'Result' : STATUS[view.status].label}</h3>
      {report?.answer && <p className="report-answer">{report.answer}</p>}
      {!report && view.error && <p className="report-answer">{view.error}</p>}
      {level && report && (
        <div className="confidence">
          <div className="confidence-row">
            <span className={`tag tone-${level.tone}`}>{level.label}</span>
            <span className="muted">{Math.round(report.confidence * 100)}%</span>
          </div>
          <div className="confidence-track" role="meter" aria-label="Agent confidence" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(report.confidence * 100)}>
            <div className={`confidence-fill tone-${level.tone}`} style={{ width: `${report.confidence * 100}%` }} />
          </div>
          <p className="hint">{level.hint}</p>
        </div>
      )}
      <p className="muted report-foot">
        {view.steps.length} steps in {duration(view.durationMs ?? 0)}
        {view.steps.some((s) => s.state === 'failed') && `, ${view.steps.filter((s) => s.state === 'failed').length} failed`}
      </p>
    </section>
  );
}
