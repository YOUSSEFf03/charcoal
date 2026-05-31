import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'

export default function Layout() {
  return (
    <div style={{ display: 'flex', flex: 1 }}>
      <Sidebar />
      <div className="main">
        <Outlet />
      </div>
    </div>
  )
}
