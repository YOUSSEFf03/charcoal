// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import Modal from '../components/ui/Modal'
import { keepModalsOpenOnOutsideClick } from './keepModalsOpen'

describe('keepModalsOpenOnOutsideClick', () => {
  beforeAll(() => keepModalsOpenOnOutsideClick())
  afterEach(cleanup)

  it('clicking the backdrop of the shared Modal does not close it; ✕ still does', () => {
    const onClose = vi.fn()
    const { container, getByLabelText } = render(
      <Modal open onClose={onClose} title="Edit" footer={<button>Save</button>}>body</Modal>,
    )
    fireEvent.click(container.querySelector('.modal-overlay')!)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(getByLabelText('Close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('also covers inline overlays (always-close and data-modal-overlay variants)', () => {
    const close1 = vi.fn(), close2 = vi.fn(), inner = vi.fn()
    const { container } = render(
      <>
        <div className="modal-overlay open" id="a" onClick={close1}>
          <div className="modal" onClick={e => { e.stopPropagation(); inner() }}>x</div>
        </div>
        <div data-modal-overlay="" id="b" onClick={e => e.target === e.currentTarget && close2()} />
      </>,
    )
    fireEvent.click(container.querySelector('#a')!)
    fireEvent.click(container.querySelector('#b')!)
    expect(close1).not.toHaveBeenCalled()
    expect(close2).not.toHaveBeenCalled()
    fireEvent.click(container.querySelector('.modal')!)
    expect(inner).toHaveBeenCalled()
  })

  it('leaves side-panel backdrops alone', () => {
    const close = vi.fn()
    const { container } = render(<div className="panel-backdrop" onClick={close} />)
    fireEvent.click(container.firstChild as Element)
    expect(close).toHaveBeenCalled()
  })
})
