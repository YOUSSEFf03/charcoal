import { useMemo } from 'react'
import { Bar } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
} from 'chart.js'
import type { ChartOptions } from 'chart.js'
import type { DailyRevenuePoint } from '../lib/types'
import { formatUsd } from '../lib/money'
import { cssVar } from '../lib/chartTheme'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip)

/**
 * Daily revenue bar chart — the single chart implementation shared by the
 * Reports P&L tab and the Dashboard "Daily revenue" card. Both callers pass
 * the same useDailyRevenue() response, so the two pages can never disagree
 * on a day's figure.
 */
export default function DailyRevenueChart({
  data,
  isLoading,
  height = 200,
}: {
  data?: DailyRevenuePoint[]
  isLoading?: boolean
  height?: number
}) {
  const accent = cssVar('--accent', '#1D6B4A')
  const border = cssVar('--border', '#E4E1D9')
  const text3  = cssVar('--text3', '#9B9890')

  const chartData = useMemo(() => {
    const points = data ?? []
    return {
      labels: points.map(p => new Date(p.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })),
      datasets: [{
        label: 'Revenue',
        data: points.map(p => parseFloat(p.revenue)),
        backgroundColor: accent,
        borderRadius: 3,
        maxBarThickness: 18,
      }],
    }
  }, [data, accent])

  const options: ChartOptions<'bar'> = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => formatUsd(ctx.parsed.y, { decimals: 0 }),
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: text3, font: { size: 10 }, maxRotation: 0, autoSkip: true },
      },
      y: {
        beginAtZero: true,
        grid: { color: border },
        ticks: {
          color: text3,
          font: { size: 10 },
          callback: (v) => formatUsd(Number(v), { decimals: 0 }),
        },
      },
    },
  }), [text3, border])

  if (isLoading) {
    return <div className="empty">Loading daily revenue…</div>
  }
  if (!data || data.length === 0) {
    return <div className="empty">No revenue in this period.</div>
  }

  return (
    <div style={{ height }}>
      <Bar data={chartData} options={options} />
    </div>
  )
}
