import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'
import { auth } from './api'
import Login from './pages/Login'
import Overview from './pages/Overview'
import SensorDetail from './pages/SensorDetail'
import Calibration from './pages/Calibration'
import Devices from './pages/Devices'
import Admin from './pages/Admin'
import DataEntry from './pages/DataEntry'

function useHash() {
  const [hash, setHash] = useState(location.hash || '#/')
  useEffect(() => {
    const on = () => setHash(location.hash || '#/')
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  return hash
}

function App() {
  const hash = useHash()
  const user = auth.user
  if (!auth.token || hash === '#/login') return <Login />

  const [, page, arg] = hash.slice(1).split('/')
  let body
  if (page === 'sensor') body = <SensorDetail id={Number(arg)} />
  else if (page === 'calib') body = <Calibration sensorId={arg ? Number(arg) : null} />
  else if (page === 'devices') body = <Devices />
  else if (page === 'admin') body = <Admin />
  else if (page === 'data') body = <DataEntry />
  else body = <Overview />

  const link = (h, label) => (
    <a href={h} className={hash.startsWith(h) && (h !== '#/' || hash === '#/') ? 'active' : ''}>{label}</a>
  )
  return (
    <>
      <header>
        <strong>SSC Monitor</strong>
        <nav>
          {link('#/', 'Tổng quan')}
          {link('#/calib', 'Hiệu chuẩn')}
          {link('#/devices', 'Thiết bị')}
          {user?.role === 'admin' && link('#/data', 'Nhập dữ liệu')}
          {user?.role === 'admin' && link('#/admin', 'Quản trị')}
        </nav>
        <span className="who">
          {user?.username} ({user?.role === 'admin' ? 'quản trị' : 'người xem'})
          <button className="link" onClick={() => { auth.clear(); location.hash = '#/login' }}>Đăng xuất</button>
        </span>
      </header>
      <main>{body}</main>
    </>
  )
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)
