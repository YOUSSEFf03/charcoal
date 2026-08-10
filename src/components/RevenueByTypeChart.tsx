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
import type { RevenueByTypePoint } from '../lib/types'
import { formatUsd } from '../lib/money'
import { cssVar, categoricalPalette } from '../lib/chartTheme'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip)

/**
 * Revenue-by-charcoal-type bar chart. One bar per type, sorted by revenue
 * (the order the backend already returns), colored from the design system's
 * categorical palette so it reads as part of the same chart system as
 * DailyRevenueChart without introducing a second charting approach.
 */
export default function RevenueByTypeChart({
  data,
  isLoading,
  height = 200,
}: {
  data?: RevenueByTypePoint[]
  isLoading?: boolean
  height?: number
}) {
  const palette = useMemo(() => categoricalPalette(), [])
  const border = cssVar('--border', '#E4E1D9')
  const text3  = cssVar('--text3', '#9B9890')

  const chartData = useMemo(() => {
    const points = data ?? []
    return {
      labels: points.map(p => p.charcoalType),
      datasets: [{
        label: 'Revenue',
        data: points.map(p => parseFloat(p.revenue)),
        backgroundColor: points.map((_, i) => palette[i % palette.length]),
        borderRadius: 4,
        maxBarThickness: 32,
      }],
    }
  }, [data, palette])

  const options: ChartOptions<'bar'> = useMemo(() => ({
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => formatUsd(ctx.parsed.x, { decimals: 0 }),
        },
      },
    },
    scales: {
      x: {
        beginAtZero: true,
        grid: { color: border },
        ticks: {
          color: text3,
          font: { size: 10 },
          callback: (v) => formatUsd(Number(v), { decimals: 0 }),
        },
      },
      y: {
        grid: { display: false },
        ticks: { color: text3, font: { size: 11 } },
      },
    },
  }), [border, text3])

  if (isLoading) {
    return <div className="empty">Loading revenue by type…</div>
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
