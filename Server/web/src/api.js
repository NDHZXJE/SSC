// Tiny API client. Token lives in localStorage.
const KEY = 'ssc_token'

export const auth = {
  get token() { try { return localStorage.getItem(KEY) } catch { return null } },
  get user() { try { return JSON.parse(localStorage.getItem('ssc_user') || 'null') } catch { return null } },
  save(res) {
    try {
      localStorage.setItem(KEY, res.token)
      localStorage.setItem('ssc_user', JSON.stringify({ username: res.username, role: res.role }))
    } catch {}
  },
  clear() { try { localStorage.removeItem(KEY); localStorage.removeItem('ssc_user') } catch {} },
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(auth.token ? { Authorization: 'Bearer ' + auth.token } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401) {
    auth.clear()
    location.hash = '#/login'
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const d = data.detail
    throw new Error(typeof d === 'string' ? d : JSON.stringify(d || res.statusText))
  }
  return data
}

export function download(path, filename) {
  fetch('/api' + path, { headers: { Authorization: 'Bearer ' + auth.token } })
    .then(r => { if (!r.ok) throw new Error('Tải xuống lỗi'); return r.blob() })
    .then(b => {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(b)
      a.download = filename
      a.click()
      URL.revokeObjectURL(a.href)
    })
    .catch(e => alert(e.message))
}

export const fmt = (v, d = 3) => (v === null || v === undefined || Number.isNaN(v) ? '–' : Number(v).toFixed(d))
export const isAdmin = () => auth.user?.role === 'admin'

export async function upload(path, file) {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch('/api' + path, { method: 'POST', body: fd, headers: { Authorization: 'Bearer ' + auth.token } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail || res.statusText))
  return data
}
