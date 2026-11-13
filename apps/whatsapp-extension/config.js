/*
 * Farah WhatsApp Share — configuration.
 *
 * APP_ORIGINS: the exact origins (scheme://host:port) of the Farah Charcoal
 * web app allowed to talk to this extension. Chrome match patterns in
 * manifest.json cannot pin a port, so the content script re-checks the exact
 * origin against this list. To use the app from another address, add it
 * here AND add a matching pattern to manifest.json "content_scripts[0].matches",
 * then reload the extension in chrome://extensions.
 */
;(function (root) {
  'use strict'
  const CONFIG = {
    APP_ORIGINS: [
      'http://100.121.85.63:5173', // Farah server over Tailscale
      'http://localhost:5173', // local development
      'http://127.0.0.1:5173',
    ],
    WHATSAPP_ORIGIN: 'https://web.whatsapp.com',

    /** Largest PDF accepted (bytes). chrome.storage.session holds ~10 MB in total. */
    MAX_PDF_BYTES: 6 * 1024 * 1024,
    /** Longest caption accepted (characters). */
    MAX_MESSAGE_CHARS: 1000,

    /** A job older than this is abandoned (ms). Includes time to scan the QR code. */
    JOB_TTL_MS: 6 * 60 * 1000,
    /** How long to wait for WhatsApp Web to finish loading a logged-in session (ms). */
    WA_LOAD_TIMEOUT_MS: 60 * 1000,
    /** How long to wait for the user to scan the QR code when logged out (ms). */
    WA_LOGIN_TIMEOUT_MS: 4 * 60 * 1000,
    /** How long each attachment strategy waits for WhatsApp's preview screen (ms). */
    ATTACH_TIMEOUT_MS: 10 * 1000,

    /*
     * WhatsApp Web DOM hooks. WhatsApp changes its markup from time to time;
     * if attaching stops working, these are the first thing to update.
     * Each entry is a list of CSS selectors tried in order.
     */
    SELECTORS: {
      appReady: ['#side', '#pane-side', '[data-testid="chat-list"]'],
      loginScreen: ['div[data-ref] canvas', 'canvas[aria-label*="scan" i]', '[data-testid="qrcode"]', '[data-ref]'],
      chatPanel: ['#main'],
      chatComposer: ['#main footer div[contenteditable="true"]', '#main div[contenteditable="true"][data-tab="10"]'],
      chatTitle: ['#main header span[title]', '#main header [dir="auto"]'],
      modalDialog: ['div[role="dialog"]', '[data-animate-modal-popup="true"]'],
      attachButton: [
        '#main footer [data-icon="plus-rounded"]',
        '#main footer [data-icon="plus"]',
        '#main footer [data-icon="clip"]',
        '#main footer [data-icon="attach-menu-plus"]',
        '#main footer button[title="Attach"]',
        '#main footer div[aria-label="Attach"]',
      ],
      documentFileInput: ['input[type="file"][accept="*"]', 'input[type="file"]:not([accept*="image"])'],
      previewSendButton: [
        '[data-icon="send"]',
        '[data-icon="wds-ic-send-filled"]',
        '[role="button"][aria-label="Send"]',
        'div[aria-label="Send"]',
      ],
    },
  }

  root.FARAH_WA_CONFIG = Object.freeze(CONFIG)
})(typeof globalThis !== 'undefined' ? globalThis : self)
