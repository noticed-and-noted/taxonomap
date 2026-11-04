/** Chart sums from the charts cube, and the bar lists that show them (cube or GBIF facets alike). */

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const BAR_ORDERS = {
  count: ([, left], [, right]) => right - left,
  newestFirst: ([left], [right]) => String(right).localeCompare(String(left), 'en', { numeric: true }),
  calendar: ([left], [right]) => Number(left) - Number(right),
};

const formatCount = (count) => Math.round(count).toLocaleString('en-GB');

/** Sentence case for GBIF's upper-case enum values. */
export const sentenceCase = (value) => value[0] + value.slice(1).toLowerCase().replaceAll('_', ' ');

/** As GBIF does, records without a year drop out once a year range is set. */
export function inYears(year, { yearFrom, yearTo }) {
  if (yearFrom === null && yearTo === null) return true;
  if (year === null || year === undefined) return false;
  return (yearFrom === null || year >= yearFrom) && (yearTo === null || year <= yearTo);
}

/** Records summed by a key of each row. */
export function sumBy(rows, keyOf) {
  const sums = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    sums.set(key, (sums.get(key) ?? 0) + Number(row.records));
  }
  return sums;
}

/** Chart sums from charts-cube rows. Each chart applies every filter but its own, so its bars stay comparable. */
export function summariseCharts(chartRows, filters) {
  const dated = chartRows.filter((row) => inYears(row.year, filters));
  const monthMatches = (row) => !filters.months.length || filters.months.includes(row.month);
  const basisMatches = (row) => !filters.basis || row.basisofrecord === filters.basis;
  return {
    years: sumBy(
      chartRows.filter((row) => monthMatches(row) && basisMatches(row)),
      (row) => row.year ?? 'No year',
    ),
    months: sumBy(dated.filter(basisMatches), (row) => row.month ?? 'No month'),
    basis: sumBy(dated.filter(monthMatches), (row) => row.basisofrecord),
  };
}

function element(tag, text = '', className = '') {
  const created = document.createElement(tag);
  created.textContent = text;
  if (className) created.className = className;
  return created;
}

function drawBars(container, sums, { labelFor = String, order = 'count' } = {}) {
  const entries = [...sums].sort(BAR_ORDERS[order]);
  const highest = Math.max(1, ...entries.map(([, records]) => records));
  if (!entries.length) {
    container.replaceChildren(element('p', 'No records.', 'note'));
    return;
  }
  container.replaceChildren(
    ...entries.map(([key, records]) => {
      const bar = element('div', '', 'bar');
      bar.style.width = `${(records / highest) * 100}%`;
      const track = element('div');
      track.append(bar);
      const row = element('div', '', 'bar-row');
      row.append(element('span', labelFor(key)), track, element('span', formatCount(records), 'bar-value'));
      return row;
    }),
  );
}

/**
 * Draw the year, month and record-type bars.
 * @param {{ years: Map, months: Map, basis: Map }} charts
 */
export function drawCharts(charts) {
  drawBars(document.querySelector('#year-bars'), charts.years, { order: 'newestFirst' });
  drawBars(document.querySelector('#month-bars'), charts.months, {
    labelFor: (month) => MONTH_NAMES[month - 1] ?? month,
    order: 'calendar',
  });
  drawBars(document.querySelector('#basis-bars'), charts.basis, {
    labelFor: (basis) => (basis ? sentenceCase(basis) : 'Unknown'),
  });
}
