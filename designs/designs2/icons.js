// Ember icon shim — maps Tabler class names to Lucide icons, then renders inline SVGs.
// Tabler webfont glyphs fail to render in some sandboxed iframes (font reports
// "loaded" but the woff2 returns empty glyph data). This module sidesteps that
// by swapping every `<i class="ti ti-NAME">` element for an inline Lucide SVG.

(function () {
  // ti- name → lucide name. Picks the visually-closest match in Lucide's set.
  // Unknown names fall back to "square".
  const MAP = {
    "activity": "activity",
    "adjustments": "sliders-horizontal",
    "alert-circle": "alert-circle",
    "alert-triangle": "alert-triangle",
    "anchor": "anchor",
    "arrow-left": "arrow-left",
    "arrow-right": "arrow-right",
    "arrow-up-right": "arrow-up-right",
    "arrows-diff": "arrow-left-right",
    "bell": "bell",
    "bell-ringing": "bell-ring",
    "bolt": "zap",
    "box": "box",
    "brand-whatsapp": "message-circle",
    "brush": "brush",
    "building": "building",
    "building-store": "store",
    "building-warehouse": "warehouse",
    "calculator": "calculator",
    "calendar": "calendar",
    "cash": "banknote",
    "cash-register": "scan-line",
    "chart-bar": "bar-chart-3",
    "chart-pie": "pie-chart",
    "check": "check",
    "check-circle": "circle-check",
    "chevron-left": "chevron-left",
    "chevron-right": "chevron-right",
    "clipboard-check": "clipboard-check",
    "clipboard-text": "clipboard-list",
    "clock": "clock",
    "copy": "copy",
    "credit-card": "credit-card",
    "currency-dollar": "dollar-sign",
    "database": "database",
    "device-mobile": "smartphone",
    "discount": "percent",
    "dots": "more-horizontal",
    "download": "download",
    "edit": "pencil",
    "file-invoice": "file-text",
    "file-text": "file-text",
    "filter": "filter",
    "flame": "flame",
    "gas-station": "fuel",
    "history": "history",
    "id-badge": "id-card",
    "info-circle": "info",
    "language": "languages",
    "layout-dashboard": "layout-dashboard",
    "list": "list",
    "loader": "loader",
    "lock": "lock",
    "map-pin": "map-pin",
    "minus": "minus",
    "notes": "notebook-pen",
    "package": "package",
    "phone": "phone",
    "player-play": "play",
    "plus": "plus",
    "plus-circle": "circle-plus",
    "printer": "printer",
    "receipt": "receipt",
    "receipt-2": "receipt",
    "receipt-tax": "receipt",
    "refresh": "refresh-cw",
    "repeat": "repeat",
    "road": "route",
    "safe": "shield",
    "search": "search",
    "send": "send",
    "settings": "settings",
    "ship": "ship",
    "stack-2": "layers",
    "star": "star",
    "stop": "square",
    "terminal": "terminal",
    "tools": "wrench",
    "trash": "trash-2",
    "trending-down": "trending-down",
    "trending-up": "trending-up",
    "truck": "truck",
    "users": "users",
    "wallet": "wallet",
    "weight": "weight",
    "x": "x",
    // common extras
    "circle": "circle",
    "circle-check": "circle-check",
    "circle-x": "circle-x",
  };

  function replaceIcons(root) {
    root = root || document;
    const els = root.querySelectorAll('i[class*="ti-"], i.ti');
    els.forEach((el) => {
      if (el.dataset.iconDone) return;
      // Find the ti-XXX class
      let name = null;
      for (const c of el.classList) {
        if (c.startsWith("ti-") && c !== "ti") {
          name = c.slice(3);
          break;
        }
      }
      if (!name) return;
      const lucideName = MAP[name] || "square";

      // Copy inline styles + computed font-size for sizing
      const computed = window.getComputedStyle(el);
      const fontSize = parseFloat(computed.fontSize) || 16;
      const color = el.style.color || "currentColor";

      // Build the icon via lucide if available
      if (window.lucide && window.lucide.icons) {
        // lucide.icons keys are PascalCase: e.g. "ArrowRight"
        const pascal = lucideName
          .split("-")
          .map((s) => s[0].toUpperCase() + s.slice(1))
          .join("");
        const def = window.lucide.icons[pascal];
        if (def) {
          // def is [tagName, attrs, children] — render as <svg>
          const svg = lucideToSvg(def, fontSize, color);
          el.innerHTML = svg;
          el.style.display = el.style.display || "inline-flex";
          el.style.alignItems = "center";
          el.style.justifyContent = "center";
          el.style.verticalAlign = "middle";
          el.style.lineHeight = "1";
          el.dataset.iconDone = "1";
        }
      }
    });
  }

  function lucideToSvg(def, size, color) {
    // def = ["svg", attrs, children] OR [tag, attrs, children]
    const [, attrs, children] = def;
    const merged = Object.assign({}, attrs, {
      width: size,
      height: size,
      stroke: color,
    });
    const attrStr = Object.entries(merged)
      .map(([k, v]) => `${k}="${String(v).replace(/"/g, "&quot;")}"`)
      .join(" ");
    const inner = (children || [])
      .map((c) => nodeToString(c))
      .join("");
    return `<svg ${attrStr}>${inner}</svg>`;
  }

  function nodeToString(node) {
    if (!Array.isArray(node)) return "";
    const [tag, attrs, children] = node;
    const attrStr = Object.entries(attrs || {})
      .map(([k, v]) => `${k}="${String(v).replace(/"/g, "&quot;")}"`)
      .join(" ");
    const inner = (children || []).map(nodeToString).join("");
    return `<${tag} ${attrStr}>${inner}</${tag}>`;
  }

  function init() {
    if (!window.lucide) {
      // Try again shortly — lucide script might still be loading
      return setTimeout(init, 50);
    }
    replaceIcons(document);

    // Watch for dynamically-added icons
    const obs = new MutationObserver((records) => {
      let hasNew = false;
      for (const r of records) {
        for (const n of r.addedNodes) {
          if (n.nodeType === 1) {
            if (n.matches && n.matches('i[class*="ti-"]')) { hasNew = true; break; }
            if (n.querySelector && n.querySelector('i[class*="ti-"]')) { hasNew = true; break; }
          }
        }
        if (hasNew) break;
      }
      if (hasNew) replaceIcons(document);
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
