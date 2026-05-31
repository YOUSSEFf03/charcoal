import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import { QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { ToastProvider } from './context/ToastContext.tsx'
import { RateProvider } from './context/RateContext.tsx'
import { queryClient } from './lib/queryClient.ts'
import { useTokenSync } from './lib/auth.ts'

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

if (!clerkPublishableKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY — set it in .env')
}

// Lives inside ClerkProvider so useTokenSync() can call Clerk's useAuth() hook.
// It publishes the token getter onto window for the Axios interceptor, then
// renders the rest of the app.
function AppWithAuthSync() {
  useTokenSync()
  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClerkProvider publishableKey={clerkPublishableKey}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <RateProvider>
            <AppWithAuthSync />
          </RateProvider>
        </ToastProvider>
      </QueryClientProvider>
    </ClerkProvider>
  </StrictMode>,
)
