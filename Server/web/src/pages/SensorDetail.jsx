import { t as tr, locale } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import { api, download, fmt, isAdmin } from '../api'
import Chart from '../Chart'

const LIVE_S = 30
const RANGES = [['1 giờ', 3600], ['6 giờ', 21600], ['24 giờ', 86400], ['7 ngày', 604800]]

function useLive(id) {
  const [data, setData] = useState([[], [], []])
  const buf = useRef({ t: [], rho: [], stress: [] })
  const last = useRef(0)
  useEffect(() => {
    buf.current = { t: [], rho: [], stress: [] }
    last.current = 0
    let stop = false
    const tick = async () => {
      try {
        const r = await api(`/sensors/${id}/live?since=${last.current}`)
        if (stop || !r.t.length) return
        last.current = r.t[r.t.length - 1]
        const b = buf.current
        b.t.push(...r.t.map(x => x / 1000)); b.rho.push(...r.rho); b.stress.push(...r.stress)
        const cut = b.t[b.t.length - 1] - LIVE_S
        let i = 0
        while (i < b.t.length && b.t[i] < cut) i++
        if (i) { b.t.splice(0, i); b.rho.splice(0, i); b.stress.splice(0, i) }
        setData([b.t.slice(), b.rho.slice(), b.stress.slice()])
      } catch {}
    }
    tick()
    const h = setInterval(tick, 1000)
    return () => { stop = true; clearInterval(h) }
  }, [id])
  return data
}

export default function SensorDetail({ id }) {
  const [s, setS] = useState(null)
  const [models, setModels] = useState([])
  const [range, setRange] = useState(3600)
  const [hist, setHist] = useState(null)
  const [err, setErr] = useState('')
  const live = useLive(id)

  const load = () => {
    api(`/sensors/${id}`).then(setS).catch(e => setErr(e.message))
    api(`/sensors/${id}/models`).then(setModels).catch(() => {})
  }
  useEffect(load, [id])
  useEffect(() => {
    const end = new Date(), start = new Date(end - range * 1000)
    api(`/sensors/${id}/series?start=${start.toISOString()}&end=${end.toISOString()}`)
      .then(r => setHist(r)).catch(e => setErr(e.message))
  }, [id, range])

  const approve = async mid => {
    try { await api(`/calib/models/${mid}/approve`, { method: 'POST' }); load() } catch (e) { setErr(e.message) }
  }
  const exportData = (resolution, fmtName) => {
    const end = new Date(), start = new Date(end - range * 1000)
    download(`/sensors/${id}/export?start=${start.toISOString()}&end=${end.toISOString()}&resolution=${resolution}&fmt=${fmtName}`,
      `${s?.code || id}_${resolution}.${fmtName}`)
  }

  if (!s) return <div className="card">{err || tr('Đang tải…')}</div>
  const lastRho = live[1].length ? live[1][live[1].length - 1] : null
  const lastStress = live[2].length ? live[2][live[2].length - 1] : null
  const calibrated = !!s.model
  return (
    <>
      <div className="row spread">
        <h1>{s.code} <span className="muted">{s.name}</span></h1>
        <div className="row">
          <span className="row" style={{ gap: 6 }}><span className={'dot' + (s.device?.online ? ' on' : '')} />{s.device ? `${s.device.id} · ${s.device.online ? 'online' : 'offline'}` : tr('chưa gán thiết bị')}</span>
          {isAdmin() && <a href={`#/calib/${id}`}><button>{tr('Hiệu chuẩn')}</button></a>}
        </div>
      </div>
      {err && <div className="error">{err}</div>}

      <div className="card">
        <div className="row spread">
          <h2>{tr('Trực tiếp {n} giây gần nhất (100 mẫu/giây)', { n: LIVE_S })}</h2>
          <div className="row muted">
            <span>{tr('ρ')} <strong>{fmt(lastRho, 4)}</strong> {tr('Ω·m')}</span>
            <span>{tr('σ')} <strong>{fmt(lastStress, 3)}</strong> MPa</span>
            <span>{tr('Tải')} <strong>{lastStress == null ? '–' : fmt(lastStress * s.load_area_mm2 / 1000, 2)}</strong> kN</span>
          </div>
        </div>
        <Chart
          series={calibrated
            ? [{ label: tr('ρ (Ω·m)'), color: '#1f6feb' }, { label: tr('σ (MPa)'), color: '#d1495b', scale: 'y2' }]
            : [{ label: tr('ρ (Ω·m)'), color: '#1f6feb' }]}
          data={calibrated ? live : [live[0], live[1]]}
          yLabel="ρ (Ω·m)" y2Label="σ (MPa)"
        />
        {!calibrated && <div className="muted">{tr('Cục chưa có mô hình hiệu chuẩn được duyệt nên chưa tính được ứng suất.')}</div>}
      </div>

      <div className="card">
        <div className="row spread">
          <h2>{tr('Lịch sử')}</h2>
          <div className="row">
            {RANGES.map(([l, v]) => <button key={v} className={v === range ? '' : 'secondary'} onClick={() => setRange(v)}>{tr(l)}</button>)}
          </div>
        </div>
        {hist && <>
          <Chart
            series={[{ label: tr('ρ trung bình'), color: '#1f6feb' }, { label: tr('σ (MPa)'), color: '#d1495b', scale: 'y2' }, { label: tr('Nhiệt độ (°C)'), color: '#2a9d8f', scale: 'y2' }]}
            data={[hist.t.map(x => x / 1000), hist.rho, hist.stress, hist.temp]}
            yLabel="ρ (Ω·m)" y2Label="σ (MPa), °C"
          />
          <div className="muted">{tr('Mỗi điểm là trung bình {n} giây.', { n: hist.bucket_s })}</div>
        </>}
        <div className="row" style={{ marginTop: 12 }}>
          <span className="muted">{tr('Xuất dữ liệu khoảng này cho AI / phân tích:')}</span>
          <button className="secondary" onClick={() => exportData('raw', 'csv')}>{tr('CSV gốc 100 mẫu/s')}</button>
          <button className="secondary" onClick={() => exportData('1s', 'csv')}>{tr('CSV 1 giây')}</button>
          <button className="secondary" onClick={() => exportData('raw', 'parquet')}>{tr('Parquet gốc')}</button>
        </div>
      </div>

      <div className="card">
        <h2>{tr('Thông số cục')}</h2>
        <dl className="kv">
          <dt>{tr('Cấp phối')}</dt><dd>{s.mix}</dd>
          <dt>{tr('Điện cực A × L')}</dt><dd>{s.electrode_area_mm2} mm² × {s.electrode_gap_mm} mm</dd>
          <dt>{tr('Diện tích chịu nén')}</dt><dd>{s.load_area_mm2} mm²</dd>
          <dt>{tr('ρs0(0) quy về 20 °C')}</dt><dd>{fmt(s.rho0_ref, 4)} Ω·m</dd>
          <dt>{tr('Độ ẩm W dùng để bù')}</dt><dd>{s.moisture_pct} %</dd>
          <dt>{tr('Vị trí')}</dt><dd>{s.location || '—'}</dd>
          <dt>{tr('Ngày đúc')}</dt><dd>{s.cast_date || '—'}</dd>
        </dl>
      </div>

      <div className="card">
        <h2>{tr('Các phiên bản hiệu chuẩn')}</h2>
        <table>
          <thead><tr><th>#</th><th>{tr('Loại')}</th><th>{tr('K (Ω·m/MPa)')}</th><th>{tr('ρ(0)')}</th><th>T (°C)</th><th>R²</th><th>{tr('Sai số σ (MPa)')}</th><th>{tr('Ngày tạo')}</th><th>{tr('Trạng thái')}</th></tr></thead>
          <tbody>
            {models.map(m => (
              <tr key={m.id}>
                <td>{m.id}</td><td>{m.kind === 'eq14' ? tr('Eq.14 (không nén)') : tr('Máy nén')}</td>
                <td>{fmt(m.k, 5)}</td><td>{fmt(m.rho0, 4)}</td><td>{fmt(m.temp, 1)}</td>
                <td>{fmt(m.r2, 4)}</td><td>{fmt(m.rmse_mpa, 3)}</td>
                <td>{new Date(m.created_at).toLocaleString(locale())}</td>
                <td>{m.active ? <span className="badge good">{tr('Đang dùng')}</span>
                  : isAdmin() ? <button className="secondary" onClick={() => approve(m.id)}>{tr('Duyệt và dùng')}</button> : '—'}</td>
              </tr>
            ))}
            {!models.length && <tr><td colSpan="9" className="muted">{tr('Chưa có.')}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
