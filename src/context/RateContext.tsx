import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { useExchangeRate, useSetExchangeRate } from '../hooks/useSettings'

interface RateCtx {
  rate: string        // formatted with commas e.g. "89,550"
  rawRate: number     // numeric e.g. 89550
  setRate: (r: string) => void  // accepts formatted or raw string
  isSaving: boolean
}

const DEFAULT_RATE = 89550
const RateContext = createContext<RateCtx>({
  rate: DEFAULT_RATE.toLocaleString(),
  rawRate: DEFAULT_RATE,
  setRate: () => {},
  isSaving: false,
})

export function RateProvider({ children }: { children: ReactNode }) {
  const { data: backendRate } = useExchangeRate()
  const setRateMutation = useSetExchangeRate()
  const [rate, setLocalRate] = useState(DEFAULT_RATE)

  // Sync from backend once loaded
  useEffect(() => {
    if (backendRate != null) setLocalRate(backendRate)
  }, [backendRate])

  function setRate(r: string) {
    const parsed = parseInt(r.replace(/,/g, ''), 10)
    if (!isNaN(parsed) && parsed > 0) {
      setLocalRate(parsed)
      setRateMutation.mutate(parsed)
    }
  }

  return (
    <RateContext.Provider value={{
      rate: rate.toLocaleString(),
      rawRate: rate,
      setRate,
      isSaving: setRateMutation.isPending,
    }}>
      {children}
    </RateContext.Provider>
  )
}

export function useRate() {
  return useContext(RateContext)
}
