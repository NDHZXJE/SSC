import { useEffect, useRef, useState } from 'react'
import { api, auth } from '../api'
import './landing.css'
import { SensorScene } from './SensorScene'
import { RoadScene } from './RoadScene'

// Load cycle shared by the animated block and the signal trace (period 6 s).
const PERIOD = 3.2 // cùng nhịp với hoạt ảnh máy nén (lpPress trong landing.css)
const loadAt = t => 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / PERIOD) // 0..1

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

// Thành viên nhóm. Ảnh đặt ở web/public/team/; thiếu ảnh thì hiện chữ cái đầu tên.
const TEAM = [
  { name: 'Nguyễn Minh Hải', photo: '/team/nguyen-minh-hai.jpg', link: 'https://sites.google.com/view/nguyenminhhai-hp/' },
  { name: 'Nguyễn Đức Tuấn', photo: '/team/nguyen-duc-tuan.jpg', link: 'https://scv.udn.vn/nguyenductuan' },
  { name: 'Võ Minh Chí', photo: '/team/vo-minh-chi.jpg' },
  { name: 'Nguyễn Đức Hưng', photo: '/team/nguyen-duc-hung.jpg' },
]

function Member({ name, photo, link }) {
  const [ok, setOk] = useState(true)
  const initials = name.split(' ').slice(-2).map(w => w[0]).join('')
  const card = (
    <>
      <div className="avatar">
        {ok ? <img src={photo} alt={name} loading="lazy" onError={() => setOk(false)} /> : <span>{initials}</span>}
      </div>
      <h3>{name}</h3>
      {link && <span className="member-link">Trang cá nhân ↗</span>}
    </>
  )
  return link
    ? <a className="member" href={link} target="_blank" rel="noopener noreferrer">{card}</a>
    : <div className="member">{card}</div>
}

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
          <a href="#about">Về chúng tôi</a>
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
          <SensorScene />
          <SignalTrace t={t} />
        </div>
      </section>

      <section id="road" className="road">
        <span className="eyebrow">Ứng dụng · cân xe khi đang chạy</span>
        <h2>Chôn dưới mặt đường, biết ngay xe nặng bao nhiêu</h2>
        <p className="road-lead">Cụm 4 cục SSC chôn dọc làn xe dưới lớp móng, dây gom về tủ bên lề. Xe chạy qua, từng trục ép lần lượt lên các cục,
          hệ thống đọc tải và cộng ra trọng lượng xe.</p>
        <RoadScene />
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

      <section id="about" className="about">
        <span className="eyebrow">Về chúng tôi</span>
        <h2>Nhóm nghiên cứu Vật liệu tiên tiến AMAST</h2>
        <p className="about-lead">
          Thuộc Viện ISTAR, Trường Đại học Bách khoa – Đại học Đà Nẵng (DUT – UDN).
          Nhóm phát triển bê tông tự cảm biến và hệ thống SSC Monitor để đưa vật liệu thông minh vào giám sát công trình thực tế.
        </p>
        <div className="team">
          {TEAM.map(m => <Member key={m.name} {...m} />)}
        </div>
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
