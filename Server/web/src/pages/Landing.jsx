import { useEffect, useRef, useState } from 'react'
import '../landing.css'

// Trang giới thiệu hiện ra trước khi đăng nhập. Chỉ dùng /api/health (không cần đăng nhập).

// Các viên cốt liệu rải trên mặt cục bê tông (cố định để hình không nhảy mỗi lần vẽ)
const GRAVEL = [
  [170, 215, 7], [205, 260, 5], [160, 270, 6], [228, 300, 8], [190, 320, 5], [240, 250, 4], [178, 290, 4],
  [300, 280, 6], [335, 300, 5], [360, 250, 7], [318, 325, 4], [282, 315, 5], [365, 290, 4], [348, 225, 4],
  [230, 170, 6], [290, 160, 5], [262, 200, 7], [320, 185, 4], [200, 185, 4], [262, 145, 4],
]

function SensorScene() {
  return (
    <svg className="lp-scene" viewBox="0 0 540 430" role="img"
      aria-label="Cục bê tông tự cảm biến chịu tải, dòng điện đi qua bê tông, node ESP32 gửi dữ liệu không dây">
      <defs>
        <linearGradient id="lpTop" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c9ced6" /><stop offset="1" stopColor="#9aa2ad" />
        </linearGradient>
        <linearGradient id="lpLeft" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8b939e" /><stop offset="1" stopColor="#5d6570" />
        </linearGradient>
        <linearGradient id="lpRight" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#737b86" /><stop offset="1" stopColor="#474e58" />
        </linearGradient>
        <linearGradient id="lpPlate" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#334155" /><stop offset=".5" stopColor="#64748b" /><stop offset="1" stopColor="#334155" />
        </linearGradient>
        <radialGradient id="lpGlow">
          <stop offset="0" stopColor="#22d3ee" stopOpacity=".55" /><stop offset="1" stopColor="#22d3ee" stopOpacity="0" />
        </radialGradient>
        <filter id="lpBlur"><feGaussianBlur stdDeviation="2.2" /></filter>
        <path id="lpCurrent" d="M297 300 C 310 285, 322 300, 330 282 S 340 268, 343 262" />
        <path id="lpCurrent2" d="M297 260 C 312 250, 320 262, 330 245 S 340 236, 343 232" />
      </defs>

      {/* bóng đổ */}
      <ellipse cx="262" cy="378" rx="170" ry="26" fill="#000" opacity=".35" filter="url(#lpBlur)" />

      {/* cục bê tông */}
      <g className="lp-cube">
        <polygon points="140,180 260,240 260,360 140,300" fill="url(#lpLeft)" />
        <polygon points="260,240 380,180 380,300 260,360" fill="url(#lpRight)" />
        <polygon className="lp-topface" points="260,120 380,180 260,240 140,180" fill="url(#lpTop)" />
        {GRAVEL.map(([x, y, r], i) => (
          <circle key={i} cx={x} cy={y} r={r} fill="#1f2937" opacity={0.18 + (i % 3) * 0.06} />
        ))}
        <polyline points="140,180 260,240 380,180" fill="none" stroke="#e5e7eb" strokeOpacity=".35" />
        <line x1="260" y1="240" x2="260" y2="360" stroke="#e5e7eb" strokeOpacity=".2" />

        {/* vùng ứng suất phát sáng theo nhịp tải */}
        <ellipse className="lp-stress" cx="320" cy="270" rx="48" ry="62" fill="url(#lpGlow)" />

        {/* hai điện cực lưới */}
        <g className="lp-electrode">
          <line x1="297" y1="232" x2="297" y2="330" />
          <line x1="343" y1="210" x2="343" y2="308" />
        </g>

        {/* dòng điện chạy giữa hai điện cực */}
        {[0, 0.5, 1, 1.5].map(d => (
          <circle key={'a' + d} r="3.2" className="lp-spark">
            <animateMotion dur="2s" begin={`-${d}s`} repeatCount="indefinite"><mpath href="#lpCurrent" /></animateMotion>
          </circle>
        ))}
        {[0.25, 0.9, 1.6].map(d => (
          <circle key={'b' + d} r="2.6" className="lp-spark">
            <animateMotion dur="2.3s" begin={`-${d}s`} repeatCount="indefinite"><mpath href="#lpCurrent2" /></animateMotion>
          </circle>
        ))}
      </g>

      {/* bàn nén của máy + mũi tên lực */}
      <g className="lp-press">
        <polygon points="260,92 392,158 392,170 260,104 128,170 128,158" fill="url(#lpPlate)" opacity=".95" />
        <polygon points="260,80 392,146 260,212 128,146" fill="#475569" opacity=".85" />
        <polygon points="260,80 392,146 260,212 128,146" fill="none" stroke="#94a3b8" strokeOpacity=".6" />
        {[[200, 40], [260, 20], [320, 40]].map(([x, y]) => (
          <g key={x} className="lp-arrow">
            <line x1={x} y1={y} x2={x} y2={y + 70} />
            <polyline points={`${x - 9},${y + 58} ${x},${y + 72} ${x + 9},${y + 58}`} />
          </g>
        ))}
      </g>

      {/* dây nối và node ESP32 */}
      <path className="lp-wire" d="M343 214 C 400 205, 410 250, 432 258" />
      <path className="lp-wire" d="M297 236 C 330 262, 392 276, 432 272" />
      <g transform="translate(432 236)">
        <rect width="78" height="54" rx="8" fill="#0f172a" stroke="#22d3ee" strokeOpacity=".7" />
        <rect x="10" y="12" width="26" height="20" rx="3" fill="#1e293b" stroke="#475569" />
        <circle className="lp-led" cx="64" cy="14" r="4" />
        <text x="10" y="46" fill="#94a3b8" fontSize="10" fontFamily="ui-monospace,monospace">ESP32</text>
        <g className="lp-wifi" fill="none" stroke="#22d3ee" strokeWidth="2.4" strokeLinecap="round">
          <path d="M28 -12 a16 16 0 0 1 22 0" />
          <path d="M22 -20 a26 26 0 0 1 34 0" />
          <path d="M16 -28 a36 36 0 0 1 46 0" />
        </g>
      </g>
    </svg>
  )
}

function LiveWave() {
  // sóng điện trở suất / ứng suất chạy liên tục (2 chu kỳ giống nhau để trượt vòng)
  const pts = n => Array.from({ length: n }, (_, i) => {
    const x = i * 6
    const y = 40 - 26 * Math.exp(-(((i % 44) - 22) ** 2) / 40) - 4 * Math.sin((2 * Math.PI * i) / 11)
    return `${x},${y.toFixed(1)}`
  }).join(' ')
  const p = pts(45)
  return (
    <div className="lp-wavecard">
      <div className="lp-wavehead">
        <span><i className="lp-dot" /> Cục C-01 · trực tiếp</span>
        <span className="lp-mono">100 mẫu/giây</span>
      </div>
      <svg viewBox="0 0 264 60" preserveAspectRatio="none" className="lp-wave">
        <g className="lp-wavemove">
          <polyline points={p} />
          <polyline points={p} transform="translate(264 0)" />
        </g>
      </svg>
      <div className="lp-wavefoot">
        <div><small>ρ điện trở suất</small><b className="lp-mono">1 284 Ω·m</b></div>
        <div><small>σ ứng suất</small><b className="lp-mono lp-amber">12,6 MPa</b></div>
        <div><small>Tải</small><b className="lp-mono">283 kN</b></div>
      </div>
    </div>
  )
}

function useHealth() {
  const [h, setH] = useState(null)
  useEffect(() => {
    let stop = false
    const load = () => fetch('/api/health').then(r => r.json()).then(d => !stop && setH(d)).catch(() => !stop && setH(false))
    load()
    const t = setInterval(load, 5000)
    return () => { stop = true; clearInterval(t) }
  }, [])
  return h
}

const STEPS = [
  ['01', 'Bê tông tự cảm biến', 'Cục bê tông có phụ gia dẫn điện và hai điện cực lưới. Khi chịu nén, điện trở suất ρ thay đổi theo ứng suất.'],
  ['02', 'Node ESP32 đo liên tục', 'Mỗi node đo điện áp 100 lần mỗi giây, kèm nhiệt độ, độ ẩm, rồi gửi về máy chủ qua Wi-Fi (MQTT).'],
  ['03', 'Máy chủ hiệu chuẩn', 'Tính ρ, áp mô hình hiệu chuẩn riêng của từng cục (mô hình lai có bù nhiệt, tuổi bê tông) để ra ứng suất σ.'],
  ['04', 'Theo dõi trên web', 'Xem trực tiếp ρ, σ, tải (kN) của mọi cục, xem lại lịch sử và xuất dữ liệu để phân tích.'],
]

const FEATURES = [
  ['M3 12h4l3-8 4 16 3-8h4', 'Giám sát thời gian thực', 'Biểu đồ trực tiếp, trạng thái online của từng node, cảnh báo khi số liệu bất thường.'],
  ['M4 20V10m6 10V4m6 16v-7m4 7H2', 'Hiệu chuẩn từng cục', 'Ghi các bậc tải trên máy nén, khớp mô hình, kiểm tra R² rồi duyệt dùng chỉ trong vài bước.'],
  ['M12 3a4 4 0 0 1 4 4v1a4 4 0 0 1 3 7 4 4 0 0 1-7 3 4 4 0 0 1-7-3 4 4 0 0 1 3-7V7a4 4 0 0 1 4-4z', 'Mô hình AI lai', 'Kết hợp vật lý và học máy, có khoảng tin cậy và tự đánh dấu khi thiếu cục tham chiếu.'],
  ['M12 3v12m-5-5 5 5 5-5M4 21h16', 'Xuất dữ liệu', 'Tải dữ liệu thô 100 mẫu/giây hoặc dữ liệu gộp dưới dạng CSV, Parquet cho Excel, Python.'],
]

export default function Landing() {
  const h = useHealth()
  const how = useRef(null)
  const online = h && h.ok
  return (
    <div className="lp">
      <div className="lp-bg" aria-hidden="true"><span /><span /><span /></div>

      <nav className="lp-nav">
        <a className="lp-brand" href="#/">
          <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
            <polygon points="16,3 28,9.5 16,16 4,9.5" fill="#cbd5e1" />
            <polygon points="4,9.5 16,16 16,29 4,22.5" fill="#64748b" />
            <polygon points="16,16 28,9.5 28,22.5 16,29" fill="#475569" />
            <path d="M8 19 l3-2 2 3 3-5" stroke="#22d3ee" strokeWidth="1.8" fill="none" strokeLinecap="round" />
          </svg>
          SSC Monitor
        </a>
        <a className="lp-btn lp-btn-ghost" href="#/login">Đăng nhập</a>
      </nav>

      <section className="lp-hero">
        <div className="lp-copy">
          <span className="lp-eyebrow">Bê tông tự cảm biến · Giám sát thời gian thực</span>
          <h1>Bê tông <em>tự cảm nhận</em> ứng suất.<br />Bạn nhìn thấy từng nhịp tải.</h1>
          <p>
            SSC Monitor thu tín hiệu điện từ các cục bê tông tự cảm biến, hiệu chuẩn riêng từng cục
            và chuyển thành ứng suất, tải trọng hiển thị trực tiếp trên web.
          </p>
          <div className="lp-cta">
            <a className="lp-btn" href="#/login">Đăng nhập hệ thống →</a>
            <button className="lp-btn lp-btn-ghost" onClick={() => how.current?.scrollIntoView({ behavior: 'smooth' })}>
              Cách hoạt động
            </button>
          </div>
          <div className="lp-status">
            <span className={'lp-pill ' + (online ? 'on' : h === false ? 'off' : '')}>
              <i className="lp-dot" /> {online ? 'Hệ thống đang hoạt động' : h === false ? 'Không kết nối được máy chủ' : 'Đang kiểm tra…'}
            </span>
            {online && <>
              <span className="lp-pill">MQTT {h.mqtt ? 'đã kết nối' : 'mất kết nối'}</span>
              <span className="lp-pill lp-mono">{Number(h.packets).toLocaleString('vi-VN')} gói đã nhận</span>
            </>}
          </div>
        </div>
        <div className="lp-visual">
          <SensorScene />
          <LiveWave />
        </div>
      </section>

      <section className="lp-section" ref={how}>
        <h2>Cách hoạt động</h2>
        <p className="lp-lead">Từ cục bê tông đến biểu đồ trên màn hình, mất chưa tới một giây.</p>
        <ol className="lp-steps">
          {STEPS.map(([n, t, d]) => (
            <li key={n}><span className="lp-num">{n}</span><h3>{t}</h3><p>{d}</p></li>
          ))}
        </ol>
      </section>

      <section className="lp-section">
        <h2>Tính năng chính</h2>
        <div className="lp-features">
          {FEATURES.map(([icon, t, d]) => (
            <div className="lp-feature" key={t}>
              <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d={icon} /></svg>
              <h3>{t}</h3><p>{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-final">
        <h2>Sẵn sàng theo dõi công trình?</h2>
        <a className="lp-btn" href="#/login">Đăng nhập</a>
      </section>

      <footer className="lp-foot">SSC Monitor · Hệ thống giám sát bê tông tự cảm biến</footer>
    </div>
  )
}
