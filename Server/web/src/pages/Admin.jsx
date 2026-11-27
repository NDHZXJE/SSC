import { t as tr } from '../i18n'
import { useEffect, useState } from 'react'
import { api, isAdmin } from '../api'

const EMPTY = { code: '', name: '', mix: 'F2', electrode_area_mm2: 2000, electrode_gap_mm: 30, load_area_mm2: 2500, moisture_pct: 0, location: '', cast_date: '', note: '' }

function SensorForm({ initial, onSave, onCancel }) {
  const [f, setF] = useState(initial)
  const set = k => e => setF({ ...f, [k]: e.target.type === 'number' ? Number(e.target.value) : e.target.value })
  return (
    <form className="form" onSubmit={e => { e.preventDefault(); onSave({ ...f, cast_date: f.cast_date || null }) }}>
      <label>{tr('Mã cục *')}<input required value={f.code} onChange={set('code')} placeholder="SSC-001" /></label>
      <label>{tr('Tên')}<input value={f.name} onChange={set('name')} placeholder={tr('Gối 1 – sàn A')} /></label>
      <label>{tr('Cấp phối')}
        <select value={f.mix} onChange={set('mix')}><option>F2</option><option>F1P1</option><option value="Khác">{tr('Khác')}</option></select>
      </label>
      <label>{tr('Diện tích điện cực A (mm²)')}<input type="number" step="any" value={f.electrode_area_mm2} onChange={set('electrode_area_mm2')} /></label>
      <label>{tr('Khoảng cách điện cực L (mm)')}<input type="number" step="any" value={f.electrode_gap_mm} onChange={set('electrode_gap_mm')} /></label>
      <label>{tr('Diện tích chịu nén (mm²)')}<input type="number" step="any" value={f.load_area_mm2} onChange={set('load_area_mm2')} /></label>
      <label>{tr('Độ ẩm W để bù (%)')}<input type="number" step="any" value={f.moisture_pct} onChange={set('moisture_pct')} /></label>
      <label>{tr('Vị trí')}<input value={f.location} onChange={set('location')} /></label>
      <label>{tr('Ngày đúc')}<input type="date" value={f.cast_date || ''} onChange={set('cast_date')} /></label>
      <label>{tr('Ghi chú')}<input value={f.note} onChange={set('note')} /></label>
      <div className="row"><button type="submit">{tr('Lưu')}</button>{onCancel && <button type="button" className="secondary" onClick={onCancel}>{tr('Huỷ')}</button>}</div>
    </form>
  )
}

export default function Admin() {
  const [sensors, setSensors] = useState([])
  const [users, setUsers] = useState([])
  const [edit, setEdit] = useState(null)
  const [nu, setNu] = useState({ username: '', password: '', role: 'viewer' })
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const load = () => {
    api('/overview').then(setSensors).catch(e => setErr(e.message))
    api('/users').then(setUsers).catch(e => setErr(e.message))
  }
  useEffect(load, [])
  const run = async (fn, ok) => { setErr(''); setMsg(''); try { await fn(); setMsg(ok); load() } catch (e) { setErr(e.message) } }

  if (!isAdmin()) return <div className="card">{tr('Chỉ quản trị viên.')}</div>
  return (
    <>
      <h1>{tr('Quản trị')}</h1>
      {err && <div className="error">{err}</div>}
      {msg && <div className="ok">{msg}</div>}

      <div className="card">
        <h2>{edit?.id ? tr('Sửa cục {c}', { c: edit.code }) : tr('Thêm cục SSC')}</h2>
        <SensorForm key={edit?.id || 'new'} initial={edit || EMPTY}
          onCancel={edit ? () => setEdit(null) : null}
          onSave={f => run(async () => {
            if (edit?.id) await api(`/sensors/${edit.id}`, { method: 'PUT', body: f })
            else await api('/sensors', { method: 'POST', body: f })
            setEdit(null)
          }, edit?.id ? tr('Đã lưu.') : tr('Đã thêm cục. Gán thiết bị cho cục ở trang Thiết bị.'))} />
      </div>

      <div className="card">
        <h2>{tr('Danh sách cục')}</h2>
        <table>
          <thead><tr><th>{tr('Mã')}</th><th>{tr('Tên')}</th><th>{tr('Cấp phối')}</th><th>{tr('Vị trí')}</th><th>{tr('Thiết bị')}</th><th>{tr('Hiệu chuẩn')}</th><th></th></tr></thead>
          <tbody>{sensors.map(s => (
            <tr key={s.id}>
              <td><a href={`#/sensor/${s.id}`}>{s.code}</a></td><td>{s.name}</td><td>{s.mix}</td><td>{s.location}</td>
              <td>{s.device_id || '—'}</td><td>{s.model_id ? tr('có') : tr('chưa')}</td>
              <td className="row">
                <button className="secondary" onClick={() => setEdit({ ...s, cast_date: s.cast_date || '' })}>{tr('Sửa')}</button>
                <button className="danger" onClick={() => confirm(tr('Xoá cục {c} và toàn bộ hiệu chuẩn?', { c: s.code })) &&
                  run(() => api(`/sensors/${s.id}`, { method: 'DELETE' }), tr('Đã xoá.'))}>{tr('Xoá')}</button>
              </td>
            </tr>))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>{tr('Tài khoản')}</h2>
        <form className="row" onSubmit={e => { e.preventDefault(); run(async () => { await api('/users', { method: 'POST', body: nu }); setNu({ username: '', password: '', role: 'viewer' }) }, tr('Đã tạo tài khoản.')) }}>
          <input required placeholder={tr('Tên đăng nhập')} value={nu.username} onChange={e => setNu({ ...nu, username: e.target.value })} />
          <input required type="password" minLength="6" placeholder={tr('Mật khẩu (≥ 6 ký tự)')} value={nu.password} onChange={e => setNu({ ...nu, password: e.target.value })} />
          <select value={nu.role} onChange={e => setNu({ ...nu, role: e.target.value })}>
            <option value="viewer">{tr('Người xem')}</option><option value="admin">{tr('Quản trị')}</option>
          </select>
          <button type="submit">{tr('Tạo')}</button>
        </form>
        <table style={{ marginTop: 12 }}>
          <thead><tr><th>{tr('Tên')}</th><th>{tr('Vai trò')}</th><th>{tr('Ngày tạo')}</th><th></th></tr></thead>
          <tbody>{users.map(u => (
            <tr key={u.id}><td>{u.username}</td><td>{u.role === 'admin' ? tr('Quản trị') : tr('Người xem')}</td>
              <td>{new Date(u.created_at).toLocaleDateString('vi-VN')}</td>
              <td><button className="danger" onClick={() => confirm(tr('Xoá {u}?', { u: u.username })) && run(() => api(`/users/${u.id}`, { method: 'DELETE' }), tr('Đã xoá.'))}>{tr('Xoá')}</button></td></tr>))}
          </tbody>
        </table>
      </div>
    </>
  )
}
