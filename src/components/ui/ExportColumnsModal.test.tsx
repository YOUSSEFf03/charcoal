// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useExportColumnsModal } from './ExportColumnsModal'
import type { ExcelColumn } from '../../lib/excelExport'

interface Row { name: string; amount: number }

const columns: ExcelColumn<Row>[] = [
  { key: 'name', header: 'Name', value: r => r.name },
  { key: 'amount', header: 'Amount', type: 'currency', value: r => r.amount },
  { key: 'notes', header: 'Notes', value: () => null, defaultSelected: false },
]

function TestHarness({ onExport }: { onExport: (cols: ExcelColumn<Row>[]) => Promise<void> }) {
  const { openExportModal, exportColumnsModal } = useExportColumnsModal()
  return (
    <div>
      <button onClick={() => openExportModal({ title: 'Test Export', columns, onExport })}>Open</button>
      {exportColumnsModal}
    </div>
  )
}

describe('ExportColumnsModal / useExportColumnsModal', () => {
  it('seeds checked state from defaultSelected (true unless explicitly false)', async () => {
    const user = userEvent.setup()
    render(<TestHarness onExport={vi.fn()} />)
    await user.click(screen.getByText('Open'))
    expect(screen.getByLabelText('Name')).toBeChecked()
    expect(screen.getByLabelText('Amount')).toBeChecked()
    expect(screen.getByLabelText('Notes')).not.toBeChecked()
  })

  it('individual deselection then reselection of a single column', async () => {
    const user = userEvent.setup()
    render(<TestHarness onExport={vi.fn()} />)
    await user.click(screen.getByText('Open'))
    const nameCheckbox = screen.getByLabelText('Name')
    await user.click(nameCheckbox)
    expect(nameCheckbox).not.toBeChecked()
    await user.click(nameCheckbox)
    expect(nameCheckbox).toBeChecked()
  })

  it('Select all checks every column, including ones off by default', async () => {
    const user = userEvent.setup()
    render(<TestHarness onExport={vi.fn()} />)
    await user.click(screen.getByText('Open'))
    await user.click(screen.getByText('Select all'))
    expect(screen.getByLabelText('Name')).toBeChecked()
    expect(screen.getByLabelText('Amount')).toBeChecked()
    expect(screen.getByLabelText('Notes')).toBeChecked()
  })

  it('Clear all unchecks every column, disables Export, and shows the validation message', async () => {
    const user = userEvent.setup()
    render(<TestHarness onExport={vi.fn()} />)
    await user.click(screen.getByText('Open'))
    await user.click(screen.getByText('Clear all'))
    expect(screen.getByLabelText('Name')).not.toBeChecked()
    expect(screen.getByRole('button', { name: /export excel/i })).toBeDisabled()
    expect(screen.getByText(/select at least one column/i)).toBeInTheDocument()
  })

  it('Export Excel calls onExport with only the checked columns, and the real column definitions (not copies)', async () => {
    const user = userEvent.setup()
    const onExport = vi.fn().mockResolvedValue(undefined)
    render(<TestHarness onExport={onExport} />)
    await user.click(screen.getByText('Open'))
    await user.click(screen.getByLabelText('Amount')) // deselect Amount — Notes is already off by default, so only Name remains
    await user.click(screen.getByRole('button', { name: /export excel/i }))
    expect(onExport).toHaveBeenCalledTimes(1)
    const receivedColumns = onExport.mock.calls[0][0] as ExcelColumn<Row>[]
    expect(receivedColumns.map(c => c.key)).toEqual(['name'])
    expect(receivedColumns[0].value({ name: 'X', amount: 1 })).toBe('X')
  })

  it('Cancel closes the modal and never calls onExport', async () => {
    const user = userEvent.setup()
    const onExport = vi.fn()
    render(<TestHarness onExport={onExport} />)
    await user.click(screen.getByText('Open'))
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onExport).not.toHaveBeenCalled()
    expect(screen.queryByText('Select columns to export')).not.toBeInTheDocument()
  })

  it('closes automatically after a successful export', async () => {
    const user = userEvent.setup()
    const onExport = vi.fn().mockResolvedValue(undefined)
    render(<TestHarness onExport={onExport} />)
    await user.click(screen.getByText('Open'))
    await user.click(screen.getByRole('button', { name: /export excel/i }))
    expect(screen.queryByText('Select columns to export')).not.toBeInTheDocument()
  })

  it('shows the real error text and keeps the modal open when onExport rejects — no silent swallowing', async () => {
    const user = userEvent.setup()
    const onExport = vi.fn().mockRejectedValue(new Error('Network timeout'))
    render(<TestHarness onExport={onExport} />)
    await user.click(screen.getByText('Open'))
    await user.click(screen.getByRole('button', { name: /export excel/i }))
    expect(await screen.findByText('Network timeout')).toBeInTheDocument()
    expect(screen.getByText('Select columns to export')).toBeInTheDocument()
  })

  it('every reopen starts from the same deterministic default — no leaked selection from a prior session', async () => {
    const user = userEvent.setup()
    render(<TestHarness onExport={vi.fn().mockResolvedValue(undefined)} />)
    await user.click(screen.getByText('Open'))
    await user.click(screen.getByLabelText('Name'))
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    await user.click(screen.getByText('Open'))
    expect(screen.getByLabelText('Name')).toBeChecked()
  })
})
