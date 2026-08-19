import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Vitest globals are off (test.globals is not set) so React Testing
// Library's own auto-cleanup registration — which relies on detecting a
// global afterEach — never fires; without this, each test's rendered DOM
// tree stacks up across the whole file instead of unmounting, causing later
// tests' getByText()/getByRole() queries to match multiple stale elements
// from earlier tests.
afterEach(() => {
  cleanup()
})
