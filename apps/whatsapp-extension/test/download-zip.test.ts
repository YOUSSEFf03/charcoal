import { resolve } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain .mjs Vite plugin, typed by its .d.mts for the app build
import { buildZip, extensionFiles, EXTENSION_ZIP_URL } from '../../../vite-plugins/whatsapp-extension-zip.mjs'
import { source } from './load'

const EXT_DIR = resolve(__dirname, '..')

/** Reads a ZIP through its central directory, the way unzip tools do. */
function readZip(zip: Buffer): Map<string, Buffer> {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  const count = zip.readUInt16LE(eocd + 10)
  let p = zip.readUInt32LE(eocd + 16)
  const out = new Map<string, Buffer>()
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(p)).toBe(0x02014b50)
    const compSize = zip.readUInt32LE(p + 20)
    const size = zip.readUInt32LE(p + 24)
    const nameLen = zip.readUInt16LE(p + 28)
    const local = zip.readUInt32LE(p + 42)
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    expect(zip.readUInt32LE(local)).toBe(0x04034b50)
    const dataStart = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
    const data = inflateRawSync(zip.subarray(dataStart, dataStart + compSize))
    expect(data.length).toBe(size)
    out.set(name, data)
    p += 46 + nameLen
  }
  return out
}

describe('extension download zip', () => {
  it('is served at a stable URL', () => {
    expect(EXTENSION_ZIP_URL).toBe('/downloads/farah-whatsapp-extension.zip')
  })

  it('contains exactly the extension files at the zip root (no tests), byte-for-byte', () => {
    const entries = readZip(buildZip(extensionFiles(EXT_DIR)))
    const names = [...entries.keys()].sort()
    expect(names).toEqual(['README.md', 'app-bridge.js', 'background.js', 'config.js', 'manifest.json', 'protocol.js', 'whatsapp-content.js'])
    for (const name of names) expect(entries.get(name)!.toString('utf8')).toBe(source(name))
    // Every script the manifest references is in the zip.
    const manifest = JSON.parse(entries.get('manifest.json')!.toString('utf8'))
    const referenced = [manifest.background.service_worker, ...manifest.content_scripts.flatMap((c: { js: string[] }) => c.js)]
    for (const f of referenced) expect(entries.has(f)).toBe(true)
  })

  it('is deterministic (same files → same bytes)', () => {
    const files = extensionFiles(EXT_DIR)
    expect(buildZip(files).equals(buildZip(files))).toBe(true)
  })
})
