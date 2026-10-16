import {
  DEFAULTS,
  VIEW_TO_BTN,
  BTN_TO_VIEW,
  STATE_NAMES,
} from './modules/constants.js';
import {
  formatMoney,
  formatSignedMoney,
  formatDate,
  formatAxisDate,
  toIsoLocal,
  formatRelativeTime,
} from './modules/format.js';
import {
  HOUSING_EVENTS,
  eventLabelIndex,
  eventsAtIndex,
  assignLabelRows,
} from './modules/events.js';
import { parseUrlParams, anyFilterNonDefault } from './modules/urlState.js';
import { rangeEdgeIndices, clampedRangeIndices, clampIndexRange } from './modules/range.js';
import { computeDelta } from './modules/deltas.js';
import { isOverlayVisible, buildOverlayData, shouldIncludeLegendItem } from './modules/overlay.js';
import { qualityLabel, estimationBadge } from './modules/quality.js';
import { viewVisibility, viewAfterLegendToggle } from './modules/view.js';
import { filterStates } from './modules/stateSearch.js';

const DEFAULT_TITLE = document.title;
const isEmbed = new URLSearchParams(window.location.search).get('embed') === '1';

// localStorage throws (not just returns null) when storage is blocked - e.g. this page
// embedded in a third-party iframe with partitioned storage disabled.
const readStoredTheme = () => {
  try { return localStorage.getItem('theme'); } catch { return null; }
};
const storeTheme = theme => {
  try { localStorage.setItem('theme', theme); } catch { /* storage blocked: theme still applies */ }
};

// Encapsulated Application State
const state = {
    chartData: null,
    nationalCache: null,
    chartInstance: null,
    chartColors: {},
    firstEstimatedIndex: -1,
    activePointIndex: -1,
    minDate: null,
    maxDate: null,
    yAxisZero: false,
    showEvents: true,
    showNationalOverlay: true,
    currentState: 'ALL',
    currentRange: '2y',
    currentView: 'both',
    // {start, end} indices after a wheel zoom / drag pan; null means "whatever currentRange
    // selects". Lets the CSV + table export what is actually on screen.
    visibleRange: null,
  };


  // DOM Elements
  const dom = {
    updateInfo: document.getElementById('updateInfo'),
    selectedDate: document.getElementById('selectedDate'),
    currentMultiplier: document.getElementById('currentMultiplier'),
    housePrice: document.getElementById('housePrice'),
    annualIncome: document.getElementById('annualIncome'),
    mortgageRate: document.getElementById('mortgageRate'),
    multiplierCard: document.getElementById('multiplierCard'),
    priceCard: document.getElementById('priceCard'),
    incomeCard: document.getElementById('incomeCard'),
    multiplierDelta: document.getElementById('multiplierDelta'),
    priceDelta: document.getElementById('priceDelta'),
    incomeDelta: document.getElementById('incomeDelta'),
    rateDelta: document.getElementById('rateDelta'),
    btnToggleY: document.getElementById('btnToggleY'),
    btnToggleYLabel: document.getElementById('btnToggleYLabel'),
    btnResetFilters: document.getElementById('btnResetFilters'),
    stateSelect: document.getElementById('stateSelect'),
    headerEyebrow: document.getElementById('headerEyebrow'),
    dateRangeButtons: document.querySelectorAll('.date-range-buttons .btn'),
    controlsButtons: document.querySelectorAll('.controls-views .btn'),
    chartLiveRegion: document.getElementById('chartLiveRegion'),
    activePointMarkers: document.getElementById('activePointMarkers'),
    stickySummary: document.getElementById('stickySummary'),
    stickySummaryDate: document.getElementById('stickySummaryDate'),
    stickySummaryRatio: document.getElementById('stickySummaryRatio'),
    btnToggleTable: document.getElementById('btnToggleTable'),
    btnToggleTableLabel: document.getElementById('btnToggleTableLabel'),
    chartContainer: document.getElementById('chartContainer'),
    dataTableWrapper: document.getElementById('dataTableWrapper'),
    dataTableBody: document.getElementById('dataTableBody'),
    dataTableCaption: document.getElementById('dataTableCaption'),
    zoomTip: document.getElementById('zoomTip'),
    comboInput: document.getElementById('stateComboboxInput'),
  };

  let fetchToken = 0;
  let currentFetchController = null;
  // Assigned by setupStateGrid once the ranking grid is built; loadData calls it after the
  // displayed state is actually committed (success) or reverted (failure) so the aria-current
  // ring tracks the rendered state instead of lagging a selection behind.
  let highlightStateGrid = null;

  // URL Parameter Management - thin wrappers over the pure modules/urlState.js
  const readUrlParams = () => parseUrlParams(window.location.search);

  const isAnyFilterNonDefault = () =>
    anyFilterNonDefault({
      state: state.currentState,
      range: state.currentRange,
      view: state.currentView,
      yAxisZero: state.yAxisZero,
    });

  const syncUrlParams = () => {
    const params = new URLSearchParams();
    params.set('state', state.currentState.toLowerCase());
    params.set('range', state.currentRange);
    params.set('view', state.currentView);
    params.set('yaxis', state.yAxisZero ? 'zero' : 'auto');
    // Keep embed mode in the URL: replaceState rewrites the iframe's own address, so dropping
    // it here would bring back the full page chrome on any reload (including the SW update reload).
    if (isEmbed) params.set('embed', '1');

    const url = `${window.location.pathname}?${params.toString()}`;
    history.replaceState(null, '', url);

    if (dom.btnResetFilters) dom.btnResetFilters.hidden = !isAnyFilterNonDefault();
  };

  // Chart Plugins
  const plugins = {
    estimatedRegion: {
      id: 'estimatedRegion',
      beforeDraw: chart => {
        if (state.firstEstimatedIndex === -1) return;
        const { ctx, chartArea } = chart;
        const meta = chart.getDatasetMeta(0);
        if (!meta.data[state.firstEstimatedIndex]) return;

        const x = meta.data[state.firstEstimatedIndex].x;
        ctx.save();
        ctx.fillStyle = `${state.chartColors.amber}14`;
        ctx.fillRect(
          x,
          chartArea.top,
          chartArea.right - x,
          chartArea.bottom - chartArea.top,
        );
        ctx.restore();
      },
    },
    activePoint: {
      id: 'activePoint',
      // Positions DOM-level markers (inside #activePointMarkers) on each
      // visible dataset's active point. Using DOM elements instead of
      // canvas drawing means the markers are always above the tooltip
      // box (which draws inside the canvas) - no z-order fighting.
      afterDraw: chart => {
        const container = dom.activePointMarkers;
        if (!container) return;

        const datasets = chart.data.datasets;
        while (container.children.length < datasets.length) {
          const m = document.createElement('div');
          m.className = 'active-point-marker';
          m.style.display = 'none';
          container.appendChild(m);
        }

        // Chart.js gives point.x / point.y in canvas-local coordinates.
        // The marker container covers the chart-container padding box,
        // so shift by the canvas's offset inside its padded parent.
        const canvas = chart.canvas;
        const offsetX = canvas.offsetLeft;
        const offsetY = canvas.offsetTop;
        const { chartArea } = chart;

        datasets.forEach((_, i) => {
          const marker = container.children[i];
          if (state.activePointIndex === -1 || !chart.isDatasetVisible(i)) {
            marker.style.display = 'none';
            return;
          }
          const p = chart.getDatasetMeta(i).data[state.activePointIndex];
          if (
            !p ||
            p.x < chartArea.left ||
            p.x > chartArea.right ||
            p.y < chartArea.top ||
            p.y > chartArea.bottom
          ) {
            marker.style.display = 'none';
            return;
          }
          marker.style.display = 'block';
          marker.style.transform = `translate(${p.x + offsetX}px, ${p.y + offsetY}px)`;
        });
      },
    },
    customCanvasBackgroundColor: {
      id: 'customCanvasBackgroundColor',
      beforeDraw: chart => {
        const { ctx } = chart;
        ctx.save();
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = state.chartColors.bgContainer || '#ffffff';
        ctx.fillRect(0, 0, chart.width, chart.height);
        ctx.restore();
      },
    },
    eventMarkers: {
      id: 'eventMarkers',
      afterDatasetsDraw: chart => {
        if (!state.showEvents || !state.chartData) return;
        const { ctx, chartArea, scales: { x } } = chart;
        const labels = chart.data.labels;
        // Canvas fonts can't resolve CSS custom properties, so use the family string
        // captured by readChartTokens.
        ctx.save();
        ctx.font = `600 10px ${state.chartColors.fontMono || 'monospace'}`;

        const visible = [];
        HOUSING_EVENTS.forEach(evt => {
          const idx = eventLabelIndex(labels, evt.date);
          if (idx === -1) return;
          const xPos = x.getPixelForValue(idx);
          if (xPos < chartArea.left || xPos > chartArea.right) return;
          const half = ctx.measureText(evt.short).width / 2;
          // Keep the label inside the plot area even when the guide sits near an edge.
          const center = Math.min(Math.max(xPos, chartArea.left + half), chartArea.right - half);
          visible.push({ evt, xPos, center, left: center - half, right: center + half });
        });
        const rows = assignLabelRows(visible);

        visible.forEach(({ evt, xPos, center }, i) => {
          ctx.strokeStyle = state.chartColors.textColor || '#94a3b8';
          ctx.globalAlpha = 0.35;
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(xPos, chartArea.top);
          ctx.lineTo(xPos, chartArea.bottom);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.globalAlpha = 1;
          ctx.fillStyle = state.chartColors.amber || '#d97706';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(evt.short, center, chartArea.top + 4 + rows[i] * 13);
        });
        ctx.restore();
      },
    },
  };

  // Core Updates
  const updateCardBadge = (card, isEstimated, text) => {
    const existing = card.querySelector('.estimated-badge');
    if (existing) existing.remove();

    if (isEstimated) {
      card.classList.add('estimated');
      const badge = document.createElement('span');
      badge.className = 'estimated-badge';
      badge.textContent = text;
      card.appendChild(badge);
    } else {
      card.classList.remove('estimated');
    }
  };

  const triggerValueFlip = el => {
    if (!el) return;
    el.classList.remove('value-flip');
    // force reflow so the animation restarts on consecutive arrow-key presses
    void el.offsetWidth;
    el.classList.add('value-flip');
  };

  const updateInfoCards = (index, announce = false) => {
    if (!state.chartData || index < 0 || index >= state.chartData.single_costs.length) {
      return;
    }
    const singleData = state.chartData.single_costs[index];
    const householdData = state.chartData.household_costs[index];
    const singleVisible = state.chartInstance.isDatasetVisible(0);
    const householdVisible = state.chartInstance.isDatasetVisible(1);
    const bothVisible = singleVisible && householdVisible;

    dom.selectedDate.textContent = formatDate(singleData.date);
    dom.housePrice.textContent = formatMoney(singleData.home_price);
    dom.mortgageRate.textContent = `${singleData.mortgage_rate}%`;

    if (bothVisible) {
      dom.currentMultiplier.innerHTML =
        `<span class="dual-value single">${singleData.cost_to_income}x</span>` +
        `<span class="dual-value household">${householdData.cost_to_income}x</span>`;
      dom.annualIncome.innerHTML =
        `<span class="dual-value single">${formatMoney(singleData.single_income)}</span>` +
        `<span class="dual-value household">${formatMoney(householdData.household_income)}</span>`;
    } else if (householdVisible) {
      dom.currentMultiplier.textContent = `${householdData.cost_to_income}x`;
      dom.annualIncome.textContent = formatMoney(householdData.household_income);
    } else {
      dom.currentMultiplier.textContent = `${singleData.cost_to_income}x`;
      dom.annualIncome.textContent = formatMoney(singleData.single_income);
    }

    updateDeltas(index, householdVisible, bothVisible);

    [
      dom.selectedDate, dom.currentMultiplier, dom.housePrice, dom.annualIncome, dom.mortgageRate,
      dom.multiplierDelta, dom.priceDelta, dom.incomeDelta, dom.rateDelta,
    ].forEach(triggerValueFlip);

    const details = singleData.estimation_details || {};
    const isInterpolated = !singleData.observed && !singleData.estimated;

    const setEstimationBadge = (cardEl, isFieldEstimated) => {
      const { active, label } = estimationBadge(isFieldEstimated, isInterpolated);
      updateCardBadge(cardEl, active, label);
    };

    setEstimationBadge(dom.multiplierCard, !!singleData.estimated);
    setEstimationBadge(dom.priceCard, !!details.price_estimated);
    setEstimationBadge(dom.incomeCard, !!details.income_estimated);

    // Only announce on actual point navigation (arrow/click) and the initial/deep-link render.
    // View-toggle and theme re-renders pass announce=false to avoid re-reading the full sentence.
    if (announce && dom.chartLiveRegion) {
      const stateName = STATE_NAMES[state.currentState] || state.currentState;
      const multiplierPart = bothVisible
        ? `Price-to-Income ${singleData.cost_to_income}x (single) / ${householdData.cost_to_income}x (dual)`
        : householdVisible
          ? `Price-to-Income ${householdData.cost_to_income}x`
          : `Price-to-Income ${singleData.cost_to_income}x`;
      dom.chartLiveRegion.textContent = `${formatDate(singleData.date)} - ${stateName}: ${multiplierPart}, Median Home Price ${formatMoney(singleData.home_price)}, Mortgage ${singleData.mortgage_rate}%`;
    }

    if (dom.stickySummaryDate && dom.stickySummaryRatio) {
      dom.stickySummaryDate.textContent = formatDate(singleData.date);
      const stickyRatio = householdVisible && !bothVisible
        ? householdData.cost_to_income
        : singleData.cost_to_income;
      dom.stickySummaryRatio.textContent = `${stickyRatio}x`;
    }
  };

  const renderDelta = (el, diff, formatted, betterDirection) => {
    if (!el) return;
    const { text, className } = computeDelta(diff, formatted, betterDirection);
    el.textContent = text;
    el.className = className;
  };

  const updateDeltas = (index, householdVisible, bothVisible) => {
    const yearAgoIdx = index - 52;
    const deltaEls = [dom.multiplierDelta, dom.priceDelta, dom.incomeDelta, dom.rateDelta];
    if (yearAgoIdx < 0) {
      deltaEls.forEach(el => {
        if (!el) return;
        el.textContent = '';
        el.className = 'info-delta';
      });
      return;
    }

    const currSingle = state.chartData.single_costs[index];
    const prevSingle = state.chartData.single_costs[yearAgoIdx];
    const currHousehold = state.chartData.household_costs[index];
    const prevHousehold = state.chartData.household_costs[yearAgoIdx];

    // Ratio (lower is better). In both-view, anchor on single to match the eyebrow.
    const useHousehold = householdVisible && !bothVisible;
    const ratioDiff = useHousehold
      ? parseFloat(currHousehold.cost_to_income) - parseFloat(prevHousehold.cost_to_income)
      : parseFloat(currSingle.cost_to_income) - parseFloat(prevSingle.cost_to_income);
    renderDelta(
      dom.multiplierDelta,
      ratioDiff,
      `${ratioDiff >= 0 ? '+' : '-'}${Math.abs(ratioDiff).toFixed(2)}x`,
      'down',
    );

    // Price (lower is better - more affordable).
    const priceDiff = currSingle.home_price - prevSingle.home_price;
    renderDelta(dom.priceDelta, priceDiff, formatSignedMoney(priceDiff), 'down');

    // Income (higher is better).
    const incomeCurr = useHousehold ? currHousehold.household_income : currSingle.single_income;
    const incomePrev = useHousehold ? prevHousehold.household_income : prevSingle.single_income;
    const incomeDiff = incomeCurr - incomePrev;
    renderDelta(dom.incomeDelta, incomeDiff, formatSignedMoney(incomeDiff), 'up');

    // Mortgage rate (lower is better).
    const rateDiff = parseFloat(currSingle.mortgage_rate) - parseFloat(prevSingle.mortgage_rate);
    renderDelta(
      dom.rateDelta,
      rateDiff,
      `${rateDiff >= 0 ? '+' : '-'}${Math.abs(rateDiff).toFixed(2)}%`,
      'down',
    );
  };

  const readChartTokens = () => {
    const style = getComputedStyle(document.documentElement);
    return {
      primary: style.getPropertyValue('--accent-blue').trim() || '#3b82f6',
      secondary: style.getPropertyValue('--accent-purple').trim() || '#8b5cf6',
      gridColor: style.getPropertyValue('--border-color').trim() || '#e5e7eb',
      textColor: style.getPropertyValue('--text-secondary').trim() || '#6b7280',
      amber: style.getPropertyValue('--accent-amber').trim() || '#f59e0b',
      bgContainer: style.getPropertyValue('--bg-container').trim() || '#ffffff',
      tooltipBg: style.getPropertyValue('--tooltip-bg').trim() || 'rgba(17, 24, 39, 0.95)',
      tooltipText: style.getPropertyValue('--tooltip-text').trim() || '#f1f5f9',
      fontMono: style.getPropertyValue('--font-mono').trim() || 'monospace',
    };
  };

  // Phone-width charts get a smaller legend and fewer x ticks so the plot keeps its height.
  const COMPACT_CHART_WIDTH = 520;
  const applyResponsiveChartOptions = (chart, width) => {
    const compact = width < COMPACT_CHART_WIDTH;
    const legendLabels = chart.options.plugins.legend.labels;
    legendLabels.font = { size: compact ? 11 : 14, weight: 'bold' };
    legendLabels.boxWidth = compact ? 8 : 40;
    chart.options.scales.x.ticks.maxTicksLimit = compact ? 5 : 12;
  };

  // Legend clicks drive the same view state as the Compare Both / Single / Dual buttons, so the
  // buttons, info cards and URL can't drift from what the chart shows. Dataset 2 (U.S. overlay)
  // toggles the overlay preference instead.
  const handleLegendClick = (_e, item) => {
    if (item.datasetIndex === 2) {
      state.showNationalOverlay = !state.showNationalOverlay;
      applyNationalOverlay();
      return;
    }
    const next = viewAfterLegendToggle(state.currentView, item.datasetIndex);
    if (!next || next === state.currentView) return;
    state.currentView = next;
    applyCurrentView();
    syncUrlParams();
  };

  // After a wheel zoom or drag pan the range buttons no longer describe the view, so clear them
  // and remember the on-screen window for the CSV / table.
  const handleManualZoom = ({ chart }) => {
    if (!state.chartData) return;
    const items = state.chartData.single_costs;
    const { min, max } = chart.scales.x;
    // The wheel callback is debounced (~250ms), so it can land after a range button click that
    // followed a pinch. If the chart already shows exactly that range, keep the button lit.
    const { startIndex, endIndex } = rangeEdgeIndices(
      items, state.currentRange, state.minDate, state.maxDate,
    );
    if (min === startIndex && max === (endIndex !== -1 ? endIndex : items.length - 1)) return;
    clearDateButtons();
    state.visibleRange = clampIndexRange(min, max, items.length);
  };

  const initChart = () => {
    const ctx = document.getElementById('mortgageChart').getContext('2d');
    state.activePointIndex = state.chartData.single_costs.length - 1;

    const labels = state.chartData.single_costs.map(d => d.date);
    const singleData = state.chartData.single_costs.map(d => d.cost_to_income);
    const householdData = state.chartData.household_costs.map(
      d => d.cost_to_income,
    );

    state.chartColors = readChartTokens();
    const { primary: colorPrimary, secondary: colorSecondary, gridColor, textColor } = state.chartColors;

    state.chartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Single Earner',
            data: singleData,
            borderColor: colorPrimary,
            backgroundColor: `${colorPrimary}20`,
            borderWidth: 3,
            tension: 0.4,
            pointRadius: 0,
            pointHoverRadius: 8,
            segment: {
              borderDash: ctx =>
                state.chartData.single_costs[ctx.p1DataIndex]?.estimated ? [8, 4] : [],
              borderColor: ctx =>
                state.chartData.single_costs[ctx.p1DataIndex]?.estimated
                  ? `${state.chartColors.primary}80`
                  : state.chartColors.primary,
            },
          },
          {
            label: 'Dual Income (1.4×)',
            data: householdData,
            borderColor: colorSecondary,
            backgroundColor: `${colorSecondary}20`,
            borderWidth: 3,
            tension: 0.4,
            pointRadius: 0,
            pointHoverRadius: 8,
            segment: {
              borderDash: ctx =>
                state.chartData.household_costs[ctx.p1DataIndex]?.estimated ? [8, 4] : [],
              borderColor: ctx =>
                state.chartData.household_costs[ctx.p1DataIndex]?.estimated
                  ? `${state.chartColors.secondary}80`
                  : state.chartColors.secondary,
            },
          },
          {
            label: 'U.S. Single Earner',
            data: nationalOverlayData(state.chartData.single_costs.length),
            borderColor: state.chartColors.textColor || '#94a3b8',
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            borderDash: [4, 4],
            tension: 0.4,
            pointRadius: 0,
            pointHoverRadius: 0,
            spanGaps: true,
            hidden: !shouldShowNationalOverlay(),
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        transitions: { active: { animation: { duration: 0 } } },
        interaction: { mode: 'index', intersect: false },
        onResize: (chart, size) => applyResponsiveChartOptions(chart, size.width),
        onClick: (e, elements, chart) => {
          let index = -1;
          if (elements.length > 0) index = elements[0].index;
          else {
            const points = chart.getElementsAtEventForMode(
              e,
              'index',
              { intersect: false },
              false,
            );
            if (points.length > 0) index = points[0].index;
          }
          if (index !== -1) {
            state.activePointIndex = index;
            updateInfoCards(index, true);
            // 'none' skips the full re-render/animation pass; the activePoint plugin still
            // repositions the DOM marker in its afterDraw hook on a 'none' update.
            chart.update('none');
          }
        },
        plugins: {
          legend: {
            onClick: handleLegendClick,
            labels: {
              color: textColor,
              font: { size: 14, weight: 'bold' },
              usePointStyle: true,
              filter: item => shouldIncludeLegendItem(
                item.datasetIndex,
                state.currentState,
                state.nationalCache,
              ),
            },
          },
          tooltip: {
            backgroundColor: state.chartColors.tooltipBg,
            titleColor: state.chartColors.tooltipText,
            bodyColor: state.chartColors.tooltipText,
            footerColor: state.chartColors.tooltipText,
            padding: 15,
            callbacks: {
              title: ctx => {
                const d = state.chartData.single_costs[ctx[0].dataIndex];
                return `${formatDate(d.date)}${d.estimated ? ' (Estimated)' : ''}`;
              },
              afterTitle: ctx => {
                const d = state.chartData.single_costs[ctx[0].dataIndex];
                return `\nHome Price: ${formatMoney(d.home_price)}\nMortgage Rate: ${d.mortgage_rate}%\nTotal Cost: ${formatMoney(d.total_cost)}`;
              },
              label: ctx => {
                // The U.S. overlay only carries a ratio (from the national file), not this
                // state's income - don't report the state's numbers under the U.S. label.
                if (ctx.datasetIndex === 2) {
                  return `${ctx.dataset.label}: Ratio ${ctx.parsed.y.toFixed(2)}x`;
                }
                const isSingle = ctx.datasetIndex === 0;
                const d = isSingle
                  ? state.chartData.single_costs[ctx.dataIndex]
                  : state.chartData.household_costs[ctx.dataIndex];
                const income = isSingle ? d.single_income : d.household_income;
                return `${ctx.dataset.label}: Ratio ${d.cost_to_income}x (Income: ${formatMoney(income)})`;
              },
              footer: ctx =>
                state.showEvents
                  ? eventsAtIndex(ctx[0].chart.data.labels, ctx[0].dataIndex).map(evt => evt.label)
                  : [],
            },
          },
          zoom: {
            zoom: {
              // Plain wheel scrolls the page; Ctrl + wheel (also what a trackpad pinch sends)
              // zooms. Without the modifier the chart traps page scrolling under the cursor.
              wheel: { enabled: true, speed: 0.1, modifierKey: 'ctrl' },
              pinch: { enabled: true },
              mode: 'x',
              onZoomComplete: handleManualZoom,
            },
            pan: {
              enabled: true,
              mode: 'x',
              threshold: 10,
              onPanComplete: handleManualZoom,
            },
            limits: { x: { min: 'original', max: 'original' } },
          },
        },
        scales: {
          x: {
            ticks: {
              color: textColor,
              maxTicksLimit: 12,
              maxRotation: 0,
              autoSkipPadding: 16,
              // `this` is the x scale: format by how many weekly points are on screen.
              callback(value) {
                return formatAxisDate(this.getLabelForValue(value), this.max - this.min);
              },
            },
            grid: { display: false },
          },
          y: {
            beginAtZero: state.yAxisZero,
            ticks: { color: textColor },
            grid: { color: gridColor },
            title: {
              display: true,
              text: 'Price-to-Income Ratio',
              color: textColor,
              font: { weight: 'bold' },
            },
          },
        },
      },
      plugins: [
        plugins.estimatedRegion,
        plugins.activePoint,
        plugins.customCanvasBackgroundColor,
        plugins.eventMarkers,
      ],
    });

    // Hammer (chartjs-plugin-zoom's touch layer) sets touch-action: none on the canvas, which
    // stops a phone user from scrolling the page while their finger is on the chart. pan-y hands
    // vertical swipes back to the browser; horizontal drags and pinches still reach Hammer.
    // Hammer only writes this once, at plugin start.
    state.chartInstance.canvas.style.touchAction = 'pan-y';
    applyResponsiveChartOptions(state.chartInstance, state.chartInstance.width);

    const chartContainer = dom.chartContainer;
    if (chartContainer && chartContainer.tabIndex !== 0) {
      chartContainer.tabIndex = 0;
      chartContainer.setAttribute('role', 'group');
      chartContainer.setAttribute(
        'aria-label',
        'Price-to-income chart. Left and Right arrow keys step through dates; Home and End jump to the first and latest.',
      );
    }

    updateInfoCards(state.activePointIndex);
    setDateRange(state.currentRange);
    applyCurrentView();
    // Announce the initial/deep-link point once, after the view is applied so the sentence
    // reflects the correct single/dual/both visibility.
    updateInfoCards(state.activePointIndex, true);

    // Ensure the DOM marker lands on its final position after the
    // chart's initial animation and zoom/visibility updates settle,
    // not on some intermediate animation frame.
    state.chartInstance.update('none');
  };

  // Update the existing chart's data in place instead of destroy+rebuild.
  // Preserves hover/interaction state across state switches so tooltips
  // and point-hover-radius work immediately without waiting for a click.
  const updateChartData = () => {
    const chart = state.chartInstance;
    state.activePointIndex = state.chartData.single_costs.length - 1;

    chart.data.labels = state.chartData.single_costs.map(d => d.date);
    chart.data.datasets[0].data = state.chartData.single_costs.map(d => d.cost_to_income);
    chart.data.datasets[1].data = state.chartData.household_costs.map(d => d.cost_to_income);
    if (chart.data.datasets[2]) {
      chart.data.datasets[2].data = nationalOverlayData(state.chartData.single_costs.length);
    }

    chart.options.scales.y.beginAtZero = state.yAxisZero;
    chart.resetZoom('none');
    chart.update('none');

    updateInfoCards(state.activePointIndex);
    setDateRange(state.currentRange);
    applyCurrentView();
    // Announce the most-recent point once after a state switch (view visibility now applied).
    updateInfoCards(state.activePointIndex, true);
  };

  // Event & UI Handlers
  const clearDateButtons = () =>
    dom.dateRangeButtons.forEach(b => b.classList.remove('active'));

  const setDateRange = range => {
    state.currentRange = range;
    state.visibleRange = null;

    const items = state.chartData.single_costs;
    const { startIndex, endIndex } = rangeEdgeIndices(
      items, range, state.minDate, state.maxDate,
    );

    if (startIndex !== -1) {
      state.chartInstance.zoomScale('x', {
        min: startIndex,
        max: endIndex !== -1 ? endIndex : items.length - 1,
      });
      clearDateButtons();
      const btn = document.querySelector(
        `.date-range-buttons .btn[data-range="${range}"]`,
      );
      if (btn) btn.classList.add('active');
    }
    if (dom.dataTableWrapper && !dom.dataTableWrapper.hidden) {
      renderDataTable();
    }
  };

  const applyCurrentView = () => {
    const btnId = VIEW_TO_BTN[state.currentView] || 'btnBoth';
    const { single, household } = viewVisibility(state.currentView);
    updateLineVisibility(single, household, btnId);
  };

  const updateLineVisibility = (showSingle, showHousehold, btnId) => {
    if (showSingle) state.chartInstance.show(0);
    else state.chartInstance.hide(0);
    if (showHousehold) state.chartInstance.show(1);
    else state.chartInstance.hide(1);
    // Dataset.hidden is only the initial flag. After init, Chart.js stores
    // live visibility on the meta via show()/hide(). Keep the overlay in
    // sync here so a return to ALL actually drops it from the chart + legend.
    if (state.chartInstance.data.datasets[2]) {
      if (shouldShowNationalOverlay()) state.chartInstance.show(2);
      else state.chartInstance.hide(2);
    }

    state.currentView = BTN_TO_VIEW[btnId] || 'both';

    dom.controlsButtons.forEach(btn => {
      btn.classList.toggle('btn-primary', btn.id === btnId);
      btn.classList.toggle('active', btn.id === btnId);
      btn.classList.toggle('btn-secondary', btn.id !== btnId);
    });
    updateInfoCards(state.activePointIndex);
  };

  // Features
  const downloadChart = () => {
    // In table view the chart container is hidden (display:none), which collapses the canvas to
    // 0x0 and yields a blank PNG. Un-hide + resize to restore the backing buffer, snapshot, then
    // re-hide - all synchronous, so the browser never paints the intermediate chart (no flicker).
    const chart = state.chartInstance;
    const tableActive = dom.dataTableWrapper && !dom.dataTableWrapper.hidden;
    if (tableActive) {
      dom.chartContainer.hidden = false;
      chart.resize();
    }
    // A shared PNG should say what it shows: stamp a title + source line for the snapshot only.
    const range = computeRangeIndices();
    const rows = state.chartData.single_costs;
    const color = state.chartColors.textColor;
    chart.options.plugins.title = {
      display: true,
      text: `${STATE_NAMES[state.currentState] || state.currentState} · Mortgage vs Income`,
      color,
      font: { size: 16, weight: 'bold' },
      padding: { top: 4, bottom: 2 },
    };
    chart.options.plugins.subtitle = {
      display: true,
      text: `Price-to-income ratio, ${formatDate(rows[range.start].date)} – ${formatDate(rows[range.end].date)} · mortgagevsincome.com`,
      color,
      padding: { bottom: 8 },
    };
    chart.update('none');
    const image = chart.toBase64Image();
    chart.options.plugins.title = { display: false };
    chart.options.plugins.subtitle = { display: false };
    chart.update('none');

    const link = document.createElement('a');
    link.download = `mortgage-vs-income-${state.currentState}-${toIsoLocal(new Date())}.png`;
    link.href = image;
    link.click();
    if (tableActive) {
      dom.chartContainer.hidden = true;
    }
  };

  const csvCell = value => {
    const s = value == null ? '' : String(value);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const downloadCsv = () => {
    if (!state.chartData) return;
    const range = computeRangeIndices();
    if (!range) return;
    const single = state.chartData.single_costs;
    const household = state.chartData.household_costs;
    const header = [
      'date', 'observed', 'estimated',
      'single_ratio', 'household_ratio',
      'home_price', 'single_income', 'household_income',
      'mortgage_rate',
    ];
    const lines = [header.join(',')];
    for (let i = range.start; i <= range.end; i++) {
      const s = single[i];
      const h = household[i];
      lines.push([
        s.date,
        s.observed ? 'true' : 'false',
        s.estimated ? 'true' : 'false',
        s.cost_to_income,
        h.cost_to_income,
        s.home_price,
        s.single_income,
        h.household_income,
        s.mortgage_rate,
      ].map(csvCell).join(','));
    }
    const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `mortgage-vs-income-${state.currentState}-${toIsoLocal(new Date())}.csv`;
    link.href = url;
    link.click();
    // Revoking synchronously can cancel the download in Safari/Firefox; let it start first.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const setYAxisLabel = () => {
    dom.btnToggleYLabel.textContent = state.yAxisZero ? 'Y-Axis: Zero' : 'Y-Axis: Auto';
    dom.btnToggleY.classList.toggle('active', state.yAxisZero);
  };

  const computeRangeIndices = () => {
    if (!state.chartData) return null;
    if (state.visibleRange) return state.visibleRange;
    return clampedRangeIndices(
      state.chartData.single_costs, state.currentRange, state.minDate, state.maxDate,
    );
  };

  const renderDataTable = () => {
    if (!state.chartData || !dom.dataTableBody) return;
    const range = computeRangeIndices();
    if (!range) return;
    const single = state.chartData.single_costs;
    const household = state.chartData.household_costs;
    const stateName = STATE_NAMES[state.currentState] || state.currentState;
    if (dom.dataTableCaption) {
      dom.dataTableCaption.textContent =
        `Mortgage vs income metrics for ${stateName}, ${formatDate(single[range.start].date)} to ${formatDate(single[range.end].date)}.`;
    }
    const rows = [];
    for (let i = range.start; i <= range.end; i++) {
      const s = single[i];
      const h = household[i];
      const q = qualityLabel(s);
      rows.push(
        `<tr>` +
        `<td>${formatDate(s.date)}</td>` +
        `<td>${s.cost_to_income}x</td>` +
        `<td>${h.cost_to_income}x</td>` +
        `<td>${formatMoney(s.home_price)}</td>` +
        `<td>${formatMoney(s.single_income)}</td>` +
        `<td>${formatMoney(h.household_income)}</td>` +
        `<td>${s.mortgage_rate}%</td>` +
        `<td class="${q.cls}">${q.text}</td>` +
        `</tr>`,
      );
    }
    dom.dataTableBody.innerHTML = rows.join('');
  };

  const setupStateGrid = async () => {
    const grid = document.getElementById('stateGrid');
    if (!grid) return;
    const section = grid.closest('.state-grid-section');
    try {
      const resp = await fetch('data/index.json');
      if (!resp.ok) {
        if (section) section.hidden = true;
        return;
      }
      const idx = await resp.json();
      const items = (idx.states || []).filter(s => s.latest_ratio_single != null);
      if (!items.length) {
        if (section) section.hidden = true;
        return;
      }
      items.sort((a, b) => b.latest_ratio_single - a.latest_ratio_single);
      const min = items[items.length - 1].latest_ratio_single;
      const max = items[0].latest_ratio_single;
      const span = Math.max(0.001, max - min);

      grid.replaceChildren();
      items.forEach(s => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'state-tile';
        btn.dataset.code = s.state;
        // No role override: a role="listitem" here would clobber the implicit button role,
        // so AT would announce a non-actionable list item instead of a button.
        btn.setAttribute(
          'aria-label',
          `${s.state_name}, ratio ${s.latest_ratio_single.toFixed(2)}x. Press to load.`,
        );
        const intensity = Math.round(((s.latest_ratio_single - min) / span) * 80) + 10;
        // Solid fallback first; the color-mix assignment is ignored on browsers
        // that don't support it (e.g. iOS 16.0-16.3), leaving the fallback in place.
        // --heat / --heat-text are tuned per theme so the text clears 4.5:1 at every intensity.
        btn.style.background = 'var(--bg-card)';
        btn.style.background = `color-mix(in srgb, var(--heat) ${intensity}%, var(--bg-card))`;
        const code = document.createElement('span');
        code.className = 'state-tile-code';
        code.textContent = s.state;
        const ratio = document.createElement('span');
        ratio.className = 'state-tile-ratio';
        ratio.textContent = `${s.latest_ratio_single.toFixed(1)}x`;
        btn.append(code, ratio);
        btn.addEventListener('click', () => {
          if (dom.stateSelect.value !== s.state) {
            dom.stateSelect.value = s.state;
            dom.stateSelect.dispatchEvent(new Event('change'));
          }
        });
        grid.appendChild(btn);
      });

      const highlightCurrent = () => {
        grid.querySelectorAll('.state-tile').forEach(t => {
          t.setAttribute('aria-current', t.dataset.code === state.currentState ? 'true' : 'false');
        });
      };
      highlightCurrent();
      // loadData drives subsequent highlights once state.currentState is committed/reverted.
      // The old #stateSelect 'change' wiring read currentState before commit (J1), so the
      // ring lagged one selection behind - don't re-add it here.
      highlightStateGrid = highlightCurrent;
    } catch {
      // Hide the whole section (header + grid), not just the inner wrapper, so a thrown
      // error doesn't leave an orphaned "All states, ranked" heading above empty space.
      if (section) section.hidden = true;
    }
  };

  const setupStateCombobox = () => {
    const input = dom.comboInput;
    const list = document.getElementById('stateComboboxList');
    if (!input || !list || !dom.stateSelect) return;

    const items = Array.from(dom.stateSelect.options).map(opt => ({
      code: opt.value,
      name: opt.textContent.trim(),
      aliases: opt.value === 'ALL' ? ['us', 'usa', 'united states', 'national'] : [],
    }));
    let filtered = items.slice();
    let activeIdx = -1;

    const stateNameFor = code => STATE_NAMES[code] || code || 'U.S.A';
    const setInputToCurrent = () => { input.value = stateNameFor(dom.stateSelect.value); };
    setInputToCurrent();

    const renderList = filter => {
      filtered = filterStates(items, filter);
      // APG: aria-selected marks the COMMITTED value option (not the keyboard-highlighted
      // one - that's conveyed via aria-activedescendant + the .active class in setActive).
      const selectedCode = dom.stateSelect.value;
      list.innerHTML = filtered
        .map((it, i) =>
          `<li role="option" data-code="${it.code}" id="state-combo-opt-${i}" aria-selected="${it.code === selectedCode ? 'true' : 'false'}">` +
          `<span>${it.name}</span><span class="state-code">${it.code === 'ALL' ? 'US' : it.code}</span>` +
          `</li>`)
        .join('');
      activeIdx = -1;
      input.removeAttribute('aria-activedescendant');
    };

    const openList = () => {
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    };

    const closeList = () => {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      // Popup is hidden: drop the active-option pointer so AT doesn't reference a stale id.
      input.removeAttribute('aria-activedescendant');
      activeIdx = -1;
    };

    const setActive = i => {
      const lis = list.querySelectorAll('li');
      // Keyboard highlight is a visual-only .active class; the active option is conveyed to
      // AT via aria-activedescendant. aria-selected stays on the committed option (renderList).
      lis.forEach(li => li.classList.remove('active'));
      if (i >= 0 && i < lis.length) {
        lis[i].classList.add('active');
        lis[i].scrollIntoView({ block: 'nearest' });
        input.setAttribute('aria-activedescendant', lis[i].id);
      } else {
        input.removeAttribute('aria-activedescendant');
      }
      activeIdx = i;
    };

    const commit = code => {
      if (!code) return;
      input.value = stateNameFor(code);
      closeList();
      if (dom.stateSelect.value !== code) {
        dom.stateSelect.value = code;
        dom.stateSelect.dispatchEvent(new Event('change'));
      }
    };

    input.addEventListener('focus', () => {
      input.select();
      renderList('');
      openList();
    });

    input.addEventListener('input', () => {
      renderList(input.value);
      openList();
    });

    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (list.hidden) { renderList(''); openList(); }
        if (filtered.length) setActive(Math.min(activeIdx + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (filtered.length) setActive(Math.max(activeIdx - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (activeIdx >= 0 && !list.hidden) {
          commit(filtered[activeIdx].code);
        } else {
          // No highlighted option: take the best match for what's typed ("ne" -> Nebraska,
          // "texas" -> Texas). Untouched input holds the current state's name, so this is a no-op.
          const best = filterStates(items, input.value)[0];
          if (best) commit(best.code);
        }
      } else if (e.key === 'Escape') {
        closeList();
        setInputToCurrent();
        // APG: keep focus in the textbox rather than dropping it to <body> on close.
        input.focus();
      }
    });

    // Re-open on click when the input is already focused (e.g. right after a commit), selecting
    // the text like the focus handler so typing replaces the committed name.
    input.addEventListener('click', () => {
      if (list.hidden) {
        input.select();
        renderList('');
        openList();
      }
    });

    // Tabbing or clicking away closes the popup and restores the committed state's name.
    input.addEventListener('blur', () => {
      closeList();
      setInputToCurrent();
    });

    list.addEventListener('mousedown', e => {
      // Keep focus in the input so the blur handler doesn't close the list mid-click
      // (or when dragging the list's scrollbar).
      e.preventDefault();
      const li = e.target.closest('li');
      if (li) commit(li.dataset.code);
    });

    dom.stateSelect.addEventListener('change', setInputToCurrent);
  };

  const toggleTableView = () => {
    if (!dom.dataTableWrapper || !dom.chartContainer) return;
    const showingTable = !dom.dataTableWrapper.hidden;
    if (showingTable) {
      dom.dataTableWrapper.hidden = true;
      dom.chartContainer.hidden = false;
      dom.btnToggleTable.setAttribute('aria-pressed', 'false');
      dom.btnToggleTableLabel.textContent = 'View as Table';
    } else {
      renderDataTable();
      dom.dataTableWrapper.hidden = false;
      dom.chartContainer.hidden = true;
      dom.btnToggleTable.setAttribute('aria-pressed', 'true');
      dom.btnToggleTableLabel.textContent = 'View as Chart';
    }
    // The zoom/pan/arrow-key tip only applies to the chart.
    if (dom.zoomTip) dom.zoomTip.hidden = !showingTable;
  };

  const toggleYAxis = () => {
    state.yAxisZero = !state.yAxisZero;
    state.chartInstance.options.scales.y.beginAtZero = state.yAxisZero;
    setYAxisLabel();
    state.chartInstance.update();
  };

  const getDataUrl = stateCode => {
    if (stateCode === 'ALL') return 'weekly_case_shiller_output.json';
    return `data/${stateCode}.json`;
  };

  const shouldShowNationalOverlay = () =>
    isOverlayVisible(state.currentState, state.showNationalOverlay, state.nationalCache);

  const nationalOverlayData = length =>
    buildOverlayData(length, state.currentState, state.nationalCache, state.chartData);

  const fetchNationalIfNeeded = async () => {
    if (state.nationalCache || state.currentState === 'ALL') return;
    // Pin the load that triggered this fetch; a late response must not paint onto a newer state.
    const myToken = fetchToken;
    try {
      const resp = await fetch('weekly_case_shiller_output.json');
      if (!resp.ok) return;
      state.nationalCache = await resp.json();
      if (state.chartInstance && state.chartData) {
        applyNationalOverlay(myToken);
      }
    } catch {
      // Silent: overlay is a non-critical enhancement.
    }
  };

  const applyNationalOverlay = myToken => {
    // Bail if a newer state load has superseded the one that requested this overlay.
    if (myToken !== undefined && myToken !== fetchToken) return;
    if (!state.chartInstance || !state.chartData) return;
    const ds = state.chartInstance.data.datasets[2];
    if (!ds) return;
    ds.data = nationalOverlayData(state.chartData.single_costs.length);
    if (shouldShowNationalOverlay()) state.chartInstance.show(2);
    else state.chartInstance.hide(2);
  };

  const buildRetryButton = stateCode => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-secondary btn-small retry-btn';
    btn.textContent = 'Retry';
    btn.addEventListener('click', () => loadData(stateCode), { once: true });
    return btn;
  };

  const renderRetry = (stateCode, isSwitch, message) => {
    const wrapper = document.createElement('span');
    wrapper.append(`${message} `);
    wrapper.appendChild(buildRetryButton(stateCode));
    if (isSwitch) {
      dom.updateInfo.replaceChildren(wrapper);
    } else {
      const lm = document.getElementById('loadingMessage');
      const errorDiv = document.createElement('div');
      errorDiv.className = 'error-message';
      errorDiv.appendChild(wrapper);
      lm.replaceChildren(errorDiv);
      lm.style.display = '';
    }
  };

  const updateHeaderForState = stateCode => {
    const name = STATE_NAMES[stateCode] || stateCode;
    const label = stateCode === 'ALL' ? 'U.S. Housing Market' : `${name} Housing Market`;
    const latest = state.chartData && state.chartData.single_costs
      ? state.chartData.single_costs[state.chartData.single_costs.length - 1]
      : null;
    dom.headerEyebrow.textContent = label;
    if (latest) {
      // Own span so the eyebrow's text-transform: uppercase doesn't turn "12.8x" into "12.8X".
      const ratio = document.createElement('span');
      ratio.className = 'header-eyebrow-ratio';
      ratio.textContent = `${latest.cost_to_income}x`;
      dom.headerEyebrow.append(' · ', ratio);
    }
    document.title = stateCode === 'ALL' ? DEFAULT_TITLE : `${name} - ${DEFAULT_TITLE}`;
  };

  // Errors whose message is written for site visitors. Anything else (TypeError from a dropped
  // connection, etc.) gets a generic message instead of e.g. "Failed to fetch".
  const userError = message => Object.assign(new Error(message), { userFacing: true });

  // Bootstrapping
  const loadData = async stateCode => {
    // Don't commit currentState yet: a failed/timed-out load must leave the UI on the
    // previously-rendered state, so we only switch on the success path below.
    const prevState = state.currentState;

    const myToken = ++fetchToken;
    if (currentFetchController) currentFetchController.abort();
    currentFetchController = new AbortController();
    const controller = currentFetchController;

    let timedOut = false;
    const FETCH_TIMEOUT_MS = 30000;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, FETCH_TIMEOUT_MS);

    const mainContent = document.getElementById('mainContent');
    const isSwitch = state.chartInstance !== null;

    if (isSwitch) {
      mainContent.classList.add('is-loading');
    }

    const stateName = STATE_NAMES[stateCode] || stateCode;
    try {
      const url = getDataUrl(stateCode);
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw userError(
          response.status === 404
            ? `Data for ${stateName} isn't available right now.`
            : `Couldn't load data for ${stateName} (server error ${response.status}).`,
        );
      }

      let json;
      try {
        json = await response.json();
      } catch (bodyError) {
        // An abort (timeout or superseding load) mid-read must reach the AbortError handling
        // below, not be reported as a damaged file.
        if (controller.signal.aborted) throw bodyError;
        throw userError(`The data file for ${stateName} looks damaged. Please try again shortly.`);
      }
      if (
        !Array.isArray(json?.single_costs) || !json.single_costs.length ||
        !Array.isArray(json.household_costs) ||
        json.household_costs.length !== json.single_costs.length
      ) {
        throw userError(`The data file for ${stateName} is incomplete. Please try again shortly.`);
      }
      if (myToken !== fetchToken) return;

      // Load succeeded and is still the latest request: commit the new state now.
      state.currentState = stateCode;
      state.chartData = json;
      // The national file doubles as the overlay source - no need to fetch it again later.
      if (stateCode === 'ALL') state.nationalCache = json;
      state.firstEstimatedIndex = state.chartData.single_costs.findIndex(
        i => i.estimated || i.interpolated,
      );

      state.minDate = state.chartData.single_costs[0].date;
      state.maxDate =
        state.chartData.single_costs[state.chartData.single_costs.length - 1].date;

      // Metadata setup
      const gen = new Date(state.chartData.metadata.generated_at);
      const sq = state.chartData.metadata.series_quality;
      let countsText;
      if (sq) {
        const parts = [`${sq.observed} observed`];
        if (sq.interpolated > 0) parts.push(`${sq.interpolated} interpolated`);
        if (sq.extrapolated > 0) parts.push(`${sq.extrapolated} extrapolated`);
        countsText = `${parts.join(' + ')} data points`;
      } else {
        const actCount =
          state.firstEstimatedIndex === -1
            ? state.chartData.single_costs.length
            : state.firstEstimatedIndex;
        const estCount = state.chartData.single_costs.length - actCount;
        countsText = `${actCount} actual${estCount > 0 ? ' + ' + estCount + ' estimated' : ''} data points`;
      }
      dom.updateInfo.textContent = `Updated ${formatRelativeTime(gen)} | ${countsText}`;
      dom.updateInfo.title = `Generated at ${gen.toLocaleString()}`;

      document.getElementById('loadingMessage').style.display = 'none';
      mainContent.style.display = 'block';

      updateHeaderForState(stateCode);
      if (state.chartInstance) {
        updateChartData();
      } else {
        initChart();
      }
      syncUrlParams();
      // Programmatic switches (Reset Filters, the ranking grid) set the native select without the
      // combobox seeing it, so mirror the committed state into the desktop picker here.
      if (dom.comboInput && document.activeElement !== dom.comboInput) {
        dom.comboInput.value = STATE_NAMES[stateCode] || stateCode;
      }
      // Sync the ranking-grid ring now that state.currentState holds the committed state.
      if (highlightStateGrid) highlightStateGrid();
      // Fire the national overlay fetch after the main chart is up (non-blocking).
      fetchNationalIfNeeded();
    } catch (error) {
      // Aborted by a newer load (supersede), not our own timeout: that load now owns currentState
      // + the picker, so bail silently without restoring or surfacing an error.
      if (error.name === 'AbortError' && !timedOut) return;
      // A newer load took over after this one resolved its fetch: likewise leave its state intact.
      if (myToken !== fetchToken) return;

      // Genuine failure of the current load. Restore the previously-shown state so currentState,
      // the native <select>, and the desktop combobox don't claim data we never rendered.
      state.currentState = prevState;
      if (dom.stateSelect.value !== prevState) dom.stateSelect.value = prevState;
      if (dom.comboInput) dom.comboInput.value = STATE_NAMES[prevState] || prevState || 'U.S.A';
      // Failed switch reverted to prevState: move the ring back so it never sits on a state
      // we never rendered.
      if (highlightStateGrid) highlightStateGrid();

      if (error.name === 'AbortError') {
        // Survived the supersede guard above, so this AbortError is our own 30s timeout.
        renderRetry(stateCode, isSwitch, "Couldn't load data - network timeout.");
        return;
      }
      console.error(error);
      renderRetry(
        stateCode,
        isSwitch,
        error.userFacing ? error.message : "Couldn't load data - check your connection and try again.",
      );
    } finally {
      clearTimeout(timeoutId);
      if (myToken === fetchToken) mainContent.classList.remove('is-loading');
    }
  };

  // Service worker registration (off in dev / non-https).
  if ('serviceWorker' in navigator && window.location.protocol === 'https:') {
    // Capture controller state BEFORE register: a new SW that claims an already-
    // controlled tab fires controllerchange, and we reload once so the page can't
    // run mixed old/new assets. hadController is false on first install, so the
    // very first SW activation does not trigger a reload.
    const hadController = !!navigator.serviceWorker.controller;
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing || !hadController) return;
      refreshing = true;
      window.location.reload();
    });
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }

  // Listeners bindings
  document.addEventListener('DOMContentLoaded', () => {
    // Embed mode strips header/footer/methodology so the chart fills the iframe.
    if (isEmbed) {
      document.body.classList.add('is-embed');
    }

    if (typeof Chart === 'undefined') {
      const lm = document.getElementById('loadingMessage');
      if (lm) {
        lm.replaceChildren();
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        const strong = document.createElement('strong');
        strong.textContent = 'Failed to load chart library.';
        errorDiv.append(strong, ' The CDN may be unreachable. Check your connection and refresh the page.');
        lm.appendChild(errorDiv);
        lm.style.display = '';
      }
      return;
    }

    // Read URL params and apply initial state
    const params = readUrlParams();
    const initialRange = params.range;
    state.currentRange = params.range;
    state.currentView = params.view;
    state.yAxisZero = params.yaxis === 'zero';
    dom.stateSelect.value = params.state;

    if (state.yAxisZero) {
      dom.btnToggleYLabel.textContent = 'Y-Axis: Zero';
      dom.btnToggleY.classList.add('active');
    }

    document
      .getElementById('btnBoth')
      .addEventListener('click', () => {
        updateLineVisibility(true, true, 'btnBoth');
        syncUrlParams();
      });
    document
      .getElementById('btnSingle')
      .addEventListener('click', () => {
        updateLineVisibility(true, false, 'btnSingle');
        syncUrlParams();
      });
    document
      .getElementById('btnHousehold')
      .addEventListener('click', () => {
        updateLineVisibility(false, true, 'btnHousehold');
        syncUrlParams();
      });

    document.querySelector('.date-range-buttons').addEventListener('click', e => {
      const btn = e.target.closest('.btn');
      if (btn) { setDateRange(btn.dataset.range); syncUrlParams(); }
    });

    document.getElementById('btnResetZoom').addEventListener('click', () => {
      setDateRange(initialRange);
      syncUrlParams();
    });
    document
      .getElementById('btnDownload')
      .addEventListener('click', downloadChart);
    const btnCsv = document.getElementById('btnDownloadCsv');
    if (btnCsv) btnCsv.addEventListener('click', downloadCsv);
    const btnToggleEvents = document.getElementById('btnToggleEvents');
    if (btnToggleEvents) {
      btnToggleEvents.addEventListener('click', () => {
        state.showEvents = !state.showEvents;
        btnToggleEvents.classList.toggle('active', state.showEvents);
        btnToggleEvents.setAttribute('aria-pressed', state.showEvents ? 'true' : 'false');
        if (state.chartInstance) state.chartInstance.update('none');
      });
    }

    const btnCopyLink = document.getElementById('btnCopyLink');
    const btnCopyLinkLabel = document.getElementById('btnCopyLinkLabel');
    if (btnCopyLink && btnCopyLinkLabel) {
      // Always restore to the fixed label: capturing the current text would latch "Copied!"
      // permanently if the button is clicked again before the reset timer fires.
      const COPY_LABEL = btnCopyLinkLabel.textContent;
      let copyResetTimer = null;
      const flashCopyLabel = text => {
        btnCopyLinkLabel.textContent = text;
        // Icon-only on phones, so also announce the outcome.
        if (dom.chartLiveRegion) dom.chartLiveRegion.textContent = text === 'Copied!' ? 'Link copied' : text;
        clearTimeout(copyResetTimer);
        copyResetTimer = setTimeout(() => { btnCopyLinkLabel.textContent = COPY_LABEL; }, 1600);
      };
      btnCopyLink.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(window.location.href);
          flashCopyLabel('Copied!');
        } catch {
          flashCopyLabel('Copy failed');
        }
      });
    }
    dom.btnToggleY.addEventListener('click', () => { toggleYAxis(); syncUrlParams(); });

    dom.btnResetFilters.addEventListener('click', () => {
      state.currentRange = DEFAULTS.range;
      state.currentView = DEFAULTS.view;
      state.yAxisZero = DEFAULTS.yaxis === 'zero';
      dom.stateSelect.value = DEFAULTS.state;
      setYAxisLabel();
      resizeSelect();
      loadData(DEFAULTS.state);
    });

    // State market selector
    const measureSpan = document.createElement('span');
    measureSpan.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap';
    document.body.appendChild(measureSpan);
    const resizeSelect = () => {
      const cs = getComputedStyle(dom.stateSelect);
      measureSpan.style.font = cs.font;
      measureSpan.style.letterSpacing = cs.letterSpacing;
      measureSpan.textContent = dom.stateSelect.options[dom.stateSelect.selectedIndex].text;
      dom.stateSelect.style.width = (measureSpan.offsetWidth + 52) + 'px';
    };
    resizeSelect();
    // Re-measure once web fonts land (the first pass used fallback metrics) and when the
    // select's font size changes at the mobile breakpoint.
    if (document.fonts) document.fonts.ready.then(resizeSelect);
    window.matchMedia('(max-width: 768px)').addEventListener('change', resizeSelect);
    dom.stateSelect.addEventListener('change', () => {
      resizeSelect();
      loadData(dom.stateSelect.value);
    });

    // Table view toggle
    if (dom.btnToggleTable) {
      dom.btnToggleTable.addEventListener('click', toggleTableView);
    }

    // Searchable state combobox (desktop only - mobile uses the native select)
    setupStateCombobox();

    // All-states ranking grid
    setupStateGrid();

    // Keyboard shortcut help: press `?` anywhere outside a text input.
    const shortcutDialog = document.getElementById('shortcutDialog');
    if (shortcutDialog && typeof shortcutDialog.showModal === 'function') {
      const isEditable = el => {
        if (!el) return false;
        const tag = el.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
      };
      // Stash the element that opened the dialog so focus can return to it on close.
      let dialogOpener = null;
      document.addEventListener('keydown', e => {
        if (e.key === '?' && !shortcutDialog.open && !isEditable(e.target)) {
          e.preventDefault();
          dialogOpener = document.activeElement;
          shortcutDialog.showModal();
        }
      });
      // Restores focus for Escape, the close button, and backdrop dismissal alike.
      shortcutDialog.addEventListener('close', () => {
        if (dialogOpener && typeof dialogOpener.focus === 'function') dialogOpener.focus();
        dialogOpener = null;
      });
      const closeBtn = document.getElementById('shortcutClose');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => shortcutDialog.close());
      }
      // Native <dialog> doesn't close on a backdrop click. The dialog has no padding, so a click
      // whose target is the dialog element itself landed on the backdrop.
      shortcutDialog.addEventListener('click', e => {
        if (e.target === shortcutDialog) shortcutDialog.close();
      });
    }

    // Sticky mobile summary: visible only while the chart is in viewport.
    if (dom.stickySummary && 'IntersectionObserver' in window) {
      const chartContainer = document.querySelector('.chart-container');
      if (chartContainer) {
        const obs = new IntersectionObserver(
          entries => {
            entries.forEach(entry => {
              dom.stickySummary.classList.toggle('visible', entry.isIntersecting);
            });
          },
          { threshold: 0.1 },
        );
        obs.observe(chartContainer);
      }
    }

    // Keyboard navigation: arrows step one week, Home/End jump to the first/latest point.
    dom.chartContainer.addEventListener('keydown', e => {
      if (!state.chartInstance || !state.chartData) return;
      const last = state.chartData.single_costs.length - 1;
      let next = state.activePointIndex;
      if (e.key === 'ArrowRight') next = Math.min(last, next + 1);
      else if (e.key === 'ArrowLeft') next = Math.max(0, next - 1);
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = last;
      else return;
      e.preventDefault();
      if (next === state.activePointIndex) return;
      state.activePointIndex = next;
      updateInfoCards(next, true);
      state.chartInstance.update('none');
    });

    // Theme toggle
    const themeToggle = document.getElementById('themeToggle');
    const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = theme => {
      document.documentElement.setAttribute('data-theme', theme);
      themeToggle.setAttribute('aria-pressed', String(theme === 'dark'));
      if (state.chartInstance) {
        const tokens = readChartTokens();
        state.chartColors = tokens;
        const chart = state.chartInstance;

        chart.options.scales.x.ticks.color = tokens.textColor;
        chart.options.scales.y.ticks.color = tokens.textColor;
        chart.options.scales.y.grid.color = tokens.gridColor;
        chart.options.scales.y.title.color = tokens.textColor;
        chart.options.plugins.legend.labels.color = tokens.textColor;
        chart.options.plugins.tooltip.backgroundColor = tokens.tooltipBg;
        chart.options.plugins.tooltip.titleColor = tokens.tooltipText;
        chart.options.plugins.tooltip.bodyColor = tokens.tooltipText;
        chart.options.plugins.tooltip.footerColor = tokens.tooltipText;

        const ds = chart.data.datasets;
        ds[0].borderColor = tokens.primary;
        ds[0].backgroundColor = `${tokens.primary}20`;
        ds[1].borderColor = tokens.secondary;
        ds[1].backgroundColor = `${tokens.secondary}20`;
        ds[2].borderColor = tokens.textColor;

        chart.update('none');
      }
    };
    // Reflect the bootstrap theme (stored choice / system preference) on the toggle's pressed state.
    themeToggle.setAttribute(
      'aria-pressed',
      String(document.documentElement.getAttribute('data-theme') === 'dark'),
    );
    themeToggle.addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      storeTheme(next);
    });
    // Follow OS light/dark switches until the visitor picks a theme explicitly.
    darkQuery.addEventListener('change', e => {
      if (!readStoredTheme()) applyTheme(e.matches ? 'dark' : 'light');
    });

    loadData(params.state);
  });
