import { useEffect, useRef, useState } from 'react'
import { RoadScene } from './RoadScene'

// Sơ đồ ứng dụng: khối SSC + vi mạch + IoT + AI ở giữa, 7 lĩnh vực ứng dụng xung quanh.
// Mỗi lĩnh vực là một hình SVG nhỏ có hoạt ảnh CSS (lớp ah-* trong landing.css).

function Bridge() {
  return (
    <svg viewBox="0 0 240 120" className="ah-svg" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="240" height="120" fill="url(#ahSky)" />
      <rect y="86" width="240" height="34" fill="#0e3a52" />
      <path className="ah-wave" d="M0 92 q10 -4 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0" stroke="#38bdf8" strokeOpacity=".35" fill="none" />
      {[60, 180].map(x => <rect key={x} x={x - 4} y="22" width="8" height="66" rx="2" fill="#94a3b8" />)}
      <path d="M0 70 Q 60 22 120 70 Q 180 22 240 70" fill="none" stroke="#cbd5e1" strokeWidth="1.6" />
      {[20, 40, 80, 100, 140, 160, 200, 220].map(x => {
        const t = (x % 120) / 120 // dây võng bậc hai giữa hai trụ
        return <line key={x} x1={x} y1={70 - 96 * t + 96 * t * t} x2={x} y2="72" stroke="#94a3b8" strokeOpacity=".6" />
      })}
      <rect y="70" width="240" height="6" fill="#475569" />
      <g className="ah-car ah-car-a"><rect x="-24" y="63" width="18" height="8" rx="2" fill="#f59e0b" /></g>
      <g className="ah-car ah-car-b"><rect x="-24" y="63" width="14" height="8" rx="2" fill="#e2e8f0" /></g>
      {[40, 120, 200].map((x, i) => <circle key={x} cx={x} cy="76" r="3" className="ah-blink" style={{ animationDelay: `${i * 0.4}s` }} />)}
      <g className="ah-bob"><rect x="200" y="10" width="14" height="8" rx="1" fill="#cbd5e1" /><rect x="190" y="12" width="9" height="4" fill="#3b82f6" /><rect x="215" y="12" width="9" height="4" fill="#3b82f6" /></g>
      <path className="ah-beam" d="M206 20 L120 74" stroke="#22d3ee" strokeDasharray="3 5" />
    </svg>
  )
}

function Dam() {
  return (
    <svg viewBox="0 0 240 120" className="ah-svg" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="240" height="120" fill="url(#ahSky)" />
      <rect x="0" y="44" width="70" height="76" fill="#0e3a52" />
      <path className="ah-wave" d="M-40 46 q10 -4 20 0 t20 0 t20 0 t20 0 t20 0 t20 0" stroke="#7dd3fc" strokeOpacity=".7" fill="none" />
      <polygon points="66,30 100,30 120,120 66,120" fill="#94a3b8" />
      {[0, 1, 2].map(i => <rect key={i} x={72 + i * 9} y="34" width="6" height="12" fill="#64748b" />)}
      <g className="ah-fall">{[0, 1, 2, 3].map(i => <line key={i} x1={102 + i * 3} y1="46" x2={110 + i * 4} y2="104" stroke="#e0f2fe" strokeWidth="2" strokeDasharray="6 6" />)}</g>
      <rect x="100" y="104" width="140" height="16" fill="#0e3a52" />
      <polygon points="150,104 200,40 240,30 240,104" fill="#a16207" />
      <polygon points="170,104 205,60 240,52 240,104" fill="#78350f" opacity=".6" />
      <rect x="203" y="54" width="10" height="16" rx="2" fill="#cbd5e1" stroke="#22d3ee" />
      <circle cx="208" cy="62" r="6" className="ah-ring" />
      <circle cx="208" cy="62" r="6" className="ah-ring" style={{ animationDelay: '.9s' }} />
    </svg>
  )
}

function Buildings() {
  const B = [[20, 40, 40, 80], [70, 20, 46, 100], [126, 50, 36, 70], [172, 30, 50, 90]]
  return (
    <svg viewBox="0 0 240 120" className="ah-svg" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="240" height="120" fill="url(#ahSky)" />
      {B.map(([x, y, w, h], i) => (
        <g key={i}>
          <rect x={x} y={y} width={w} height={h} fill={i % 2 ? '#1e40af' : '#334155'} />
          {Array.from({ length: Math.floor(h / 12) }, (_, r) => Array.from({ length: Math.floor(w / 10) }, (_, c) => (
            <rect key={r + '-' + c} x={x + 3 + c * 10} y={y + 4 + r * 12} width="5" height="6"
              className={(r * 7 + c * 3 + i) % 5 === 0 ? 'ah-win' : ''} fill="#93c5fd" opacity=".35" style={{ animationDelay: `${(r + c) * 0.3}s` }} />
          )))}
        </g>
      ))}
      <rect y="116" width="240" height="4" fill="#475569" />
      {[40, 93, 197].map((x, i) => (
        <g key={x}>
          <rect x={x - 6} y="110" width="12" height="6" fill="#9aa2ad" stroke="#d97706" />
          <circle cx={x} cy="112" r="5" className="ah-ring" style={{ animationDelay: `${i * 0.5}s` }} />
        </g>
      ))}
    </svg>
  )
}

function Energy() {
  const Turbine = ({ x, s, d }) => (
    <g transform={`translate(${x} 40) scale(${s})`}>
      <polygon points="-2,0 2,0 4,70 -4,70" fill="#e2e8f0" />
      <g className="ah-spin" style={{ animationDuration: d }}>
        {[0, 120, 240].map(a => <path key={a} d="M0 0 L-3 -6 L0 -34 L3 -6 Z" fill="#f8fafc" transform={`rotate(${a})`} />)}
        <circle r="3" fill="#94a3b8" />
      </g>
    </g>
  )
  return (
    <svg viewBox="0 0 240 120" className="ah-svg" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="240" height="120" fill="url(#ahSky)" />
      <polygon points="120,120 180,60 240,80 240,120" fill="#92400e" opacity=".7" />
      <Turbine x={50} s={1} d="3s" />
      <Turbine x={100} s={0.75} d="2.4s" />
      <path d="M150 50 l10 70 M170 50 l-10 70 M146 60 h28 M150 76 h20" stroke="#94a3b8" strokeWidth="2" fill="none" />
      <path id="ahWire" d="M160 50 Q 200 70 240 56" stroke="#64748b" fill="none" />
      <circle r="3" fill="#fbbf24" className="ah-glow"><animateMotion dur="1.6s" repeatCount="indefinite" path="M160 50 Q 200 70 240 56" /></circle>
      <circle r="3" fill="#fbbf24" className="ah-glow"><animateMotion dur="1.6s" begin="-0.8s" repeatCount="indefinite" path="M160 50 Q 200 70 240 56" /></circle>
      <rect y="110" width="240" height="10" fill="#0e3a52" />
      <rect x="22" y="104" width="12" height="6" fill="#9aa2ad" stroke="#d97706" />
      <circle cx="28" cy="106" r="5" className="ah-ring" />
    </svg>
  )
}

function Traffic() {
  const [n, setN] = useState(1284)
  useEffect(() => {
    const id = setInterval(() => setN(v => v + 1 + (v % 3 === 0 ? 1 : 0)), 900)
    return () => clearInterval(id)
  }, [])
  return (
    <svg viewBox="0 0 240 120" className="ah-svg" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="240" height="120" fill="url(#ahSky)" />
      <polygon points="0,120 0,70 240,50 240,120" fill="#14532d" opacity=".5" />
      <polygon points="0,112 0,84 240,62 240,80" fill="#334155" />
      <path d="M0 98 L240 71" stroke="#e5e7eb" strokeDasharray="10 8" className="ah-lane" />
      <g className="ah-car ah-car-road"><rect x="-20" y="88" width="16" height="8" rx="2" fill="#f59e0b" /></g>
      <g className="ah-car ah-car-road2"><rect x="-20" y="98" width="20" height="9" rx="2" fill="#60a5fa" /></g>
      <g className="ah-car ah-car-road3"><rect x="-20" y="80" width="12" height="7" rx="2" fill="#e2e8f0" /></g>
      {[60, 150].map((x, i) => <rect key={x} x={x - 7} y={i ? 72 : 82} width="14" height="4" fill="#22d3ee" className="ah-blink" style={{ animationDelay: `${i * 0.5}s` }} />)}
      <rect x="150" y="8" width="82" height="30" rx="6" fill="#0b1118" stroke="#22d3ee" strokeOpacity=".6" />
      <text x="191" y="20" textAnchor="middle" fontSize="8" fill="#93a1b2">xe / giờ</text>
      <text x="191" y="33" textAnchor="middle" fontSize="12" fontWeight="700" fill="#fbbf24" fontFamily="ui-monospace,monospace">{n.toLocaleString('vi-VN')}</text>
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

function Warning() {
  return (
    <svg viewBox="0 0 240 120" className="ah-svg" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="240" height="120" fill="url(#ahStorm)" />
      <g className="ah-rain">{Array.from({ length: 18 }, (_, i) => <line key={i} x1={i * 14} y1={(i * 13) % 40} x2={i * 14 - 4} y2={(i * 13) % 40 + 10} stroke="#93c5fd" strokeOpacity=".5" />)}</g>
      <path d="M150 40 l6 -20 l6 30 l6 -16 l6 26" stroke="#94a3b8" fill="none" strokeWidth="2" />
      <polygon points="40,62 75,36 110,62" fill="#c2410c" />
      <rect x="48" y="62" width="54" height="34" fill="#f1f5f9" />
      <rect x="70" y="74" width="12" height="22" fill="#475569" />
      <g className="ah-flood">
        <rect x="0" y="94" width="240" height="30" fill="#0e7490" opacity=".75" />
        <path className="ah-wave" d="M-40 94 q10 -5 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0" stroke="#a5f3fc" fill="none" />
      </g>
      <g className="ah-alert">
        <polygon points="190,52 212,90 168,90" fill="#f59e0b" stroke="#fde68a" />
        <rect x="188" y="64" width="4" height="14" fill="#0b0f14" /><rect x="188" y="81" width="4" height="4" fill="#0b0f14" />
      </g>
      <g className="ah-alert" style={{ animationDelay: '.5s' }}>
        <polygon points="128,30 142,54 114,54" fill="#f59e0b" />
        <rect x="126" y="38" width="3" height="9" fill="#0b0f14" />
      </g>
    </svg>
  )
}

const APPS = [
  ['weigh', 'Cân xe khi đang chạy', 'Cụm 4 cục SSC chôn dọc làn xe dưới lớp móng. Xe chạy qua, từng trục ép lần lượt lên các cục, hệ thống đọc tải và cộng ra trọng lượng xe mà không cần dừng xe.', RoadScene, 12000],
  ['bridge', 'Giám sát sức khỏe công trình cầu đường', 'Theo dõi ứng suất mặt cầu, trụ cầu khi xe chạy qua, phát hiện sớm hư hỏng.', Bridge],
  ['dam', 'Quan trắc đê điều, mái dốc', 'Cảm nhận áp lực nước và dịch chuyển mái dốc theo thời gian thực.', Dam],
  ['building', 'Quan trắc công trình dân dụng', 'Cột, dầm, sàn tự báo tải trọng và biến dạng trong suốt vòng đời công trình.', Buildings],
  ['traffic', 'Quản lý lưu lượng giao thông', 'Đếm xe, đo tải trục và cân xe khi đang chạy ngay dưới mặt đường.', Traffic],
  ['energy', 'Hạ tầng năng lượng', 'Móng tua-bin gió, trụ điện, trạm biến áp được giám sát liên tục.', Energy],
  ['twin', 'Bản sao số hạ tầng, đô thị', 'Dữ liệu từ hàng nghìn cục SSC đổ về mô hình số của cả thành phố.', Twin],
  ['warn', 'Cảnh báo sớm thiên tai', 'Đánh giá rủi ro hạ tầng khi bão, lũ, sạt lở và gửi cảnh báo kịp thời.', Warning],
]

// tên ngắn cho hàng tab
const SHORT = { weigh: 'Cân xe', bridge: 'Cầu đường', dam: 'Đê điều, mái dốc', building: 'Dân dụng', traffic: 'Giao thông',
  energy: 'Năng lượng', twin: 'Bản sao số', warn: 'Cảnh báo thiên tai' }

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
          <linearGradient id="ahStorm" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1e293b" /><stop offset="1" stopColor="#0f172a" /></linearGradient>
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
