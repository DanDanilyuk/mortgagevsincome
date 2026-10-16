# Mortgage vs Income

## Project Overview

A single-page dashboard tracking U.S. home affordability trends by comparing mortgage costs to income over time. Live at [mortgagevsincome.com](https://mortgagevsincome.com/). Deployed on GitHub Pages (`DanDanilyuk/mortgagevsincome`) with Cloudflare DNS. No build step - static HTML/CSS/JS served directly.

## Tech Stack

- **Frontend**: Native ES modules - `app.js` (entry, `<script type="module">`) imports from `modules/constants.js`, `modules/format.js`, `modules/events.js`, `modules/urlState.js`, `modules/range.js`, `modules/deltas.js`, `modules/overlay.js`, `modules/quality.js`, `modules/view.js`, `modules/stateSearch.js`. HTML and CSS with CSS variables for theming. No build step.
- **Charts**: Chart.js 4.4.0 with chartjs-plugin-zoom (CDN)
- **Data Generation**: Ruby script (`weekly_case_shiller.rb`) run weekly via GitHub Actions
- **Data Format**: JSON files - `weekly_case_shiller_output.json` (national), `data/{STATE}.json` (per-state), `data/index.json` (per-state latest-snapshot roll-up)
- **PWA**: `sw.js` (hand-rolled service worker, no Workbox) + `manifest.webmanifest`. Network-first for every same-origin request (HTML/JS/CSS/JSON) with cache fallback offline; only `/` and `/index.html` share the `/` cache key (regardless of query string) - other navigations, e.g. opening a JSON file in a tab, are cached per path so they can't replace the offline shell; the three pinned CDN scripts (`CDN_ASSETS`) are precached and served cache-first, and their `<script>` tags carry `crossorigin="anonymous"` so a cache miss yields a real status (failures are never cached). `test/js/sw.test.js` fails if `SHELL_ASSETS` misses a `modules/*.js` file or `CDN_ASSETS` drifts from the `<script>` tags in `index.html`. Bump `CACHE_VERSION` on breaking changes.
- **Tests**: Ruby minitest under `test/` (run via `bundle exec ruby test/all.rb`); JS native test runner under `test/js/` (run via `node --test test/js/*.test.js`)
- **Lint**: `oxlint` via `npx --yes oxlint@0.16 app.js sw.js modules/ test/js/`
- **Schema**: `schema/state_data.schema.json` validates every JSON file in CI via `ajv-cli`
- **Local secrets**: `.env.example` is the template; `.env` is gitignored. `notes.md`, `suggested_domains.md`, `TASK_LIST.md` also gitignored

## Data Pipeline

The Ruby script fetches from four sources:
- **BLS API**: National average weekly earnings (CES0500000011) - requires `BLS_API_KEY`
- **FRED API**: Zillow Home Value Index per state (`{STATE}UCSFRCONDOSMSAMID`), 30-yr mortgage rates (`MORTGAGE30US`), and CPI-U (`CPIAUCSL`) for inflation adjustment - requires `FRED_API_KEY`
- **BLS QCEW**: State income multipliers from Quarterly Census of Employment and Wages (no key needed)

State income = national CES earnings x QCEW state-to-national wage ratio. The multiplier and its provenance (`qcew_<year>` / `fallback_missing` / `fallback_unavailable`) are both emitted in `metadata.data_sources.qcew_multiplier_source` so fallback values are distinguishable from real low-wage-state ratios.

After the per-state run loop, `build_state_index` reads each state's JSON and writes `data/index.json` (sorted by state code) with `{state, state_name, date, latest_ratio_single, latest_ratio_household, latest_home_price, latest_mortgage_rate}` per row. Powers the all-states ranking grid without fanning out 51 fetches on first paint.

BLS period parsing uses the structured `period` field with regex `/^M(0[1-9]|1[0-2])$/` plus a 4-digit year guard - permissive `Date.parse` accepts strings like `"2026--01"` as January, which the regex blocks.

Run locally:
```sh
cp .env.example .env  # fill in your keys
set -a; source .env; set +a
ruby weekly_case_shiller.rb --bls-api-key "$BLS_API_KEY" --fred-api-key "$FRED_API_KEY"
```
Single state: append `--state CA`.

## Key Architecture Decisions

- Internal state code for the U.S. national view is `ALL`, not `US`. The HTML select value, JS state, and URL param all use `all`/`ALL`. The display label is "U.S.A" (set in `STATE_NAMES.ALL` in `modules/constants.js` and on the native `<option>` text). Don't rename the code itself - lots of code paths key on the literal `'ALL'`.
- URL params are always written for all settings (`state`, `range`, `view`, `yaxis`) so users can share/bookmark any view. Plus `embed=1` for chrome-less iframe rendering.
- `readUrlParams()` is case-insensitive and accepts `state=us` as alias for `state=all`.
- State JSON files live in `data/` directory. National data stays at root as `weekly_case_shiller_output.json`. `data/index.json` is the per-state latest-snapshot index.
- Dark mode uses `data-theme` attribute on `<html>`, toggled via JS (`#themeToggle` button), with localStorage persistence and system preference fallback.
- Single source of truth for per-state metadata is the `STATES` Ruby hash; `STATE_FRED_SERIES`, `STATE_NAMES`, and `STATE_FIPS` are derived via `transform_values`. On the JS side, `STATE_NAMES` lives in `modules/constants.js`.
- The native `<select>` is the source of truth for selected state. On desktop (>=769px), a custom combobox (`#stateComboboxInput` + `#stateComboboxList`) is shown instead and dispatches `change` on the native select when it commits. On mobile, the native picker is used directly.

## UI Layout

- Page order: skip link → sticky mobile summary (hidden when chart isn't in viewport) → header → info grid (5 cards with optional delta lines) → controls → chart toolbar → chart container OR data table (toggled) → state ranking grid → methodology details → footer. Plus a `<dialog id="shortcutDialog">` opened by `?`.
- The `.controls` div contains the searchable combobox (`#stateCombobox`, desktop only) + native select (`#stateSelect`, mobile or fallback), the `.controls-divider` span, the view toggle buttons group (`.controls-views` with Compare Both / Single Earner / Dual Income), and the `#btnResetFilters` button (direct child of `.controls`, not inside `.controls-views`).
- The Reset Filters button is visibility-toggled by `syncUrlParams()` whenever any of state/range/view/yaxis differs from its default. On desktop it flows to the right of Dual Income; on mobile `.controls` is flex-column so it falls below the view buttons automatically.
- The select auto-sizes its width to fit the selected option text via `resizeSelect()`, which uses a persistent hidden measurement span. Only matters on mobile - the native select is `display: none` on desktop.
- The chart toolbar (`.action-buttons`) now has seven actions (Events toggle, Y-Axis, PNG, CSV, Copy Link, Table toggle, Reset View) styled with `.btn-action` (icon + label). On viewports `<=768px`, `.btn-label` is hidden so each button shrinks to icon-only and the toolbar stays single-row.
- The info grid has five cards (Date, Price-to-Income Ratio, Median Home Price, Avg. Annual Earnings, 30-Yr Fixed Rate). Each non-date card has an `.info-delta` slot below the value showing "▲/▼ change vs 1Y" colored emerald (better) or rose (worse). The four metric cards carry a `title` attribute explaining the metric.
- The "All states, ranked" section renders a CSS-grid of color-coded buttons sorted by current single-earner ratio (most expensive first). Powered by `data/index.json`; the active state has `aria-current="true"` and an amber outline ring.
- Embed mode (`body.is-embed`, set when URL has `?embed=1`) hides the header, footer, methodology, state grid, sticky summary, and skip link.

## JS Patterns

- `app.js` is a native ES module (`<script type="module">`). Imports come from `modules/constants.js` (DEFAULTS, VIEW_TO_BTN, STATE_NAMES, etc.), `modules/format.js` (formatDate, formatMoney, formatSignedMoney, toIsoLocal, formatRelativeTime), `modules/events.js` (HOUSING_EVENTS array), and the extracted pure-logic modules: `modules/urlState.js` (resolveState, parseUrlParams, anyFilterNonDefault), `modules/range.js` (rangeWindow, rangeEdgeIndices, clampedRangeIndices), `modules/deltas.js` (computeDelta), `modules/overlay.js` (isOverlayVisible, buildOverlayData, shouldIncludeLegendItem), `modules/quality.js` (qualityLabel, estimationBadge), `modules/view.js` (viewVisibility, viewFromVisibility, viewAfterLegendToggle), `modules/stateSearch.js` (filterStates - ranked combobox matching). `format.js` also has formatAxisDate (x-tick labels) and `events.js` has eventLabelIndex / eventsAtIndex / assignLabelRows. When adding pure helpers, extract them into a module and import - tests in `test/js/*.test.js` cover the pure modules.
- The pure modules are dependency-injected, not state-coupled: `app.js` keeps thin same-name wrapper functions (e.g. `readUrlParams = () => parseUrlParams(window.location.search)`, `nationalOverlayData = length => buildOverlayData(length, state.currentState, state.nationalCache, state.chartData)`) so call sites stay unchanged while the logic is unit-tested in isolation. `range.js` deliberately exposes both `rangeEdgeIndices` (raw -1 edges, used by `setDateRange`'s zoom which bails on a -1 start) and `clampedRangeIndices` (0/len-1 clamped, used by the CSV/table path) because the two original call sites clamped differently.
- DOM references are cached in the `dom` object at init time, including button NodeLists. Use cached refs instead of repeated `querySelectorAll`. The view-button NodeList is scoped to `.controls-views .btn` so sibling buttons added to `.controls` don't get swept into the primary/secondary class toggle.
- Date range buttons use event delegation on the parent `.date-range-buttons` element.
- Legend clicks are routed through `handleLegendClick`: datasets 0/1 map to `state.currentView` via `viewAfterLegendToggle` (so the view buttons, info cards, and `?view=` stay in sync, and the last visible series can't be hidden); dataset 2 toggles `state.showNationalOverlay`. `shouldIncludeLegendItem` deliberately ignores that toggle so a hidden overlay stays in the legend (struck through) and can be re-enabled.
- `state.visibleRange` holds the `{start, end}` window after a wheel zoom / drag pan (`handleManualZoom`, wired to `onZoomComplete` + `onPanComplete`); `setDateRange` resets it to null. `computeRangeIndices` prefers it, so the CSV and table export what is on screen.
- `syncUrlParams` re-adds `embed=1` in embed mode - replaceState rewrites the iframe's own URL, so dropping it would restore full chrome on any reload.
- `loadData` validates the JSON shape (non-empty, equal-length `single_costs`/`household_costs`) and throws `userError(...)` for visitor-facing messages; other failures (e.g. `TypeError: Failed to fetch`) show a generic "check your connection" retry. Loading `ALL` also seeds `state.nationalCache`. On success it updates `document.title` and mirrors the state into the desktop combobox (Reset Filters and the ranking grid set the native select without dispatching to it).
- The desktop combobox closes on `blur`; the list's `mousedown` calls `preventDefault()` so focus stays in the input while clicking options. Enter with no highlighted option commits the best `filterStates` match for the typed text (exact code/name/alias, then word prefix, then substring; `us`/`usa` find the national view).
- Theme: `readStoredTheme`/`storeTheme` wrap localStorage in try/catch (it throws in storage-blocked third-party iframes; the inline bootstrap script in `index.html` is guarded too). `applyTheme` refreshes chart colors; with no stored choice the page follows `prefers-color-scheme` changes live.
- `formatDate()` uses the 3-argument `new Date(y, m-1, d)` constructor; `toIsoLocal()` formats a Date via `getFullYear/getMonth/getDate` (no UTC round-trip). Never use `new Date("YYYY-MM-DD")` for display - it parses as UTC midnight and rolls back a day in US timezones.
- `state.minDate` / `state.maxDate` are raw YYYY-MM-DD strings, not Date objects. Parse on demand with the split + 3-arg constructor pattern.
- Rapid state switches are race-safe: `loadData` bumps a module-level `fetchToken` and stashes an `AbortController` so a stale response can't overwrite a newer selection. `AbortError` caused by supersede is silent; `AbortError` caused by the 30s fetch timeout surfaces a user-visible retry message via `renderRetry()`. Non-AbortError failures also route through `renderRetry()` so every error path offers a retry button.
- The retry button uses `<button class="retry-btn">` (not an id) constructed via `createElement` with `{ once: true }` - duplicate-id collisions and listener-leaks if the user trips multiple timeouts are avoided.
- Y-axis toggle keeps `#btnToggleY`'s `.active` class in sync with `state.yAxisZero` both at bootstrap (for `?yaxis=zero` deep links) and in the click handler. The Y-axis button's text target is the inner `<span id="btnToggleYLabel">` since the button also contains an inline SVG icon that should survive toggles.
- Reset View returns to the URL-loaded range captured at bootstrap (`initialRange`), not to 'all'.
- Screen-reader announcements come from `#chartLiveRegion` (visually hidden `aria-live="polite"` region inside `.chart-container`). `updateInfoCards()` writes a one-line status summary, so arrow-key and click navigation are announced.
- `updateInfoCards` bounds-checks `index` against `state.chartData.single_costs.length` and bails when chartData is null (defensive against stale arrow keypresses during a state switch).
- Per-card estimation badges (`setEstimationBadge` helper) derive the label from each card's own flag (`details.price_estimated`, `details.income_estimated`, top-level `singleData.estimated`) and fall through to "Interpolated" when the row is between observations (`!observed && !estimated`).
- `updateDeltas(index, householdVisible, bothVisible)` writes the 52-Thursdays-ago delta into each card's `.info-delta` slot. Better/worse is per-metric: ratio/price/rate down = better, income up = better.
- The sticky mobile summary (`#stickySummary`) toggles `.visible` via an IntersectionObserver on `.chart-container`. Hidden on desktop via CSS. `updateInfoCards` writes its date + ratio.
- The data table view (toggle via `#btnToggleTable`) swaps the canvas for a semantic `<table>` covering the same date range, re-rendered when the range changes or on state switch.
- The keyboard shortcut dialog (`#shortcutDialog`) is a native `<dialog>`; press `?` outside any input/textarea/contenteditable to open. Escape closes natively; a click on the backdrop (event target is the dialog itself) closes it too. The chart container also handles Home/End (first/latest point) alongside the arrow keys.
- Service worker is registered only on `https:` so `file://` and `http://localhost` don't get a sticky cache.

## Chart Patterns

- **Update in place, don't destroy.** `loadData` creates the chart once via `initChart()` on first load; subsequent state switches run `updateChartData()` which replaces `chart.data.labels` + each dataset's `.data`, resets zoom, and calls `chart.update('none')`. The Chart.js instance, its canvas event listeners, and its hover state survive intact across switches - crucial for hover behavior. Do not revert to destroy + rebuild.
- **Three datasets.** Index 0 = single earner (blue, `--accent-blue`), index 1 = dual income 1.4x (purple, `--accent-purple`), index 2 = "U.S. Single Earner" national comparison overlay (gray dashed, hidden when `currentState === 'ALL'`). The tooltip line for index 2 reports only the overlay's own ratio (`ctx.parsed.y`) - never the state's household row. The national overlay's data is built by `nationalOverlayData()` using a date map against `state.nationalCache`, which is lazy-fetched by `fetchNationalIfNeeded()` after the main state load resolves. `spanGaps: true` keeps the line continuous across missing days.
- **Theme tokens captured into `state.chartColors`.** `readChartTokens()` reads CSS custom properties (`--accent-blue/purple/amber`, `--border-color`, `--text-secondary`, `--bg-container`, `--tooltip-bg`, `--tooltip-text`) into `state.chartColors`. Dataset segment callbacks and plugins reference `state.chartColors` so dark-mode theme toggles propagate via a single reassign + `chart.update('none')` in the `#themeToggle` handler. The handler also refreshes `chart.options.plugins.tooltip.{backgroundColor,titleColor,bodyColor}` so the tooltip matches the theme.
- **DOM active-point markers, not canvas.** The amber active-point indicator is rendered as absolutely-positioned `<div class="active-point-marker">` elements inside `#activePointMarkers` (a sibling of the canvas inside `.chart-container`, z-index 2). The `activePoint` plugin's `afterDraw` hook positions them with `transform: translate(p.x + canvas.offsetLeft, p.y + canvas.offsetTop)`. This keeps markers above the tooltip box (which draws inside the canvas) with no plugin-order fighting.
- **Zoom/touch.** Wheel zoom requires Ctrl (`modifierKey: 'ctrl'`; trackpad pinch sends ctrl-wheel) so plain scrolling over the chart scrolls the page. After init, `canvas.style.touchAction = 'pan-y'` overrides Hammer's `none` so phones can scroll vertically past the chart while horizontal drag/pinch still reach Hammer (chartjs-plugin-zoom only starts Hammer once, so the override sticks).
- **Axis + responsive.** X ticks use `formatAxisDate` (month + year when >70 points are visible, full date otherwise) with `maxRotation: 0`. `applyResponsiveChartOptions` (called from `onResize` and after init) shrinks the legend and caps ticks at 5 below 520px wide.
- **PNG export** temporarily enables the Chart.js `title`/`subtitle` plugins (state name, visible date range, site URL), snapshots, then disables them again.
- **Plugins** registered in `initChart`: `estimatedRegion` (amber tint behind extrapolated portion), `activePoint` (DOM marker placement above), `customCanvasBackgroundColor` (paints `--bg-container` behind the canvas so PNG export isn't transparent), `eventMarkers` (dashed vertical guides from `HOUSING_EVENTS` in `modules/events.js`, gated by `state.showEvents`; labels use the `--font-mono` family captured in `state.chartColors.fontMono` because canvas fonts can't resolve CSS variables, and `assignLabelRows` drops colliding labels onto extra rows). The tooltip footer shows an event's long `label` when hovering its week.
- **Animations disabled.** Chart options set `animation: false` and `transitions.active.animation.duration: 0`. Initial-animation animating x/y values were firing `afterDraw` with not-yet-settled positions, which hid the DOM marker until a click forced a final update.
- **`state.activePointIndex`** is set to `length - 1` on load / state switch (most recent point). Arrow keys (`←`/`→` on `.chart-container`) and click advance it. The chart-container `tabindex` is set to `0` from JS at the end of `initChart`, not in the HTML, so it isn't a tab dead-end before data loads.

## CSS Design System

Uses CSS custom properties defined in `:root` (with overrides in `:root[data-theme="dark"]`). Key tokens:
- Fonts: `--font-display` (Source Serif 4), `--font-body` (Outfit), `--font-mono` (DM Mono)
- Accents: `--accent-amber` (primary), `--accent-blue` (single earner), `--accent-purple` (dual income), `--bg-container` (card background)
- Tooltip-specific: `--tooltip-bg`, `--tooltip-text` (inverted between themes so the chart tooltip is always high-contrast against the chart background)
- Dark-header-fixed: `--text-on-dark`, `--text-on-dark-muted` (used by `.update-info` and other text painted on the always-dark header gradient; not overridden in dark mode)
- The `.is-loading` class on `#mainContent` triggers loading transitions when switching states (wrapped in `@media (prefers-reduced-motion: no-preference)` for the pulse)
- `.value-flip` animates info card values on update (180ms opacity dip). Triggered by adding the class after a forced reflow so consecutive arrow-key presses restart the animation. Also gated by `prefers-reduced-motion: no-preference`.
- `.sr-only` is available for visually hidden screen-reader content (1x1px clip pattern)
- `.btn-action` collapses to icon-only on viewports `<=768px` by hiding nested `.btn-label` - keeps the toolbar single-row on phones.
- `body.is-embed` strips chrome for iframe embedding (header / footer / methodology / state grid / sticky summary / skip link).
- Page header styles are scoped to `.site-header`, not a bare `header` selector - the shortcut dialog has its own `<header>`.
- `.shortcut-dialog` sets `margin: auto` explicitly: the global `* { margin: 0 }` reset otherwise strips the UA centering and pins the modal to the top-left.
- Entry animations (`fadeUp` on `.info-card` / `.chart-container`) use `animation-fill-mode: backwards`. A retained final keyframe (`both`) overrode the `.is-loading` dim and the card hover lift.
- `#currentMultiplier` / `#annualIncome` carry `.info-value-dual`, which reserves the two-line (Compare Both) height so view switches don't shift the chart.
- `.estimated-badge` is a corner tab confined to the card's top padding, so it can't overprint the label on narrow 5-up cards.
- Ranking-grid tiles mix `--heat` into `--bg-card` (10-90%) with `--heat-text` as the text color; both are set per theme (light: `#d97706` / `#0f172a`, dark: `#b45309` / `#f8fafc`) to stay >= 5:1 at every intensity.
- At <=480px the date-range and action button rows use `flex: 1 1 0` so each stays on one line.
- Use CSS variable tokens for colors - avoid hardcoding hex values. The active-point marker glow uses `color-mix(in srgb, var(--accent-amber) 40%, transparent)` so it tracks the amber token across themes. When a chart plugin needs a color, read it from `state.chartColors` so theme toggles propagate.

## Output JSON Schema (per file)

The canonical schema lives at `schema/state_data.schema.json` and is validated against every `data/*.json` + the national file in CI via `ajv-cli`. Highlights:

- `metadata.generated_at` - ISO-8601 with timezone
- `metadata.series_quality: { observed, interpolated, extrapolated }` - mutually exclusive, summing to total. `observed` = Thursday matched to a monthly FRED ZHVI release (~1 per month). `interpolated` = Hermite-interpolated between monthly points. `extrapolated` = trend-projected beyond the last monthly observation.
- `metadata.data_sources.qcew_income_multiplier` + `qcew_multiplier_source` + `qcew_year` - multiplier value + provenance marker (`qcew_<year>` / `fallback_missing` / `fallback_unavailable`). The schema enforces this via a regex pattern.
- `metadata.methodology.household_multiplier: 1.4` - documented in `weekly_case_shiller.rb` comment as 1.0 primary + 0.4 secondary earner
- Per-entry: `observed` (bool), `estimated` (true when price or income is extrapolated), `cpi` (optional - most-recent monthly CPIAUCSL value as of the Thursday; used by the frontend inflation-adjusted display), `estimation_details: {price_estimated, rate_estimated, income_estimated}` (present only when `estimated` is true), `rate_gap_days` (present when mortgage rate was nearest-neighbor-filled; up to `MAX_RATE_GAP_DAYS = 14`)

The frontend header prefers `series_quality` when present and falls back to the legacy `counts.actual + counts.estimated` wording otherwise, so older JSON still renders.

`data/index.json` is a separate small file: `{generated_at, states: [{state, state_name, date, latest_ratio_single, latest_ratio_household, latest_home_price, latest_mortgage_rate}]}` sorted by state code.

## Data Pipeline Robustness

- API calls (BLS, FRED) have HTTP status validation (`.to_i == 200` across the file), timeouts (30s open, 60s read), SSL peer verification, and retry logic (3 attempts with exponential backoff).
- `sanitize_for_log(str)` redacts `?api_key=...` and `"registrationkey"=>"..."` patterns before any error message is raised or logged, so public CI output never leaks secrets.
- `strict_float(str, field_name)` uses `Float()` with a rescue; malformed upstream values return nil with a warning instead of silently coercing to `0.0`.
- `find_nearest_rate` always returns the closest observation; the caller in `match_thursday_dates` enforces `MAX_RATE_GAP_DAYS = 14` and emits `nil` (skipping the Thursday) when the gap exceeds it. Within-threshold fills record the actual distance as `rate_gap_days` on the entry.
- File writes are atomic: write to `"#{output_file}.tmp"` then `File.rename`, so a crash mid-write can't serve truncated JSON.
- Per-state failures are rescued in the main loop; each failure is collected into `failed_states`. If any state failed, the process exits non-zero so CI fails loudly instead of auto-committing a partial snapshot. Previously-silent `return` paths for missing observations now `raise` to surface as counted failures.
- QCEW fetcher tries current year - 1, then year - 2, then falls back to 1.0 multipliers with `qcew_multiplier_source = 'fallback_unavailable'` - flagged in output, not silent.
- Growth rate calculations guard against division by zero.
- `Gemfile` lists `csv` explicitly (required on Ruby 3.4+ since csv left stdlib). No `httparty` - the script uses `Net::HTTP` directly.
- Ruby version lives in `.ruby-version` (4.0.7); both workflows use `ruby-version: '.ruby-version'` so local and CI can't drift. Bundler 4 (`BUNDLED WITH` in `Gemfile.lock`, which lists `x86_64-linux` for CI). json is 3.x: duplicate keys are rejected and the removed APIs (`fast_generate`, `create_additions`, etc.) are gone - stick to `JSON.parse` / `JSON.pretty_generate`. minitest is 6.x: use `assert_nil`, not `assert_equal nil`; `minitest/mock` is a separate gem if ever needed.

## Tests and Lint

- **Ruby (minitest)** - `test/all.rb` aggregator loads every `test/*_test.rb`. Current files: `normalize_income_data_test.rb` (BLS period parsing + edge cases), `home_price_enhancer_test.rb` (raises on invalid last obs, drops invalid middle obs, growth-rate fallback), `daily_estimator_test.rb` (hermite_interpolate degenerate inputs + estimate_weekly_income edge cases). Run: `bundle exec ruby test/all.rb`.
- **JS (node --test)** - `test/js/format.test.js`, `test/js/constants.test.js`, `test/js/urlState.test.js`, `test/js/range.test.js`, `test/js/deltas.test.js`, `test/js/overlay.test.js`, `test/js/quality.test.js`, `test/js/events.test.js`, `test/js/view.test.js`, `test/js/stateSearch.test.js`, `test/js/sw.test.js` (precache-list drift guard). No npm deps - uses the native test runner. Run: `node --test test/js/*.test.js`.
- **Lint (oxlint)** - zero-config, fast. Run: `npx --yes oxlint@0.16 app.js sw.js modules/ test/js/`.

When adding pure functions, put them in `modules/` and add a test under `test/js/`. `app.js` is a plain top-level ES module (not an IIFE); its DOM- and state-coupled glue stays outside the test surface, but pure decision logic is extracted into `modules/` (urlState/range/deltas/overlay/quality/view/stateSearch/events) and unit-tested - `app.js` calls it through thin same-name wrappers that inject the live state.

## GitHub Actions

Two workflows (a Lighthouse workflow existed until June 2026 and was removed):

**`.github/workflows/weekly_case_shiller.yml`** runs every Thursday at 17:05 UTC (cron `5 17 * * 4`, accepting ~1 hour drift across DST instead of the previous double-cron EDT/EST hack). Steps:

1. Checkout.
2. **Skip check** - reads `metadata.generated_at` from the national JSON; skips all downstream steps if a run landed within the last 6 hours (21600s window).
3. Ruby setup + `bundle install`.
4. **Run unit tests** via `bundle exec ruby test/all.rb` - fails fast before any API quota is spent.
5. Run `weekly_case_shiller.rb` for national + 50 states + DC.
6. Node setup + **JSON schema validation** via `ajv-cli` against `schema/state_data.schema.json`.
7. **Freshness check** - inline Ruby script asserts every `data/*.json` + the national file has `metadata.generated_at` within 8 days; fails the job if any is stale. Complements the per-state rescue's exit-1.
8. Commit and push updated JSON via `stefanzweifel/git-auto-commit-action`, with the message `Update affordability data for week of YYYY-MM-DD` (America/New_York date).

Concurrency group (`weekly-case-shiller`) prevents parallel runs.

**`.github/workflows/test.yml`** runs on every push to `main` and on PRs: two parallel jobs (Ruby minitest, JS `node --test`) plus an oxlint step (covering `sw.js` too) on the JS job.
