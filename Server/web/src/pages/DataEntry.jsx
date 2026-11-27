import { t as tr, locale } from '../i18n'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api, download, fmt, isAdmin, upload } from '../api'

// Trang nhập dữ liệu huấn luyện mô hình AI, theo bố cục công cụ ThuThapDuLieu:
// chọn loại -> 1 thông tin -> 2 số liệu -> 3 kiểm tra -> lưu -> dữ liệu đã lưu.
// Cột giống hệt template Excel (sheet Cuc, QuetNhiet, EpBac, LapDat, KiemChung).

const TYPES_ = () => [
  ['Cuc', tr('Cục mới'), tr('Khai báo cục (kể cả cục đối chứng) trước khi nhập số đo của nó.')],
  ['QuetNhiet', tr('Quét nhiệt'), tr('Cục KHÔNG tải trong tủ nhiệt, 4 mức 15, 25, 35, 45 °C. Chờ nhiệt trong cục ổn định rồi mới lấy số.')],
  ['EpBac', tr('Ép theo bậc'), tr('Ép 0 → 12 MPa (dưới 20% fc), lên rồi xuống, 3 chu kỳ. Mỗi chu kỳ bắt đầu bằng bậc 0. Mỗi lần lưu là một lần ép.')],
  ['LapDat', tr('Mốc lắp đặt'), tr('Đo khi cục đã đặt vào công trình và CHƯA cho tải. Có cục đối chứng thì ghi cả số của nó.')],
  ['KiemChung', tr('Kiểm chứng'), tr('Những lúc biết chắc tải đang tác dụng (quả nặng, thử tải) để kiểm tra mô hình ngoài hiện trường.')],
]
const LS = 'ssc_nhap_du_lieu'
const load = () => { try { return JSON.parse(localStorage.getItem(LS) || '{}') } catch { return {} } }
const keep = v => { try { localStorage.setItem(LS, JSON.stringify(v)) } catch {} }
const num = v => (v === '' || v === null || v === undefined ? NaN : Number(v))
const today = () => new Date().toISOString().slice(0, 10)
const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16) }

const COLS_ = () => ({
  QuetNhiet: [['nhiet_do_c', tr('Nhiệt độ (°C)')], ['rho_ohm_m', tr('ρ (Ω·m)')], ['rs_ohm', tr('hoặc Rs (Ω)')], ['rho_std', tr('± ρ')], ['so_mau', tr('Số mẫu')]],
  EpBac: [['chu_ky', tr('Chu kỳ')], ['tai_kn', tr('Lực (kN)')], ['rho_ohm_m', tr('ρ (Ω·m)')], ['rs_ohm', tr('hoặc Rs (Ω)')], ['nhiet_do_c', tr('Nhiệt độ (°C)')]],
  KiemChung: [['thoi_diem', tr('Thời điểm')], ['tai_kn', tr('Tải biết trước (kN)')], ['rho_ohm_m', tr('ρ (Ω·m)')], ['nhiet_do_c', tr('Nhiệt độ (°C)')], ['rho_doi_chung_ohm_m', tr('ρ đối chứng')]],
})
const BLANK_BLOCK = { ma_cuc: '', cap_phoi: 'F2', me_duc: '', ngay_duc: '', cuong_do_nen_mpa: '', dien_tich_dien_cuc_mm2: 2000,
  khoang_cach_dien_cuc_mm: 30, dien_tich_chiu_nen_mm2: 2500, la_cuc_doi_chung: false, ma_cuc_doi_chung: '', vi_tri: '' }

function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').trim().split(/\r?\n/)
  const sep = [';', ',', '\t'].find(c => lines[0].includes(c)) || ';'
  const head = lines[0].split(sep).map(s => s.trim())
  const rows = lines.slice(1).map(l => l.split(sep).map(x => Number(x.replace(',', '.'))))
  return { head, t: rows.map(r => r[0]), v: rows.map(r => r[1]) }
}

function Scatter({ pts, xl, yl }) {
  const ok = pts.filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]))
  if (ok.length < 2) return null
  const W = 560, H = 240, L = 64, R = 16, T = 12, B = 36
  const xs = ok.map(p => p[0]), ys = ok.map(p => p[1])
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
  const X = x => L + (x - x0) / ((x1 - x0) || 1) * (W - L - R), Y = y => H - B - (y - y0) / ((y1 - y0) || 1) * (H - T - B)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W }}>
      <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke="var(--line)" />
      <line x1={L} x2={L} y1={T} y2={H - B} stroke="var(--line)" />
      <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle" fontSize="12" fill="var(--muted)">{xl}</text>
      <text x={L - 6} y={T + 10} textAnchor="end" fontSize="11" fill="var(--muted)">{y1.toFixed(3)}</text>
      <text x={L - 6} y={H - B} textAnchor="end" fontSize="11" fill="var(--muted)">{y0.toFixed(3)}</text>
      <text x={L} y={H - B + 14} textAnchor="middle" fontSize="11" fill="var(--muted)">{x0.toFixed(1)}</text>
      <text x={W - R} y={H - B + 14} textAnchor="end" fontSize="11" fill="var(--muted)">{x1.toFixed(1)}</text>
      <text x={8} y={(T + H - B) / 2} fontSize="12" fill="var(--muted)" transform={`rotate(-90 8 ${(T + H - B) / 2})`} textAnchor="middle" dominantBaseline="hanging">{yl}</text>
      {ok.map((p, i) => <circle key={i} cx={X(p[0])} cy={Y(p[1])} r="4" fill="var(--accent)" opacity=".85" />)}
    </svg>
  )
}

export default function DataEntry() {
  const saved = load()
  const [type, setType] = useState(saved.type || 'EpBac')
  const [info, setInfo] = useState({ sid: '', ngay: today(), nguoi: '', temp: '', moist: '', note: '', ...(saved.info || {}) })
  const [sensors, setSensors] = useState([])
  const [rows, setRows] = useState({ QuetNhiet: [], EpBac: [], KiemChung: [] })
  const [block, setBlock] = useState(BLANK_BLOCK)
  const [inst, setInst] = useState({ thoi_diem: nowLocal(), rho0_ohm_m: '', nhiet_do_c: '', do_am_pct: '', rho_doi_chung_ohm_m: '' })
  const [epMode, setEpMode] = useState(saved.epMode || 'tay')
  const [volt, setVolt] = useState(null)
  const [elec, setElec] = useState({ up: saved.up || 16, rr: saved.rr || 820, ...{} })
  const [steps, setSteps] = useState([{ t0: '', t1: '', kn: '', chu_ky: 1 }])
  const [paste, setPaste] = useState('')
  const [list, setList] = useState({ rows: [], counts: {} })
  const [msg, setMsg] = useState(['', ''])
  const [busy, setBusy] = useState(false)
  // Bối cảnh thí nghiệm + trợ lý chat
  const [context, setContext] = useState(saved.context || '')
  const [chat, setChat] = useState([])
  const [ask, setAsk] = useState('')
  const [thinking, setThinking] = useState(false)
  const [aiInfo, setAiInfo] = useState(null)
  const logRef = useRef(null)
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight }, [chat, thinking])

  const sensor = sensors.find(s => s.id === Number(info.sid))
  const area = sensor?.load_area_mm2 || 2500
  const loadSensors = () => api('/overview').then(setSensors).catch(() => {})
  const loadList = () => api(`/ai/rows?sheet=${type}${info.sid && type !== 'Cuc' ? `&sensor_id=${info.sid}` : ''}`).then(setList).catch(() => {})
  useEffect(() => { loadSensors(); api('/ai/assistant').then(setAiInfo).catch(() => {}) }, [])
  useEffect(() => { loadList() }, [type, info.sid])
  useEffect(() => { keep({ type, info, epMode, up: elec.up, rr: elec.rr, context }) }, [type, info, epMode, elec, context])

  const setI = (k, v) => setInfo(o => ({ ...o, [k]: v }))
  const tableRows = rows[type] || []
  const setRow = (i, k, v) => setRows(o => ({ ...o, [type]: o[type].map((r, j) => (j === i ? { ...r, [k]: v } : r)) }))
  const addRow = (r = {}) => setRows(o => ({ ...o, [type]: [...o[type], { nhiet_do_c: info.temp, ...(type === 'KiemChung' ? { thoi_diem: nowLocal() } : {}), ...r }] }))
  const delRow = i => setRows(o => ({ ...o, [type]: o[type].filter((_, j) => j !== i) }))

  // Đổ kết quả của trợ lý vào form (người dùng vẫn phải xem mục Kiểm tra rồi bấm Lưu)
  const str = v => (v === null || v === undefined ? '' : String(v))
  const applyAI = d => {
    const sh = d.sheet || type
    const i = d.info || {}
    const s = sensors.find(x => x.code === (i.ma_cuc || d.rows?.[0]?.ma_cuc))
    const a = s?.load_area_mm2 || area
    setInfo(o => ({ ...o, ...(s ? { sid: String(s.id) } : {}), ...(i.ngay ? { ngay: i.ngay.slice(0, 10) } : {}),
      ...(i.nguoi ? { nguoi: i.nguoi } : {}), ...(i.nhiet_do_c != null ? { temp: str(i.nhiet_do_c) } : {}),
      ...(i.do_am_pct != null ? { moist: str(i.do_am_pct) } : {}), ...(i.ghi_chu ? { note: i.ghi_chu } : {}) }))
    if (d.sheet) setType(d.sheet)
    const rs = d.rows || []
    if (!rs.length) return 0
    if (sh === 'Cuc') {
      const r = rs[0]
      setBlock({ ...BLANK_BLOCK, ...Object.fromEntries(Object.keys(BLANK_BLOCK).filter(k => r[k] != null).map(k => [k, k === 'la_cuc_doi_chung' ? !!r[k] : str(r[k])])) })
    } else if (sh === 'LapDat') {
      const r = rs[0]
      setInst(o => ({ ...o, ...Object.fromEntries(Object.keys(o).filter(k => r[k] != null).map(k => [k, k === 'thoi_diem' ? str(r[k]).slice(0, 16) : str(r[k])])) }))
    } else if (COLS_()[sh]) {
      if (sh === 'EpBac') setEpMode('tay')
      setRows(o => ({ ...o, [sh]: rs.map(r => {
        const x = { ...r }
        if (x.tai_kn == null && x.ung_suat_mpa != null) x.tai_kn = +(x.ung_suat_mpa * a / 1000).toFixed(3)
        if (x.tai_kn == null && x.ung_suat_that_mpa != null) x.tai_kn = +(x.ung_suat_that_mpa * a / 1000).toFixed(3)
        if (x.thoi_diem) x.thoi_diem = str(x.thoi_diem).slice(0, 16)
        return Object.fromEntries(COLS_()[sh].map(([k]) => [k, str(x[k])]))
      }) }))
    }
    return rs.length
  }
  const formState = () => ({ loai: type, cuc: sensor?.code || null, info,
    dong: type === 'Cuc' ? [block] : type === 'LapDat' ? [inst] : (rows[type] || []) })
  const send = async () => {
    const text = ask.trim()
    if (!text || thinking) return
    const hist = [...chat, { role: 'user', content: text }]
    setChat(hist); setAsk(''); setThinking(true)
    try {
      const d = await api('/ai/assistant', { method: 'POST', body: { context, form: formState(),
        messages: hist.map(m => ({ role: m.role, content: m.role === 'assistant' ? m.raw || m.content : m.content })) } })
      const n = applyAI(d)
      const q = (d.questions || []).filter(Boolean)
      setChat([...hist, { role: 'assistant', content: d.reply, questions: q, n, sheet: d.sheet, raw: JSON.stringify({ reply: d.reply, sheet: d.sheet, info: d.info, rows: d.rows, questions: q }) }])
    } catch (e) {
      setChat([...hist, { role: 'assistant', content: e.message, error: true }])
    } finally { setThinking(false) }
  }

  // Lấy số trực tiếp từ node (trung bình vài giây)
  const fromNode = async (seconds, apply) => {
    if (!info.sid) return setMsg(['err', tr('Chọn cục trước.')])
    try {
      const r = await api(`/sensors/${info.sid}/now?window_s=${seconds}`)
      apply(r); setMsg(['ok', tr('Đã lấy trung bình {n} mẫu: ρ = {rho} Ω·m, {t} °C', { n: r.n, rho: fmt(r.rho, 4), t: fmt(r.temp, 1) })])
    } catch (e) { setMsg(['err', e.message]) }
  }

  // Dán từ Excel: các cột theo đúng thứ tự trên bảng
  const applyPaste = () => {
    const cols = COLS_()[type]
    const add = paste.trim().split(/\r?\n/).filter(Boolean).map(l => {
      const p = l.split(/\t|;/)
      return Object.fromEntries(cols.map(([k], i) => [k, (p[i] ?? '').trim().replace(',', '.')]))
    })
    setRows(o => ({ ...o, [type]: [...o[type], ...add] })); setPaste('')
  }
  const presetTemp = () => setRows(o => ({ ...o, QuetNhiet: [15, 25, 35, 45].map(t => ({ nhiet_do_c: t, rho_ohm_m: '', so_mau: '' })) }))
  const presetPress = () => {
    const up = [0, 2, 4, 6, 8, 10, 12], seq = [...up, ...up.slice(0, -1).reverse()]
    const r = []
    for (let c = 1; c <= 3; c++) seq.forEach(s => r.push({ chu_ky: c, tai_kn: +(s * area / 1000).toFixed(2), rho_ohm_m: '', nhiet_do_c: info.temp }))
    setRows(o => ({ ...o, EpBac: r }))
  }

  // Từ file điện áp ESP32 + bậc tải: Rs = Rr·|Us| / (Up − |Us|), ρ = Rs·A/L
  const onVolt = async f => { if (!f) return; const t = await f.text(); const p = parseCsv(t); setVolt({ name: f.name, ...p }) }
  const fileRows = useMemo(() => {
    if (!volt || !sensor) return []
    const A = sensor.electrode_area_mm2 * 1e-6, Lg = sensor.electrode_gap_mm * 1e-3
    return steps.map(s => {
      const a = num(s.t0), b = num(s.t1)
      const v = volt.v.filter((_, i) => volt.t[i] >= a && volt.t[i] <= b).map(Math.abs)
      if (!v.length) return { ...s, n: 0 }
      const us = v.reduce((x, y) => x + y, 0) / v.length
      const sd = Math.sqrt(v.reduce((x, y) => x + (y - us) ** 2, 0) / v.length)
      const rs = elec.rr * us / (elec.up - us)
      return { ...s, n: v.length, us, rs, rho: rs * A / Lg, rho_std: (elec.rr * elec.up / (elec.up - us) ** 2) * sd * A / Lg }
    })
  }, [volt, steps, elec, sensor])

  // Dòng sẽ gửi lên server (cột của template)
  const payload = useMemo(() => {
    const code = sensor?.code
    const base = { ma_cuc: code, do_am_pct: info.moist === '' ? null : num(info.moist), ghi_chu: info.note }
    if (type === 'Cuc') return [{ ...block, la_cuc_doi_chung: block.la_cuc_doi_chung ? 'co' : '' }]
    if (type === 'LapDat') return [{ ...base, ...inst }]
    if (type === 'EpBac' && epMode === 'file')
      return fileRows.filter(r => r.n).map(r => ({ ...base, lan_ep: 1, chu_ky: r.chu_ky, tai_kn: num(r.kn), rho_ohm_m: r.rho, rs_ohm: r.rs,
        rho_std: r.rho_std, so_mau: r.n, nhiet_do_c: num(info.temp), thoi_diem: info.ngay }))
    return tableRows.map(r => {
      const o = { ...base, ...r, thoi_diem: r.thoi_diem || info.ngay }
      if (type === 'EpBac') o.lan_ep = 1
      if (type === 'KiemChung') o.ung_suat_that_mpa = num(r.tai_kn) * 1000 / area
      if (o.rho_ohm_m === '' && sensor && r.rs_ohm !== '' && r.rs_ohm !== undefined)
        o.rho_ohm_m = num(r.rs_ohm) * sensor.electrode_area_mm2 * 1e-6 / (sensor.electrode_gap_mm * 1e-3)
      return o
    })
  }, [type, block, inst, tableRows, info, sensor, epMode, fileRows, area])

  // Kiểm tra: err = phải sửa, warn = nên xem lại, ok/info = thông tin
  const checks = useMemo(() => {
    const c = [], add = (l, m) => c.push([l, m])
    if (type === 'Cuc') {
      if (!block.ma_cuc.trim()) add('err', tr('Chưa nhập mã cục.'))
      else if (sensors.some(s => s.code === block.ma_cuc.trim())) add('warn', tr('Cục {c} đã có: lưu sẽ cập nhật thông tin của nó.', { c: block.ma_cuc }))
      ;['dien_tich_dien_cuc_mm2', 'khoang_cach_dien_cuc_mm', 'dien_tich_chiu_nen_mm2'].forEach(k => { if (!(num(block[k]) > 0)) add('err', tr('Kích thước cục phải lớn hơn 0.')) })
      if (!block.cuong_do_nen_mpa) add('warn', tr('Chưa nhập cường độ nén fc: không kiểm tra được giới hạn ép 20% fc.'))
      if (!block.la_cuc_doi_chung && !block.ma_cuc_doi_chung) add('info', tr('Cục chưa có cục đối chứng đi kèm. Có thể chọn sau.'))
      return c
    }
    if (!sensor) { add('err', tr('Chưa chọn cục.')); return c }
    if (!info.ngay) add('err', tr('Chưa chọn ngày đo.'))
    if (!info.nguoi.trim()) add('warn', tr('Chưa nhập người đo.'))
    const bad = payload.filter(r => !Number.isFinite(num(r.rho_ohm_m ?? r.rho0_ohm_m)))
    if (type === 'LapDat') {
      if (!(num(inst.rho0_ohm_m) > 0)) add('err', tr('Chưa có ρ lúc chưa tải.'))
      if (!Number.isFinite(num(inst.nhiet_do_c))) add('err', tr('Chưa có nhiệt độ trong cục.'))
      if (sensor.reference_sensor_id && !(num(inst.rho_doi_chung_ohm_m) > 0)) add('warn', tr('Cục có cục đối chứng nhưng chưa ghi ρ của nó: mô hình sẽ không bù được ẩm.'))
      if (!c.some(x => x[0] === 'err')) add('ok', tr('Đủ số liệu cho mốc lắp đặt.'))
      return c
    }
    if (!payload.length) { add('err', tr('Chưa có dòng số liệu nào.')); return c }
    if (bad.length) add('err', tr('{n} dòng chưa có ρ (hoặc Rs).', { n: bad.length }))
    const noT = payload.filter(r => !Number.isFinite(num(r.nhiet_do_c)))
    if (noT.length) add('err', tr('{n} dòng chưa có nhiệt độ. Điền ở mục 1 để dùng chung cho mọi dòng.', { n: noT.length }))
    const ok = payload.filter(r => Number.isFinite(num(r.rho_ohm_m)))
    if (type === 'QuetNhiet') {
      const T = ok.map(r => num(r.nhiet_do_c)).filter(Number.isFinite)
      if (T.length) {
        const span = Math.max(...T) - Math.min(...T)
        add(T.length >= 3 && span >= 20 ? 'ok' : 'warn', tr('{n} mức nhiệt, khoảng {s} °C', { n: T.length, s: span.toFixed(0) }) + `${T.length < 3 || span < 20 ? tr(' (nên có ít nhất 3 mức, cách nhau tổng 20 °C)') : ''}.`)
        const s = ok.slice().sort((a, b) => num(a.nhiet_do_c) - num(b.nhiet_do_c))
        if (s.length >= 2 && num(s[s.length - 1].rho_ohm_m) > num(s[0].rho_ohm_m)) add('warn', tr('ρ tăng khi nóng lên, ngược với vật liệu F2: kiểm tra lại cột hoặc độ ẩm.'))
      }
    }
    if (type === 'EpBac') {
      const S = ok.map(r => num(r.tai_kn) * 1000 / area)
      const cycles = [...new Set(ok.map(r => String(r.chu_ky)))]
      cycles.forEach(cy => {
        const first = ok.find(r => String(r.chu_ky) === cy)
        if (first && num(first.tai_kn) > 0.01) add('err', tr('Chu kỳ {c} không bắt đầu bằng bậc 0 kN: mô hình cần bậc 0 làm mốc.', { c: cy }))
      })
      const levels = new Set(S.map(s => s.toFixed(1)))
      add(levels.size >= 3 ? 'ok' : 'warn', tr('{a} bậc, {b} chu kỳ, {c} mức tải, lớn nhất {m} MPa.', { a: ok.length, b: cycles.length, c: levels.size, m: Math.max(...S).toFixed(2) }))
      const fc = num(sensors.find(s => s.id === sensor.id)?.fc_mpa)
      if (fc > 0 && Math.max(...S) > 0.2 * fc) add('warn', tr('Ứng suất vượt 20% fc ({m} MPa): vùng không còn tuyến tính, có thể gây nứt.', { m: (0.2 * fc).toFixed(1) }))
      const zero = ok.filter(r => num(r.tai_kn) <= 0.01).map(r => num(r.rho_ohm_m))
      const top = ok.filter(r => num(r.tai_kn) * 1000 / area >= Math.max(...S) - 0.01).map(r => num(r.rho_ohm_m))
      if (zero.length && top.length) {
        const ch = (top.reduce((a, b) => a + b) / top.length) / (zero.reduce((a, b) => a + b) / zero.length) - 1
        add(ch < 0 ? 'ok' : 'warn', tr('ρ đổi {p}% từ bậc 0 tới bậc lớn nhất', { p: (ch * 100).toFixed(2) }) + `${ch >= 0 ? tr(': lẽ ra phải giảm khi nén, kiểm tra lại') : ''}.`)
      }
      const T = ok.map(r => num(r.nhiet_do_c)).filter(Number.isFinite)
      if (T.length && Math.max(...T) - Math.min(...T) > 3) add('info', tr('Nhiệt độ đổi hơn 3 °C trong lần ép: mô hình sẽ học thêm độ nhạy theo nhiệt.'))
      if (epMode === 'file') {
        if (!volt) add('err', tr('Chưa chọn file điện áp.'))
        else add('ok', tr('File điện áp {f}: {n} mẫu.', { f: volt.name, n: volt.t.length }))
        fileRows.forEach((r, i) => { if (!r.n) add('err', tr('Bậc {n}: không có mẫu nào trong khoảng giây đã khai.', { n: i + 1 })) })
        if (!(elec.up > 0 && elec.rr > 0)) add('err', tr('Nhập điện áp nguồn Up và điện trở Rr.'))
      }
    }
    if (type === 'KiemChung') {
      const noLoad = payload.filter(r => !Number.isFinite(num(r.tai_kn)))
      if (noLoad.length) add('err', tr('{n} dòng chưa có tải biết trước.', { n: noLoad.length }))
      else add('ok', tr('{n} điểm kiểm chứng.', { n: payload.length }))
    }
    return c
  }, [type, block, sensors, sensor, info, payload, inst, epMode, volt, fileRows, elec, area])
  const hasErr = checks.some(c => c[0] === 'err')

  const save = async () => {
    setBusy(true); setMsg(['', ''])
    try {
      const r = await api('/ai/rows', { method: 'POST', body: { sheet: type, rows: payload, context,
        chat: chat.filter(m => !m.error).map(m => ({ role: m.role, content: m.content })) } })
      const n = Object.values(r.counts).reduce((a, b) => a + b, 0)
      setMsg(['ok', tr('Đã lưu {n} dòng vào bộ dữ liệu.', { n })])
      if (type === 'Cuc') { setBlock(BLANK_BLOCK); loadSensors() }
      else if (type === 'LapDat') setInst({ ...inst, rho0_ohm_m: '', rho_doi_chung_ohm_m: '' })
      else if (type === 'EpBac' && epMode === 'file') { setVolt(null); setSteps([{ t0: '', t1: '', kn: '', chu_ky: 1 }]) }
      else setRows(o => ({ ...o, [type]: [] }))
      loadList()
    } catch (e) { setMsg(['err', e.message]) } finally { setBusy(false) }
  }
  const del = async id => {
    if (!confirm(tr('Xoá dòng này khỏi bộ dữ liệu?'))) return
    try { await api(`/ai/rows/${type}/${id}`, { method: 'DELETE' }); loadList() } catch (e) { setMsg(['err', e.message]) }
  }

  if (!isAdmin()) return <div className="card">{tr('Chỉ quản trị viên được nhập dữ liệu.')}</div>
  const note = TYPES_().find(t => t[0] === type)[2]
  const chartPts = type === 'EpBac' ? payload.map(r => [num(r.tai_kn) * 1000 / area, num(r.rho_ohm_m)])
    : type === 'QuetNhiet' ? payload.map(r => [num(r.nhiet_do_c), num(r.rho_ohm_m)]) : []
  const listCols = list.rows[0] ? Object.keys(list.rows[0]).filter(k => !['id', 'created_at'].includes(k)) : []

  return (
    <div className="entry">
      <div className="entry-head">
        <h1>{tr('Nhập dữ liệu huấn luyện')}</h1>
        <span className="tag">{tr('{a} dòng số đo · {b} cục', { a: Object.entries(list.counts).filter(([k]) => k !== 'Cuc').reduce((a, [, v]) => a + v, 0), b: list.counts.Cuc ?? 0 })}</span>
      </div>

      <div className="card">
        <h2>{tr('Bối cảnh thí nghiệm và trợ lý AI')}</h2>
        <p className="hint">{tr('Mô tả thí nghiệm (máy, mẫu, điều kiện, cách đo), rồi kể hoặc dán số liệu vào ô chat. Trợ lý hiểu bối cảnh, chọn đúng loại dữ liệu và điền sẵn vào mục bên dưới. Nó không tự lưu: xem lại ở mục Kiểm tra rồi mới bấm Lưu. Bối cảnh được lưu kèm dữ liệu.')}</p>
        <div className="ai">
          <div className="field"><label>{tr('Bối cảnh thí nghiệm')}</label>
            <textarea rows="7" value={context} onChange={e => setContext(e.target.value)}
              placeholder={tr('Ví dụ: Ép cục SSC-001 trên máy nén 300 kN phòng thí nghiệm, ngày 26/11. Người đo: xi. Nhiệt độ trong cục 25 °C, mẫu đã dưỡng hộ 28 ngày, để khô 3 ngày. Đo Rs bằng ESP32, Up 16 V, Rr 820 Ω. Ép 0 → 12 MPa bậc 2 MPa, 3 chu kỳ.')} /></div>
          <div className="chat">
            <div className="chat-log" ref={logRef}>
              {!chat.length && <p className="hint" style={{ margin: 0 }}>{tr('Ví dụ: "chu kỳ 1: 0 kN Rs 6.25 kΩ, 5 kN 6.2 kΩ, 10 kN 6.14 kΩ…" hoặc dán nguyên bảng ghi chép.')}</p>}
              {chat.map((m, i) => <div key={i} className={`msg ${m.role}${m.error ? ' error' : ''}`}>
                <div>{m.content}</div>
                {m.n > 0 && <div className="msg-note">{tr('Đã điền {n} dòng vào mục "{s}".', { n: m.n, s: TYPES_().find(t => t[0] === (m.sheet || type))?.[1] })}</div>}
                {m.questions?.length > 0 && <ul>{m.questions.map((q, j) => <li key={j}>{q}</li>)}</ul>}
              </div>)}
              {thinking && <div className="msg assistant muted">{tr('Đang đọc…')}</div>}
            </div>
            <div className="chat-in">
              <textarea rows="2" value={ask} onChange={e => setAsk(e.target.value)} placeholder={tr('Nhập hoặc dán số liệu, Enter để gửi, Shift+Enter xuống dòng')}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
              <button onClick={send} disabled={thinking || !ask.trim()}>{tr('Gửi')}</button>
            </div>
            <div className="row spread"><span className="muted">{aiInfo ? `Model: ${aiInfo.model} (${{ claude: 'Claude API', openai: tr('API ngoài') }[aiInfo.provider] || tr('chạy trên máy chủ')})` : ''}</span>
              {chat.length > 0 && <button className="link" onClick={() => setChat([])}>{tr('Bắt đầu lại hội thoại')}</button>}</div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>{tr('Loại dữ liệu')}</h2>
        <p className="hint">{tr('Mỗi lần lưu ghi thẳng vào bộ dữ liệu huấn luyện của server, cùng chỗ với dữ liệu nhập bằng file Excel và dữ liệu tự thu ở trang Hiệu chuẩn.')}</p>
        <div className="seg">{TYPES_().map(([k, label]) => <button key={k} className={type === k ? 'on' : ''} onClick={() => { setType(k); setMsg(['', '']) }}>{label}</button>)}</div>
        <p className="hint" style={{ margin: '12px 0 0' }}>{note}</p>
      </div>

      {type !== 'Cuc' && <div className="card">
        <h2>{tr('1 · Thông tin lần đo')}</h2>
        <p className="hint">{tr('Các ô này được nhớ lại cho lần sau. Ô có dấu')} <span className="req">*</span> {tr('là bắt buộc.')}</p>
        <div className="fgrid">
          <div className="field"><label>{tr('Cục')} <span className="req">*</span></label>
            <select value={info.sid} onChange={e => setI('sid', e.target.value)}>
              <option value="">{tr('— chọn —')}</option>
              {sensors.map(s => <option key={s.id} value={s.id}>{s.code}{s.is_reference ? tr(' (đối chứng)') : ''}{s.online ? ' ●' : ''}</option>)}
            </select></div>
          <div className="field"><label>{tr('Ngày đo')} <span className="req">*</span></label><input type="date" value={info.ngay} onChange={e => setI('ngay', e.target.value)} /></div>
          <div className="field"><label>{tr('Người đo')}</label><input value={info.nguoi} onChange={e => setI('nguoi', e.target.value)} /></div>
          <div className="field"><label>{tr('Nhiệt độ trong cục (°C)')}</label><input type="number" step="0.1" value={info.temp} onChange={e => setI('temp', e.target.value)} placeholder={tr('dùng chung cho các dòng')} /></div>
          <div className="field"><label>{tr('Độ ẩm W (%)')}</label><input type="number" step="0.01" value={info.moist} onChange={e => setI('moist', e.target.value)} /></div>
        </div>
        <div className="field" style={{ marginTop: 12 }}><label>{tr('Ghi chú')}</label><input value={info.note} onChange={e => setI('note', e.target.value)} placeholder={tr('Máy nén, tủ nhiệt, hiện tượng lạ…')} /></div>
        {sensor && <p className="hint" style={{ margin: '10px 0 0' }}>{sensor.online ? tr('● Node đang gửi tín hiệu: dùng được nút "Lấy từ node".') : tr('Node của cục này đang offline: nhập số tay.')} {tr('Diện tích chịu nén')} {area} mm².</p>}
      </div>}

      <div className="card">
        <h2>{type === 'Cuc' ? tr('1 · Thông tin cục') : tr('2 · Số liệu')}</h2>
        {type === 'Cuc' && <div className="fgrid">
          {[['ma_cuc', tr('Mã cục *'), 'text'], ['cap_phoi', tr('Cấp phối *'), 'text'], ['me_duc', tr('Mẻ đúc'), 'text'], ['ngay_duc', tr('Ngày đúc'), 'date'],
            ['cuong_do_nen_mpa', tr('Cường độ nén fc (MPa)'), 'number'], ['dien_tich_dien_cuc_mm2', tr('Diện tích điện cực A (mm²) *'), 'number'],
            ['khoang_cach_dien_cuc_mm', tr('Khoảng cách điện cực L (mm) *'), 'number'], ['dien_tich_chiu_nen_mm2', tr('Diện tích chịu nén (mm²) *'), 'number'],
            ['vi_tri', tr('Vị trí lắp'), 'text']].map(([k, l, t]) =>
            <div className="field" key={k}><label>{l.replace(' *', '')}{l.endsWith('*') && <span className="req"> *</span>}</label>
              <input type={t} step="any" value={block[k]} onChange={e => setBlock({ ...block, [k]: e.target.value })} /></div>)}
          <div className="field"><label>{tr('Cục đối chứng đi kèm')}</label>
            <select value={block.ma_cuc_doi_chung} disabled={block.la_cuc_doi_chung} onChange={e => setBlock({ ...block, ma_cuc_doi_chung: e.target.value })}>
              <option value="">{tr('— không có —')}</option>
              {sensors.filter(s => s.is_reference).map(s => <option key={s.id} value={s.code}>{s.code}</option>)}
            </select></div>
          <label className="inline"><input type="checkbox" checked={block.la_cuc_doi_chung} onChange={e => setBlock({ ...block, la_cuc_doi_chung: e.target.checked, ma_cuc_doi_chung: '' })} /> {tr('Đây là cục đối chứng (không chịu tải)')}</label>
        </div>}

        {type === 'LapDat' && <>
          <div className="row" style={{ marginBottom: 12 }}>
            <button className="secondary" disabled={!sensor?.online} onClick={() => fromNode(60, r => setInst({ ...inst, thoi_diem: nowLocal(), rho0_ohm_m: r.rho.toFixed(5), nhiet_do_c: r.temp != null ? r.temp.toFixed(2) : inst.nhiet_do_c, rho_doi_chung_ohm_m: r.rho_ref != null ? r.rho_ref.toFixed(5) : inst.rho_doi_chung_ohm_m }))}>{tr('Lấy trung bình 60 s từ node')}</button>
          </div>
          <div className="fgrid">
            {[['thoi_diem', tr('Thời điểm *'), 'datetime-local'], ['rho0_ohm_m', tr('ρ lúc chưa tải (Ω·m) *'), 'number'], ['nhiet_do_c', tr('Nhiệt độ trong cục (°C) *'), 'number'],
              ['do_am_pct', tr('Độ ẩm W (%)'), 'number'], ['rho_doi_chung_ohm_m', tr('ρ cục đối chứng (Ω·m)'), 'number']].map(([k, l, t]) =>
              <div className="field" key={k}><label>{l.replace(' *', '')}{l.endsWith('*') && <span className="req"> *</span>}</label>
                <input type={t} step="any" value={inst[k]} onChange={e => setInst({ ...inst, [k]: e.target.value })} /></div>)}
          </div>
        </>}

        {type === 'EpBac' && <div className="radio">
          <label><input type="radio" checked={epMode === 'tay'} onChange={() => setEpMode('tay')} /> {tr('Nhập từng bậc (tay, dán từ Excel, hoặc lấy từ node)')}</label>
          <label><input type="radio" checked={epMode === 'file'} onChange={() => setEpMode('file')} /> {tr('Từ file điện áp ESP32 + các bậc tải')}</label>
        </div>}

        {type === 'EpBac' && epMode === 'file' && <>
          <p className="hint">{tr('File CSV xuất từ dashboard (cột thời gian giây, cột điện áp V hai đầu SSC). Khai các khoảng thời gian tải được giữ ổn định, kể cả đoạn 0 kN.')}</p>
          <input type="file" accept=".csv,.txt" onChange={e => onVolt(e.target.files[0])} />
          <div className="fileinfo">{volt ? tr('{f}: {n} mẫu, {a}–{b} giây', { f: volt.name, n: volt.t.length, a: fmt(volt.t[0], 1), b: fmt(volt.t[volt.t.length - 1], 1) }) : tr('Chưa chọn file.')}</div>
          <div className="fgrid" style={{ margin: '12px 0', maxWidth: 420 }}>
            <div className="field"><label>{tr('Điện áp nguồn Up (V)')}</label><input type="number" step="any" value={elec.up} onChange={e => setElec({ ...elec, up: Number(e.target.value) })} /></div>
            <div className="field"><label>{tr('Điện trở tham chiếu Rr (Ω)')}</label><input type="number" step="any" value={elec.rr} onChange={e => setElec({ ...elec, rr: Number(e.target.value) })} /></div>
          </div>
          <table className="steps"><thead><tr><th>{tr('Chu kỳ')}</th><th>{tr('Từ giây')}</th><th>{tr('Đến giây')}</th><th>{tr('Lực (kN)')}</th><th>{tr('ρ tính được')}</th><th>{tr('Mẫu')}</th><th></th></tr></thead>
            <tbody>{steps.map((s, i) => <tr key={i}>
              {['chu_ky', 't0', 't1', 'kn'].map(k => <td key={k}><input type="number" step="any" value={s[k]} onChange={e => setSteps(steps.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} /></td>)}
              <td className="num">{fmt(fileRows[i]?.rho, 4)}</td><td className="num">{fileRows[i]?.n ?? '–'}</td>
              <td><button className="btn-x" onClick={() => setSteps(steps.filter((_, j) => j !== i))}>✕</button></td></tr>)}</tbody></table>
          <button className="secondary" onClick={() => setSteps([...steps, { t0: '', t1: '', kn: '', chu_ky: steps.at(-1)?.chu_ky || 1 }])}>{tr('＋ Thêm bậc tải')}</button>
        </>}

        {COLS_()[type] && !(type === 'EpBac' && epMode === 'file') && <>
          <div className="row" style={{ marginBottom: 10 }}>
            {type === 'QuetNhiet' && <button className="secondary" onClick={presetTemp}>{tr('Tạo 4 mức 15 / 25 / 35 / 45 °C')}</button>}
            {type === 'EpBac' && <button className="secondary" onClick={presetPress}>{tr('Tạo bậc 0 → 12 → 0 MPa, 3 chu kỳ')}</button>}
            <button className="secondary" onClick={() => addRow(type === 'EpBac' ? { chu_ky: tableRows.at(-1)?.chu_ky || 1 } : {})}>{tr('＋ Thêm dòng')}</button>
          </div>
          <div className="tbl-scroll"><table className="steps">
            <thead><tr>{COLS_()[type].map(([k, l]) => <th key={k}>{l}</th>)}<th></th><th></th></tr></thead>
            <tbody>{tableRows.map((r, i) => <tr key={i}>
              {COLS_()[type].map(([k]) => <td key={k}><input type={k === 'thoi_diem' ? 'datetime-local' : 'number'} step="any" value={r[k] ?? ''} onChange={e => setRow(i, k, e.target.value)} /></td>)}
              <td><button className="btn-x" disabled={!sensor?.online} title={tr('Lấy trung bình 10 giây gần nhất từ node')}
                onClick={() => fromNode(type === 'QuetNhiet' ? 60 : 10, d => setRows(o => ({ ...o, [type]: o[type].map((x, j) => (j === i ? {
                  ...x, rho_ohm_m: d.rho.toFixed(5), rho_std: d.rho_std.toFixed(5), so_mau: d.n,
                  nhiet_do_c: x.nhiet_do_c !== '' && x.nhiet_do_c !== undefined && type === 'QuetNhiet' ? x.nhiet_do_c : (d.temp != null ? d.temp.toFixed(2) : x.nhiet_do_c),
                  ...(type === 'KiemChung' ? { thoi_diem: nowLocal(), rho_doi_chung_ohm_m: d.rho_ref != null ? d.rho_ref.toFixed(5) : '' } : {}),
                } : x)) })))}>{tr('Lấy từ node')}</button></td>
              <td><button className="btn-x" onClick={() => delRow(i)}>✕</button></td></tr>)}
              {!tableRows.length && <tr><td colSpan={COLS_()[type].length + 2} className="muted">{tr('Chưa có dòng nào. Bấm "Thêm dòng", dùng nút tạo sẵn, hoặc dán từ Excel bên dưới.')}</td></tr>}
            </tbody></table></div>
          <details style={{ marginTop: 10 }}>
            <summary className="hint" style={{ cursor: 'pointer' }}>{tr('Dán từ Excel (các cột theo đúng thứ tự trên bảng)')}</summary>
            <textarea rows="4" value={paste} onChange={e => setPaste(e.target.value)} placeholder={COLS_()[type].map(c => c[1]).join('\t')} style={{ width: '100%', marginTop: 8, fontFamily: 'monospace' }} />
            <button className="secondary" onClick={applyPaste} disabled={!paste.trim()}>{tr('Thêm các dòng đã dán')}</button>
          </details>
        </>}
      </div>

      <div className="card">
        <h2>{type === 'Cuc' ? '2' : '3'} · {tr('Kiểm tra')}</h2>
        <ul className="checks">{checks.map(([l, m], i) => <li key={i} className={l}>{m}</li>)}</ul>
        {chartPts.length > 1 && <Scatter pts={chartPts} xl={type === 'EpBac' ? tr('σ (MPa)') : tr('Nhiệt độ (°C)')} yl="ρ (Ω·m)" />}
      </div>

      <div className="card savebar">
        <button className="btn-ok" onClick={save} disabled={busy || hasErr}>{tr('Lưu vào bộ dữ liệu')}</button>
        <span className={msg[0]}>{msg[1]}</span>
        <span style={{ flex: 1 }} />
        <button className="secondary" onClick={() => download('/ai/dataset.xlsx', 'SSC_du_lieu_huan_luyen.xlsx')}>{tr('Xuất toàn bộ ra Excel')}</button>
        <label className="button secondary">{tr('Nhập file Excel')}<input type="file" accept=".xlsx" style={{ display: 'none' }}
          onChange={e => e.target.files[0] && upload('/ai/import', e.target.files[0]).then(r => { setMsg(['ok', tr('Đã nhập file:') + ` ${Object.entries(r.counts).map(([k, v]) => `${k} ${v}`).join(', ')}`]); loadList(); loadSensors() }).catch(er => setMsg(['err', er.message]))} /></label>
      </div>

      <div className="card">
        <h2>{tr('Dữ liệu đã lưu:')} {TYPES_().find(t => t[0] === type)[1].toLowerCase()}{sensor && type !== 'Cuc' ? ` ${tr('của')} ${sensor.code}` : ''}</h2>
        <div className="sum">{TYPES_().slice(1).map(([k, l]) => <div key={k}><b>{list.counts[k] ?? 0}</b>{l} {tr('(mọi cục)')}</div>)}</div>
        <div className="tbl-scroll"><table className="list">
          <thead><tr>{listCols.map(k => <th key={k}>{k}</th>)}<th></th></tr></thead>
          <tbody>{list.rows.slice(0, 200).map(r => <tr key={r.id}>
            {listCols.map(k => <td key={k} className={typeof r[k] === 'number' ? 'num' : ''}>{typeof r[k] === 'number' ? (Number.isInteger(r[k]) ? r[k] : r[k].toFixed(4)) : typeof r[k] === 'boolean' ? (r[k] ? tr('có') : '') : (r[k] ?? '').toString().replace('T', ' ').slice(0, 19)}</td>)}
            <td>{type !== 'Cuc' && <button className="btn-x" onClick={() => del(r.id)}>{tr('Xoá')}</button>}</td></tr>)}
            {!list.rows.length && <tr><td className="muted">{tr('Chưa có dữ liệu.')}</td></tr>}</tbody></table></div>
      </div>
    </div>
  )
}
