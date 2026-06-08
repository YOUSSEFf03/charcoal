import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ReactNode } from 'react'
import Layout from './components/layout/Layout'
import { ProtectedRoute } from './components/auth/ProtectedRoute'
import { useTokenSync } from './lib/auth'
import Dashboard from './pages/Dashboard'
import Orders from './pages/Orders'
import Invoices from './pages/Invoices'
import Clients from './pages/Clients'
import Suppliers from './pages/Suppliers'
import Employees from './pages/Employees'
import Warehouse from './pages/Warehouse'
import WarehouseSales from './pages/WarehouseSales'
import Containers from './pages/Containers'
import Packing from './pages/Packing'
import BagPurchases from './pages/BagPurchases'
import Expenses from './pages/Expenses'
import Reports from './pages/Reports'
import CashHandover from './pages/CashHandover'
import Settings from './pages/Settings'
import DriverMobile from './pages/DriverMobile'
import SignIn from './pages/SignIn'
import ClientDetail from './pages/ClientDetail'
import OrderDetail from './pages/OrderDetail'
import NewOrder from './pages/NewOrder'
import ContainerDetail from './pages/ContainerDetail'
import NewContainer from './pages/NewContainer'
import SupplierDetail from './pages/SupplierDetail'
import Balances from './pages/Balances'
import Payment from './pages/Payment'
import FillClients from './pages/FillClients'
import FillClientDetail from './pages/FillClientDetail'
import InvoicePrint from './pages/InvoicePrint'

// Small helper so each protected element reads cleanly below.
const Guard = ({ children, allowedRoles }: { children: ReactNode; allowedRoles?: string[] }) => (
  <ProtectedRoute allowedRoles={allowedRoles}>{children}</ProtectedRoute>
)

export default function App() {
  // Bridges the Clerk token to the Axios interceptor. (Also mounted in main.tsx's
  // AppWithAuthSync; both register the same window.__clerk_token getter.)
  useTokenSync()

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/sign-in" replace />} />

        {/* Public — no auth required */}
        <Route path="/sign-in" element={<SignIn />} />

        {/* Protected standalone — no sidebar, no layout */}
        <Route path="/invoice/:id" element={<Guard><InvoicePrint /></Guard>} />

        {/* Protected standalone — driver mobile (driver + owner only) */}
        <Route
          path="/driver-mobile"
          element={<Guard allowedRoles={['driver', 'owner']}><DriverMobile /></Guard>}
        />

        {/* Standard layout — sidebar + main, all protected (any signed-in role) */}
        <Route element={<Layout />}>
          <Route path="/dashboard" element={<Guard><Dashboard /></Guard>} />

          {/* Orders */}
          <Route path="/orders" element={<Guard><Orders /></Guard>} />
          <Route path="/orders/new" element={<Guard><NewOrder /></Guard>} />
          <Route path="/orders/:id" element={<Guard><OrderDetail /></Guard>} />
          <Route path="/delivery" element={<Navigate to="/orders" replace />} />

          {/* Invoices */}
          <Route path="/invoices" element={<Guard><Invoices /></Guard>} />
          <Route path="/payment" element={<Guard><Payment /></Guard>} />
          <Route path="/payments" element={<Navigate to="/invoices" replace />} />

          {/* Clients */}
          <Route path="/clients" element={<Guard><Clients /></Guard>} />
          <Route path="/clients/:id" element={<Guard><ClientDetail /></Guard>} />

          {/* Fill clients */}
          <Route path="/fill-clients" element={<Guard><FillClients /></Guard>} />
          <Route path="/fill-clients/:id" element={<Guard><FillClientDetail /></Guard>} />

          {/* Suppliers */}
          <Route path="/suppliers" element={<Guard><Suppliers /></Guard>} />
          <Route path="/suppliers/:id" element={<Guard><SupplierDetail /></Guard>} />

          {/* Containers */}
          <Route path="/containers" element={<Guard><Containers /></Guard>} />
          <Route path="/containers/new" element={<Guard><NewContainer /></Guard>} />
          <Route path="/containers/:id" element={<Guard><ContainerDetail /></Guard>} />

          {/* Finance */}
          <Route path="/balances" element={<Guard><Balances /></Guard>} />
          <Route path="/cash-handover" element={<Guard><CashHandover /></Guard>} />
          <Route path="/expenses" element={<Guard><Expenses /></Guard>} />

          {/* Other */}
          <Route path="/employees" element={<Guard><Employees /></Guard>} />
          <Route path="/warehouse" element={<Guard><Warehouse /></Guard>} />
          <Route path="/warehouse-sales" element={<Guard><WarehouseSales /></Guard>} />
          <Route path="/packing" element={<Guard><Packing /></Guard>} />
          <Route path="/bag-purchases" element={<Guard><BagPurchases /></Guard>} />
          <Route path="/reports" element={<Guard><Reports /></Guard>} />
          <Route path="/settings" element={<Guard><Settings /></Guard>} />
        </Route>

        {/* Catch-all — redirect unknown paths to sign-in */}
        <Route path="*" element={<Navigate to="/sign-in" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
