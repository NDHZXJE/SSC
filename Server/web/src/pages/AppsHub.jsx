import { useEffect, useRef, useState } from 'react'
import { RoadScene } from './RoadScene'

// Sơ đồ ứng dụng: khối SSC + vi mạch + IoT + AI ở giữa, 7 lĩnh vực ứng dụng xung quanh.
// Mỗi lĩnh vực là một hình SVG nhỏ có hoạt ảnh CSS (lớp ah-* trong landing.css).

// Cầu hai nhịp: khối SSC đặt ở gối cầu (trên mố trái, trụ giữa, mố phải).
// Xe chạy qua → phản lực gối đổi theo vị trí xe → khối SSC sáng lên và bảng số liệu cập nhật.
const BR_SUP = [{ x: 44, name: 'Mố trái' }, { x: 120, name: 'Trụ giữa' }, { x: 196, name: 'Mố phải' }]
const BR_DECK = 64 // mặt trên bản mặt cầu
const BR_SEAT = 72 // đáy dầm = mặt trên khối SSC
const BR_CARS = [
  { kind: 'car', len: 20, w: 1.6, v: 28, off: 0, color: '#ef4444' },
  { kind: 'truck', len: 32, w: 12, v: 28, off: 160, color: '#f59e0b' },
]

function bridgeLoads(xs) {
  const R = [2, 3, 2] // tĩnh tải (t), quy ước
  xs.forEach(({ x, w }) => {
    for (let i = 0; i < 2; i++) {
      const a = BR_SUP[i].x, b = BR_SUP[i + 1].x
      if (x >= a && x <= b) { const t = (x - a) / (b - a); R[i] += w * (1 - t); R[i + 1] += w * t }
    }
  })
  return R
}

function BrCar({ x, color, spin }) {
  return (
    <g transform={`translate(${x + 10} ${BR_DECK - 9}) scale(-1 1)`}>
      <path d="M1 7 L1 4.6 Q1 3.6 2.2 3.4 L5.5 2.8 L8.6 0.4 Q9.2 0 10 0 L14.5 0 Q15.4 0 16 .6 L18 3 L19.2 3.4 Q20 3.7 20 4.6 L20 7 Z" fill={color} />
      <path d="M8.9 1 L10.6 1 L10.6 3 L6.6 3 Z M11.4 1 L14.4 1 L16.4 3 L11.4 3 Z" fill="#bae6fd" opacity=".85" />
      <rect x="19" y="4.2" width="1.2" height="1" rx=".4" fill="#f87171" />
      <rect x=".6" y="4.4" width="1" height="1" rx=".4" fill="#fde68a" />
      {[5, 15.5].map(cx => (
        <g key={cx} transform={`translate(${cx} 7.2) rotate(${spin})`}>
          <circle r="2" fill="#0f172a" /><circle r="1" fill="#94a3b8" /><line x1="-1" x2="1" stroke="#0f172a" strokeWidth=".4" />
        </g>
      ))}
    </g>
  )
}

function BrTruck({ x, color, spin }) {
  return (
    <g transform={`translate(${x - 16} ${BR_DECK - 15})`}>
      <rect x="0" y="0" width="22" height="11" rx="1" fill="#e2e8f0" />
      <rect x="1.5" y="1.5" width="19" height="2" rx=".5" fill={color} opacity=".9" />
      <text x="11" y="8.6" textAnchor="middle" fontSize="3.6" fontWeight="700" fill="#334155">SSC</text>
      <path d="M23 11 L23 3 Q23 2 24 2 L28.4 2 Q29.4 2 30 3 L32 6.6 L32 11 Z" fill={color} />
      <path d="M24.4 3.2 L28 3.2 L30 6.4 L24.4 6.4 Z" fill="#bae6fd" opacity=".85" />
      <rect x="31" y="8" width="1.2" height="1.2" fill="#fde68a" />
      <rect x="0" y="11" width="32" height="1.4" fill="#334155" />
      {[4.5, 9.5, 27].map(cx => (
        <g key={cx} transform={`translate(${cx} 13.2) rotate(${spin})`}>
          <circle r="2.2" fill="#0f172a" /><circle r="1.1" fill="#94a3b8" /><line x1="-1.1" x2="1.1" stroke="#0f172a" strokeWidth=".4" />
        </g>
      ))}
    </g>
  )
}

function SscBlock({ x, load, max }) {
  const k = Math.min(1, Math.max(0, (load - 2) / (max - 2)))
  return (
    <g>
      <rect x={x - 6} y={BR_SEAT - 2} width="12" height="2" fill="#475569" />
      <rect x={x - 5} y={BR_SEAT} width="10" height="7" rx=".8" fill="#9aa2ad" stroke="#22d3ee" strokeWidth={0.4 + k * 0.8} />
      <rect x={x - 5} y={BR_SEAT} width="10" height="7" rx=".8" fill="#22d3ee" opacity={k * 0.55} />
      <line x1={x - 4} x2={x + 4} y1={BR_SEAT + 2.2} y2={BR_SEAT + 2.2} stroke="#b45309" strokeWidth=".9" />
      <line x1={x - 4} x2={x + 4} y1={BR_SEAT + 4.8} y2={BR_SEAT + 4.8} stroke="#b45309" strokeWidth=".9" />
      <circle cx={x} cy={BR_SEAT + 3.5} r={6 + k * 4} fill="none" stroke="#22d3ee" strokeOpacity={k * 0.7} strokeWidth=".6" />
    </g>
  )
}

function Bridge() {
  const [t, setT] = useState(0)
  useEffect(() => {
    const speed = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.5 : 1
    let raf, last = performance.now(), acc = 0
    const loop = now => { acc += (now - last) / 1000 * speed; last = now; setT(acc); raf = requestAnimationFrame(loop) }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])
  const span = 320
  const cars = BR_CARS.map(c => ({ ...c, x: ((c.off + c.v * t) % span) - 40 }))
  const R = bridgeLoads(cars)
  const max = 17
  const spin = (t * 360 * 2) % 360
  return (
    <svg viewBox="0 0 240 120" className="ah-svg" preserveAspectRatio="xMidYMid meet" aria-hidden="true"
      style={{ background: 'linear-gradient(#0f2a3d 50%, #0e3a52 50%)' }}>
      <rect width="240" height="120" fill="url(#ahSky)" />
      {/* sông */}
      <rect y="92" width="240" height="28" fill="#0e3a52" />
      <path className="ah-wave" d="M0 98 q10 -3 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0" stroke="#38bdf8" strokeOpacity=".35" fill="none" />
      {/* nền đường hai đầu + mố cầu */}
      <polygon points="0,68 40,68 40,120 0,120" fill="#3f3a33" />
      <polygon points="200,68 240,68 240,120 200,120" fill="#3f3a33" />
      <polygon points="34,79 52,79 50,104 30,104" fill="#64748b" />
      <polygon points="188,79 206,79 210,104 190,104" fill="#64748b" />
      {/* trụ giữa */}
      <rect x="111" y="79" width="18" height="3" fill="#64748b" />
      <rect x="115" y="82" width="10" height="26" fill="#64748b" />
      {/* vòm + dây treo */}
      <path d="M44 64 Q 82 24 120 64 Q 158 24 196 64" fill="none" stroke="#cbd5e1" strokeWidth="1.4" />
      {[56, 68, 82, 94, 106, 134, 146, 158, 172, 184].map(x => {
        const a = x < 120 ? 44 : 120, u = (x - a) / 76
        return <line key={x} x1={x} x2={x} y1={64 - 80 * u * (1 - u)} y2={BR_DECK} stroke="#94a3b8" strokeOpacity=".55" strokeWidth=".5" />
      })}
      {/* khối SSC ở gối cầu */}
      {BR_SUP.map((s, i) => <SscBlock key={s.x} x={s.x} load={R[i]} max={max} />)}
      {/* dầm + mặt đường */}
      <rect x="0" y={BR_DECK} width="240" height={BR_SEAT - 2 - BR_DECK} fill="#475569" />
      <rect x="0" y={BR_DECK} width="240" height="1" fill="#1f2937" />
      <line x1="0" x2="240" y1={BR_DECK + .5} y2={BR_DECK + .5} stroke="#fbbf24" strokeWidth=".3" strokeDasharray="3 3" />
      {/* xe */}
      {cars.map((c, i) => c.kind === 'car'
        ? <BrCar key={i} x={c.x} color={c.color} spin={spin} />
        : <BrTruck key={i} x={c.x} color={c.color} spin={spin * 0.9} />)}
      {/* nhãn khối SSC */}
      {BR_SUP.map((s, i) => (
        <g key={s.x}>
          <line x1={s.x} x2={s.x} y1={BR_SEAT + 8} y2={108} stroke="#22d3ee" strokeWidth=".3" strokeDasharray="1 1" />
          <rect x={s.x - 13} y={108.5} width="26" height="8" rx="2" fill="#0b1220" stroke="#22d3ee" strokeWidth=".3" />
          <text x={s.x} y={113.8} textAnchor="middle" fontSize="3.6" fill="#e2e8f0">SSC · {s.name}</text>
        </g>
      ))}
      {/* bảng phản lực gối */}
      <g transform="translate(6 6)">
        <rect width="68" height="30" rx="3" fill="#0b1220" opacity=".85" stroke="#1e293b" strokeWidth=".4" />
        <text x="4" y="6.5" fontSize="3.6" fill="#94a3b8">Lực lên gối cầu (tấn)</text>
        {BR_SUP.map((s, i) => (
          <g key={s.x} transform={`translate(4 ${10 + i * 6.4})`}>
            <text y="3.4" fontSize="3.4" fill="#cbd5e1">{s.name}</text>
            <rect x="17" width="30" height="3.6" rx="1" fill="#1e293b" />
            <rect x="17" width={30 * Math.min(1, R[i] / max)} height="3.6" rx="1" fill="#22d3ee" />
            <text x="62" y="3.4" fontSize="3.4" fill="#e2e8f0" textAnchor="end">{R[i].toFixed(1)}</text>
          </g>
        ))}
      </g>
      {/* trạm thu + vệ tinh */}
      <rect x="212" y="76" width="9" height="9" rx="1" fill="#1e293b" stroke="#22d3ee" strokeWidth=".4" />
      <text x="216.5" y="90" fontSize="2.8" fill="#94a3b8" textAnchor="middle">trạm thu</text>
      <line x1="216.5" x2="216.5" y1="76" y2="72" stroke="#94a3b8" strokeWidth=".5" />
      <circle cx="216.5" cy="71.4" r=".9" className="ah-blink" />
      <path d={`M201 ${BR_SEAT + 3.5} L212 80`} stroke="#22d3ee" strokeWidth=".4" />
      <g className="ah-bob"><rect x="206" y="12" width="12" height="7" rx="1" fill="#cbd5e1" /><rect x="197" y="14" width="8" height="3" fill="#3b82f6" /><rect x="219" y="14" width="8" height="3" fill="#3b82f6" /></g>
      <path className="ah-beam" d="M216.5 70 L212 20" stroke="#22d3ee" strokeDasharray="2 3" strokeWidth=".6" />
    </svg>
  )
}

// Trái: mặt cắt đập trọng lực, 3 khối SSC gắn sát mặt thượng lưu ở 3 cao độ đo áp lực nước.
// Phải: mái dốc / đê, 3 khối SSC chôn dọc mái, đo biến dạng khi khối đất trượt dần theo mặt trượt.
function useSceneClock() {
  const [t, setT] = useState(0)
  useEffect(() => {
    const speed = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.5 : 1
    let raf, last = performance.now(), acc = 0
    const loop = now => { acc += (now - last) / 1000 * speed; last = now; setT(acc); raf = requestAnimationFrame(loop) }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])
  return t
}

function SensorChip({ x, y, k, warn, rot = 0 }) {
  const c = warn ? '#f97316' : '#22d3ee'
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot + 90})`}>
      <rect x="-4.5" y="-3" width="9" height="6" rx=".7" fill="#9aa2ad" stroke={c} strokeWidth={0.4 + k * 0.7} />
      <rect x="-4.5" y="-3" width="9" height="6" rx=".7" fill={c} opacity={k * 0.5} />
      <line x1="-3.5" x2="3.5" y1="-1.1" y2="-1.1" stroke="#b45309" strokeWidth=".8" />
      <line x1="-3.5" x2="3.5" y1="1.1" y2="1.1" stroke="#b45309" strokeWidth=".8" />
      <circle r={5.5 + k * 3} fill="none" stroke={c} strokeOpacity={k * 0.7} strokeWidth=".5" />
    </g>
  )
}

const DAM_FOOT = 100
const DAM_S = [{ y: 46, n: 'D1' }, { y: 64, n: 'D2' }, { y: 84, n: 'D3' }]
const SLOPE_A = [150, 100], SLOPE_B = [204, 50]
const SLOPE_S = [{ u: 0.22, n: 'M1', w: 0.35 }, { u: 0.5, n: 'M2', w: 1 }, { u: 0.78, n: 'M3', w: 0.6 }]

function Dam() {
  const t = useSceneClock()
  const lvl = 36 + 5 * Math.sin(t * 0.7) // cao độ mặt nước (y)
  const P = DAM_S.map(s => Math.max(0, s.y - lvl) * 0.098 * 10) // kPa quy ước ~ 9.8 kPa / m, 1 đv = 1 m
  const pMax = (DAM_FOOT - 30) * 0.98
  const cyc = (t % 10) / 10 // mái dốc: dịch chuyển tăng dần rồi được gia cố, lặp lại
  const d = cyc < 0.8 ? cyc / 0.8 * 3.2 : 3.2 * (1 - (cyc - 0.8) / 0.2)
  const warn = d > 2.2
  const dx = -0.73 * d * 0.6, dy = 0.68 * d * 0.6 // dịch theo hướng xuống mái
  const nx = 0.68, ny = 0.73 // pháp tuyến vào trong đất
  const pt = u => [SLOPE_A[0] + (SLOPE_B[0] - SLOPE_A[0]) * u, SLOPE_A[1] + (SLOPE_B[1] - SLOPE_A[1]) * u]
  return (
    <svg viewBox="0 0 240 120" className="ah-svg" preserveAspectRatio="xMidYMid meet" aria-hidden="true"
      style={{ background: 'linear-gradient(#0f2a3d 50%, #0e3a52 50%)' }}>
      <rect width="240" height="120" fill="url(#ahSky)" />
      {/* ===== đập ===== */}
      <rect x="0" y={lvl} width="56" height={DAM_FOOT - lvl} fill="#0e3a52" />
      <clipPath id="ahDamClip"><rect width="56" height="120" /></clipPath>
      <path clipPath="url(#ahDamClip)" className="ah-wave" d={`M-40 ${lvl} q5 -2 10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0`} stroke="#7dd3fc" strokeOpacity=".7" fill="none" strokeWidth=".6" />
      {/* biểu đồ áp lực thủy tĩnh */}
      {[0, 1, 2, 3, 4, 5, 6].map(i => {
        const y = lvl + 4 + i * (DAM_FOOT - lvl - 6) / 6, L = (y - lvl) * 0.22
        return <g key={i}><line x1={55 - L} x2="55" y1={y} y2={y} stroke="#38bdf8" strokeWidth=".5" /><path d={`M55 ${y} l-1.6 -1 v2 z`} fill="#38bdf8" /></g>
      })}
      <line x1="55" y1={lvl} x2={55 - (DAM_FOOT - lvl) * 0.22} y2={DAM_FOOT - 1} stroke="#38bdf8" strokeOpacity=".5" strokeWidth=".4" />
      <polygon points={`56,28 70,28 112,${DAM_FOOT} 56,${DAM_FOOT}`} fill="#94a3b8" />
      <rect x="54" y="26" width="18" height="2.4" fill="#cbd5e1" />
      <rect x="0" y={DAM_FOOT} width="240" height="20" fill="#3f3a33" />
      {/* nước xả hạ lưu */}
      {/* cáp tín hiệu + trạm đo trên đỉnh đập */}
      <path d={`M62 ${DAM_S[2].y} V31`} stroke="#22d3ee" strokeWidth=".4" strokeDasharray="1 1" />
      <rect x="64" y="19" width="7" height="7" rx="1" fill="#1e293b" stroke="#22d3ee" strokeWidth=".4" />
      <line x1="67.5" x2="67.5" y1="19" y2="14" stroke="#94a3b8" strokeWidth=".5" /><circle cx="67.5" cy="13.4" r=".9" className="ah-blink" />
      {DAM_S.map((s, i) => (
        <g key={s.n}>
          <SensorChip x={62} y={s.y} k={P[i] / pMax} />
          <line x1="67" x2="86" y1={s.y} y2={s.y} stroke="#22d3ee" strokeWidth=".3" strokeDasharray="1 1" />
          <rect x="86" y={s.y - 3.6} width="30" height="7.2" rx="1.6" fill="#0b1220" stroke="#22d3ee" strokeWidth=".3" />
          <text x="88" y={s.y + 1.3} fontSize="3.3" fill="#e2e8f0">SSC-{s.n}</text>
          <text x="114" y={s.y + 1.3} fontSize="3.3" fill="#22d3ee" textAnchor="end">{P[i].toFixed(0)} kPa</text>
        </g>
      ))}
      <text x="4" y="8" fontSize="4" fontWeight="700" fill="#e2e8f0">Đập thủy điện</text>
      <text x="4" y="13" fontSize="3.2" fill="#94a3b8">SSC sát mặt thượng lưu, 3 cao độ</text>
      <text x="4" y={lvl - 2} fontSize="3" fill="#7dd3fc">▼ MNH</text>

      {/* ===== mái dốc ===== */}
      <line x1="128" x2="128" y1="6" y2="98" stroke="#1e293b" strokeWidth=".5" />
      <polygon points={`132,${DAM_FOOT} ${SLOPE_A[0]},${SLOPE_A[1]} ${SLOPE_B[0]},${SLOPE_B[1]} 240,50 240,${DAM_FOOT}`} fill="#78350f" />
      {/* khối trượt giữa mặt mái và mặt trượt */}
      <g transform={`translate(${dx} ${dy})`}>
        <path d={`M146 ${DAM_FOOT} L${SLOPE_A[0]} ${SLOPE_A[1]} L${SLOPE_B[0]} ${SLOPE_B[1]} L214 50 Q 206 96 146 ${DAM_FOOT} Z`} fill="#a16207" />
        {[[168, 84], [182, 72], [194, 62], [160, 94]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r=".9" fill="#78350f" />)}
      </g>
      <path d={`M146 ${DAM_FOOT} Q 206 96 214 50`} fill="none" stroke={warn ? '#f97316' : '#fbbf24'} strokeWidth=".6" strokeDasharray="2 1.5" />
      <text x="208" y="84" fontSize="3" fill={warn ? '#f97316' : '#fbbf24'}>mặt trượt</text>
      {/* cỏ */}
      <line x1={SLOPE_B[0]} x2="240" y1="50" y2="50" stroke="#4d7c0f" strokeWidth="1" />
      {SLOPE_S.map(s => {
        const [x, y] = pt(s.u), k = Math.min(1, d / 3.2 * s.w)
        const sx = x + nx * 6 + dx, sy = y + ny * 6 + dy
        const w = warn && s.w === 1
        return (
          <g key={s.n}>
            <SensorChip x={sx} y={sy} k={k} warn={w} rot={-43} />
            <line x1={sx} y1={sy} x2={sx - 16} y2={sy - 14} stroke={w ? '#f97316' : '#22d3ee'} strokeWidth=".3" strokeDasharray="1 1" />
            <rect x={sx - 34} y={sy - 18} width="18" height="6.6" rx="1.6" fill="#0b1220" stroke={w ? '#f97316' : '#22d3ee'} strokeWidth=".3" />
            <text x={sx - 25} y={sy - 13.6} fontSize="3.2" fill="#e2e8f0" textAnchor="middle">SSC-{s.n}</text>
          </g>
        )
      })}
      <text x="134" y="8" fontSize="4" fontWeight="700" fill="#e2e8f0">Mái dốc, đê</text>
      <text x="134" y="13" fontSize="3.2" fill="#94a3b8">SSC chôn dọc mái, vuông góc mặt dốc</text>
      <g transform="translate(176 20)">
        <rect width="60" height="20" rx="3" fill="#0b1220" opacity=".9" stroke={warn ? '#f97316' : '#1e293b'} strokeWidth=".5" />
        <text x="4" y="7" fontSize="3.3" fill="#94a3b8">Dịch chuyển mái</text>
        <text x="56" y="7" fontSize="3.6" fill="#e2e8f0" textAnchor="end">{(d * 4).toFixed(1)} mm</text>
        <rect x="4" y="10" width="52" height="2.6" rx="1" fill="#1e293b" />
        <rect x="4" y="10" width={52 * d / 3.2} height="2.6" rx="1" fill={warn ? '#f97316' : '#22d3ee'} />
        <text x="4" y="17.4" fontSize="3.2" fill={warn ? '#f97316' : '#4ade80'}>{warn ? '⚠ Cảnh báo trượt' : '● An toàn'}</text>
      </g>
    </svg>
  )
}

// Khung nhà 4 tầng, mỗi chân cột đặt 1 khối SSC trong móng (C1..C4).
// Chu kỳ 8 s: yên tĩnh → động đất (nền rung, tầng trên lắc mạnh hơn) → tắt dần.
const EQ_COLS = [36, 68, 100, 132]
const EQ_LV = [100, 82, 64, 46, 28]
const EQ_DEAD = [22, 34, 34, 22]
function eqEnv(t) {
  const c = t % 8
  if (c < 1 || c > 7) return 0
  return Math.sin(Math.PI * (c - 1) / 6) ** 2
}
const eqAcc = t => eqEnv(t) * (Math.sin(9 * t) + 0.5 * Math.sin(15.3 * t + 1))

function Buildings() {
  const t = useSceneClock()
  const env = eqEnv(t)
  const g = 1.6 * eqAcc(t) // nền rung
  const sway = j => g + env * 7 * Math.sin(5.2 * t - 0.4) * (j / 4) ** 1.2
  const sTop = env * 7 * Math.sin(5.2 * t - 0.4)
  const N = EQ_COLS.map((x, i) => EQ_DEAD[i] + 1.6 * sTop * (84 - x) / 48 * (i === 0 || i === 3 ? 1.6 : 0.6) + Math.abs(g) * 1.5)
  const warn = N.map((n, i) => n > EQ_DEAD[i] * 1.25)
  const quake = env > 0.05
  const trace = Array.from({ length: 90 }, (_, k) => {
    const tt = t - (89 - k) * 0.045
    return `${k * 0.82},${-eqAcc(tt) * 5}`
  }).join(' ')
  return (
    <svg viewBox="0 0 240 120" className="ah-svg" preserveAspectRatio="xMidYMid meet" aria-hidden="true"
      style={{ background: 'linear-gradient(#0f2a3d 50%, #3f3a33 50%)' }}>
      <rect width="240" height="120" fill="url(#ahSky)" />
      {/* sóng địa chấn */}
      {quake && [0, 1, 2].map(i => <circle key={i} cx="84" cy="128" r={((t * 18 + i * 14) % 42)} fill="none" stroke="#f97316" strokeOpacity={env * (1 - ((t * 18 + i * 14) % 42) / 42)} strokeWidth=".6" />)}
      <g transform={`translate(${g} 0)`}>
        <rect x="-10" y="100" width="260" height="20" fill="#3f3a33" />
        <rect x="-10" y="100" width="260" height="1" fill="#57534e" />
        {/* móng + khối SSC */}
        {EQ_COLS.map((x, i) => (
          <g key={x}>
            <rect x={x - 8} y="106" width="16" height="4" fill="#64748b" />
            <SensorChip x={x} y={103} k={Math.min(1, Math.max(0, (N[i] - 18) / 18))} warn={warn[i]} rot={-90} />
            <text x={x} y="116" fontSize="3.2" textAnchor="middle" fill={warn[i] ? '#f97316' : '#e2e8f0'}>C{i + 1}</text>
          </g>
        ))}
      </g>
      {/* khung nhà */}
      {EQ_LV.slice(1).map((y, j) => {
        const a = sway(j), b = sway(j + 1)
        return (
          <g key={y}>
            {EQ_COLS.slice(0, 3).map((x, i) => (
              <polygon key={x} points={`${x + 2 + a},${EQ_LV[j] - 1} ${x + 30 + a},${EQ_LV[j] - 1} ${x + 30 + b},${y + 2} ${x + 2 + b},${y + 2}`} fill="#1e3a5f" opacity=".55" />
            ))}
            {EQ_COLS.slice(0, 3).map((x, i) => (
              <rect key={'w' + x} x={x + 10 + (a + b) / 2} y={y + 6} width="12" height="7" fill="#93c5fd" opacity={(i + j) % 3 ? 0.25 : 0.55} />
            ))}
            {EQ_COLS.map(x => <line key={'c' + x} x1={x + a} y1={EQ_LV[j]} x2={x + b} y2={y} stroke="#cbd5e1" strokeWidth="2.2" />)}
            <rect x={32 + b} y={y - 1.5} width="104" height="3" fill="#94a3b8" />
          </g>
        )
      })}
      <text x="84" y="22" fontSize="3.4" textAnchor="middle" fill="#94a3b8">Nhà khung BTCT 4 tầng</text>
      {/* chú thích vị trí SSC */}
      <line x1="140" y1="103" x2="150" y2="94" stroke="#22d3ee" strokeWidth=".3" strokeDasharray="1 1" />
      <text x="151" y="93" fontSize="3.2" fill="#22d3ee">SSC trong móng, dưới mỗi chân cột</text>
      {/* bảng địa chấn + lực chân cột */}
      <g transform="translate(150 6)">
        <rect width="86" height="80" rx="3" fill="#0b1220" opacity=".9" stroke={quake ? '#f97316' : '#1e293b'} strokeWidth=".5" />
        <text x="4" y="7" fontSize="3.6" fontWeight="700" fill={quake ? '#f97316' : '#4ade80'}>{quake ? '⚠ Đang có động đất' : '● Bình thường'}</text>
        <text x="82" y="7" fontSize="3.2" fill="#94a3b8" textAnchor="end">{(env * 0.28).toFixed(2)} g</text>
        <rect x="4" y="10" width="78" height="18" rx="1.5" fill="#111c2b" />
        <polyline points={trace} transform="translate(5 19)" fill="none" stroke="#f97316" strokeWidth=".5" />
        <text x="4" y="35" fontSize="3.2" fill="#94a3b8">Lực dọc chân cột (tấn)</text>
        {N.map((n, i) => (
          <g key={i} transform={`translate(4 ${39 + i * 9.5})`}>
            <text y="3.6" fontSize="3.4" fill={warn[i] ? '#f97316' : '#cbd5e1'}>SSC-C{i + 1}</text>
            <rect x="20" width="44" height="4" rx="1" fill="#1e293b" />
            <rect x="20" width={44 * Math.min(1, n / 46)} height="4" rx="1" fill={warn[i] ? '#f97316' : '#22d3ee'} />
            <text x="78" y="3.6" fontSize="3.4" fill="#e2e8f0" textAnchor="end">{n.toFixed(1)}</text>
          </g>
        ))}
      </g>
    </svg>
  )
}

// Mặt bằng đường 4 làn nhìn từ trên. Một hàng khối SSC chôn ngang đường (mỗi làn 1 khối).
// Xe đè lên khối → khối sáng, đếm xe theo làn, phân loại xe con / xe tải theo lực ép.
const TR_LINE = 120
const TR_LANES = [
  { y: 48, dir: -1, v: 46, cars: [[0, 'car', '#e2e8f0'], [130, 'truck', '#f59e0b'], [210, 'car', '#60a5fa']] },
  { y: 64, dir: -1, v: 34, cars: [[40, 'bus', '#22c55e'], [190, 'car', '#f472b6']] },
  { y: 80, dir: 1, v: 40, cars: [[20, 'car', '#ef4444'], [110, 'car', '#e2e8f0'], [220, 'truck', '#a78bfa']] },
  { y: 96, dir: 1, v: 52, cars: [[70, 'car', '#fbbf24'], [180, 'car', '#38bdf8']] },
]
const TR_SPEC = { car: { len: 14, w: 7, t: 1.5 }, truck: { len: 26, w: 8, t: 14 }, bus: { len: 24, w: 8, t: 11 } }
const TR_LOOP = 300

function TopCar({ x, y, kind, color, dir }) {
  const s = TR_SPEC[kind], L = s.len, W = s.w
  return (
    <g transform={`translate(${x} ${y}) scale(${dir} 1)`}>
      <rect x={-L / 2 + .6} y={-W / 2 - .4} width={L - 1.2} height={W + .8} rx="1.6" fill="#000" opacity=".25" />
      {kind === 'truck' ? (
        <>
          <rect x={-L / 2} y={-W / 2} width={L - 7} height={W} rx=".8" fill="#e2e8f0" />
          <rect x={L / 2 - 6} y={-W / 2 + .5} width="6" height={W - 1} rx="1.2" fill={color} />
          <rect x={L / 2 - 2.4} y={-W / 2 + 1.2} width="1.6" height={W - 2.4} rx=".4" fill="#0f172a" opacity=".7" />
        </>
      ) : (
        <>
          <rect x={-L / 2} y={-W / 2} width={L} height={W} rx={kind === 'bus' ? 1 : 2.4} fill={color} />
          {kind === 'bus'
            ? <>{[-8, -4, 0, 4, 8].map(k => <rect key={k} x={k - 1.2} y={-W / 2 + 1} width="2.6" height={W - 2} fill="#0f172a" opacity=".35" />)}<rect x={L / 2 - 2.6} y={-W / 2 + 1} width="1.6" height={W - 2} fill="#0f172a" opacity=".7" /></>
            : <><rect x={L / 2 - 6} y={-W / 2 + .9} width="2.4" height={W - 1.8} rx=".6" fill="#0f172a" opacity=".75" />
              <rect x={-L / 2 + 1.6} y={-W / 2 + 1.1} width="1.8" height={W - 2.2} rx=".6" fill="#0f172a" opacity=".6" />
              <rect x={-L / 2 + 3.6} y={-W / 2 + 1} width={L - 10} height={W - 2} rx="1" fill="#fff" opacity=".18" /></>}
        </>
      )}
      <rect x={L / 2 - .8} y={-W / 2 + .6} width=".8" height="1.2" fill="#fde68a" />
      <rect x={L / 2 - .8} y={W / 2 - 1.8} width=".8" height="1.2" fill="#fde68a" />
    </g>
  )
}

function Traffic() {
  const t = useSceneClock()
  let nCar = 0, nTruck = 0
  const lanes = TR_LANES.map(l => {
    let hot = 0, cnt = 0
    const vs = l.cars.map(([off, kind, color]) => {
      const p = off + l.v * t
      const u = (p % TR_LOOP) - 30
      const x = l.dir > 0 ? u : 240 - u
      const passes = Math.max(0, Math.floor((p - (TR_LINE + 30)) / TR_LOOP) + 1)
      cnt += passes
      if (kind === 'car') nCar += passes; else nTruck += passes
      if (Math.abs(x - TR_LINE) < TR_SPEC[kind].len / 2) hot = Math.max(hot, TR_SPEC[kind].t)
      return { x, kind, color }
    })
    return { ...l, vs, hot, cnt }
  })
  const base = 1180
  const flow = base + (nCar + nTruck) * 3
  return (
    <svg viewBox="0 0 240 120" className="ah-svg" preserveAspectRatio="xMidYMid meet" aria-hidden="true"
      style={{ background: '#14532d' }}>
      <rect width="240" height="120" fill="#123d26" />
      {/* vỉa hè + đường */}
      <rect y="36" width="240" height="4" fill="#64748b" />
      <rect y="104" width="240" height="4" fill="#64748b" />
      <rect y="40" width="240" height="64" fill="#334155" />
      <line x1="0" x2="240" y1="71.4" y2="71.4" stroke="#fbbf24" strokeWidth=".6" />
      <line x1="0" x2="240" y1="72.6" y2="72.6" stroke="#fbbf24" strokeWidth=".6" />
      {[56, 88].map(y => <line key={y} x1="0" x2="240" y1={y} y2={y} stroke="#e5e7eb" strokeWidth=".6" strokeDasharray="6 5" />)}
      <path d="M8 48 l-4 0 m0 0 l2 -1.5 m-2 1.5 l2 1.5 M8 64 l-4 0 m0 0 l2 -1.5 m-2 1.5 l2 1.5" stroke="#94a3b8" strokeWidth=".5" fill="none" />
      <path d="M232 80 l4 0 m0 0 l-2 -1.5 m2 1.5 l-2 1.5 M232 96 l4 0 m0 0 l-2 -1.5 m2 1.5 l-2 1.5" stroke="#94a3b8" strokeWidth=".5" fill="none" />
      {/* hàng SSC chôn dưới mặt đường */}
      <rect x={TR_LINE - 5} y="40" width="10" height="64" fill="#0b1220" opacity=".35" />
      {lanes.map((l, i) => {
        const k = Math.min(1, l.hot / 10)
        return (
          <g key={i}>
            <rect x={TR_LINE - 3.5} y={l.y - 5.5} width="7" height="11" rx=".8" fill="#9aa2ad" stroke="#22d3ee" strokeWidth={0.4 + k * 0.8} strokeDasharray={l.hot ? '0' : '1 .6'} />
            <rect x={TR_LINE - 3.5} y={l.y - 5.5} width="7" height="11" rx=".8" fill="#22d3ee" opacity={k * 0.6} />
            <line x1={TR_LINE - 2.5} x2={TR_LINE + 2.5} y1={l.y - 2} y2={l.y - 2} stroke="#b45309" strokeWidth=".8" />
            <line x1={TR_LINE - 2.5} x2={TR_LINE + 2.5} y1={l.y + 2} y2={l.y + 2} stroke="#b45309" strokeWidth=".8" />
          </g>
        )
      })}
      {lanes.map((l, i) => l.vs.map((c, j) => <TopCar key={i + '-' + j} x={c.x} y={l.y} kind={c.kind} color={c.color} dir={l.dir} />))}
      {/* nhãn từng làn */}
      {lanes.map((l, i) => (
        <g key={'lb' + i}>
          <text x={TR_LINE + 6} y={l.y + 1.2} fontSize="3" fill={l.hot ? '#22d3ee' : '#94a3b8'}>L{i + 1}</text>
        </g>
      ))}
      <line x1={TR_LINE} x2={TR_LINE} y1="108" y2="109" stroke="#22d3ee" strokeWidth=".3" />
      <rect x={TR_LINE - 40} y="109" width="80" height="7" rx="2" fill="#0b1220" stroke="#22d3ee" strokeWidth=".3" />
      <text x={TR_LINE} y="113.8" fontSize="3.3" fill="#e2e8f0" textAnchor="middle">Hàng SSC chôn dưới mặt đường, mỗi làn 1 khối</text>
      {/* bảng thống kê */}
      <g transform="translate(4 3)">
        <rect width="232" height="30" rx="3" fill="#0b1220" opacity=".92" stroke="#1e293b" strokeWidth=".4" />
        <text x="5" y="8" fontSize="3.3" fill="#94a3b8">Lưu lượng</text>
        <text x="5" y="20" fontSize="9" fontWeight="700" fill="#fbbf24" fontFamily="ui-monospace,monospace">{flow.toLocaleString('vi-VN')}</text>
        <text x="5" y="26.5" fontSize="3" fill="#94a3b8">xe / giờ</text>
        <text x="60" y="8" fontSize="3.3" fill="#94a3b8">Phân loại theo tải</text>
        <text x="60" y="16" fontSize="3.6" fill="#e2e8f0">Xe con: <tspan fill="#22d3ee">{nCar}</tspan></text>
        <text x="60" y="23" fontSize="3.6" fill="#e2e8f0">Xe tải, buýt: <tspan fill="#f59e0b">{nTruck}</tspan></text>
        <text x="124" y="8" fontSize="3.3" fill="#94a3b8">Xe qua từng làn</text>
        {lanes.map((l, i) => (
          <g key={i} transform={`translate(${124 + i * 27} 12)`}>
            <rect width="24" height="14" rx="2" fill={l.hot ? '#0e3a52' : '#111c2b'} stroke={l.hot ? '#22d3ee' : '#1e293b'} strokeWidth=".4" />
            <text x="12" y="5.4" fontSize="3" fill="#94a3b8" textAnchor="middle">L{i + 1} {l.dir > 0 ? '→' : '←'}{l.hot ? <tspan fill="#fbbf24"> · {l.hot} t</tspan> : ''}</text>
            <text x="12" y="11.6" fontSize="4.6" fontWeight="700" fill="#e2e8f0" textAnchor="middle">{l.cnt}</text>
          </g>
        ))}
      </g>
    </svg>
  )
}

function Twin() {
  return (
    <svg viewBox="0 0 240 120" className="ah-svg" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="240" height="120" fill="#0b1220" />
      {[0, 1, 2].map(c => [0, 1].map(r => (
        <rect key={c + '' + r} x={10 + c * 74} y={8 + r * 40} width="68" height="34" rx="3" fill="#111c2b" stroke="#1e3a5f" />
      )))}
      <polyline className="ah-draw" points="14,36 24,28 34,32 44,20 54,26 64,16 74,22" fill="none" stroke="#22d3ee" strokeWidth="1.6" />
      <polyline className="ah-draw" points="88,36 98,34 108,22 118,28 128,18 138,24 148,14" fill="none" stroke="#fbbf24" strokeWidth="1.6" style={{ animationDelay: '.6s' }} />
      {[0, 1, 2, 3, 4].map(i => <rect key={i} x={164 + i * 12} y={40 - (i * 7) % 22 - 6} width="8" height={(i * 7) % 22 + 6} fill="#a78bfa" className="ah-bar" style={{ animationDelay: `${i * 0.15}s` }} />)}
      <g transform="translate(14 54)">
        <polygon points="30,4 54,16 30,28 6,16" fill="#64748b" /><polygon points="6,16 30,28 30,34 6,22" fill="#475569" /><polygon points="30,28 54,16 54,22 30,34" fill="#334155" />
        <rect x="22" y="-6" width="8" height="18" fill="#94a3b8" className="ah-blink" />
      </g>
      <path d="M88 60 h60 M88 68 h48 M88 76 h54" stroke="#334155" strokeWidth="3" />
      <circle cx="200" cy="66" r="9" className="ah-ring" />
      <circle cx="200" cy="66" r="3" fill="#22c55e" />
      <rect x="10" y="94" width="220" height="20" rx="3" fill="#111c2b" />
      <rect x="14" y="100" width="40" height="8" rx="2" fill="#22d3ee" className="ah-scan" />
    </svg>
  )
}

const APPS = [
  ['weigh', 'Cân xe khi đang chạy', 'Cụm 4 cục SSC chôn dọc làn xe dưới lớp móng. Xe chạy qua, từng trục ép lần lượt lên các cục, hệ thống đọc tải và cộng ra trọng lượng xe mà không cần dừng xe.', RoadScene, 12000],
  ['bridge', 'Giám sát sức khỏe công trình cầu đường', 'Khối SSC đặt tại gối cầu trên mố và trụ, đo lực truyền xuống khi xe chạy qua, phát hiện sớm lún, nứt hay quá tải.', Bridge],
  ['dam', 'Quan trắc đê điều, mái dốc', 'Khối SSC gắn sát mặt thượng lưu đập ở nhiều cao độ để đo áp lực nước, và chôn dọc mái dốc để phát hiện sớm khối đất bắt đầu trượt.', Dam],
  ['building', 'Quan trắc công trình dân dụng', 'Mỗi chân cột đặt một khối SSC trong móng. Khi động đất, hệ thống thấy ngay cột nào bị ép quá tải để cảnh báo và kiểm tra sau sự cố.', Buildings, 10000],
  ['traffic', 'Quản lý lưu lượng giao thông', 'Một hàng khối SSC chôn ngang đường, mỗi làn một khối. Xe đè qua là được đếm theo làn và phân loại xe con hay xe tải theo lực ép.', Traffic, 9000],
  ['twin', 'Bản sao số hạ tầng, đô thị', 'Dữ liệu từ hàng nghìn cục SSC đổ về mô hình số của cả thành phố.', Twin],
]

// tên ngắn cho hàng tab
const SHORT = { weigh: 'Cân xe', bridge: 'Cầu đường', dam: 'Đê điều, mái dốc', building: 'Dân dụng', traffic: 'Giao thông',
  twin: 'Bản sao số' }

const AUTO_MS = 6000 // cảnh cân xe dài hơn để xe kịp chạy qua cụm cục

export function AppsHub() {
  const [idx, setIdx] = useState(0)
  const [paused, setPaused] = useState(false)
  const [tick, setTick] = useState(0) // đổi mỗi lần chuyển slide để chạy lại thanh tiến trình
  const n = APPS.length
  const go = i => { setIdx(((i % n) + n) % n); setTick(t => t + 1) }

  useEffect(() => {
    if (paused) return
    const id = setTimeout(() => go(idx + 1), APPS[idx][4] || AUTO_MS)
    return () => clearTimeout(id)
  }, [idx, paused, tick])

  // cuộn hàng tab để tab đang chọn luôn nằm trong khung (không cuộn cả trang)
  const tabs = useRef(null)
  useEffect(() => {
    const ol = tabs.current, li = ol?.children[idx]
    if (ol && li) ol.scrollTo({ left: li.offsetLeft - (ol.clientWidth - li.clientWidth) / 2, behavior: 'smooth' })
  }, [idx])

  // vuốt ngang trên điện thoại
  const start = useRef(null)
  const onDown = e => { start.current = e.clientX }
  const onUp = e => {
    if (start.current == null) return
    const dx = e.clientX - start.current
    start.current = null
    if (Math.abs(dx) > 40) go(idx + (dx < 0 ? 1 : -1))
  }

  return (
    <div className="ah-wrap" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
        <defs>
          <linearGradient id="ahSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0f2a3d" /><stop offset="1" stopColor="#0b1520" /></linearGradient>
        </defs>
      </svg>

      <aside className="ah-side">
        <ol className="ah-tabs" ref={tabs}>
          {APPS.map(([key, title], i) => (
            <li key={key}>
              <button className={i === idx ? 'on' : ''} onClick={() => go(i)}>
                <span className="ah-num">{String(i + 1).padStart(2, '0')}</span>{SHORT[key] || title}
                {i === idx && <i key={tick} className={'ah-progress' + (paused ? ' paused' : '')} style={{ animationDuration: (APPS[i][4] || AUTO_MS) + 'ms' }} />}
              </button>
            </li>
          ))}
        </ol>
      </aside>

      <div className="ah-stage" onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={() => (start.current = null)}>
        <div className="ah-track" style={{ transform: `translateX(-${idx * 100}%)` }}>
          {APPS.map(([key, title, desc, Art, long], i) => (
            <section className={'ah-slide' + (i === idx ? ' on' : '') + (long ? ' wide' : '')} key={key} aria-hidden={i !== idx}>
              <div className="ah-art"><Art /></div>
              <div className="ah-text">
                <span className="ah-kicker">Ứng dụng {i + 1}/{n}</span>
                <h3>{title}</h3>
                <p>{desc}</p>
              </div>
            </section>
          ))}
        </div>
        <button className="ah-nav prev" aria-label="Ứng dụng trước" onClick={() => go(idx - 1)}>‹</button>
        <button className="ah-nav next" aria-label="Ứng dụng sau" onClick={() => go(idx + 1)}>›</button>
        <div className="ah-dots">
          {APPS.map(([key], i) => <button key={key} className={i === idx ? 'on' : ''} aria-label={`Ứng dụng ${i + 1}`} onClick={() => go(i)} />)}
        </div>
      </div>
    </div>
  )
}
