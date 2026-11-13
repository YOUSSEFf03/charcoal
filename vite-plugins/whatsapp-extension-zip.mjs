// Serves the Farah WhatsApp Chrome extension (apps/whatsapp-extension) as a
// zip download at /downloads/farah-whatsapp-extension.zip, built on the fly
// from the files in the repo — so the download always matches what is
// deployed. Dev server: middleware. Production build: emitted into dist/.
//
// Files sit at the zip ROOT (manifest.json at the top), so Windows
// "Extract All" gives one folder that Chrome's "Load unpacked" accepts.
// Tests and docs-only folders are left out. No dependencies: a minimal
// ZIP writer (deflate via node:zlib).
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { deflateRawSync } from 'node:zlib'

export const EXTENSION_ZIP_URL = '/downloads/farah-whatsapp-extension.zip'
const SKIP_DIRS = new Set(['test', 'node_modules'])

/** Every file of the extension, as [zip path, bytes], sorted. */
export function extensionFiles(extDir) {
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full)
      } else if (entry.isFile()) {
        out.push([relative(extDir, full).split(sep).join('/'), readFileSync(full)])
      }
    }
  }
  walk(extDir)
  return out.sort((a, b) => a[0].localeCompare(b[0]))
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Builds a standard ZIP (deflate) from [name, bytes] pairs. */
export function buildZip(files) {
  // Fixed timestamp (2026-01-01 00:00) so identical files give an identical zip.
  const DOS_TIME = 0
  const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1
  const locals = []
  const centrals = []
  let offset = 0
  for (const [name, data] of files) {
    const nameBuf = Buffer.from(name, 'utf8')
    const compressed = deflateRawSync(data, { level: 9 })
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // UTF-8 names
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, nameBuf, compressed)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // made by
    central.writeUInt16LE(20, 6) // needed
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(DOS_TIME, 12)
    central.writeUInt16LE(DOS_DATE, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    // extra len, comment len, disk no., internal attrs, external attrs = 0
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBuf)

    offset += local.length + nameBuf.length + compressed.length
  }
  const centralBuf = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralBuf, end])
}

/** Vite plugin: dev-server route + production asset. */
export function whatsappExtensionZip(extDir) {
  const make = () => buildZip(extensionFiles(extDir))
  return {
    name: 'farah-whatsapp-extension-zip',
    configureServer(server) {
      server.middlewares.use(EXTENSION_ZIP_URL, (_req, res) => {
        try {
          const zip = make()
          res.setHeader('Content-Type', 'application/zip')
          res.setHeader('Content-Disposition', 'attachment; filename="farah-whatsapp-extension.zip"')
          res.setHeader('Cache-Control', 'no-store')
          res.end(zip)
        } catch (e) {
          res.statusCode = 500
          res.end('Could not build the extension zip: ' + (e && e.message ? e.message : String(e)))
        }
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: EXTENSION_ZIP_URL.slice(1), source: make() })
    },
  }
}
