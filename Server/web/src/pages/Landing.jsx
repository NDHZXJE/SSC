import { useEffect, useRef, useState } from 'react'
import { api, auth } from '../api'
import './landing.css'
import { SensorScene } from './SensorScene'
import { AppsHub } from './AppsHub'
import { t as tr, useLang, LangSwitch, locale, getLang } from '../i18n'

// Load cycle shared by the animated block and the signal trace (period 6 s).
const PERIOD = 3.2 // cùng nhịp với hoạt ảnh máy nén (lpPress trong landing.css)
const loadAt = t => 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / PERIOD) // 0..1

function useClock() {
  const [t, setT] = useState(0)
  useEffect(() => {
    let id, t0 = performance.now()
    // Máy tắt hiệu ứng: vẫn chạy nhưng chậm một nửa (CSS trong landing.css cũng chậm theo)
    const speed = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.5 : 1
    const tick = now => { setT(((now - t0) / 1000) * speed); id = requestAnimationFrame(tick) }
    id = requestAnimationFrame(tick)
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
        <span><i className="live" /> {tr('Tín hiệu minh họa · 100 mẫu/giây')}</span>
        <span className="mono">σ = {(L * 16).toFixed(2)} MPa · F = {(L * 40).toFixed(1)} kN</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        {[0.25, 0.5, 0.75].map(g => <line key={g} x1="0" x2={W} y1={H * g} y2={H * g} className="gridline" />)}
        <polyline points={pts.join(' ')} className="wave-glow" />
        <polyline points={pts.join(' ')} className="wave" />
      </svg>
      <div className="trace-foot mono"><span>ρ (Ω·m)</span><span>{tr('8 giây gần nhất')}</span></div>
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
      {ok ? tr('Hệ thống đang hoạt động · MQTT {mqtt} · {n} gói dữ liệu đã nhận', { mqtt: h.mqtt ? tr('đã kết nối') : tr('mất kết nối'), n: Number(h.packets || 0).toLocaleString(locale()) })
        : tr('Không kết nối được máy chủ')}
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
        <button type="button" className="close" onClick={onClose} aria-label={tr('Đóng')}>×</button>
        <h2>{tr('Đăng nhập')}</h2>
        <p>{tr('Vào hệ thống giám sát SSC')}</p>
        <label>{tr('Tên đăng nhập')}<input ref={ref} value={u} onChange={e => setU(e.target.value)} autoComplete="username" /></label>
        <label>{tr('Mật khẩu')}<input type="password" value={p} onChange={e => setP(e.target.value)} autoComplete="current-password" /></label>
        {err && <div className="err">{err}</div>}
        <button type="submit" className="btn primary" disabled={busy}>{busy ? tr('Đang đăng nhập…') : tr('Đăng nhập')}</button>
      </form>
    </div>
  )
}

const STEPS = [
  ['01', 'Cục SSC', 'Bê tông pha sợi carbon. Khi chịu nén, mạng sợi dẫn điện khít lại và điện trở suất ρ thay đổi.'],
  ['02', 'Node IoT', 'Vi điều khiển (MCU) với ADC 24-bit đọc điện áp hai đầu điện cực 100 lần mỗi giây, gửi qua Wi-Fi.'],
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
const PUBS = [
  { year: 2026, venue: 'Measurement 281, 121975',
    title: 'Environment-compensated prediction of compressive stress-dependent electrical resistivity response of self-sensing cementitious materials using initial resistivity calibration',
    authors: 'M.H. Nguyen, M.C. Vo, D.H. Nguyen, L. Nguyen, V.H. Nguyen, Q.Q. Pham, T.N. Phan, D.T. Nguyen, N.P. Pham',
    doi: '10.1016/j.measurement.2026.121975' },
  { year: 2026, venue: 'Journal of Building Engineering 130, 117125',
    title: 'Experimental study of the electromechanical behavior of a multi-bearing self-sensing concrete system for smart slab structures',
    authors: 'M.H. Nguyen, M.C. Vo, D.T. Nguyen, D.H. Nguyen, V.H. Nguyen, Q.Q. Pham, T.N. Phan, N.P. Pham',
    doi: '10.1016/j.jobe.2026.117125' },
  { year: 2023, venue: 'Case Studies in Construction Materials 19, e02685',
    title: 'An empirical model for electrical resistivity of mortar considering the synergistic effects of carbon fillers, current intensity, and environmental factors',
    authors: 'M.C. Vo, M.H. Nguyen, L. Nguyen, V.H. Nguyen',
    doi: '10.1016/j.cscm.2023.e02685' },
  { year: 2023, venue: 'Journal of Advanced Concrete Technology 21, 762–776',
    title: 'Stress self-sensitivity of carbon black-filled mortar under nondestructive compression and the effects of electric circuit and specimen dimensions',
    authors: 'M.C. Vo, M.H. Nguyen, L. Nguyen, V.H. Nguyen',
    doi: '10.3151/jact.21.762' },
  { year: 2023, venue: 'IOP Conf. Series: Materials Science and Engineering 1289, 012033',
    title: 'Compression self-sensibility of the concrete using high content carbon black with various measurement conditions',
    authors: 'M.C. Vo, L. Nguyen, M.H. Nguyen, V.H. Nguyen',
    doi: '10.1088/1757-899X/1289/1/012033' },
]

const TEAM = [
  { name: 'Nguyễn Minh Hải', photo: '/team/nguyen-minh-hai.jpg', link: 'https://sites.google.com/view/nguyenminhhai-hp/' },
  { name: 'Nguyễn Đức Tuấn', photo: '/team/nguyen-duc-tuan.jpg', link: 'https://scv.udn.vn/nguyenductuan' },
  { name: 'Võ Minh Chí', photo: '/team/vo-minh-chi.jpg' },
  { name: 'Nguyễn Đức Hưng', photo: '/team/nguyen-duc-hung.jpg' },
]

// Tiếng Anh/Nhật: tên không dấu (font Nhật không có dấu tiếng Việt chồng nhau)
const plain = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')

function Member({ name: viName, photo, link }) {
  const name = getLang() === 'vi' ? viName : plain(viName)
  const [ok, setOk] = useState(true)
  const initials = name.split(' ').slice(-2).map(w => w[0]).join('')
  const card = (
    <>
      <div className="avatar">
        {ok ? <img src={photo} alt={name} loading="lazy" onError={() => setOk(false)} /> : <span>{initials}</span>}
      </div>
      <h3>{name}</h3>
      {link && <span className="member-link">{tr('Trang cá nhân')} ↗</span>}
    </>
  )
  return link
    ? <a className="member" href={link} target="_blank" rel="noopener noreferrer">{card}</a>
    : <div className="member">{card}</div>
}

export default function Landing({ openLogin = false }) {
  useLang()
  const t = useClock()
  const [login, setLogin] = useState(openLogin)
  useEffect(() => setLogin(openLogin), [openLogin])
  const L = loadAt(t)

  return (
    <div className="landing">
      <nav className="lnav">
        <a className="brand" href="#/"><span className="logo" />SSC Monitor</a>
        <div className="lnav-links">
          <a href="#how">{tr('Cách hoạt động')}</a>
          <a href="#apps">{tr('Ứng dụng')}</a>
          <a href="#features">{tr('Tính năng')}</a>
          <a href="#pubs">{tr('Công bố')}</a>
          <a href="#about">{tr('Về chúng tôi')}</a>
          <LangSwitch />
          <button className="btn ghost" onClick={() => setLogin(true)}>{tr('Đăng nhập')}</button>
        </div>
      </nav>

      <section className="hero">
        <div className="hero-text">
          <span className="eyebrow">{tr('Bê tông tự cảm biến · Self-sensing concrete')}</span>
          <h1>{tr('Bê tông')} <em>{tr('cảm nhận')}</em> {tr('được lực tác động')}</h1>
          <p>
            {tr('Mỗi cục bê tông là một cảm biến. Hệ thống đọc tín hiệu điện của từng cục, hiệu chuẩn bằng AI và cho anh/chị theo dõi tải trọng kết cấu theo thời gian thực.')}
          </p>
          <div className="cta">
            <button className="btn primary" onClick={() => setLogin(true)}>{tr('Vào hệ thống giám sát')}</button>
            <a className="btn ghost" href="#how">{tr('Tìm hiểu cách hoạt động')}</a>
          </div>
          <SystemStatus />
          <div className="kpis">
            <div><b>100</b><span>{tr('mẫu/giây mỗi cục')}</span></div>
            <div><b>24-bit</b><span>{tr('độ phân giải ADC')}</span></div>
            <div><b>R² &gt; 0.9</b><span>{tr('mô hình hiệu chuẩn')}</span></div>
          </div>
        </div>
        <div className="hero-visual">
          <div className="glow-bg" style={{ opacity: 0.35 + 0.4 * L }} />
          <SensorScene />
          <SignalTrace t={t} />
        </div>
      </section>

      <section id="apps" className="apps">
        <span className="eyebrow">{tr('Ứng dụng')}</span>
        <h2>{tr('Một vật liệu, cả mạng lưới cảm biến cho hạ tầng')}</h2>
        <p className="apps-lead">{tr('Mỗi cục bê tông vừa chịu lực vừa là cảm biến. Ghép với vi mạch, kết nối IoT và trí tuệ nhân tạo, cả công trình trở thành một mạng cảm biến diện rộng: từ cân xe đang chạy, cầu, đập đến nhà dân dụng chịu động đất.')}</p>
        <AppsHub />
      </section>

      <section id="how" className="how">
        <h2>{tr('Từ lực nén đến số liệu trên màn hình')}</h2>
        <div className="steps">
          {STEPS.map(([n, h, d], i) => (
            <div className="step" key={n}>
              <span className="num">{n}</span>
              <h3>{tr(h)}</h3>
              <p>{tr(d)}</p>
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
          <div className="feature" key={h}><h3>{tr(h)}</h3><p>{tr(d)}</p></div>
        ))}
      </section>

      <section id="about" className="about">
        <span className="eyebrow">{tr('Về chúng tôi')}</span>
        <h2>{tr('Nhóm nghiên cứu Vật liệu tiên tiến AMAST')}</h2>
        <p className="about-lead">
          {tr('Thuộc Viện ISTAR, Trường Đại học Bách khoa – Đại học Đà Nẵng (DUT – UDN). Nhóm phát triển bê tông tự cảm biến và hệ thống SSC Monitor để đưa vật liệu thông minh vào giám sát công trình thực tế.')}
        </p>
        <div className="team">
          {TEAM.map(m => <Member key={m.name} {...m} />)}
        </div>
      </section>

      <section id="pubs" className="pubs">
        <span className="eyebrow">{tr('Công bố khoa học')}</span>
        <h2>{tr('Nền tảng từ các bài báo Scopus của nhóm')}</h2>
        <p className="pubs-lead">
          {tr('Phương pháp đo, mô hình bù môi trường và hệ nhiều cục SSC trong hệ thống này dựa trên các nghiên cứu đã công bố dưới đây.')}
        </p>
        <ol className="pub-list">
          {PUBS.map(p => (
            <li key={p.doi}>
              <a className="pub" href={`https://doi.org/${p.doi}`} target="_blank" rel="noopener noreferrer">
                <span className="pub-year">{p.year}</span>
                <span className="pub-body">
                  <span className="pub-title">{p.title}</span>
                  <span className="pub-authors">{p.authors}</span>
                  <span className="pub-venue"><em>{p.venue}</em></span>
                  <span className="pub-doi">doi:{p.doi} ↗</span>
                </span>
              </a>
            </li>
          ))}
        </ol>
      </section>

      <section className="final">
        <h2>{tr('Sẵn sàng theo dõi kết cấu của anh/chị?')}</h2>
        <button className="btn primary" onClick={() => setLogin(true)}>{tr('Đăng nhập')}</button>
      </section>

      <footer className="lfoot">
        <span>SSC Monitor · {tr('Hệ thống giám sát bê tông tự cảm biến')}</span>
        <span>{tr('Mô hình dựa trên các nghiên cứu về vật liệu xi măng tự cảm biến công bố 2023–2026')}</span>
      </footer>

      {login && <LoginPanel onClose={() => { setLogin(false); if (location.hash === '#/login') location.hash = '#/' }} />}
    </div>
  )
}
