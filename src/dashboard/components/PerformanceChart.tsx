import { useMemo, useState } from 'react';
import { EmptyState } from './DashPrimitives';
import type { ChangeDirection, PerformanceSeriesPoint, PerformanceSnapshot } from '../superAdminApi';

// Hand-rolled SVG line chart — no charting dependency. Plots one performance metric over time, with
// each change log entry drawn as a point color-coded by its direction (green positive / red negative
// / grey neutral), so it reads at a glance which changes correlated with the metric moving.

type MetricKey = keyof Pick<PerformanceSnapshot, 'deploymentSuccessRate' | 'avgDeployTimeSec' | 'totalDeployments' | 'diskUsageMb'>;

const METRICS: Array<{ key: MetricKey; label: string; suffix: string }> = [
  { key: 'deploymentSuccessRate', label: 'Deploy success rate', suffix: '%' },
  { key: 'avgDeployTimeSec', label: 'Avg deploy time', suffix: 's' },
  { key: 'totalDeployments', label: 'Total deployments', suffix: '' },
  { key: 'diskUsageMb', label: 'Disk usage', suffix: ' MB' },
];

const DIRECTION_COLOR: Record<ChangeDirection, string> = {
  positive: '#16a34a',
  negative: '#dc2626',
  neutral: '#94a3b8',
};

const WIDTH = 820;
const HEIGHT = 280;
const PAD = { top: 24, right: 24, bottom: 44, left: 56 };

export function PerformanceChart({ series }: { series: PerformanceSeriesPoint[] }) {
  const [metric, setMetric] = useState<MetricKey>('deploymentSuccessRate');

  const active = METRICS.find((m) => m.key === metric)!;

  const points = useMemo(
    () =>
      series
        .filter((point) => typeof point.metrics?.[metric] === 'number' && point.occurredAt)
        .map((point) => ({
          ...point,
          value: point.metrics[metric] as number,
          time: new Date(point.occurredAt as string).getTime(),
        }))
        .sort((a, b) => a.time - b.time),
    [series, metric],
  );

  const geometry = useMemo(() => {
    if (points.length === 0) return null;
    const values = points.map((p) => p.value);
    const times = points.map((p) => p.time);
    const minV = Math.min(...values);
    const maxV = Math.max(...values);
    const minT = Math.min(...times);
    const maxT = Math.max(...times);
    const spanV = maxV - minV || 1;
    const spanT = maxT - minT || 1;

    const plotW = WIDTH - PAD.left - PAD.right;
    const plotH = HEIGHT - PAD.top - PAD.bottom;

    const x = (t: number) => (points.length === 1 ? PAD.left + plotW / 2 : PAD.left + ((t - minT) / spanT) * plotW);
    const y = (v: number) => PAD.top + plotH - ((v - minV) / spanV) * plotH;

    return {
      minV,
      maxV,
      midV: (minV + maxV) / 2,
      minT,
      maxT,
      plotH,
      coords: points.map((p) => ({ ...p, cx: x(p.time), cy: y(p.value) })),
    };
  }, [points]);

  return (
    <section className="perf-chart">
      <header className="perf-chart-head">
        <div>
          <strong>Application performance across changes</strong>
          <span>Each point is a logged change, colored by its net impact.</span>
        </div>
        <label className="perf-chart-metric">
          <span>Metric</span>
          <select value={metric} onChange={(event) => setMetric(event.target.value as MetricKey)}>
            {METRICS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </header>

      {!geometry ? (
        <EmptyState>No change log entries have a captured value for this metric yet.</EmptyState>
      ) : (
        <>
          <div className="perf-chart-canvas">
            <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${active.label} over time`} preserveAspectRatio="xMidYMid meet">
              {/* horizontal gridlines + y labels */}
              {[geometry.maxV, geometry.midV, geometry.minV].map((v, index) => {
                const yPos = PAD.top + (index * geometry.plotH) / 2;
                return (
                  <g key={index}>
                    <line x1={PAD.left} y1={yPos} x2={WIDTH - PAD.right} y2={yPos} className="perf-grid-line" />
                    <text x={PAD.left - 10} y={yPos + 4} textAnchor="end" className="perf-axis-label">
                      {formatValue(v, active.suffix)}
                    </text>
                  </g>
                );
              })}

              {/* connecting line */}
              {geometry.coords.length > 1 && (
                <polyline points={geometry.coords.map((c) => `${c.cx},${c.cy}`).join(' ')} className="perf-line" fill="none" />
              )}

              {/* points */}
              {geometry.coords.map((c) => (
                <g key={c.id}>
                  <circle cx={c.cx} cy={c.cy} r={6} fill={DIRECTION_COLOR[c.direction]} stroke="#fff" strokeWidth={2}>
                    <title>{`${c.title}\n${active.label}: ${formatValue(c.value, active.suffix)}\n${c.direction}, impact ${c.impactRating}/5\n${new Date(c.occurredAt as string).toLocaleDateString()}`}</title>
                  </circle>
                </g>
              ))}

              {/* x axis end labels */}
              <text x={PAD.left} y={HEIGHT - 16} textAnchor="start" className="perf-axis-label">
                {new Date(geometry.minT).toLocaleDateString()}
              </text>
              <text x={WIDTH - PAD.right} y={HEIGHT - 16} textAnchor="end" className="perf-axis-label">
                {new Date(geometry.maxT).toLocaleDateString()}
              </text>
            </svg>
          </div>
          <div className="perf-chart-legend">
            <span>
              <i style={{ background: DIRECTION_COLOR.positive }} /> Positive
            </span>
            <span>
              <i style={{ background: DIRECTION_COLOR.negative }} /> Negative
            </span>
            <span>
              <i style={{ background: DIRECTION_COLOR.neutral }} /> Neutral
            </span>
          </div>
        </>
      )}
    </section>
  );
}

function formatValue(value: number, suffix: string) {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded}${suffix}`;
}
