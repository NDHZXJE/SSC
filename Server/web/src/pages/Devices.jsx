import { useEffect, useRef, useState } from 'react'
import { api, isAdmin } from '../api'

// Ô nhập mã 6 số: tự nhảy ô, dán được cả mã, Backspace lùi ô
function CodeInput({ value, onChange }) {
  const refs = useRef([])
  const digits = Array.from({ length: 6 }, (_, i) => value[i] || '')
  const set = (i, ch) => {
    const next = digits.slice()
    next[i] = ch
    const v = next.join('').slice(0, 6)
    onChange(v)
    return v
  }
  const onInput = (i, e) => {
    const only = e.target.value.replace(/\D/g, '')
    if (!only) return
    if (only.length > 1) {   // dán cả mã hoặc gõ nhanh
      const v = (digits.slice(0, i).join('') + only).slice(0, 6)
      onChange(v)
      refs.current[Math.min(v.length, 5)]?.focus()
      return
    }
    set(i, only)
    if (i < 5) refs.current[i + 1]?.focus()
  }
  const onKey = (i, e) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      set(i - 1, '')
      refs.current[i - 1]?.focus()
      e.preventDefault()
    } else if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus()
    else if (e.key === 'ArrowRight' && i < 5) refs.current[i + 1]?.focus()
  }
  return (
    <div className="code6" role="group" aria-label="Mã ghép 6 số">
      {digits.map((d, i) => (
        <input key={i} ref={el => (refs.current[i] = el)} value={d} inputMode="numeric" autoComplete="one-time-code"
          maxLength={6} aria-label={`Số thứ ${i + 1}`} autoFocus={i === 0}
          onChange={e => (e.target.value ? onInput(i, e) : set(i, ''))} onKeyDown={e => onKey(i, e)}
          onFocus={e => e.target.select()} />
      ))}
    </div>
  )
}

function PairCard({ sensors, onClose, onPaired }) {
  const [code, setCode] = useState('')
  const [sensorId, setSensorId] = useState('')
  const [rr, setRr] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const submit = async (c = code) => {
    if (c.length !== 6 || busy) return
    setBusy(true)
    setErr('')
    try {
      const body = { code: c }
      if (sensorId) body.sensor_id = Number(sensorId)
      if (rr) body.rr_ohm = Number(rr)
      const res = await api('/devices/pair', { method: 'POST', body })
      onPaired(res.id)
    } catch (e) {
      setErr(e.message)
      setCode('')
    } finally { setBusy(false) }
  }
  return (
    <div className="card pair">
      <div className="row spread">
        <h2>Thêm mạch đọc</h2>
        <button className="secondary" onClick={onClose}>Đóng</button>
      </div>
      <ol className="pair-steps muted">
        <li>Cấp nguồn cho mạch đọc. Mạch tự vào Wi-Fi và kết nối máy chủ.</li>
        <li>Mạch chưa ghép sẽ hiện <b>mã 6 số</b> (trên màn hình, nhãn dán hoặc Serial Monitor).</li>
        <li>Nhập mã đó vào ô dưới đây. Có thể chọn luôn cục bê tông và R1.</li>
      </ol>
      <form onSubmit={e => { e.preventDefault(); submit() }}>
      <CodeInput value={code} onChange={setCode} />
      <div className="form" style={{ marginTop: 14 }}>
        <label>Gán cho cục (không bắt buộc)
          <select value={sensorId} onChange={e => setSensorId(e.target.value)}>
            <option value="">— để sau —</option>
            {sensors.map(s => <option key={s.id} value={s.id}>{s.code} {s.name}</option>)}
          </select>
        </label>
        <label>R1 đo thực (Ω, không bắt buộc)
          <input type="number" step="any" min="0" placeholder="820" value={rr} onChange={e => setRr(e.target.value)} />
        </label>
        <button type="submit" disabled={code.length !== 6 || busy}>{busy ? 'Đang ghép…' : 'Ghép mạch'}</button>
      </div>
      </form>
      {err && <div className="error">{err}</div>}
    </div>
  )
}

export default function Devices() {
  const [devs, setDevs] = useState([])
  const [sensors, setSensors] = useState([])
  const [pending, setPending] = useState(0)
  const [adding, setAdding] = useState(false)
  const [ok, setOk] = useState('')
  const [err, setErr] = useState('')
  const load = () => {
    api('/devices').then(setDevs).catch(e => setErr(e.message))
    api('/devices/pending').then(r => setPending(r.count)).catch(() => {})
    api('/overview').then(setSensors).catch(() => {})
  }
  useEffect(() => { load(); const t = setInterval(load, 3000); return () => clearInterval(t) }, [])
  const patch = (id, body) => api(`/devices/${id}`, { method: 'PATCH', body }).then(load).catch(e => setErr(e.message))
  const remove = id => confirm(`Bỏ ghép và xoá mạch ${id}? Mạch sẽ quay về chờ ghép.`) &&
    api(`/devices/${id}`, { method: 'DELETE' }).then(load).catch(e => setErr(e.message))
  const admin = isAdmin()
  return (
    <>
      <div className="row spread">
        <h1>Thiết bị</h1>
        {admin && !adding && (
          <button onClick={() => { setAdding(true); setOk('') }}>
            + Thêm mạch đọc{pending > 0 && <span className="pill-count">{pending} đang chờ</span>}
          </button>
        )}
      </div>
      <p className="muted">
        Mạch đọc mới cần được ghép bằng mã 6 số hiện trên mạch. Sau khi ghép, gán mỗi mạch cho một cục (1 mạch = 1 cục)
        và nhập giá trị R1 đo thực bằng đồng hồ.
      </p>
      {adding && <PairCard sensors={sensors} onClose={() => setAdding(false)}
        onPaired={id => { setAdding(false); setOk(`Đã ghép mạch ${id}.`); load() }} />}
      {ok && <div className="ok">{ok}</div>}
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
                {admin && <td><button className="danger" onClick={() => remove(d.id)}>Bỏ ghép</button></td>}
              </tr>
            ))}
            {!devs.length && (
              <tr><td colSpan="8" className="muted">
                Chưa có mạch nào được ghép.{admin && ' Bấm "Thêm mạch đọc" và nhập mã 6 số trên mạch.'}
                {pending > 0 && ` Có ${pending} mạch đang chờ ghép.`}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
