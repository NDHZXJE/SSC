import { useEffect, useState } from 'react'

// Cảnh minh họa: cục SSC chôn dưới mặt đường, xe tải chạy qua, hệ thống đo tải từng trục và ước tính trọng lượng xe.
const W = 960
const BLOCKS = [              // cụm cục SSC chôn dọc làn xe (x tâm cục) và màu vệt tín hiệu
  { id: 'R-01', x: 190, c: '#fbbf24' },
  { id: 'R-02', x: 350, c: '#22d3ee' },
  { id: 'R-03', x: 510, c: '#a78bfa' },
  { id: 'R-04', x: 670, c: '#4ade80' },
]
const LAST_X = BLOCKS[BLOCKS.length - 1].x
const PERIOD = 9000           // ms cho một lượt xe
const AXLES = [               // vị trí trục so với đầu xe (px) và tải trục (tấn)
  { dx: 38, t: 6.5 },
  { dx: 168, t: 9.0 },
  { dx: 206, t: 9.0 },
]
const TRUCK_LEN = 250
const SPREAD = 26             // độ rộng vùng ảnh hưởng của một bánh lên cục (px)

function useLoop() {
  const [t, setT] = useState(0.47)
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let raf, start = performance.now() - 0.1 * PERIOD
    const tick = now => { setT(((now - start) % PERIOD) / PERIOD); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  return t
}

const fmt = v => v.toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export default function RoadScene() {
  const t = useLoop()
  const front = -TRUCK_LEN + t * (W + TRUCK_LEN * 2)   // x của đầu xe (xe chạy từ trái sang phải, đầu xe bên phải)
  const axleX = AXLES.map(a => front - a.dx)
  const loadAt = (bx, ax) => AXLES.reduce((s, a, i) => s + a.t * Math.exp(-(((ax[i] - bx) / SPREAD) ** 2)), 0)
  const loads = BLOCKS.map(b => loadAt(b.x, axleX))
  const ks = loads.map(l => Math.min(1, l / 9))
  const load = Math.max(...loads)
  const active = loads.indexOf(load)
  const passed = AXLES.filter((a, i) => axleX[i] > LAST_X + SPREAD * 1.5)
  const total = passed.reduce((s, a) => s + a.t, 0)
  const done = passed.length === AXLES.length
  const crossed = BLOCKS.filter(b => axleX[AXLES.length - 1] > b.x + SPREAD * 1.5).length

  // vệt tín hiệu của từng cục: tải theo thời gian của cả lượt, vẽ tới thời điểm hiện tại
  const N = 160
  const traces = BLOCKS.map(() => [])
  for (let i = 0; i <= N * t; i++) {
    const f = -TRUCK_LEN + (i / N) * (W + TRUCK_LEN * 2)
    const ax = AXLES.map(a => f - a.dx)
    BLOCKS.forEach((b, j) => traces[j].push(`${((i / N) * 260).toFixed(1)},${(56 - loadAt(b.x, ax) * 5).toFixed(1)}`))
  }

  return (
    <div className="lp-road">
      <svg viewBox={`0 0 ${W} 330`} role="img" className="lp-roadsvg"
        aria-label="Cụm bốn cục bê tông tự cảm biến chôn dưới mặt đường, xe tải chạy qua, hệ thống đo tải từng trục">
        <defs>
          <linearGradient id="rdSky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0b1220" stopOpacity="0" /><stop offset="1" stopColor="#0f172a" stopOpacity=".6" />
          </linearGradient>
          <linearGradient id="rdSoil" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3b2f25" /><stop offset="1" stopColor="#1c1612" />
          </linearGradient>
          <radialGradient id="rdGlow"><stop offset="0" stopColor="#22d3ee" stopOpacity=".7" /><stop offset="1" stopColor="#22d3ee" stopOpacity="0" /></radialGradient>
          <pattern id="rdGravel" width="18" height="12" patternUnits="userSpaceOnUse">
            <circle cx="4" cy="4" r="1.6" fill="#6b7280" opacity=".5" /><circle cx="13" cy="9" r="1.2" fill="#9ca3af" opacity=".35" />
          </pattern>
        </defs>
        <rect width={W} height="150" fill="url(#rdSky)" />

        {/* các lớp kết cấu đường */}
        <rect y="150" width={W} height="36" fill="#1f2328" />
        <rect y="150" width={W} height="3" fill="#3f4650" />
        {Array.from({ length: 16 }, (_, i) => <rect key={i} x={i * 64 + 10} y="157" width="34" height="3" rx="1.5" fill="#e5e7eb" opacity=".55" />)}
        <rect y="186" width={W} height="56" fill="#4b5058" />
        <rect y="186" width={W} height="56" fill="url(#rdGravel)" />
        <rect y="242" width={W} height="88" fill="url(#rdSoil)" />
        <text x="14" y="180" className="lp-roadlbl">Lớp mặt bê tông nhựa</text>
        <text x="14" y="236" className="lp-roadlbl">Lớp móng cấp phối đá dăm</text>
        <text x="14" y="318" className="lp-roadlbl">Nền đất</text>

        {/* cáp tín hiệu từ từng cục gom về node ESP32 ở lề đường */}
        <path className="lp-wire" d={`M${BLOCKS[0].x} 234 L ${BLOCKS[0].x} 280 L 870 280 L 870 140`} />
        {BLOCKS.slice(1).map(b => <path key={b.id} className="lp-wire" d={`M${b.x} 234 L ${b.x} 280`} />)}

        {BLOCKS.map((b, j) => {
          const k = ks[j]
          return (
            <g key={b.id}>
              {/* vùng ứng suất lan xuống cục */}
              <ellipse cx={b.x} cy="212" rx={50 + 34 * k} ry={26 + 18 * k} fill="url(#rdGlow)" opacity={0.08 + 0.92 * k} />
              <rect x={b.x - 30} y="194" width="60" height="40" rx="3" fill="#9aa2ad" stroke={k > .05 ? b.c : '#cbd5e1'} strokeOpacity={0.4 + 0.6 * k} strokeWidth="2" />
              <line x1={b.x - 16} y1="196" x2={b.x - 16} y2="232" stroke="#d97706" strokeWidth="3" />
              <line x1={b.x + 16} y1="196" x2={b.x + 16} y2="232" stroke="#d97706" strokeWidth="3" />
              <text x={b.x} y="218" textAnchor="middle" fontSize="10" fontWeight="700" fill="#0f172a">{b.id}</text>
              {k > 0.08 && (
                <g className="lp-arrow" opacity={k}>
                  <line x1={b.x} y1="150" x2={b.x} y2="186" />
                  <polyline points={`${b.x - 7},178 ${b.x},188 ${b.x + 7},178`} />
                </g>
              )}
            </g>
          )
        })}

        <g transform="translate(842 96)">
          <rect x="22" y="40" width="12" height="54" fill="#334155" />
          <rect width="56" height="42" rx="7" fill="#0f172a" stroke="#22d3ee" strokeOpacity=".7" />
          <circle className="lp-led" cx="44" cy="11" r="3.5" />
          <text x="8" y="33" fill="#94a3b8" fontSize="9" fontFamily="ui-monospace,monospace">ESP32</text>
          <g className="lp-wifi" fill="none" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round">
            <path d="M19 -8 a13 13 0 0 1 18 0" /><path d="M14 -15 a21 21 0 0 1 28 0" />
          </g>
        </g>

        {/* xe tải */}
        <g transform={`translate(${front - TRUCK_LEN} 0)`}>
          <rect x="0" y="62" width="180" height="70" rx="4" fill="#e2e8f0" />
          <rect x="0" y="62" width="180" height="70" rx="4" fill="none" stroke="#94a3b8" />
          <text x="90" y="103" textAnchor="middle" fontSize="15" fontWeight="800" fill="#334155" letterSpacing="1">SSC TEST</text>
          <rect x="184" y="76" width="62" height="56" rx="8" fill="#0ea5e9" />
          <path d="M214 82 h22 a6 6 0 0 1 6 6 v14 h-28z" fill="#bae6fd" opacity=".85" />
          <rect x="246" y="118" width="6" height="10" rx="2" fill="#fbbf24" />
          <rect x="0" y="130" width="250" height="8" fill="#1e293b" />
          {AXLES.map(a => (
            <g key={a.dx} transform={`translate(${TRUCK_LEN - a.dx} 140)`}>
              <circle r="13" fill="#0b0f14" stroke="#475569" strokeWidth="3" />
              <circle r="4" fill="#94a3b8" />
            </g>
          ))}
        </g>

      </svg>

      <div className="lp-roadpanel">
        <div className="lp-wavehead"><span><i className="lp-dot" /> Cụm 4 cục · dưới làn xe</span><span className="lp-mono">100 mẫu/giây</span></div>
        <svg viewBox="0 0 260 60" preserveAspectRatio="none" className="lp-roadtrace">
          <line x1="0" y1="56" x2="260" y2="56" stroke="rgba(148,163,184,.25)" />
          {traces.map((p, j) => <polyline key={j} points={p.join(' ')} style={{ stroke: BLOCKS[j].c }} />)}
        </svg>
        <div className="lp-wavefoot">
          <div><small>Tải tức thời{load > 0.3 ? ` · ${BLOCKS[active].id}` : ''}</small><b className="lp-mono lp-amber">{fmt(load)} tấn</b></div>
          <div><small>Cục đã qua</small><b className="lp-mono">{crossed}/{BLOCKS.length}</b></div>
          <div><small>Trọng lượng xe</small><b className={'lp-mono ' + (done ? 'lp-weight' : '')}>{done ? fmt(total) + ' tấn' : '…'}</b></div>
        </div>
      </div>
    </div>
  )
}
