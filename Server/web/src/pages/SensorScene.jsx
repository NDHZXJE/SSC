import { t as tr } from '../i18n'
// Hoạt ảnh cục bê tông trên máy nén (bản gốc của trang giới thiệu). Chuyển động bằng CSS: landing.css, mục lp-*.

// Các viên cốt liệu rải trên mặt cục bê tông (cố định để hình không nhảy mỗi lần vẽ)
const GRAVEL = [
  [170, 215, 7], [205, 260, 5], [160, 270, 6], [228, 300, 8], [190, 320, 5], [240, 250, 4], [178, 290, 4],
  [300, 280, 6], [335, 300, 5], [360, 250, 7], [318, 325, 4], [282, 315, 5], [365, 290, 4], [348, 225, 4],
  [230, 170, 6], [290, 160, 5], [262, 200, 7], [320, 185, 4], [200, 185, 4], [262, 145, 4],
]

export function SensorScene() {
  return (
    <svg className="lp-scene scene" viewBox="0 0 540 430" role="img"
      aria-label={tr('Cục bê tông tự cảm biến chịu tải, dòng điện đi qua bê tông, node IoT gửi dữ liệu không dây')}>
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
        <path id="lpCurrent" d="M302 304 C 310 294, 294 284, 302 274 S 308 262, 302 254" />
        <path id="lpCurrent2" d="M336 287 C 344 277, 328 267, 336 257 S 342 245, 336 237" />
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

        {/* hai điện cực lưới nằm ngang (song song mặt chịu nén), dòng điện đi dọc theo phương lực */}
        <g className="lp-electrode">
          <line x1="276" y1="267" x2="366" y2="222" />
          <line x1="276" y1="317" x2="366" y2="272" />
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

      {/* dây nối và node IoT */}
      <path className="lp-wire" d="M366 222 C 400 214, 410 250, 432 258" />
      <path className="lp-wire" d="M366 272 C 392 274, 410 274, 432 272" />
      <g transform="translate(432 236)">
        <rect width="78" height="54" rx="8" fill="#0f172a" stroke="#22d3ee" strokeOpacity=".7" />
        <rect x="10" y="12" width="26" height="20" rx="3" fill="#1e293b" stroke="#475569" />
        <circle className="lp-led" cx="64" cy="14" r="4" />
        <text x="10" y="46" fill="#94a3b8" fontSize="10" fontFamily="ui-monospace,monospace">IoT node</text>
        <g className="lp-wifi" fill="none" stroke="#22d3ee" strokeWidth="2.4" strokeLinecap="round">
          <path d="M28 -12 a16 16 0 0 1 22 0" />
          <path d="M22 -20 a26 26 0 0 1 34 0" />
          <path d="M16 -28 a36 36 0 0 1 46 0" />
        </g>
      </g>
    </svg>
  )
}
