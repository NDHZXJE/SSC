import { t as tr, locale } from '../i18n'
import { useEffect, useState } from 'react'
import { api, download, fmt, upload } from '../api'

const P = m => (typeof m.params === 'string' ? JSON.parse(m.params) : m.params) || {}
const FLAG = { ok: 'Tốt', check: 'Cần kiểm tra', no_model: 'Chưa có mô hình' }

// Mô hình AI lai cho một cục: dữ liệu (template + tự thu), huấn luyện, mốc lắp đặt, kiểm chứng, trôi.
export default function AiModel({ sid, online }) {
  const [st, setSt] = useState(null)
  const [temp, setTemp] = useState('')
  const [winT, setWinT] = useState('60')
  const [chkKn, setChkKn] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const load = () => api(`/sensors/${sid}/ai`).then(setSt).catch(e => setErr(e.message))
  useEffect(() => { setSt(null); load() }, [sid])
  const act = async (fn, ok) => {
    setErr(''); setMsg(''); setBusy(true)
    try { const r = await fn(); await load(); if (ok) setMsg(typeof ok === 'function' ? ok(r) : ok) } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  if (!st) return <div className="card">{tr('Đang tải mô hình AI…')}</div>
  const s = st.sensor
  const imp = f => f && act(() => upload('/ai/import', f),
    r => tr('Đã nhập:') + ` ${Object.entries(r.counts).map(([k, v]) => `${k} ${v}`).join(', ')}${r.errors.length ? `. ${tr('{n} dòng lỗi:', { n: r.errors.length })} ${r.errors.slice(0, 3).join('; ')}` : ''}`)
  const setRef = body => act(() => api(`/sensors/${sid}/ai`, { method: 'PATCH', body: { is_reference: s.is_reference, reference_sensor_id: s.reference_sensor_id, ...body } }), tr('Đã lưu.'))
  const tempStep = () => act(() => api('/calib/temp-steps', { method: 'POST', body: { sensor_id: sid, temp: temp === '' ? null : Number(temp), window_s: Number(winT) } }),
    r => tr('Đã ghi mức {t} °C: ρ = {rho} Ω·m', { t: fmt(r.temp, 1), rho: fmt(r.rho, 4) }))
  const zero = () => act(() => api(`/sensors/${sid}/install-zero`, { method: 'POST', body: { window_s: 300 } }),
    r => tr('Đã đặt mốc lắp đặt: ρ0 = {rho} Ω·m ở {t} °C', { rho: fmt(r.rho0, 4), t: fmt(r.temp, 1) }) + (r.rho_ref ? `, ${tr('cục đối chứng')} ${fmt(r.rho_ref, 4)}` : ''))
  const train = () => act(() => api(`/sensors/${sid}/models/hybrid`, { method: 'POST' }), tr('Đã huấn luyện phiên bản mới. Xem sai số rồi bấm Duyệt.'))
  const approve = id => act(() => api(`/calib/models/${id}/approve`, { method: 'POST' }), tr('Đã duyệt. Ứng suất trực tiếp giờ tính bằng mô hình lai.'))
  const check = () => act(() => api(`/sensors/${sid}/field-checks`, { method: 'POST', body: { load_kn: Number(chkKn), window_s: 30 } }),
    r => tr('Đã ghi: tải thật {a} MPa, mô hình ước {b} MPa', { a: fmt(r.stress_true, 2), b: fmt(r.stress_pred, 2) }))
  const drift = () => act(() => api(`/sensors/${sid}/drift`, { method: 'POST' }), r => `${tr('Kiểm tra trôi:')} ${tr(FLAG[r.status] || r.status)}`)
  const errs = st.checks.filter(c => c.stress_pred != null).map(c => c.stress_pred - c.stress_true)
  const rmse = errs.length ? Math.sqrt(errs.reduce((a, e) => a + e * e, 0) / errs.length) : null

  return (
    <div className="card">
      <h2>{tr('Mô hình AI lai')}</h2>
      <p className="muted">{tr('Vật lý (bù nhiệt, ẩm theo bài Measurement 2026) + tham số riêng của cục học từ quét nhiệt và ép theo bậc. Mỗi ứng suất có khoảng tin cậy 95%. Cục có cục đối chứng không tải thì ẩm và lão hóa tự triệt tiêu.')}</p>
      {err && <div className="error">{err}</div>}
      {msg && <div className="ok">{msg}</div>}

      <h3>{tr('1. Dữ liệu')}</h3>
      <div className="row">
        <button className="secondary" onClick={() => download('/ai/template.xlsx', 'SSC_template_du_lieu.xlsx')}>{tr('Tải template trống')}</button>
        <label className="button secondary">{tr('Nhập file đã điền')}<input type="file" accept=".xlsx" style={{ display: 'none' }} onChange={e => imp(e.target.files[0])} /></label>
        <button className="secondary" onClick={() => download('/ai/dataset.xlsx', 'SSC_du_lieu_huan_luyen.xlsx')}>{tr('Xuất toàn bộ dữ liệu đã thu')}</button>
      </div>

      <h3>{tr('2. Cục đối chứng')}</h3>
      <div className="row">
        <label className="inline"><input type="checkbox" checked={s.is_reference} onChange={e => setRef({ is_reference: e.target.checked, reference_sensor_id: null })} /> {tr('Cục này là cục đối chứng (không chịu tải)')}</label>
        {!s.is_reference && <label>{tr('Cục đối chứng đi kèm')}
          <select value={s.reference_sensor_id || ''} onChange={e => setRef({ reference_sensor_id: Number(e.target.value) || null })}>
            <option value="">{tr('— không có —')}</option>
            {st.reference_options.map(r => <option key={r.id} value={r.id}>{r.code}</option>)}
          </select></label>}
      </div>

      <h3>{tr('3. Quét nhiệt không tải (tủ nhiệt 15, 25, 35, 45 °C)')}</h3>
      <div className="row">
        <label>{tr('Nhiệt độ trong cục (°C, trống = lấy từ node)')}<input type="number" step="any" value={temp} onChange={e => setTemp(e.target.value)} style={{ width: 120 }} /></label>
        <label>{tr('Lấy trung bình (giây)')}<input type="number" min="5" max="600" value={winT} onChange={e => setWinT(e.target.value)} style={{ width: 100 }} /></label>
        <button onClick={tempStep} disabled={busy || !online}>{tr('Ghi mức nhiệt')}</button>
      </div>
      <table style={{ marginTop: 8 }}>
        <thead><tr><th>T (°C)</th><th>{tr('ρ (Ω·m)')}</th><th>{tr('± ρ')}</th><th>{tr('Mẫu')}</th><th>{tr('Nguồn')}</th><th></th></tr></thead>
        <tbody>{st.temp_steps.map(t => <tr key={t.id}><td>{fmt(t.temp, 1)}</td><td>{fmt(t.rho, 4)}</td><td>{fmt(t.rho_std, 4)}</td><td>{t.n_samples}</td><td>{t.source}</td>
          <td><button className="link" onClick={() => act(() => api(`/calib/temp-steps/${t.id}`, { method: 'DELETE' }))}>{tr('xoá')}</button></td></tr>)}
          {!st.temp_steps.length && <tr><td colSpan="6" className="muted">{tr('Chưa có. Bỏ qua được, khi đó hệ số nhiệt lấy theo Eq. 12.')}</td></tr>}</tbody>
      </table>

      {!s.is_reference && <>
        <h3>{tr('4. Huấn luyện')}</h3>
        <p className="muted">{tr('Dùng mọi bậc ép ở trên (mọi lần) và các mức nhiệt. Chưa ép thì mô hình lấy độ nhạy trung bình cấp phối (sai số lớn).')}</p>
        <button onClick={train} disabled={busy}>{tr('Huấn luyện mô hình lai')}</button>
        <table style={{ marginTop: 8 }}>
          <thead><tr><th>#</th><th>{tr('Nguồn')}</th><th>{tr('κ (%/MPa)')}</th><th>a (%/°C)</th><th>{tr('ρ0 20 °C')}</th><th>R²</th><th>{tr('Sai số kiểm tra chéo (MPa)')}</th><th></th></tr></thead>
          <tbody>{st.models.map(m => { const p = P(m); return (
            <tr key={m.id}><td>{m.id}</td><td>{p.source === 'prior' ? tr('theo cấp phối') : tr('đã ép')}</td><td>{fmt(p.kappa * 100, 3)}</td><td>{fmt(p.a * 100, 3)}</td>
              <td>{fmt(p.rho20, 3)}</td><td>{fmt(m.r2, 4)}</td><td>{fmt(m.rmse_mpa, 2)}</td>
              <td>{m.active ? <span className="badge good">{tr('Đang dùng')}</span> : <button onClick={() => approve(m.id)} disabled={busy}>{tr('Duyệt')}</button>}</td></tr>) })}
            {!st.models.length && <tr><td colSpan="8" className="muted">{tr('Chưa có phiên bản nào.')}</td></tr>}</tbody>
        </table>

        <h3>{tr('5. Mốc lắp đặt')}</h3>
        <p className="muted">{tr('Sau khi đặt cục vào công trình và TRƯỚC khi cho tải, bấm để lấy trung bình 5 phút làm mốc 0')}
          {s.reference_sensor_id ? tr(' (cục đối chứng phải đang online)') : ''}.</p>
        <div className="row">
          <button onClick={zero} disabled={busy || !online}>{tr('Đặt mốc lắp đặt')}</button>
          {st.install[0] && <span className="muted">{tr('Mốc gần nhất')}: ρ0 = {fmt(st.install[0].rho0, 4)} Ω·m, {fmt(st.install[0].temp, 1)} °C, {new Date(st.install[0].time).toLocaleString(locale())}</span>}
        </div>

        <h3>{tr('6. Kiểm chứng và trôi')}</h3>
        <div className="row">
          <label>{tr('Tải biết chắc đang tác dụng (kN)')}<input type="number" step="any" value={chkKn} onChange={e => setChkKn(e.target.value)} style={{ width: 120 }} /></label>
          <button onClick={check} disabled={busy || !online || chkKn === ''}>{tr('Ghi điểm kiểm chứng')}</button>
          <span className="muted">{tr('{n} điểm', { n: st.checks.length })}{rmse != null ? `, ${tr('sai số')} ${fmt(rmse, 2)} MPa` : ''}</span>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="secondary" onClick={drift} disabled={busy}>{tr('Kiểm tra trôi ngay')}</button>
          {st.drift && <span className={'badge ' + (st.drift.status === 'ok' ? 'good' : 'warn')}>{tr(FLAG[st.drift.status] || st.drift.status)}</span>}
          {st.drift && (typeof st.drift.flags === 'string' ? JSON.parse(st.drift.flags) : st.drift.flags).map((f, i) => <span key={i} className="muted">{f.detail}</span>)}
        </div>
      </>}
    </div>
  )
}
