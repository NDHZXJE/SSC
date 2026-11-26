import { useEffect, useState } from 'react'
import { api, isAdmin } from '../api'

export default function Devices() {
  const [devs, setDevs] = useState([])
  const [sensors, setSensors] = useState([])
  const [err, setErr] = useState('')
  const load = () => {
    api('/devices').then(setDevs).catch(e => setErr(e.message))
    api('/overview').then(setSensors).catch(() => {})
  }
  useEffect(() => { load(); const t = setInterval(load, 3000); return () => clearInterval(t) }, [])
  const patch = (id, body) => api(`/devices/${id}`, { method: 'PATCH', body }).then(load).catch(e => setErr(e.message))
  const remove = id => confirm(`Xoá thiết bị ${id}?`) && api(`/devices/${id}`, { method: 'DELETE' }).then(load).catch(e => setErr(e.message))
  const admin = isAdmin()
  return (
    <>
      <h1>Thiết bị</h1>
      <p className="muted">Node mới tự xuất hiện ở đây khi gửi dữ liệu lần đầu. Gán mỗi node cho một cục (1 board = 1 cục) và nhập giá trị R1 đo thực bằng đồng hồ.</p>
      {err && <div className="error">{err}</div>}
      <div className="card">
        <table>
          <thead><tr><th>Thiết bị</th><th>Trạng thái</th><th>Cục</th><th>R1 (Ω)</th><th>Firmware</th><th>Wi-Fi</th><th>Lần cuối</th>{admin && <th></th>}</tr></thead>
          <tbody>
            {devs.map(d => (
              <tr key={d.id}>
                <td><strong>{d.id}</strong><div className="muted">{d.ip}</div></td>
                <td><span className={'dot' + (d.online ? ' on' : '')} /> {d.online ? 'online' : 'offline'}</td>
                <td>{admin
                  ? <select value={d.sensor_id || ''} onChange={e => patch(d.id, { sensor_id: e.target.value ? Number(e.target.value) : null })}>
                      <option value="">— chưa gán —</option>
                      {sensors.map(s => <option key={s.id} value={s.id}>{s.code} {s.name}</option>)}
                    </select>
                  : d.sensor_code || '—'}</td>
                <td>{admin
                  ? <input type="number" step="any" defaultValue={d.rr_ohm} style={{ width: 100 }}
                      onBlur={e => Number(e.target.value) !== d.rr_ohm && patch(d.id, { rr_ohm: Number(e.target.value) })} />
                  : d.rr_ohm}</td>
                <td>{d.fw || '—'}</td>
                <td>{d.rssi != null ? `${d.rssi} dBm` : '—'}</td>
                <td>{d.last_seen ? new Date(d.last_seen).toLocaleString('vi-VN') : '—'}</td>
                {admin && <td><button className="danger" onClick={() => remove(d.id)}>Xoá</button></td>}
              </tr>
            ))}
            {!devs.length && <tr><td colSpan="8" className="muted">Chưa có thiết bị nào gửi dữ liệu.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
