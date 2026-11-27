import { t as tr, locale } from '../i18n'
import { useEffect, useState } from 'react'
import { api, fmt, isAdmin } from '../api'
import AiModel from './AiModel'

// Small SVG scatter of Δρ vs σ with the fitted line.
function FitPlot({ steps, model }) {
  if (steps.length < 1) return null
  const W = 520, H = 260, P = 44
  const zero = steps.reduce((a, s) => (Math.abs(s.stress_mpa) < Math.abs(a.stress_mpa) ? s : a), steps[0])
  const pts = steps.map(s => [s.stress_mpa, s.rho - zero.rho])
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
  const x0 = Math.min(0, ...xs), x1 = Math.max(...xs, 1e-6)
  let y0 = Math.min(0, ...ys), y1 = Math.max(0, ...ys)
  if (y1 - y0 < 1e-9) { y0 -= 1; y1 += 1 }
  const X = x => P + (x - x0) / (x1 - x0 || 1) * (W - 2 * P)
  const Y = y => H - P - (y - y0) / (y1 - y0) * (H - 2 * P)
  const c = model?.params ? (typeof model.params === 'string' ? JSON.parse(model.params) : model.params).intercept || 0 : 0
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W }}>
      <line x1={P} x2={W - P} y1={Y(0)} y2={Y(0)} stroke="currentColor" opacity=".25" />
      <line x1={X(0)} x2={X(0)} y1={P / 2} y2={H - P} stroke="currentColor" opacity=".25" />
      <text x={W / 2} y={H - 8} textAnchor="middle" fontSize="12" fill="currentColor" opacity=".7">{tr('σ (MPa)')}</text>
      <text x={12} y={H / 2} fontSize="12" fill="currentColor" opacity=".7" transform={`rotate(-90 12 ${H / 2})`} textAnchor="middle">{tr('Δρ (Ω·m)')}</text>
      <text x={P - 4} y={Y(y1) + 4} textAnchor="end" fontSize="11" fill="currentColor" opacity=".6">{y1.toFixed(3)}</text>
      <text x={P - 4} y={Y(y0) + 4} textAnchor="end" fontSize="11" fill="currentColor" opacity=".6">{y0.toFixed(3)}</text>
      <text x={X(x1)} y={H - P + 14} textAnchor="middle" fontSize="11" fill="currentColor" opacity=".6">{x1.toFixed(1)}</text>
      {model && <line x1={X(x0)} y1={Y(model.k * x0 + c)} x2={X(x1)} y2={Y(model.k * x1 + c)} stroke="#d1495b" strokeWidth="1.5" />}
      {pts.map((p, i) => <circle key={i} cx={X(p[0])} cy={Y(p[1])} r="4" fill="#1f6feb" />)}
    </svg>
  )
}

export default function Calibration({ sensorId }) {
  const [sensors, setSensors] = useState([])
  const [sid, setSid] = useState(sensorId)
  const [runs, setRuns] = useState([])
  const [run, setRun] = useState(null)
  const [loadKn, setLoadKn] = useState('0')
  const [windowS, setWindowS] = useState('3')
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const sensor = sensors.find(s => s.id === sid)

  useEffect(() => {
    const load = () => api('/overview').then(setSensors).catch(e => setErr(e.message))
    load()
    const t = setInterval(load, 2000)
    return () => clearInterval(t)
  }, [])
  const loadRuns = () => sid && api(`/calib/runs?sensor_id=${sid}`).then(setRuns).catch(e => setErr(e.message))
  useEffect(() => { setRun(null); loadRuns() }, [sid])
  const openRun = id => api(`/calib/runs/${id}`).then(setRun).catch(e => setErr(e.message))

  const act = async (fn, okMsg) => {
    setErr(''); setMsg(''); setBusy(true)
    try { await fn(); if (okMsg) setMsg(okMsg) } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const newRun = () => act(async () => {
    const r = await api('/calib/runs', { method: 'POST', body: { sensor_id: sid, note } })
    setNote(''); await loadRuns(); await openRun(r.id)
  }, tr('Đã tạo lần hiệu chuẩn mới. Bắt đầu với bậc 0 kN.'))
  const addStep = () => act(async () => {
    const st = await api(`/calib/runs/${run.id}/steps`, { method: 'POST', body: { load_kn: Number(loadKn), window_s: Number(windowS) } })
    await openRun(run.id)
    setMsg(tr('Đã ghi bậc {kn} kN: ρ = {rho} ± {sd} Ω·m ({n} mẫu)', { kn: st.load_kn, rho: fmt(st.rho, 4), sd: fmt(st.rho_std, 4), n: st.n_samples }))
  })
  const delStep = id => act(async () => { await api(`/calib/steps/${id}`, { method: 'DELETE' }); await openRun(run.id) })
  const fit = () => act(async () => { await api(`/calib/runs/${run.id}/fit`, { method: 'POST' }); await openRun(run.id) }, tr('Đã khớp mô hình. Kiểm tra R² rồi bấm Duyệt.'))
  const approve = mid => act(async () => { await api(`/calib/models/${mid}/approve`, { method: 'POST' }); await openRun(run.id) }, tr('Đã duyệt. Từ giờ ứng suất của cục được tính bằng mô hình này.'))
  const eq14 = () => act(async () => {
    const m = await api(`/sensors/${sid}/models/eq14`, { method: 'POST' })
    setMsg(tr('Đã tạo mô hình Eq.14: ρ(0) = {rho} Ω·m, K = {k}. Vào trang cục để duyệt.', { rho: fmt(m.rho0, 4), k: fmt(m.k, 5) }))
  })

  if (!isAdmin()) return <div className="card">{tr('Chỉ quản trị viên được hiệu chuẩn. Kết quả hiệu chuẩn xem ở trang từng cục.')}</div>
  const latestModel = run?.models?.[0]

  return (
    <>
      <h1>{tr('Hiệu chuẩn')}</h1>
      {err && <div className="error">{err}</div>}
      {msg && <div className="ok">{msg}</div>}

      <div className="card">
        <div className="form">
          <label>{tr('Cục cần hiệu chuẩn')}
            <select value={sid || ''} onChange={e => setSid(Number(e.target.value) || null)}>
              <option value="">{tr('— chọn —')}</option>
              {sensors.map(s => <option key={s.id} value={s.id}>{s.code} {s.name} {s.online ? '' : '(offline)'}</option>)}
            </select>
          </label>
          {sensor && <div className="muted">
            <span className={'dot' + (sensor.online ? ' on' : '')} /> {sensor.online ? 'online' : 'offline'} ·
            {tr('ρ hiện tại')} <strong>{fmt(sensor.latest?.rho, 4)}</strong> Ω·m · {fmt(sensor.latest?.temp, 1)} °C ·
            {tr('diện tích nén')} {sensor.load_area_mm2} mm²
          </div>}
        </div>
      </div>

      {sid && <div className="card">
        <h2>{tr('Lần hiệu chuẩn')}</h2>
        <div className="row">
          <input placeholder={tr('Ghi chú (máy nén, người làm…)')} value={note} onChange={e => setNote(e.target.value)} style={{ flex: 1 }} />
          <button onClick={newRun} disabled={busy}>{tr('Bắt đầu lần mới')}</button>
          <button className="secondary" onClick={eq14} disabled={busy} title={tr('Không có máy nén: đo ρ(0) lúc không tải, lấy K từ Eq. 14/15')}>{tr('Tạo nhanh từ Eq.14')}</button>
        </div>
        <table style={{ marginTop: 12 }}>
          <thead><tr><th>#</th><th>{tr('Ngày')}</th><th>{tr('Người làm')}</th><th>{tr('Ghi chú')}</th><th>{tr('Số bậc')}</th><th>{tr('Trạng thái')}</th><th></th></tr></thead>
          <tbody>{runs.map(r => (
            <tr key={r.id}>
              <td>{r.id}</td><td>{new Date(r.created_at).toLocaleString(locale())}</td><td>{r.created_by}</td>
              <td>{r.note}</td><td>{r.n_steps}</td><td>{r.status === 'fitted' ? tr('đã khớp') : tr('đang làm')}</td>
              <td><button className="secondary" onClick={() => openRun(r.id)}>{tr('Mở')}</button></td>
            </tr>))}
            {!runs.length && <tr><td colSpan="7" className="muted">{tr('Chưa có lần nào.')}</td></tr>}
          </tbody>
        </table>
      </div>}

      {run && <div className="card">
        <h2>{tr('Lần #{n}: ghi từng bậc tải', { n: run.id })}</h2>
        <p className="muted">
          {tr('Gia tải trên máy nén, chờ tín hiệu ổn định, nhập lực đang gia rồi bấm')} <strong>{tr('Ghi bậc')}</strong>.{' '}
          {tr('Hệ thống lấy trung bình ρ trong {n} giây gần nhất. Nên ghi bậc 0 kN đầu tiên và giữ ứng suất dưới 20% cường độ nén.', { n: windowS })}
        </p>
        <div className="row">
          <label>{tr('Lực đang gia (kN)')}<input type="number" step="any" value={loadKn} onChange={e => setLoadKn(e.target.value)} style={{ width: 140 }} /></label>
          <label>{tr('Lấy trung bình (giây)')}<input type="number" min="0.5" max="60" step="0.5" value={windowS} onChange={e => setWindowS(e.target.value)} style={{ width: 120 }} /></label>
          <button onClick={addStep} disabled={busy || !sensor?.online}>{tr('Ghi bậc')}</button>
          {!sensor?.online && <span className="error">{tr('Cục đang offline')}</span>}
        </div>
        <div className="row" style={{ alignItems: 'flex-start', marginTop: 12 }}>
          <table style={{ flex: '1 1 380px' }}>
            <thead><tr><th>{tr('Lực (kN)')}</th><th>{tr('σ (MPa)')}</th><th>{tr('ρ (Ω·m)')}</th><th>{tr('± ρ')}</th><th>T (°C)</th><th>{tr('Mẫu')}</th><th></th></tr></thead>
            <tbody>{run.steps.map(s => (
              <tr key={s.id}>
                <td>{s.load_kn}</td><td>{fmt(s.stress_mpa, 3)}</td><td>{fmt(s.rho, 4)}</td><td>{fmt(s.rho_std, 4)}</td>
                <td>{fmt(s.temp, 1)}</td><td>{s.n_samples}</td>
                <td><button className="link" onClick={() => delStep(s.id)}>{tr('xoá')}</button></td>
              </tr>))}
              {!run.steps.length && <tr><td colSpan="7" className="muted">{tr('Chưa có bậc nào.')}</td></tr>}
            </tbody>
          </table>
          <div style={{ flex: '1 1 380px' }}><FitPlot steps={run.steps} model={latestModel} /></div>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button onClick={fit} disabled={busy || run.steps.length < 2}>{tr('Khớp mô hình Δρ = K·σ')}</button>
        </div>
        {run.models.map(m => (
          <div key={m.id} className="row" style={{ marginTop: 10 }}>
            <span>{tr('Mô hình')} #{m.id}: K = <strong>{fmt(m.k, 5)}</strong> Ω·m/MPa · ρ(0) = {fmt(m.rho0, 4)} ·
              R² = <strong>{fmt(m.r2, 4)}</strong> · {tr('sai số σ')} = {fmt(m.rmse_mpa, 3)} MPa · {tr('ρs0 quy về 20 °C')} = {fmt(m.rho0_ref, 4)}</span>
            {m.active ? <span className="badge good">{tr('Đang dùng')}</span> : <button onClick={() => approve(m.id)} disabled={busy}>{tr('Duyệt và dùng')}</button>}
          </div>
        ))}
      </div>}

      {sid && <AiModel sid={sid} online={!!sensor?.online} />}
    </>
  )
}
