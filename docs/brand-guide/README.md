# Tommy Top Decker brand guide

The TTD visual identity system: 11 landscape pages (cover, foundation, primary logo, secondary marks, misuse, color, typography, iconography, applications, thank-you insert, voice and tone).

| File | What it is |
|---|---|
| `index.html` | The full guide, one `<section class="page">` per page. This is the source of truth; edit it directly. |
| `thank-you-insert-options.html` | Page 10 on its own: the client-facing sheet of the three insert formats. |
| `guide.css` | Tokens (color, type), the page frame, and print rules (`@page` 1170 x 827 px, one section per page). |
| `fonts/Gotham-Black.otf` | The licensed wordmark font, the same file the storefront self-hosts. |
| `logo-mark.svg` | TT card master art (copy of `artifacts/nemat-drop/public/logo-mark.svg`). |
| `exports/` | Current PDF exports of both pages above. |

## Preview

Serve the folder so the font loads (opening the file directly blocks it):

```bash
python3 -m http.server 4600 --directory docs/brand-guide
```

## Export PDFs

With the server running, from `docs/brand-guide`:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --no-pdf-header-footer --virtual-time-budget=8000 --print-to-pdf="exports/Tommy Top Decker Brand Guidelines.pdf" http://localhost:4600/index.html
```

Swap in `thank-you-insert-options.html` for the insert sheet.

## Open items

- Thank-you insert format (1, 2 or 3), coupon code name, % and limits are pending from the client. `TOPDECK10` on the inserts is a placeholder.
- The insert previews are not print-ready (no bleed or crop marks). Build the print file at actual size once a format is chosen.
- The insert QR points to `https://tommytopdecker.com/?utm_source=insert&utm_medium=print&utm_campaign=thankyou`.
