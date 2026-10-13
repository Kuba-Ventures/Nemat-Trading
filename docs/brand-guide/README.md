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

## Print file (thank-you card, format 1)

`exports/Tommy Top Decker Thank-you Card (print).pdf` is the file to send to the printer: 2 pages (front, back), 2.75 x 3.75 in, which is the 2.5 x 3.5 in trim plus 1/8 in bleed on every side. `(proof).pdf` is the same with crop marks on a white slug, for checking.

- Order spec: 2.5 x 3.5 in, 16 pt matte, double-sided, rounded corners (the printer die-cuts them; the artwork is square).
- The gold frame sits 0.14 in inside the trim, clear of the 1/8 in safe zone. The "Packed by" line is blank for a signature.
- The QR decodes to the UTM link below (checked 2026-10-13).
- Generated from the format 1 markup in `thank-you-insert-options.html`. After editing that file, rebuild with `python3 print/build.py "$PWD"` from `docs/brand-guide`, then export both pages as above with `print/thank-you-card-print.html` and `print/thank-you-card-proof.html`.

## Open items

- Client decision (Shawn, 2026-10-07): format 1, the 2.5 x 3.5 in card. Code `TOPDECK10`, 10% off, one use per customer.
- The insert QR points to `https://tommytopdecker.com/?utm_source=insert&utm_medium=print&utm_campaign=thankyou`.
