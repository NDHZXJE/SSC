import { useState } from 'react'
import { api, auth } from '../api'
import '../landing.css'

export default function Login() {
  const [u, setU] = useState('')
  const [p, setP] = useState('')
  const [err, setErr] = useState('')
  const submit = async e => {
    e.preventDefault()
    setErr('')
    try {
      const res = await api('/login', { method: 'POST', body: { username: u, password: p } })
      auth.save(res)
      location.hash = '#/'
    } catch (e) { setErr(e.message) }
  }
  return (
    <div className="lp lp-auth">
      <div className="lp-bg" aria-hidden="true"><span /><span /><span /></div>
      <div className="login card">
      <h1>SSC Monitor</h1>
      <p className="muted">Giám sát bê tông tự cảm biến</p>
      <form onSubmit={submit}>
        <label>Tên đăng nhập<input value={u} onChange={e => setU(e.target.value)} autoFocus /></label>
        <label>Mật khẩu<input type="password" value={p} onChange={e => setP(e.target.value)} /></label>
        {err && <div className="error">{err}</div>}
        <button type="submit">Đăng nhập</button>
      </form>
      <a className="lp-back" href="#/">← Về trang giới thiệu</a>
      </div>
    </div>
  )
}
