import { useEffect, useRef, useState } from 'react'
import { api, auth } from '../api'
import './landing.css'

// Load cycle shared by the animated block and the signal trace (period 6 s).
const PERIOD = 6
const loadAt = t => 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / PERIOD) // 0..1

// Fixed pseudo-random fibre network inside the block (deterministic).
const FIBRES = Array.from({ length: 26 }, (_, i) => {
  const r = k => (Math.sin(i * 12.9898 + k * 78.233) * 43758.5453) % 1
  const a = Math.abs
  const x = 70 + a(r(1)) * 220, y = 150 + a(r(2)) * 120
  const ang = a(r(3)) * Math.PI, len = 26 + a(r(4)) * 30
  return { x1: x, y1: y, x2: x + Math.cos(ang) * len, y2: y + Math.sin(ang) * len * 0.6, d: a(r(5)) * 3 }
})

function useClock() {
  const [t, setT] = useState(0)
  useEffect(() => {
    let id, t0 = performance.now()
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    const tick = now => { setT((now - t0) / 1000); id = requestAnimationFrame(tick) }
    if (!reduce) id = requestAnimationFrame(tick)
    else setT(PERIOD / 2)
    return () => cancelAnimationFrame(id)
  }, [])
  return t
}

function BlockScene({ t }) {
  const L = loadAt(t)
  const press = 18 * L // plate travel (px)
  return (
    <svg viewBox="0 0 360 318" className="scene" role="img" aria-label="Cục bê tông tự cảm biến chịu lực nén và phát tín hiệu điện">
      <defs>
        <linearGradient id="top" x1="0" x2="1"><stop offset="0" stopColor="#8a929c" /><stop offset="1" stopColor="#6c737c" /></linearGradient>
        <linearGradient id="front" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#5b626b" /><stop offset="1" stopColor="#3d434a" /></linearGradient>
        <linearGradient id="side" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#4a5057" /><stop offset="1" stopColor="#30353b" /></linearGradient>
        <filter id="glow"><feGaussianBlur stdDeviation="2.2" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        <clipPath id="blockclip"><polygon points="60,112 180,76 320,112 320,264 200,300 60,264" /></clipPath>
        <pattern id="speckle" width="14" height="14" patternUnits="userSpaceOnUse">
          <circle cx="3" cy="4" r="0.9" fill="#ffffff22" /><circle cx="10" cy="9" r="0.7" fill="#00000033" /><circle cx="6" cy="12" r="0.6" fill="#ffffff18" />
        </pattern>
      </defs>

      {/* Force arrow + press plate */}
      <g transform={`translate(0 ${press})`}>
        <g className="arrow" opacity={0.35 + 0.65 * L}>
          <line x1="180" y1="8" x2="180" y2="58" stroke="#ffb020" strokeWidth="5" strokeLinecap="round" />
          <path d="M166 50 L180 72 L194 50 Z" fill="#ffb020" />
          <text x="200" y="34" fill="#ffb020" fontSize="18" fontWeight="700">F</text>
        </g>
        <polygon points="60,92 180,56 320,92 200,128" fill="#c9ced4" opacity="0.9" />
        <polygon points="60,92 200,128 200,138 60,102" fill="#9aa1a9" />
        <polygon points="200,128 320,92 320,102 200,138" fill="#7d848c" />
      </g>

      {/* Concrete block (slightly squashed with load) */}
      <g transform={`translate(0 ${140 + press * 0.15}) scale(1 ${1 - 0.02 * L}) translate(0 -140)`}>
        <polygon points="60,112 180,76 320,112 200,148" fill="url(#top)" />
        <polygon points="60,112 200,148 200,300 60,264" fill="url(#front)" />
        <polygon points="200,148 320,112 320,264 200,300" fill="url(#side)" />
        <polygon points="60,112 200,148 200,300 60,264" fill="url(#speckle)" />
        <polygon points="200,148 320,112 320,264 200,300" fill="url(#speckle)" />

        {/* Carbon fibre network: glows brighter as compression closes the contacts */}
        <g filter="url(#glow)" clipPath="url(#blockclip)">
          {FIBRES.map((f, i) => {
            const pulse = 0.5 + 0.5 * Math.sin(t * 4 + f.d * 2)
            return <line key={i} x1={f.x1} y1={f.y1} x2={f.x2} y2={f.y2}
              stroke="#22d3ee" strokeWidth="1.6" strokeLinecap="round" opacity={0.25 + 0.55 * L * pulse + 0.15 * pulse} />
          })}
        </g>

        {/* Copper electrodes */}
        <polygon points="88,101 94,103 94,272 88,270" fill="#d98a4a" />
        <polygon points="166,121 172,123 172,292 166,290" fill="#d98a4a" />
      </g>

      {/* Wires to the node */}
      <path d="M91 101 C 80 50, 30 50, 22 118" stroke="#d98a4a" strokeWidth="2" fill="none" />
      <path d="M169 121 C 160 40, 50 20, 30 118" stroke="#d98a4a" strokeWidth="2" fill="none" />
      <g className="node">
        <rect x="6" y="118" width="40" height="26" rx="4" fill="#0f2a33" stroke="#22d3ee" strokeWidth="1.2" />
        <text x="26" y="135" textAnchor="middle" fontSize="9" fill="#22d3ee" fontWeight="700">IoT</text>
      </g>
      {[0, 1, 2].map(k => (
        <circle key={k} r="3" fill="#22d3ee" filter="url(#glow)">
          <animateMotion dur="1.6s" repeatCount="indefinite" begin={`${k * 0.53}s`} path="M91 101 C 80 50, 30 50, 22 118" />
        </circle>
      ))}
    </svg>
  )
}

function SignalTrace({ t }) {
  // ρ falls under compression (piezoresistive), with small measurement noise.
  const W = 520, H = 150, N = 160, span = 8
  const pts = []
  for (let i = 0; i < N; i++) {
    const tt = t - span + (span * i) / (N - 1)
    const rho = 1 - 0.62 * loadAt(tt) + 0.03 * Math.sin(tt * 37) + 0.02 * Math.sin(tt * 91)
    pts.push(`${(W * i) / (N - 1)},${14 + (H - 28) * (1 - rho * 0.92)}`)
  }
  const L = loadAt(t)
  return (
    <div className="trace">
      <div className="trace-head">
        <span><i className="live" /> Tín hiệu minh họa · 100 mẫu/giây</span>
        <span className="mono">σ = {(L * 16).toFixed(2)} MPa · F = {(L * 40).toFixed(1)} kN</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        {[0.25, 0.5, 0.75].map(g => <line key={g} x1="0" x2={W} y1={H * g} y2={H * g} className="gridline" />)}
        <polyline points={pts.join(' ')} className="wave-glow" />
        <polyline points={pts.join(' ')} className="wave" />
      </svg>
      <div className="trace-foot mono"><span>ρ (Ω·m)</span><span>8 giây gần nhất</span></div>
    </div>
  )
}

function SystemStatus() {
  // Real status from the public health endpoint (no login needed).
  const [h, setH] = useState(null)
  useEffect(() => {
    let stop = false
    const load = () => fetch('/api/health').then(r => r.json()).then(d => !stop && setH(d)).catch(() => !stop && setH(false))
    load()
    const id = setInterval(load, 5000)
    return () => { stop = true; clearInterval(id) }
  }, [])
  if (h === null) return null
  const ok = h && h.ok
  return (
    <div className={'sys ' + (ok ? 'up' : 'down')}>
      <i />
      {ok ? <>Hệ thống đang hoạt động · MQTT {h.mqtt ? 'đã kết nối' : 'mất kết nối'} · {Number(h.packets || 0).toLocaleString('vi-VN')} gói dữ liệu đã nhận</>
        : 'Không kết nối được máy chủ'}
    </div>
  )
}

function LoginPanel({ onClose }) {
  const [u, setU] = useState('')
  const [p, setP] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef(null)
  useEffect(() => { ref.current?.focus() }, [])
  const submit = async e => {
    e.preventDefault()
    setErr(''); setBusy(true)
    try {
      const res = await api('/login', { method: 'POST', body: { username: u, password: p } })
      auth.save(res)
      location.hash = '#/'
      location.reload()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="modal" onClick={e => e.target === e.currentTarget && onClose()}>
      <form className="login-box" onSubmit={submit}>
        <button type="button" className="close" onClick={onClose} aria-label="Đóng">×</button>
        <h2>Đăng nhập</h2>
        <p>Vào hệ thống giám sát SSC</p>
        <label>Tên đăng nhập<input ref={ref} value={u} onChange={e => setU(e.target.value)} autoComplete="username" /></label>
        <label>Mật khẩu<input type="password" value={p} onChange={e => setP(e.target.value)} autoComplete="current-password" /></label>
        {err && <div className="err">{err}</div>}
        <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Đang đăng nhập…' : 'Đăng nhập'}</button>
      </form>
    </div>
  )
}

const STEPS = [
  ['01', 'Cục SSC', 'Bê tông pha sợi carbon. Khi chịu nén, mạng sợi dẫn điện khít lại và điện trở suất ρ thay đổi.'],
  ['02', 'Node IoT', 'ESP32-S3 với ADC 24-bit ADS1256 đọc điện áp hai đầu điện cực 100 lần mỗi giây, gửi qua Wi-Fi.'],
  ['03', 'Server và AI', 'Tính ρ, bù nhiệt độ và độ ẩm, áp mô hình hiệu chuẩn riêng của từng cục để ra ứng suất và tải.'],
  ['04', 'Web giám sát', 'Xem trực tiếp từng cục, hiệu chuẩn trên máy nén, quản lý thiết bị và xuất dữ liệu.'],
]

const FEATURES = [
  ['Hiệu chuẩn từng cục', 'Mỗi cục có hệ số K riêng, ghi từng bậc tải trên máy nén ngay trên web, có phiên bản và người duyệt.'],
  ['Bù môi trường', 'Mô hình điện trở suất ban đầu theo nhiệt độ và độ ẩm giúp tín hiệu ổn định khi thời tiết thay đổi.'],
  ['Dữ liệu cho AI', 'Lưu đủ 100 mẫu/giây trên TimescaleDB, xuất CSV và Parquet, sẵn sàng cho học máy.'],
  ['Nhiều gối, một sàn', 'Tổng tín hiệu của nhiều gối SSC tuyến tính với tải trên cả tấm sàn, sai số dưới 10% trong thí nghiệm.'],
]

export default function Landing({ openLogin = false }) {
  const t = useClock()
  const [login, setLogin] = useState(openLogin)
  useEffect(() => setLogin(openLogin), [openLogin])
  const L = loadAt(t)

  return (
    <div className="landing">
      <nav className="lnav">
        <a className="brand" href="#/"><span className="logo" />SSC Monitor</a>
        <div className="lnav-links">
          <a href="#how">Cách hoạt động</a>
          <a href="#features">Tính năng</a>
          <button className="btn ghost" onClick={() => setLogin(true)}>Đăng nhập</button>
        </div>
      </nav>

      <section className="hero">
        <div className="hero-text">
          <span className="eyebrow">Bê tông tự cảm biến · Self-sensing concrete</span>
          <h1>Bê tông <em>cảm nhận</em> được lực tác động</h1>
          <p>
            Mỗi cục bê tông là một cảm biến. Hệ thống đọc tín hiệu điện của từng cục, hiệu chuẩn bằng AI
            và cho anh/chị theo dõi tải trọng kết cấu theo thời gian thực.
          </p>
          <div className="cta">
            <button className="btn primary" onClick={() => setLogin(true)}>Vào hệ thống giám sát</button>
            <a className="btn ghost" href="#how">Tìm hiểu cách hoạt động</a>
          </div>
          <SystemStatus />
          <div className="kpis">
            <div><b>100</b><span>mẫu/giây mỗi cục</span></div>
            <div><b>24-bit</b><span>độ phân giải ADC</span></div>
            <div><b>R² &gt; 0.9</b><span>mô hình hiệu chuẩn</span></div>
          </div>
        </div>
        <div className="hero-visual">
          <div className="glow-bg" style={{ opacity: 0.35 + 0.4 * L }} />
          <BlockScene t={t} />
          <SignalTrace t={t} />
        </div>
      </section>

      <section id="how" className="how">
        <h2>Từ lực nén đến số liệu trên màn hình</h2>
        <div className="steps">
          {STEPS.map(([n, h, d], i) => (
            <div className="step" key={n}>
              <span className="num">{n}</span>
              <h3>{h}</h3>
              <p>{d}</p>
              {i < STEPS.length - 1 && <span className="flow" aria-hidden="true"><i /></span>}
            </div>
          ))}
        </div>
        <div className="formula mono">
          <b>R<sub>s</sub> = R<sub>r</sub>·U<sub>s</sub> / (U<sub>p</sub> − U<sub>s</sub>)</b>
          <span>→</span><b>ρ = R<sub>s</sub>·A / L</b><span>→</span><b>Δρ = K·σ</b>
        </div>
      </section>

      <section id="features" className="features">
        {FEATURES.map(([h, d]) => (
          <div className="feature" key={h}><h3>{h}</h3><p>{d}</p></div>
        ))}
      </section>

      <section className="final">
        <h2>Sẵn sàng theo dõi kết cấu của anh/chị?</h2>
        <button className="btn primary" onClick={() => setLogin(true)}>Đăng nhập</button>
      </section>

      <footer className="lfoot">
        <span>SSC Monitor · Hệ thống giám sát bê tông tự cảm biến</span>
        <span>Mô hình dựa trên các nghiên cứu về vật liệu xi măng tự cảm biến công bố 2023–2026</span>
      </footer>

      {login && <LoginPanel onClose={() => { setLogin(false); if (location.hash === '#/login') location.hash = '#/' }} />}
    </div>
  )
}
