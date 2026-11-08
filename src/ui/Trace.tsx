import type { Point } from '../../packages/domain/model.ts'
import { number } from './format.ts'

interface Line { label: string; color: string; points: readonly Point[]; dash?: string }
export function Trace({ lines, xStart, xEnd, min, max, threshold, cursor, timeLabel, label, xLabel, yLabel, thresholdLabel }: {
  lines: Line[]; xStart: number; xEnd: number; min?: number; max?: number; threshold?: number; cursor?: number
  timeLabel: (at: number) => string; label: string; xLabel?: string; yLabel?: string; thresholdLabel?: string
}) {
  const values = lines.flatMap((line) => line.points.map((point) => point.value))
  if (threshold !== undefined) values.push(threshold)
  const yMin = min ?? (values.length ? Math.min(...values) : 0)
  const yMax = max ?? Math.max(yMin + 1, ...(values.length ? values : [1]))
  const x = (at: number) => 46 + 516 * (at - xStart) / Math.max(1, xEnd - xStart)
  const y = (value: number) => 112 - 93 * (value - yMin) / Math.max(0.0001, yMax - yMin)
  return <figure className="trace">
    {yLabel && <div className="trace-axis-title">{yLabel}</div>}
    <svg viewBox="0 0 576 140" role="img" aria-label={label} preserveAspectRatio="none">
      {[0, 0.5, 1].map((step) => {
        const value = yMin + step * (yMax - yMin)
        return <g key={step}>
          <line x1="46" x2="562" y1={y(value)} y2={y(value)} className="trace-grid" />
          <text x="38" y={y(value) + 4} textAnchor="end">{number(value, 0)}</text>
        </g>
      })}
      {threshold !== undefined && <line x1="46" x2="562" y1={y(threshold)} y2={y(threshold)} className="trace-limit" />}
      {cursor !== undefined && <line x1={x(cursor)} x2={x(cursor)} y1="13" y2="113" className="trace-cursor" />}
      {lines.map(({ label, color, points, dash }) => points.length === 1
        ? <circle key={label} cx={x(points[0].at)} cy={y(points[0].value)} r="4" fill={color} />
        : <polyline key={label} points={points.map((point) => x(point.at) + ',' + y(point.value)).join(' ')} stroke={color} fill="none" strokeWidth="2.5" strokeDasharray={dash} vectorEffect="non-scaling-stroke" />)}
      <text x="46" y="131">{timeLabel(xStart)}</text><text x="562" y="131" textAnchor="end">{timeLabel(xEnd)}</text>
    </svg>
    {xLabel && <div className="trace-axis-title trace-axis-x">{xLabel}</div>}
    {thresholdLabel && <p className="trace-threshold-key">┄ {thresholdLabel}</p>}
    {lines.length > 1 && <figcaption>{lines.map((line) => <span key={line.label}><i style={{ background: 'none', borderTop: '3px ' + (line.dash === '3 4' ? 'dotted ' : line.dash ? 'dashed ' : 'solid ') + line.color }} />{line.label}</span>)}</figcaption>}
  </figure>
}
