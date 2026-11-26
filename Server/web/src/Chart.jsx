import { useEffect, useRef } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'

// Fast time-series chart (uPlot handles 100 samples/s without trouble).
// series: [{label, color, scale?}], data: [timesSec[], ...values[]]
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || '#888'

export default function Chart({ series, data, height = 260, yLabel, y2Label }) {
  const el = useRef(null)
  const plot = useRef(null)

  useEffect(() => {
    const width = el.current.clientWidth || 600
    const hasY2 = series.some(s => s.scale === 'y2')
    const opts = {
      width,
      height,
      scales: { x: { time: true } },
      axes: [
        { stroke: css('--muted'), grid: { stroke: css('--grid') } },
        { label: yLabel, stroke: css('--muted'), grid: { stroke: css('--grid') } },
        ...(hasY2 ? [{ scale: 'y2', side: 1, label: y2Label, stroke: css('--muted'), grid: { show: false } }] : []),
      ],
      series: [{}, ...series.map(s => ({ label: s.label, stroke: s.color, width: 1.5, scale: s.scale || 'y', spanGaps: false }))],
      legend: { live: true },
    }
    plot.current = new uPlot(opts, data, el.current)
    const ro = new ResizeObserver(() => plot.current?.setSize({ width: el.current.clientWidth, height }))
    ro.observe(el.current)
    return () => { ro.disconnect(); plot.current?.destroy(); plot.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series.map(s => s.label).join(), height])

  useEffect(() => { plot.current?.setData(data) }, [data])

  return <div ref={el} className="chart" />
}
