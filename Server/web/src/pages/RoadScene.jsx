import { t as tr } from '../i18n'
import { useEffect, useState } from 'react'

// Cục SSC chôn dưới mặt đường: xe tải chạy qua, mỗi trục ép lên cục một lần,
// tín hiệu tăng rồi giảm, cộng các trục lại ra tổng trọng lượng xe (cân động).
// Số liệu minh họa, không phải dữ liệu đo.

const CYCLE = 10          // giây mỗi lượt xe
const SPEED = 150         // px/giây
const START = -280        // vị trí đuôi xe lúc bắt đầu lượt
const CUBES = [260, 420, 580, 740] // tâm các cục SSC trong cụm, chôn dọc làn xe
const CUBE_X = CUBES[0]   // cục đầu tiên xe gặp
const LAST_X = CUBES[CUBES.length - 1]
const SPREAD = 42         // độ loang tải qua các lớp áo đường (px)
const ROAD_Y = 150
const AXLES = [40, 74, 222] // vị trí trục tính từ đuôi xe (2 trục sau + trục trước)

const TRUCKS = [
  { name: 'Xe tải 3 trục', cab: '#f59e0b', box: '#e2e8f0', w: [9.6, 9.4, 6.2] },
  { name: 'Xe tải nhẹ', cab: '#38bdf8', box: '#cbd5e1', w: [6.8, 6.6, 5.1] },
  { name: 'Xe tải nặng', cab: '#ef4444', box: '#f1f5f9', w: [11.8, 11.5, 7.0] },
]

const fmt = v => v.toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

function useRoadClock() {
  const [t, setT] = useState(0)
  useEffect(() => {
    // Máy tắt hiệu ứng: xe vẫn chạy nhưng chậm một nửa
    const speed = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.5 : 1
    let id
    const t0 = performance.now()
    const tick = now => { setT((Math.max(0, now - t0) / 1000) * speed); id = requestAnimationFrame(tick) }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [])
  return t
}

function Truck({ x, spec, spin }) {
  return (
    <g transform={`translate(${x} ${ROAD_Y})`}>
      {/* thùng */}
      <rect x="0" y="-98" width="178" height="64" rx="4" fill={spec.box} />
      <rect x="0" y="-98" width="178" height="64" rx="4" fill="none" stroke="#94a3b8" strokeOpacity=".5" />
      {[30, 60, 90, 120, 150].map(sx => <line key={sx} x1={sx} y1="-94" x2={sx} y2="-38" stroke="#94a3b8" strokeOpacity=".35" />)}
      {/* khung gầm */}
      <rect x="-4" y="-34" width="258" height="9" rx="2" fill="#334155" />
      {/* cabin */}
      <path d="M184 -34 V -80 q0 -6 6 -6 h30 q8 0 12 8 l14 26 h6 q6 0 6 6 V -34 Z" fill={spec.cab} />
      <path d="M214 -80 h8 q4 0 6 4 l11 21 h-25 Z" fill="#0f172a" opacity=".85" />
      <path d="M216 -77 h5 l9 18 h-14 Z" fill="#22d3ee" opacity=".25" />
      <circle cx="255" cy="-44" r="3.2" fill="#fde68a" />
      <path d="M258 -44 l60 -10 v20 Z" fill="#fde68a" opacity=".12" />
      {/* bánh xe */}
      {AXLES.map(ax => (
        <g key={ax} transform={`translate(${ax} -15) rotate(${spin})`}>
          <circle r="15" fill="#111827" stroke="#374151" strokeWidth="2" />
          <circle r="6" fill="#6b7280" />
          <line x1="-10" y1="0" x2="10" y2="0" stroke="#9ca3af" strokeWidth="2" />
          <line x1="0" y1="-10" x2="0" y2="10" stroke="#9ca3af" strokeWidth="2" />
        </g>
      ))}
    </g>
  )
}

export function RoadScene() {
  const t = useRoadClock()
  const lap = Math.floor(t / CYCLE)
  const spec = TRUCKS[lap % TRUCKS.length]
  const p = t - lap * CYCLE
  const x = START + p * SPEED
  const axX = AXLES.map(a => x + a)
  const noise = 0.08 * Math.sin(t * 31) + 0.05 * Math.sin(t * 73)
  // ảnh hưởng của từng trục lên từng cục, tải trên từng cục
  const inflOf = cx => axX.map(a => Math.exp(-(((a - cx) / SPREAD) ** 2)))
  const cubes = CUBES.map((cx, j) => {
    const infl = inflOf(cx)
    const l = Math.max(0, infl.reduce((s, k, i) => s + k * spec.w[i], 0) + (infl.some(k => k > 0.02) ? noise * (1 + 0.3 * j) : 0))
    return { cx, infl, load: l, level: Math.min(1, l / 12) }
  })
  const hot = cubes.reduce((a, c, j) => (c.load > cubes[a].load ? j : a), 0)
  const load = cubes[hot].load
  const level = cubes[hot].level
  const maxW = Math.max(...spec.w)
  // trục đã đi qua cục đầu: có số đọc đầu tiên; qua hết cụm: lấy trung bình 4 cục, cân xong
  const done = [2, 1, 0].filter(i => axX[i] > CUBE_X + 2.2 * SPREAD)
  const total = done.reduce((s, i) => s + spec.w[i], 0)
  const read = CUBES.filter(cx => axX[0] > cx + 2.2 * SPREAD).length
  const finished = read === CUBES.length

  return (
    <div className="road-card">
      <svg viewBox="0 0 1000 380" className="road-svg" role="img"
        aria-label={tr('Mặt cắt đường có cục bê tông tự cảm biến chôn bên dưới, xe tải chạy qua và tín hiệu tải trọng gửi về trạm')}>
        <defs>
          <linearGradient id="rdSoil" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3b2f25" /><stop offset="1" stopColor="#1c1510" />
          </linearGradient>
          <pattern id="rdGravel" width="18" height="12" patternUnits="userSpaceOnUse">
            <circle cx="4" cy="4" r="2.2" fill="#9ca3af" opacity=".35" /><circle cx="13" cy="8" r="1.6" fill="#d1d5db" opacity=".25" />
          </pattern>
          <pattern id="rdAsphalt" width="10" height="10" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="3" r=".8" fill="#ffffff" opacity=".08" /><circle cx="7" cy="7" r=".7" fill="#000" opacity=".3" />
          </pattern>
          <radialGradient id="rdBulb">
            <stop offset="0" stopColor="#fbbf24" stopOpacity=".7" /><stop offset="1" stopColor="#fbbf24" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="rdCube" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#9aa2ad" /><stop offset="1" stopColor="#5d6570" />
          </linearGradient>
        </defs>

        {/* các lớp kết cấu */}
        <rect x="0" y={ROAD_Y + 36} width="1000" height="194" fill="url(#rdSoil)" />
        <rect x="0" y={ROAD_Y + 36} width="1000" height="44" fill="#4b5563" />
        <rect x="0" y={ROAD_Y + 36} width="1000" height="44" fill="url(#rdGravel)" />
        <rect x="0" y={ROAD_Y} width="1000" height="36" fill="#1f2937" />
        <rect x="0" y={ROAD_Y} width="1000" height="36" fill="url(#rdAsphalt)" />
        <line x1="0" y1={ROAD_Y} x2="1000" y2={ROAD_Y} stroke="#64748b" strokeWidth="2" />
        <text x="14" y={ROAD_Y + 23} className="rd-label">{tr('Bê tông nhựa')}</text>
        <text x="14" y={ROAD_Y + 63} className="rd-label">{tr('Móng cấp phối')}</text>
        <text x="14" y={ROAD_Y + 140} className="rd-label">{tr('Nền đất')}</text>

        {cubes.map((c, j) => (
          <g key={c.cx}>
            {/* vùng ứng suất lan xuống cục */}
            <ellipse cx={c.cx} cy={ROAD_Y + 70} rx={50 + 34 * c.level} ry={44 + 26 * c.level} fill="url(#rdBulb)" opacity={c.level} />
            {axX.map((a, i) => c.infl[i] > 0.05 && (
              <g key={i} opacity={c.infl[i]} className="rd-cone">
                <line x1={a - 6} y1={ROAD_Y} x2={c.cx - 30} y2={ROAD_Y + 92} />
                <line x1={a + 6} y1={ROAD_Y} x2={c.cx + 30} y2={ROAD_Y + 92} />
              </g>
            ))}
            {/* cục SSC chôn trong móng */}
            <g transform={`translate(0 ${1.5 * c.level})`}>
              <rect x={c.cx - 30} y={ROAD_Y + 92} width="60" height="52" rx="3" fill="url(#rdCube)" />
              <rect x={c.cx - 30} y={ROAD_Y + 92} width="60" height="52" rx="3" fill="#22d3ee" opacity={0.08 + 0.45 * c.level} />
              {/* hai điện cực nằm ngang trên và dưới, dòng điện đi theo phương tải */}
              <line x1={c.cx - 24} y1={ROAD_Y + 102} x2={c.cx + 24} y2={ROAD_Y + 102} className="rd-electrode" />
              <line x1={c.cx - 24} y1={ROAD_Y + 134} x2={c.cx + 24} y2={ROAD_Y + 134} className="rd-electrode" />
            </g>
            <text x={c.cx} y={ROAD_Y + 164} textAnchor="middle" className={'rd-label' + (j === hot && c.level > 0.05 ? ' strong' : '')}>
              R-0{j + 1}
            </text>
          </g>
        ))}
        <text x={CUBE_X - 50} y={ROAD_Y + 122} textAnchor="end" className="rd-label strong">{tr('Cụm SSC')}</text>

        {/* cáp về tủ bên lề đường */}
        <path className="lp-wire" d={`M${CUBE_X} ${ROAD_Y + 170} V ${ROAD_Y + 182} H 905 V ${ROAD_Y + 2}`} />
        {CUBES.slice(1).map(cx => <path key={cx} className="lp-wire" d={`M${cx} ${ROAD_Y + 170} V ${ROAD_Y + 182}`} />)}
        <g transform={`translate(880 ${ROAD_Y - 64})`}>
          <rect x="0" y="0" width="50" height="62" rx="5" fill="#0f172a" stroke="#22d3ee" strokeOpacity=".7" />
          <circle className="lp-led" cx="38" cy="12" r="4" />
          <text x="8" y="50" fill="#94a3b8" fontSize="10" fontFamily="ui-monospace,monospace">IoT node</text>
          <g className="lp-wifi" fill="none" stroke="#22d3ee" strokeWidth="2.4" strokeLinecap="round">
            <path d="M14 -10 a16 16 0 0 1 22 0" />
            <path d="M8 -18 a26 26 0 0 1 34 0" />
            <path d="M2 -26 a36 36 0 0 1 46 0" />
          </g>
        </g>

        <Truck x={x} spec={spec} spin={(x / 15) * (180 / Math.PI)} />

        {/* bảng điện tử bên đường */}
        <g transform={`translate(${CUBES[hot] - 80} 2)`}>
          <rect width="160" height="46" rx="8" fill="#0b1118" stroke={level > 0.05 ? '#fbbf24' : '#334155'} />
          <text x="80" y="18" textAnchor="middle" fill="#94a3b8" fontSize="11">{tr('Tải trên cục')} R-0{hot + 1}</text>
          <text x="80" y="38" textAnchor="middle" fill="#fbbf24" fontSize="17" fontWeight="700" fontFamily="ui-monospace,monospace">
            {fmt(load)} {tr('tấn')}
          </text>
        </g>
      </svg>

      <div className="road-read">
        <div className="road-meter">
          <small>{tr('Tải tức thời')}</small>
          <b className="mono">{fmt(load)} t <span>· {fmt(load * 9.81)} kN</span></b>
          <div className="road-bar"><i style={{ width: `${Math.min(100, (load / maxW) * 100)}%` }} /></div>
        </div>
        <div className="road-axles">
          <small>{tr(spec.name)} · {tr('tải từng trục · đã qua {a}/{b} cục', { a: read, b: CUBES.length })}</small>
          <div>
            {[2, 1, 0].map((i, k) => (
              <span key={i} className={'axle' + (done.includes(i) ? ' on' : '')}>
                {tr('Trục')} {k + 1}: <b className="mono">{done.includes(i) ? `${fmt(spec.w[i])} t` : '…'}</b>
              </span>
            ))}
          </div>
        </div>
        <div className={'road-total' + (finished ? ' on' : '')}>
          <small>{tr('Trọng lượng xe')}</small>
          <b className="mono">{done.length ? `${fmt(total)} ${tr('tấn')}` : '—'}</b>
          <span>{finished ? tr('Trung bình 4 cục, đã gửi về server') : done.length ? tr('Đang đọc qua cụm cục…') : tr('Chờ xe tới')}</span>
        </div>
      </div>
      <p className="road-note">{tr('Hình minh họa. Mỗi trục xe ép lần lượt lên từng cục trong cụm, tín hiệu điện trở tăng giảm theo tải; cộng các trục lại và lấy trung bình nhiều cục ra trọng lượng xe chính xác hơn, không cần dừng xe.')}</p>
    </div>
  )
}
