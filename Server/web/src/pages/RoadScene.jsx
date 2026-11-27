import { useEffect, useState } from 'react'

// Cảnh minh họa: cục SSC chôn dưới mặt đường, xe tải chạy qua, hệ thống đo tải từng trục và ước tính trọng lượng xe.
const W = 960
const BLOCK_X = 470           // tâm cục bê tông (theo trục x của SVG)
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
  const load = AXLES.reduce((s, a, i) => s + a.t * Math.exp(-(((axleX[i] - BLOCK_X) / SPREAD) ** 2)), 0)
  const passed = AXLES.filter((a, i) => axleX[i] > BLOCK_X + SPREAD * 1.5)
  const total = passed.reduce((s, a) => s + a.t, 0)
  const done = passed.length === AXLES.length
  const k = Math.min(1, load / 9)

  // vệt tín hiệu: tải theo thời gian của cả lượt, vẽ tới thời điểm hiện tại
  const N = 120
  const pts = []
  for (let i = 0; i <= N * t; i++) {
    const f = -TRUCK_LEN + (i / N) * (W + TRUCK_LEN * 2)
    const v = AXLES.reduce((s, a) => s + a.t * Math.exp(-(((f - a.dx - BLOCK_X) / SPREAD) ** 2)), 0)
    pts.push(`${(i / N) * 260},${(56 - v * 5).toFixed(1)}`)
  }

  return (
    <div className="lp-road">
      <svg viewBox={`0 0 ${W} 330`} role="img" className="lp-roadsvg"
        aria-label="Cục bê tông tự cảm biến chôn dưới mặt đường, xe tải chạy qua, hệ thống đo tải từng trục">
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

        {/* vùng ứng suất lan xuống cục */}
        <ellipse cx={BLOCK_X} cy="212" rx={60 + 40 * k} ry={30 + 20 * k} fill="url(#rdGlow)" opacity={0.15 + 0.85 * k} />

        {/* cục SSC chôn trong lớp móng */}
        <g>
          <rect x={BLOCK_X - 34} y="194" width="68" height="40" rx="3" fill="#9aa2ad" stroke={k > .05 ? '#22d3ee' : '#cbd5e1'} strokeOpacity={0.4 + 0.6 * k} strokeWidth="2" />
          <line x1={BLOCK_X - 18} y1="196" x2={BLOCK_X - 18} y2="232" stroke="#d97706" strokeWidth="3" />
          <line x1={BLOCK_X + 18} y1="196" x2={BLOCK_X + 18} y2="232" stroke="#d97706" strokeWidth="3" />
          <text x={BLOCK_X} y="218" textAnchor="middle" fontSize="11" fontWeight="700" fill="#0f172a">SSC</text>
        </g>

        {/* cáp tín hiệu chạy ra lề đường tới node ESP32 */}
        <path className="lp-wire" d={`M${BLOCK_X + 18} 234 C ${BLOCK_X + 60} 276, 760 276, 820 262 L 870 262 L 870 140`} />
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

        {/* mũi tên tải khi bánh đè lên cục */}
        {k > 0.08 && (
          <g className="lp-arrow" opacity={k}>
            <line x1={BLOCK_X} y1="150" x2={BLOCK_X} y2="186" />
            <polyline points={`${BLOCK_X - 7},178 ${BLOCK_X},188 ${BLOCK_X + 7},178`} />
          </g>
        )}
      </svg>

      <div className="lp-roadpanel">
        <div className="lp-wavehead"><span><i className="lp-dot" /> Cục R-07 · dưới làn xe</span><span className="lp-mono">100 mẫu/giây</span></div>
        <svg viewBox="0 0 260 60" preserveAspectRatio="none" className="lp-roadtrace">
          <line x1="0" y1="56" x2="260" y2="56" stroke="rgba(148,163,184,.25)" />
          <polyline points={pts.join(' ')} />
        </svg>
        <div className="lp-wavefoot">
          <div><small>Tải tức thời</small><b className="lp-mono lp-amber">{fmt(load)} tấn</b></div>
          <div><small>Trục đã qua</small><b className="lp-mono">{passed.length}/{AXLES.length}</b></div>
          <div><small>Trọng lượng xe</small><b className={'lp-mono ' + (done ? 'lp-weight' : '')}>{done ? fmt(total) + ' tấn' : '…'}</b></div>
        </div>
      </div>
    </div>
  )
}
