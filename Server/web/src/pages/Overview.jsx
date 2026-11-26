import { useEffect, useState } from 'react'
import { api, fmt, isAdmin } from '../api'

export default function Overview() {
  const [rows, setRows] = useState([])
  const [err, setErr] = useState('')
  useEffect(() => {
    let stop = false
    const load = () => api('/overview').then(r => !stop && setRows(r)).catch(e => setErr(e.message))
    load()
    const t = setInterval(load, 2000)
    return () => { stop = true; clearInterval(t) }
  }, [])
  const online = rows.filter(r => r.online).length
  return (
    <>
      <div className="row spread">
        <h1>Tổng quan</h1>
        <span className="muted">{online}/{rows.length} cục đang online · cập nhật mỗi 2 giây</span>
      </div>
      {err && <div className="error">{err}</div>}
      {rows.length === 0 && (
        <div className="card muted">
          Chưa có cục nào. {isAdmin() ? <>Vào <a href="#/admin">Quản trị</a> để thêm cục, rồi gán thiết bị ở <a href="#/devices">Thiết bị</a>.</> : 'Liên hệ quản trị viên.'}
        </div>
      )}
      <div className="grid">
        {rows.map(r => (
          <a key={r.id} className="tile" href={`#/sensor/${r.id}`}>
            <div className="row spread">
              <strong>{r.code}</strong>
              <span className="row" style={{ gap: 6 }}><span className={'dot' + (r.online ? ' on' : '')} />{r.online ? 'online' : 'offline'}</span>
            </div>
            <div className="muted">{r.name || '—'} · {r.mix}{r.location ? ' · ' + r.location : ''}</div>
            {r.model_id
              ? <div className="big">{fmt(r.latest?.load_kn, 2)} <span className="muted">kN</span></div>
              : <div className="big">{fmt(r.latest?.rho, 3)} <span className="muted">Ω·m</span></div>}
            <div className="row muted">
              <span>σ {fmt(r.latest?.stress, 3)} MPa</span>
              <span>ρ {fmt(r.latest?.rho, 3)} Ω·m</span>
              <span>{fmt(r.latest?.temp, 1)} °C</span>
            </div>
            <div style={{ marginTop: 8 }}>
              {r.model_id
                ? <span className="badge good">Đã hiệu chuẩn · {r.model_kind === 'eq14' ? 'Eq.14' : 'máy nén'}</span>
                : <span className="badge warn">Chưa hiệu chuẩn</span>}
              {!r.device_id && <span className="badge" style={{ marginLeft: 6 }}>Chưa gán thiết bị</span>}
            </div>
          </a>
        ))}
      </div>
    </>
  )
}
