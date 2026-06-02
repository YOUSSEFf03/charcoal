import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

/** One packed-bag line in a walk-in sale (price quoted in its own currency). */
export interface WalkInBagLine {
  packedStockId: string
  bagTypeId: string
  bagTypeName: string
  quantity: number
  pricePerBag: string
  currency: 'USD' | 'LBP'
}

/** Payload for POST /walk-in-sales. */
export interface CreateWalkInSaleDto {
  clientId: string
  date: string
  bags: WalkInBagLine[]
  receivedUsd?: string
  receivedLbp?: string
  method: 'cash' | 'whish' | 'omt' | 'bank_transfer' | 'cheque'
  receiverId?: string
  recipient?: string
  notes?: string
}

/**
 * Record a walk-in sale to a REGISTERED client in one atomic backend call:
 * stock exit + issued invoice + payment (in the client's currency).
 *
 * Replaces the old two-call flow (separate exit + USD-hardcoded payment) that left
 * the client balance negative and recorded the wrong currency. Anonymous walk-ins
 * still use POST /stock-exits via useCreateStockExit.
 *
 * POST /walk-in-sales
 */
export function useCreateWalkInSale() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: CreateWalkInSaleDto) => {
      const res = await api.post('/walk-in-sales', body)
      return res.data
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['stock-exits'] })
      qc.invalidateQueries({ queryKey: ['invoices'] })
      qc.invalidateQueries({ queryKey: ['payments'] })
      qc.invalidateQueries({ queryKey: ['clients'] })
      qc.invalidateQueries({ queryKey: ['packed-stock'] })
      qc.invalidateQueries({ queryKey: ['warehouse', 'walk-in-summary'] })
      if (vars.clientId) {
        qc.invalidateQueries({ queryKey: ['clients', vars.clientId, 'balance'] })
      }
    },
  })
}
