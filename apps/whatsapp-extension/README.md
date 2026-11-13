# Farah Charcoal – WhatsApp Share (Chrome extension)

Press **Share → Prepare in WhatsApp** on an invoice, delivery receipt or
statement in the Farah Charcoal app, and this extension:

1. opens WhatsApp Web in Chrome (reusing an open WhatsApp tab if there is one),
2. opens the chat for the customer's number,
3. attaches the PDF,
4. types the message into the caption box,
5. **stops on WhatsApp's own preview screen. You press Send.**

It never sends anything. It never presses Enter or any other key, and the only
thing it ever clicks is WhatsApp's Attach (+) button, through a guard that refuses
anything that looks like a Send button. A message is sent only when you press Send.

## Install (once per computer)

1. Download **http://100.121.85.63:5173/downloads/farah-whatsapp-extension.zip**.
   The share window also links to it when the extension is missing. The site builds the zip
   from this folder, so it's always the deployed version.
   Right-click the zip → **Extract All…**, and keep the extracted folder somewhere permanent.
2. In Chrome open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the extracted folder (the one with `manifest.json`).
5. Open (or refresh) the Farah app at `http://100.121.85.63:5173`.
6. Open `https://web.whatsapp.com` once and log in by scanning the QR code with your phone
   (WhatsApp → Linked devices). The extension never sees or stores your WhatsApp login.

After updating the files, click the ↻ (reload) icon on the extension's card in
`chrome://extensions`, then refresh the Farah app tab.

## Use

1. In the app, open an invoice, an order (delivery receipt), or a client/supplier statement.
2. Click the Print/Share button → choose the language → **Share**.
3. Pick the contact (or type a number) and edit the message if you want.
4. Click **Prepare in WhatsApp (PDF attached)**. The window shows each step.
5. In the WhatsApp tab, check the chat, the PDF and the caption. **Press Send yourself.**

If the extension isn't installed, the window says so and still offers the old
fallback (open the chat via link + download the PDF to attach yourself).

## Configuration

| What | Where |
|---|---|
| App addresses allowed to use the extension | `config.js` → `APP_ORIGINS` **and** `manifest.json` → `content_scripts[0].matches` (match patterns can't hold a port, so `config.js` pins the exact origin) |
| Max PDF size (6 MB), caption length (1000) | `config.js` |
| Timeouts (WhatsApp load 60 s, QR login 4 min, attach 10 s per method, job 6 min) | `config.js` |
| WhatsApp Web element selectors | `config.js` → `SELECTORS` (update here if WhatsApp changes its page) |

The backend needs no new environment variables. It uses the existing Clerk sign-in and database.

## How it works

```
Farah app page ──postMessage──▶ app-bridge.js ──runtime msg──▶ background.js ──opens──▶ web.whatsapp.com/send?phone=…
      ▲                                                             │                         │
      └──────────── progress (accepted … ready / error) ◀───────────┴──── whatsapp-content.js ◀┘
```

* **Server check first.** Before anything opens, the app calls `POST /api/v1/whatsapp-shares`.
  The backend checks that you are signed in, that your role may read that document type,
  that the document belongs to that customer, and that the number is a valid WhatsApp number.
  It returns the normalized number, and the extension dials only that number. The event is logged
  (`journalctl -t docker/farah-charcoal-backend-1 | grep WhatsAppShare`) as *prepared, not sent*.
  When WhatsApp finishes, the app logs `ready_for_manual_send` or `failed`. It never logs "sent".
* **The PDF goes straight from the page to the extension.** The PDF is generated in your browser, as before,
  and passed directly to the extension. It is never uploaded and no download URL is created.
  The extension keeps it only in memory (`chrome.storage.session`, which never touches disk and can't be read by web pages),
  and deletes it as soon as the job ends (ready, error, tab closed or 6-minute expiry).
* **Messages are checked at every step.** The page bridge only accepts messages from the same window and an allowed
  origin. The background worker only accepts messages from its own scripts, re-checks the origin, and
  hands the job only to the WhatsApp tab it opened. Every request is validated: UUID id, 8–15 digit
  phone, `.pdf` name, real PDF bytes, size limit.
* **Attaching tries three methods, one after another**: paste into the chat box, drag-and-drop onto the chat, or
  the Attach menu's document picker. The next method runs only if WhatsApp's preview did not open,
  so the PDF is never attached twice.

## Permissions

* `storage`: in-memory session storage for the current job.
* Host access to `https://web.whatsapp.com/*` only.
* The bridge script runs only on the Farah app's addresses.

## WhatsApp Web limitations (read this)

* **Not an official interface.** WhatsApp Web has no public "attach a file" API. The extension
  drives the page like a user would. If WhatsApp changes its page, attaching can stop working until
  `SELECTORS` in `config.js` is updated. The app then shows an error and the chat stays open, so you
  can attach the PDF by hand. Nothing gets sent by mistake.
* **Untested against live WhatsApp Web.** The automated tests run against a simulated WhatsApp page.
  Check it on a real chat (your own number is a good first test) before relying on it.
* **Each share reloads the WhatsApp tab** (that's how `/send?phone=` opens a chat), which takes a few seconds.
* **Recipient check:** the chat is opened by number, so it is the right number. The window also shows the chat
  name WhatsApp displays, so you can confirm it before pressing Send.
* **Numbers not on WhatsApp:** WhatsApp shows a popup. The extension reports "could not open the chat" with
  WhatsApp's own text.
* **Captions are one line.** Line breaks are turned into spaces, because Enter sends in WhatsApp and the
  extension never types one.
* **One document at a time.** A second Share while one is being prepared is refused ("busy").
* **Desktop Chrome only** (Chrome 116+). Doesn't work on phones or in other browsers. On a phone, use
  "Share via device…" in the same window.
* **Logged out:** if WhatsApp Web shows the QR code, the app says "scan the QR code" and waits up to 4 minutes.
* If WhatsApp Web is open in several tabs, the first one is reused.

## Tests

From the repo root: `npx vitest run apps/whatsapp-extension src/lib/share src/components/share`
(extension logic, page bridge, simulated WhatsApp page, "never sends" checks).
Backend: `cd apps/backend && npx jest src/whatsapp-share`.
