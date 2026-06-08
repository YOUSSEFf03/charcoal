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

/**
 * One by-kg line in a walk-in sale (Phase 4).
 * Draws from a raw stock lot; price is quoted in its own currency.
 */
export interface WalkInKgLine {
  lotId: string
  kgQuantity: string    // decimal string, e.g. "500.000"
  description: string   // charcoal type + grade snapshot for the invoice line
  pricePerKg: string    // decimal string
  currency: 'USD' | 'LBP'
}

/**
 * Payload for POST /walk-in-sales.
 * At least one of `bags` or `kgLines` must be non-empty.
 */
export interface CreateWalkInSaleDto {
  clientId: string
  date: string
  bags?: WalkInBagLine[]
  kgLines?: WalkInKgLine[]
  receivedUsd?: string
  receivedLbp?: string
  method: 'cash' | 'whish' | 'omt' | 'bank_transfer' | 'cheque'
  receiverId?: string
  recipient?: string
  notes?: string
}

/**
 * Record a walk-in sale to a REGISTERED client in one atomic backend call:
 * stock exit(s) + issued invoice + optional payment (in the client's currency).
 *
 * Supports packed-bag lines, by-kg lines, or a mix of both in a single invoice.
 * Anonymous walk-ins still use POST /stock-exits via useCreateStockExit.
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
      qc.invalidateQueries({ queryKey: ['packed-stock-records'] })
      qc.invalidateQueries({ queryKey: ['warehouse', 'walk-in-summary'] })
      // Invalidate lot data — kgRemaining changes for KG sales.
      qc.invalidateQueries({ queryKey: ['stock-lots'] })
      if (vars.clientId) {
        qc.invalidateQueries({ queryKey: ['clients', vars.clientId, 'balance'] })
      }
    },
  })
}
