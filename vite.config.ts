import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { whatsappExtensionZip } from './vite-plugins/whatsapp-extension-zip.mjs'

export default defineConfig({
  plugins: [
    react(),
    // Download link for the Farah WhatsApp Chrome extension: /downloads/farah-whatsapp-extension.zip
    whatsappExtensionZip(fileURLToPath(new URL('./apps/whatsapp-extension', import.meta.url))),
  ],
})
