import type { Plugin } from 'vite'

export declare const EXTENSION_ZIP_URL: string
export declare function extensionFiles(extDir: string): Array<[string, Buffer]>
export declare function buildZip(files: Array<[string, Buffer | Uint8Array]>): Buffer
export declare function whatsappExtensionZip(extDir: string): Plugin
