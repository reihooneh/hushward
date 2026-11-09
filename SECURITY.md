# Security

Hushward is a static website. Everything happens in the visitor's browser: there's no server code, no account, no database, no analytics and no third-party script. Its example wards and patients are invented. No software is perfectly secure; this is how the risks are handled, and how to report a problem.

## Threats and defences

| Threat | Defence |
|---|---|
| **A hostile ward file** ("Load a ward (JSON)") trying to run script, pollute prototypes or hang the tab | The size is checked before reading (200 KB), and it's parsed with `JSON.parse` only.<br>`checkWard` accepts only plain objects with known keys (an unknown key, including `__proto__`, is refused) and checks every number for type, finiteness and range. Kinds, needs and changes must come from fixed lists, and every bed, sound and door must lie inside its room.<br>Names may not contain `<`, `>`, control characters or invisible direction marks.<br>Limits: 24 rooms, 24 beds, 48 sounds, 14 changes and 64 effects.<br>Error messages never repeat the file's contents, not even key names. |
| **Cross-site scripting** through names | The pages never build HTML from strings: everything is made with `createElement`/`createElementNS` and `textContent`. A test fails the build if `innerHTML`, `insertAdjacentHTML`, `document.write`, `eval` or `new Function` appear in the shipped code. |
| **Injected or third-party script** | A strict Content-Security-Policy on every page: `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'`, plus `base-uri 'none'` and `form-action 'none'`.<br>There are no inline scripts, styles or handlers.<br>three.js and the fonts are self-hosted and pinned.<br>The tests check every built page for all of this. |
| **Memory errors in the core** | The core is AssemblyScript compiled to WebAssembly. It uses fixed `StaticArray` buffers and allocates nothing while running.<br>`load` re-checks every number: finiteness, ranges, integer indices, points inside their rooms, exactly one corridor, and no extra numbers.<br>The output buffer is bounded.<br>The module imports nothing (`abort` is replaced by a trap); a test checks this. |
| **A crafted message to the worker** | The worker accepts four message types, and checks every field (array length and finiteness, integer masks within 14 bits, budgets and cell sizes in range) before calling the core. |
| **Denial of service** | At most 14 changes, so at most 16,384 combinations, each costing at most 48 × 24 sound paths and one 24 × 24 assignment. That bounds the search to a few seconds in the worker; the page stays responsive. |
| **Path traversal** in the local preview server (`scripts/serve.mjs`) | It serves only files inside `site/`, with a fixed list of types, and normalises and checks every path; the tests try `../` tricks. The live site is served by GitHub Pages. |
| **Supply chain** | There are no runtime dependencies beyond the vendored three.js and two font packages.<br>Development tools (AssemblyScript, Playwright) are pinned in `package-lock.json`.<br>CI runs `npm audit`, and its workflow is read-only except for the Pages deploy job. |

## Privacy

Ward files are read in your browser and never sent anywhere. "Download this ward" creates the file locally. Don't put real patient names in a ward file: the examples use invented ones, and nothing about patients is needed beyond their sleep needs.

## Limits

The sleep model is an estimate for comparing options (see HOW-IT-WORKS.md). It isn't clinical advice, and clinical needs come before noise.

## Reporting a problem

Please open a private security advisory on the GitHub repository (Security → Report a vulnerability), or an issue if it isn't sensitive.
