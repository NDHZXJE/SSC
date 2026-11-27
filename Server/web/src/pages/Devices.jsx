import { t as tr, locale } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import { api, isAdmin, upload } from '../api'

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
    <div className="code6" role="group" aria-label={tr('Mã ghép 6 số')}>
      {digits.map((d, i) => (
        <input key={i} ref={el => (refs.current[i] = el)} value={d} inputMode="numeric" autoComplete="one-time-code"
          maxLength={6} aria-label={tr('Số thứ {n}', { n: i + 1 })} autoFocus={i === 0}
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
        <h2>{tr('Thêm mạch đọc')}</h2>
        <button className="secondary" onClick={onClose}>{tr('Đóng')}</button>
      </div>
      <ol className="pair-steps muted">
        <li>{tr('Cấp nguồn cho mạch đọc. Mạch tự vào Wi-Fi và kết nối máy chủ.')}</li>
        <li>{tr('Mạch chưa ghép sẽ hiện')} <b>{tr('mã 6 số')}</b> {tr('(trên màn hình, nhãn dán hoặc Serial Monitor).')}</li>
        <li>{tr('Nhập mã đó vào ô dưới đây. Có thể chọn luôn cục bê tông và R1.')}</li>
      </ol>
      <form onSubmit={e => { e.preventDefault(); submit() }}>
      <CodeInput value={code} onChange={setCode} />
      <div className="form" style={{ marginTop: 14 }}>
        <label>{tr('Gán cho cục (không bắt buộc)')}
          <select value={sensorId} onChange={e => setSensorId(e.target.value)}>
            <option value="">{tr('— để sau —')}</option>
            {sensors.map(s => <option key={s.id} value={s.id}>{s.code} {s.name}</option>)}
          </select>
        </label>
        <label>{tr('R1 đo thực (Ω, không bắt buộc)')}
          <input type="number" step="any" min="0" placeholder="820" value={rr} onChange={e => setRr(e.target.value)} />
        </label>
        <button type="submit" disabled={code.length !== 6 || busy}>{busy ? tr('Đang ghép…') : tr('Ghép mạch')}</button>
      </div>
      </form>
      {err && <div className="error">{err}</div>}
    </div>
  )
}

const kb = n => (n / 1024).toFixed(0) + ' KB'
const BUSY = ['sent', 'downloading', 'rebooting']
const canOta = d => d.online && d.ota_ok && !BUSY.includes(d.ota?.state)

// Tiến độ lần nạp gần nhất của một mạch
function OtaState({ d }) {
  const o = d.ota
  if (!o) return d.ota_ok ? null : <div className="muted small">{tr('chưa hỗ trợ OTA qua server')}</div>
  if (o.state === 'sent') return <div className="ota-st">{tr('Đã gửi lệnh nạp {v}…', { v: o.version })}</div>
  if (o.state === 'downloading') return (
    <div className="ota-st">
      <div className="ota-bar"><span style={{ width: `${o.pct || 0}%` }} /></div>
      {tr('Đang tải {v}: {p}%', { v: o.version, p: o.pct || 0 })}
    </div>
  )
  if (o.state === 'rebooting') return <div className="ota-st">{tr('Đã ghi xong, đang khởi động lại…')}</div>
  if (o.state === 'ok') return <div className="muted small">{tr('Đã nạp {v} lúc {t}', { v: o.version, t: new Date(o.at).toLocaleString(locale()) })}</div>
  if (o.state === 'failed') return <div className="error small" title={o.msg}>{tr('Nạp {v} lỗi: {m}', { v: o.version, m: o.msg || tr('không rõ') })}</div>
  return null
}

// Chọn mạch để nạp một bản firmware
function DeployBox({ fw, devs, onDone }) {
  const [sel, setSel] = useState(() => new Set(devs.filter(d => canOta(d) && d.fw !== fw.version).map(d => d.id)))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const toggle = id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const go = async () => {
    setBusy(true)
    setErr('')
    try {
      const r = await api(`/firmware/${fw.id}/deploy`, { method: 'POST', body: { devices: [...sel] } })
      const bad = Object.entries(r.results).filter(([, v]) => v !== 'sent')
      onDone(Object.keys(r.results).length - bad.length, bad)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="deploy">
      {!devs.length && <div className="muted">{tr('Chưa có mạch nào được ghép.')}</div>}
      {devs.map(d => {
        const why = !d.online ? 'offline' : !d.ota_ok ? tr('firmware chưa hỗ trợ OTA') : BUSY.includes(d.ota?.state) ? tr('đang nạp') : ''
        return (
          <label key={d.id} className={'deploy-row' + (why ? ' off' : '')}>
            <input type="checkbox" disabled={!!why} checked={sel.has(d.id)} onChange={() => toggle(d.id)} />
            <strong>{d.id}</strong> <span className="muted">{d.sensor_code || tr('chưa gán cục')} · {tr('đang chạy')} {d.fw || '?'}</span>
            {why && <span className="badge">{why}</span>}
            {!why && d.fw === fw.version && <span className="badge">{tr('đã là bản này')}</span>}
          </label>
        )
      })}
      <div className="row" style={{ marginTop: 10 }}>
        <button disabled={!sel.size || busy} onClick={go}>{busy ? tr('Đang gửi…') : tr('Nạp {v} cho {n} mạch', { v: fw.version, n: sel.size })}</button>
        <span className="muted small">{tr('Mạch tải firmware từ server, ghi vào phân vùng còn lại rồi khởi động lại (khoảng 1 phút). Bản mới không kết nối lại được server thì mạch tự quay về bản cũ.')}</span>
      </div>
      {err && <div className="error">{err}</div>}
    </div>
  )
}

function FwRow({ f, devs, open, setOpen, del, onDone }) {
  const running = devs.filter(d => d.fw === f.version).length
  return (
    <>
      <tr>
        <td><strong>{f.version}</strong>{running > 0 && <div className="muted small">{tr('{n} mạch đang chạy', { n: running })}</div>}</td>
        <td>{f.project}<div className="muted small">{f.chip} · IDF {f.idf_ver}</div></td>
        <td>{kb(f.size)}</td>
        <td className="small">{f.built}</td>
        <td className="small">{f.notes || '—'}</td>
        <td className="small">{new Date(f.uploaded_at).toLocaleString(locale())}<div className="muted">{f.uploaded_by}</div></td>
        <td style={{ whiteSpace: 'nowrap' }}>
          <button onClick={() => setOpen(!open)}>{open ? tr('Đóng') : tr('Nạp…')}</button>{' '}
          <button className="danger" onClick={() => del(f)}>{tr('Xoá')}</button>
        </td>
      </tr>
      {open && <tr><td colSpan="7"><DeployBox fw={f} devs={devs} onDone={onDone} /></td></tr>}
    </>
  )
}

function FirmwarePanel({ devs, onChanged }) {
  const [list, setList] = useState([])
  const [file, setFile] = useState(null)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(null)
  const [msg, setMsg] = useState(['', ''])
  const fileRef = useRef(null)
  const load = () => api('/firmware').then(setList).catch(e => setMsg(['err', e.message]))
  useEffect(() => { load() }, [])
  const send = async e => {
    e.preventDefault()
    if (!file) return
    setBusy(true)
    setMsg(['', ''])
    try {
      const r = await upload('/firmware', file, { notes })
      setMsg(['ok', tr('Đã tải lên {v} ({p}, {c}, {s}). Chọn mạch để nạp bên dưới.', { v: r.version, p: r.project, c: r.chip, s: kb(r.size) })])
      setFile(null)
      setNotes('')
      if (fileRef.current) fileRef.current.value = ''
      setOpen(r.id)
      load()
    } catch (er) { setMsg(['err', er.message]) } finally { setBusy(false) }
  }
  const del = f => confirm(tr('Xoá firmware {v}?', { v: f.version })) &&
    api(`/firmware/${f.id}`, { method: 'DELETE' }).then(load).catch(e => setMsg(['err', e.message]))
  return (
    <div className="card">
      <h2>Firmware (OTA)</h2>
      <p className="muted">
        {tr('Build bằng')} <code>idf.py build</code> {tr('rồi tải lên file')} <code>build/*.bin</code>. {tr('Server đọc phiên bản ghi trong ảnh')}{' '}
        (<code>PROJECT_VER</code>) {tr('và gửi lệnh cho từng mạch qua MQTT; mạch tự tải về và nạp.')}
      </p>
      <form className="row" onSubmit={send}>
        <input ref={fileRef} type="file" accept=".bin,application/octet-stream" onChange={e => setFile(e.target.files[0] || null)} />
        <input placeholder={tr('Ghi chú (vd: sửa lỗi đo nhiệt độ)')} value={notes} onChange={e => setNotes(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
        <button type="submit" disabled={!file || busy}>{busy ? tr('Đang tải lên…') : tr('Tải lên')}</button>
      </form>
      {msg[0] && <div className={msg[0] === 'ok' ? 'ok' : 'error'}>{msg[1]}</div>}
      <table>
        <thead><tr><th>{tr('Phiên bản')}</th><th>{tr('Dự án')}</th><th>{tr('Kích thước')}</th><th>Build</th><th>{tr('Ghi chú')}</th><th>{tr('Tải lên')}</th><th></th></tr></thead>
        <tbody>
          {list.map(f => (
            <FwRow key={f.id} f={f} devs={devs} open={open === f.id} setOpen={v => setOpen(v ? f.id : null)} del={del}
              onDone={(n, bad) => {
                setOpen(null)
                setMsg([bad.length ? 'err' : 'ok', tr('Đã gửi lệnh nạp {v} cho {n} mạch.', { v: f.version, n }) +
                  (bad.length ? tr(' Bỏ qua: ') + bad.map(([id, why]) => `${id} (${why})`).join(', ') : '')])
                onChanged()
              }} />
          ))}
          {!list.length && <tr><td colSpan="7" className="muted">{tr('Chưa có firmware nào.')}</td></tr>}
        </tbody>
      </table>
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
  const remove = id => confirm(tr('Bỏ ghép và xoá mạch {id}? Mạch sẽ quay về chờ ghép.', { id })) &&
    api(`/devices/${id}`, { method: 'DELETE' }).then(load).catch(e => setErr(e.message))
  const admin = isAdmin()
  return (
    <>
      <div className="row spread">
        <h1>{tr('Thiết bị')}</h1>
        {admin && !adding && (
          <button onClick={() => { setAdding(true); setOk('') }}>
            + {tr('Thêm mạch đọc')}{pending > 0 && <span className="pill-count">{tr('{n} đang chờ', { n: pending })}</span>}
          </button>
        )}
      </div>
      <p className="muted">
        {tr('Mạch đọc mới cần được ghép bằng mã 6 số hiện trên mạch. Sau khi ghép, gán mỗi mạch cho một cục (1 mạch = 1 cục) và nhập giá trị R1 đo thực bằng đồng hồ.')}
      </p>
      {adding && <PairCard sensors={sensors} onClose={() => setAdding(false)}
        onPaired={id => { setAdding(false); setOk(tr('Đã ghép mạch {id}.', { id })); load() }} />}
      {ok && <div className="ok">{ok}</div>}
      {err && <div className="error">{err}</div>}
      <div className="card">
        <table>
          <thead><tr><th>{tr('Thiết bị')}</th><th>{tr('Trạng thái')}</th><th>{tr('Cục')}</th><th>{tr('R1 (Ω)')}</th><th>Firmware</th><th>Wi-Fi</th><th>{tr('Lần cuối')}</th>{admin && <th></th>}</tr></thead>
          <tbody>
            {devs.map(d => (
              <tr key={d.id}>
                <td><strong>{d.id}</strong><div className="muted">{d.ip}</div></td>
                <td><span className={'dot' + (d.online ? ' on' : '')} /> {d.online ? 'online' : 'offline'}</td>
                <td>{admin
                  ? <select value={d.sensor_id || ''} onChange={e => patch(d.id, { sensor_id: e.target.value ? Number(e.target.value) : null })}>
                      <option value="">{tr('— chưa gán —')}</option>
                      {sensors.map(s => <option key={s.id} value={s.id}>{s.code} {s.name}</option>)}
                    </select>
                  : d.sensor_code || '—'}</td>
                <td>{admin
                  ? <input type="number" step="any" defaultValue={d.rr_ohm} style={{ width: 100 }}
                      onBlur={e => Number(e.target.value) !== d.rr_ohm && patch(d.id, { rr_ohm: Number(e.target.value) })} />
                  : d.rr_ohm}</td>
                <td>{d.fw || '—'}<OtaState d={d} /></td>
                <td>{d.rssi != null ? `${d.rssi} dBm` : '—'}</td>
                <td>{d.last_seen ? new Date(d.last_seen).toLocaleString(locale()) : '—'}</td>
                {admin && <td><button className="danger" onClick={() => remove(d.id)}>{tr('Bỏ ghép')}</button></td>}
              </tr>
            ))}
            {!devs.length && (
              <tr><td colSpan="8" className="muted">
                {tr('Chưa có mạch nào được ghép.')}{admin && tr(' Bấm "Thêm mạch đọc" và nhập mã 6 số trên mạch.')}
                {pending > 0 && ' ' + tr('Có {n} mạch đang chờ ghép.', { n: pending })}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      {admin && <FirmwarePanel devs={devs} onChanged={load} />}
    </>
  )
}
