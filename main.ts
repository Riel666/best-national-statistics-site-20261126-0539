// Atlas of Nations — a national statistics site (Node 22, standard library only).
//
// The site is generated, deterministically and with no network access, from the
// World Bank figures embedded in data/countries.json (40 countries, 12 indicators
// each, every figure carrying its year). This program renders the whole static
// site — home, rankings, country directory, one detail page per country, a
// compare tool and a methodology page — into /output/app, copies screenshots/
// beside it, and writes /output/dossier.json with the vendored make.fun library.
//
// The generated site is plain files under app/: relative links only, inline SVG
// charts, no external request of any kind, and it works with JavaScript off
// except for the search, sorting and compare picker.
//
// Serve the generated site locally with `node serve.ts` (after running this),
// then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-frontend.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const appOut = join(out, 'app');

interface IndicatorValue { value: number; year: number }
interface Country { code: string; name: string; region: string; values: Record<string, IndicatorValue> }
interface Metric {
  key: string; label: string; short: string; code: string; kind: 'int' | 'money' | 'usd' | 'years' | 'area' | 'tonnes' | 'pct' | 'rate' | 'per1000';
  higherIsBetter: boolean; blurb: string;
}

const DATA = JSON.parse(readFileSync(join(here, 'data', 'countries.json'), 'utf8')) as {
  source: string; countries: Country[];
};
const COUNTRIES = DATA.countries;
const STYLE = readFileSync(join(here, 'templates', 'style.css'), 'utf8');
const APPJS = readFileSync(join(here, 'templates', 'app.js'), 'utf8');

// The twelve indicators, in the order the site presents them. Codes are the
// World Bank World Development Indicators series; every figure on the site
// shows the year the Bank published it for.
const METRICS: Metric[] = [
  { key: 'population', label: 'Population', short: 'Population', code: 'SP.POP.TOTL', kind: 'int', higherIsBetter: true, blurb: 'People living in the country.' },
  { key: 'gdp', label: 'GDP (current US$)', short: 'GDP', code: 'NY.GDP.MKTP.CD', kind: 'money', higherIsBetter: true, blurb: 'Total value of goods and services produced.' },
  { key: 'gdpPerCapita', label: 'GDP per capita (US$)', short: 'GDP per capita', code: 'NY.GDP.PCAP.CD', kind: 'usd', higherIsBetter: true, blurb: 'GDP divided by population.' },
  { key: 'gdpPppPerCapita', label: 'GDP per capita, PPP (int\'l $)', short: 'GDP per capita (PPP)', code: 'NY.GDP.PCAP.PP.CD', kind: 'usd', higherIsBetter: true, blurb: 'GDP per capita adjusted for what money buys locally.' },
  { key: 'lifeExpectancy', label: 'Life expectancy at birth (years)', short: 'Life expectancy', code: 'SP.DYN.LE00.IN', kind: 'years', higherIsBetter: true, blurb: 'Years a newborn is expected to live.' },
  { key: 'landArea', label: 'Land area (sq km)', short: 'Land area', code: 'AG.LND.TOTL.K2', kind: 'area', higherIsBetter: true, blurb: 'Total land surface, excluding inland waters.' },
  { key: 'co2PerCapita', label: 'CO2 emissions per capita (tonnes)', short: 'CO2 per capita', code: 'EN.GHG.CO2.PC.CE.AR5', kind: 'tonnes', higherIsBetter: false, blurb: 'Carbon dioxide emissions per person, excluding land use.' },
  { key: 'pop65', label: 'Population aged 65+ (% of total)', short: 'Aged 65+', code: 'SP.POP.65UP.TO.ZS', kind: 'pct', higherIsBetter: true, blurb: 'Share of the population aged 65 and over.' },
  { key: 'internetUsers', label: 'Internet users (% of population)', short: 'Internet users', code: 'IT.NET.USER.ZS', kind: 'pct', higherIsBetter: true, blurb: 'People who used the internet in the last 3 months.' },
  { key: 'fertility', label: 'Fertility rate (births per woman)', short: 'Fertility rate', code: 'SP.DYN.TFRT.IN', kind: 'rate', higherIsBetter: false, blurb: 'Children a woman would have over her lifetime.' },
  { key: 'under5Mortality', label: 'Under-5 mortality (per 1,000 live births)', short: 'Under-5 mortality', code: 'SH.DYN.MORT', kind: 'per1000', higherIsBetter: false, blurb: 'Children dying before age five, per 1,000 births.' },
  { key: 'urban', label: 'Urban population (% of total)', short: 'Urban population', code: 'SP.URB.TOTL.IN.ZS', kind: 'pct', higherIsBetter: true, blurb: 'Share of people living in urban areas.' },
];

const byCode = new Map(COUNTRIES.map((c) => [c.code, c]));
const metric = (key: string): Metric => METRICS.find((m) => m.key === key) as Metric;
const val = (c: Country, key: string): IndicatorValue | undefined => c.values[key];

// ---------- formatting ----------
const commas = (n: number): string => Math.round(n).toLocaleString('en-US');
function fmt(n: number, kind: Metric['kind']): string {
  switch (kind) {
    case 'int': return commas(n);
    case 'money':
      if (n >= 1e12) return '$' + (n / 1e12).toFixed(2) + ' trillion';
      if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + ' billion';
      return '$' + (n / 1e6).toFixed(1) + ' million';
    case 'usd': return '$' + commas(n);
    case 'years': return n.toFixed(1) + ' years';
    case 'area': return commas(n) + ' km²';
    case 'tonnes': return n.toFixed(1) + ' t';
    case 'pct': return n.toFixed(1) + '%';
    case 'rate': return n.toFixed(2);
    case 'per1000': return n.toFixed(1) + ' per 1,000';
  }
}
const fmtMetric = (c: Country, key: string): string => {
  const v = val(c, key);
  return v ? fmt(v.value, metric(key).kind) : '—';
};
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const median = (xs: number[]): number => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
};
const rankOf = (c: Country, key: string): number => {
  const sorted = [...COUNTRIES].sort((a, b) => (val(b, key)?.value ?? -Infinity) - (val(a, key)?.value ?? -Infinity));
  return sorted.findIndex((x) => x.code === c.code) + 1;
};

// ---------- shared chrome ----------
const NAV = [
  ['index.html', 'Home'],
  ['rankings.html', 'Rankings'],
  ['countries.html', 'Countries'],
  ['compare.html', 'Compare'],
  ['methodology.html', 'Sources & methods'],
] as const;

function shell(opts: { title: string; current: string; body: string; scripts?: string; root: string }): string {
  const links = NAV.map(([href, label]) => {
    const h = opts.root + href;
    const cur = opts.current === href ? ' aria-current="page"' : '';
    return `<a href="${h}"${cur}>${label}</a>`;
  }).join('');
  return '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    + `<title>${esc(opts.title)} · Atlas of Nations</title>\n`
    + `<link rel="stylesheet" href="${opts.root}style.css">\n`
    + (opts.scripts ?? '')
    + '</head>\n<body>\n'
    + '<header class="site-head"><div class="site-head-inner">'
    + `<a class="brand" href="${opts.root}index.html">Atlas <em>of</em> Nations</a>`
    + '<span class="tagline">National statistics, plainly presented</span>'
    + `<nav class="main-nav" aria-label="Main">${links}</nav>`
    + '</div></header>\n'
    + `<main class="wrap">\n${opts.body}\n</main>\n`
    + '<footer class="wrap site-foot"><nav aria-label="Footer">'
    + `<a href="${opts.root}index.html">Home</a><a href="${opts.root}rankings.html">Rankings</a>`
    + `<a href="${opts.root}countries.html">Countries</a><a href="${opts.root}compare.html">Compare</a>`
    + `<a href="${opts.root}methodology.html">Sources &amp; methods</a></nav>`
    + '<p>Data: World Bank Open Data, World Development Indicators. Every figure shows the year it was published for; '
    + 'most figures are 2024. Figures are the latest available per country. This is a static site: no tracking, '
    + 'no accounts, no network requests — every page works offline.</p>'
    + '<p>Atlas of Nations is an independent reference. Country names follow the World Bank listing.</p></footer>\n'
    + '</body>\n</html>\n';
}

// ---------- inline SVG bar charts (drawn at build time, no JavaScript) ----------
function hbars(rows: { label: string; value: number; display: string; color: string }[], max: number, note: string): string {
  const rowH = 34;
  const height = 22 + rows.length * rowH;
  const bars = rows.map((r, i) => {
    const y = 26 + i * rowH;
    const w = Math.max(2, (r.value / max) * 480);
    return `<text x="0" y="${y + 14}" class="bar-label">${esc(r.label)}</text>`
      + `<rect x="150" y="${y}" width="${w.toFixed(1)}" height="20" rx="4" fill="${r.color}"/>`
      + `<text x="${(158 + w).toFixed(1)}" y="${y + 14}" class="bar-value">${esc(r.display)}</text>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 760 ${height}" role="img" aria-label="${esc(note)}">${bars}</svg>`
    + `<p class="chart-note">${esc(note)}</p>`;
}

const TEAL = '#0f766e';
const AMBER = '#d97706';
const BLUE = '#2563eb';

function topChart(key: string, n: number, color: string): string {
  const m = metric(key);
  const sorted = [...COUNTRIES].sort((a, b) => (val(b, key)?.value ?? 0) - (val(a, key)?.value ?? 0)).slice(0, n);
  const max = val(sorted[0], key)?.value ?? 1;
  return hbars(sorted.map((c) => ({
    label: c.name, value: val(c, key)?.value ?? 0, display: fmtMetric(c, key), color,
  })), max, `Top ${n} of the 40 countries by ${m.short.toLowerCase()} — latest year per country.`);
}

// ---------- pages ----------
function pageIndex(): string {
  const totalPop = COUNTRIES.reduce((s, c) => s + (val(c, 'population')?.value ?? 0), 0);
  const totalGdp = COUNTRIES.reduce((s, c) => s + (val(c, 'gdp')?.value ?? 0), 0);
  const medLife = median(COUNTRIES.map((c) => val(c, 'lifeExpectancy')?.value ?? 0));
  const medInternet = median(COUNTRIES.map((c) => val(c, 'internetUsers')?.value ?? 0));
  const featured = ['USA', 'CHN', 'IND', 'DEU', 'NGA', 'BRA', 'JPN', 'IDN'].map((code) => byCode.get(code) as Country);
  const tiles = featured.map((c) => `<a class="country-tile" href="country/${c.code}.html" data-search="${esc(c.name.toLowerCase())}" data-region="${esc(c.region)}">`
    + `<b>${esc(c.name)}</b><div class="region">${esc(c.region)} · #${rankOf(c, 'population')} by population</div>`
    + `<dl><dt>Population</dt><dd>${fmtMetric(c, 'population')}</dd>`
    + `<dt>GDP</dt><dd>${fmtMetric(c, 'gdp')}</dd>`
    + `<dt>Life expectancy</dt><dd>${fmtMetric(c, 'lifeExpectancy')}</dd>`
    + `<dt>GDP per capita</dt><dd>${fmtMetric(c, 'gdpPerCapita')}</dd></dl></a>`).join('');
  const body = `<section class="hero"><p class="eyebrow" style="color:#5eead4;margin-top:0">40 countries · 12 indicators · latest World Bank figures</p>`
    + `<h1>How do nations actually compare?</h1>`
    + `<p>Population, wealth, health, cities and climate — the numbers that describe a country, side by side, `
    + `with the source and year of every figure. Pick a country, rank them all, or put three head to head.</p>`
    + `<div class="hero-stats">`
    + `<div class="hero-stat"><b>${(totalPop / 1e9).toFixed(2)} billion</b><span>people in the 40 countries covered</span></div>`
    + `<div class="hero-stat"><b>${fmt(totalGdp, 'money')}</b><span>combined GDP of the 40 countries</span></div>`
    + `<div class="hero-stat"><b>${medLife.toFixed(1)} years</b><span>median life expectancy across the 40</span></div>`
    + `<div class="hero-stat"><b>${medInternet.toFixed(1)}%</b><span>median internet use across the 40</span></div>`
    + `</div></section>`
    + `<p class="eyebrow">Largest populations</p><h2>The biggest countries first</h2>`
    + `<div class="card">${topChart('population', 10, TEAL)}</div>`
    + `<p class="eyebrow">Largest economies</p><h2>Where the money is</h2>`
    + `<div class="card">${topChart('gdp', 10, AMBER)}</div>`
    + `<p class="eyebrow">Longest lives</p><h2>Health, at a glance</h2>`
    + `<div class="card">${topChart('lifeExpectancy', 10, BLUE)}</div>`
    + `<p class="eyebrow">Start exploring</p><h2>Featured countries</h2>`
    + `<div class="country-grid">${tiles}</div>`
    + `<p style="margin-top:16px"><a href="countries.html">Browse all 40 countries →</a> &nbsp;·&nbsp; `
    + `<a href="rankings.html">See every ranking →</a> &nbsp;·&nbsp; <a href="compare.html">Compare countries →</a></p>`
    + `<div class="callout"><strong>Every figure has a year.</strong> Statistics change, and a number without a year is a rumour. `
    + `On this site each figure is labelled with the year the World Bank published it for — mostly 2024. `
    + `See <a href="methodology.html">Sources &amp; methods</a> for the full indicator list.</div>`;
  return shell({ title: 'National statistics for 40 countries', current: 'index.html', body, root: '' });
}

const RANK_TABS: { key: string; label: string; note: string }[] = [
  { key: 'population', label: 'Population', note: 'Most people first.' },
  { key: 'gdp', label: 'GDP', note: 'Largest economies first.' },
  { key: 'gdpPerCapita', label: 'GDP per capita', note: 'Richest per person first.' },
  { key: 'lifeExpectancy', label: 'Life expectancy', note: 'Longest lives first.' },
  { key: 'internetUsers', label: 'Internet users', note: 'Most connected first.' },
  { key: 'under5Mortality', label: 'Under-5 mortality', note: 'Lowest first — click the column to reverse.' },
];

function rankingTable(key: string, first: boolean): string {
  const m = metric(key);
  const asc = key === 'under5Mortality';
  const sorted = [...COUNTRIES].sort((a, b) => {
    const d = (val(a, key)?.value ?? 0) - (val(b, key)?.value ?? 0);
    return asc ? d : -d;
  });
  const rows = sorted.map((c, i) => {
    const v = val(c, key) as IndicatorValue;
    return `<tr><td class="rank">${i + 1}</td>`
      + `<td><a href="country/${c.code}.html">${esc(c.name)}</a></td>`
      + `<td class="num" data-value="${v.value}">${fmt(v.value, m.kind)}</td>`
      + `<td class="num">${v.year}</td>`
      + `<td class="num">${fmtMetric(c, 'population')}</td>`
      + `<td class="num">${fmtMetric(c, 'gdpPerCapita')}</td></tr>`;
  }).join('');
  return `<div class="metric-table table-scroll" id="table-${key}"${first ? '' : ' hidden'}>`
    + `<table class="data sortable"><caption>${esc(m.label)} — all 40 countries</caption>`
    + `<thead><tr><th scope="col">#</th>`
    + `<th scope="col"><button class="sort" data-type="text">Country ↕</button></th>`
    + `<th scope="col" class="num"><button class="sort" data-type="number">${esc(m.short)} ↕</button></th>`
    + `<th scope="col" class="num">Year</th><th scope="col" class="num">Population</th>`
    + `<th scope="col" class="num">GDP per capita</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function pageRankings(): string {
  const tabs = RANK_TABS.map((t, i) => `<button data-table="${t.key}" aria-pressed="${i === 0 ? 'true' : 'false'}">${t.label}</button>`).join('');
  const tables = RANK_TABS.map((t, i) => rankingTable(t.key, i === 0)).join('');
  const body = `<p class="eyebrow">Rankings</p><h1>Every country, ranked</h1>`
    + `<p class="lede">Forty countries on six headline measures. Pick a measure below; click any column header to re-sort the table. `
    + `Each row links to that country's full profile.</p>`
    + `<div class="tabs" role="group" aria-label="Choose a measure">${tabs}</div>${tables}`
    + `<p class="small" style="margin-top:14px">Figures are the latest available per country from the World Bank (mostly 2024). `
    + `Under-5 mortality is shown lowest first, since lower is better there.</p>`;
  return shell({ title: 'Rankings', current: 'rankings.html', body, root: '', scripts: '<script src="app.js" defer></script>' });
}

function pageCountries(): string {
  const regions = [...new Set(COUNTRIES.map((c) => c.region))].sort();
  const tiles = [...COUNTRIES].sort((a, b) => a.name.localeCompare(b.name)).map((c) =>
    `<a class="country-tile" href="country/${c.code}.html" data-search="${esc((c.name + ' ' + c.code).toLowerCase())}" data-region="${esc(c.region)}">`
    + `<b>${esc(c.name)}</b><div class="region">${esc(c.region)} · #${rankOf(c, 'population')} by population</div>`
    + `<dl><dt>Population</dt><dd>${fmtMetric(c, 'population')}</dd>`
    + `<dt>GDP</dt><dd>${fmtMetric(c, 'gdp')}</dd>`
    + `<dt>Life expectancy</dt><dd>${fmtMetric(c, 'lifeExpectancy')}</dd>`
    + `<dt>Internet users</dt><dd>${fmtMetric(c, 'internetUsers')}</dd></dl></a>`).join('');
  const body = `<p class="eyebrow">Countries</p><h1>All 40 countries</h1>`
    + `<p class="lede">From the largest (India, 1.45 billion people) to the smallest in this set (New Zealand, 5.3 million). `
    + `Search by name, or filter by region.</p>`
    + `<div class="search-row"><label for="country-search">Search</label>`
    + `<input type="search" id="country-search" placeholder="Type a country name…" autocomplete="off">`
    + `<label for="region-filter">Region</label><select id="region-filter"><option value="">All regions</option>`
    + regions.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('') + `</select>`
    + `<span class="small" id="country-count">40 of 40 countries shown</span></div>`
    + `<div class="country-grid">${tiles}</div>`;
  return shell({ title: 'All countries', current: 'countries.html', body, root: '', scripts: '<script src="app.js" defer></script>' });
}

function pageCountry(c: Country): string {
  const compareKeys = ['lifeExpectancy', 'gdpPppPerCapita', 'internetUsers', 'urban', 'under5Mortality'];
  const maxes = new Map(compareKeys.map((k) => [k, Math.max(...COUNTRIES.map((x) => val(x, k)?.value ?? 0))]));
  const bars = compareKeys.map((k) => {
    const m = metric(k);
    const v = val(c, k);
    const med = median(COUNTRIES.map((x) => val(x, k)?.value ?? 0));
    const better = m.higherIsBetter ? (v?.value ?? 0) >= med : (v?.value ?? 0) <= med;
    return `<div class="stat-card card"><div class="num" style="color:${better ? 'var(--teal-deep)' : 'var(--ink)'}">${v ? fmt(v.value, m.kind) : '—'}</div>`
      + `<div class="label">${esc(m.short)}</div>`
      + `<div class="src">40-country median: ${fmt(med, m.kind)} · ${v?.year ?? ''}</div>`
      + `<div class="bar"><i style="width:${v ? Math.min(100, (v.value / (maxes.get(k) as number)) * 100).toFixed(1) : 0}%"></i></div></div>`;
  }).join('');
  const rows = METRICS.map((m) => {
    const v = val(c, m.key);
    return `<tr><td>${esc(m.label)}</td><td class="num hl" data-value="${v?.value ?? ''}">${v ? fmt(v.value, m.kind) : '—'}</td>`
      + `<td class="num">${v?.year ?? '—'}</td><td class="num">#${rankOf(c, m.key)} of 40</td></tr>`;
  }).join('');
  const others = [...COUNTRIES].filter((x) => x.code !== c.code)
    .sort((a, b) => Math.abs((val(a, 'gdpPerCapita')?.value ?? 0) - (val(c, 'gdpPerCapita')?.value ?? 0))
      - Math.abs((val(b, 'gdpPerCapita')?.value ?? 0) - (val(c, 'gdpPerCapita')?.value ?? 0)))
    .slice(0, 3);
  const body = `<p class="eyebrow">${esc(c.region)}</p><h1>${esc(c.name)}</h1>`
    + `<p class="lede">National statistics for ${esc(c.name)} — population ${fmtMetric(c, 'population')} `
    + `(#${rankOf(c, 'population')} of the 40 countries here), GDP ${fmtMetric(c, 'gdp')} `
    + `(#${rankOf(c, 'gdp')}), life expectancy ${fmtMetric(c, 'lifeExpectancy')}. Every figure below is the latest `
    + `the World Bank published for ${esc(c.name)}, with its year.</p>`
    + `<div class="grid grid-3" style="grid-template-columns:repeat(3,1fr)">${bars}</div>`
    + `<h2>All indicators</h2>`
    + `<div class="table-scroll"><table class="data"><caption>World Bank World Development Indicators — ${esc(c.name)}</caption>`
    + `<thead><tr><th scope="col">Indicator</th><th scope="col" class="num">Value</th><th scope="col" class="num">Year</th>`
    + `<th scope="col" class="num">Rank of 40</th></tr></thead><tbody>${rows}</tbody></table></div>`
    + `<h2>Compare with similar economies</h2>`
    + `<p>Countries closest to ${esc(c.name)} by GDP per capita. <a href="../compare.html?a=${c.code}&amp;b=${others[0].code}&amp;c=${others[1].code}">`
    + `Compare ${esc(c.name)} with ${esc(others[0].name)} and ${esc(others[1].name)} →</a></p>`
    + `<div class="country-grid">${others.map((o) => `<a class="country-tile" href="${o.code}.html"><b>${esc(o.name)}</b>`
      + `<div class="region">${esc(o.region)}</div><dl><dt>Population</dt><dd>${fmtMetric(o, 'population')}</dd>`
      + `<dt>GDP per capita</dt><dd>${fmtMetric(o, 'gdpPerCapita')}</dd>`
      + `<dt>Life expectancy</dt><dd>${fmtMetric(o, 'lifeExpectancy')}</dd></dl></a>`).join('')}</div>`
    + `<p style="margin-top:18px"><a href="../countries.html">← All countries</a> &nbsp;·&nbsp; <a href="../rankings.html">Rankings →</a></p>`;
  return shell({ title: c.name, current: 'countries.html', body, root: '../' });
}

function pageCompare(): string {
  const options = (selected: string) => COUNTRIES.map((c) =>
    `<option value="${c.code}"${c.code === selected ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
  const defaults = ['USA', 'CHN', 'IND'];
  const body = `<p class="eyebrow">Compare</p><h1>Put countries head to head</h1>`
    + `<p class="lede">Pick up to three countries. Every indicator is shown side by side, the best value in each row highlighted, `
    + `with the year of each figure. Share the result: the picks live in the page address, so a link keeps them.</p>`
    + `<form id="compare-form" action="compare.html" method="get"><div class="compare-picks">`
    + ['a', 'b', 'c'].map((letter, i) => `<div><label for="pick-${letter}">Country ${i + 1}</label>`
      + `<select id="pick-${letter}" name="${letter}">${options(defaults[i])}</select></div>`).join('')
    + `</div><p><button type="submit" class="tabs" style="border:0;padding:0"><span style="display:inline-block;font:inherit;font-weight:700;padding:10px 18px;border-radius:999px;background:var(--ink);color:#fff;cursor:pointer">Compare</span></button></p></form>`
    + `<div id="compare-chart"></div>`
    + `<div class="table-scroll"><table class="data"><caption>Side-by-side indicators</caption>`
    + `<thead><tr id="compare-head"><th scope="col">Indicator</th></tr></thead><tbody id="compare-body"></tbody></table></div>`
    + `<p class="small" id="compare-note">Choose countries above — the table fills in here.</p>`
    + `<p class="small">Try it: <a href="compare.html?a=JPN&amp;b=KOR&amp;c=DEU">Japan vs South Korea vs Germany</a> · `
    + `<a href="compare.html?a=NGA&amp;b=ETH&amp;c=KEN">Nigeria vs Ethiopia vs Kenya</a> · `
    + `<a href="compare.html?a=NOR&amp;b=CHE&amp;c=SWE">Norway vs Switzerland vs Sweden</a></p>`;
  return shell({
    title: 'Compare countries', current: 'compare.html', body, root: '',
    scripts: '<script src="data.js"></script>\n<script src="app.js" defer></script>',
  });
}

function pageMethodology(): string {
  const rows = METRICS.map((m) => `<tr><td>${esc(m.label)}</td><td>${esc(m.code)}</td><td>${esc(m.blurb)}</td></tr>`).join('');
  const body = `<p class="eyebrow">Sources &amp; methods</p><h1>Where every number comes from</h1>`
    + `<p class="lede">All figures on this site come from one source: the World Bank's World Development Indicators, `
    + `fetched from the World Bank Open Data API and frozen into this site so the pages never need the network. `
    + `Nothing here is estimated, modelled or filled in — if the Bank has no value, the site shows a dash.</p>`
    + `<h2>The indicators</h2>`
    + `<div class="table-scroll"><table class="data"><caption>World Development Indicators used</caption>`
    + `<thead><tr><th scope="col">Indicator</th><th scope="col">Series code</th><th scope="col">What it measures</th></tr></thead>`
    + `<tbody>${rows}</tbody></table></div>`
    + `<h2>How figures were chosen</h2><ul class="tight">`
    + `<li><strong>Latest available wins.</strong> For each country and indicator, the most recent published year is used (mostly 2024; Myanmar's internet-users figure is 2020, the latest the Bank holds).</li>`
    + `<li><strong>Years travel with figures.</strong> Every value on the site is shown with its year, so a 2020 figure is never mistaken for a 2024 one.</li>`
    + `<li><strong>Ranks are among these 40.</strong> A rank of “#3 of 40” means third among the 40 countries this site covers — not third in the world.</li>`
    + `<li><strong>Medians are medians of the 40.</strong> Country pages compare each figure with the median of the 40 countries here.</li>`
    + `<li><strong>Names follow the World Bank.</strong> Country names and regions are the Bank's listing (for example, Türkiye).</li></ul>`
    + `<h2>Coverage</h2>`
    + `<p>The 40 countries cover every inhabited continent and about three quarters of humanity: the ten most populous `
    + `countries plus a spread of large, mid-size and smaller economies across Africa, Asia, Europe, North and South America and Oceania.</p>`
    + `<h2>What this site does not do</h2>`
    + `<p>It does not forecast, it does not rank countries into a single score (any single score would hide more than it shows), `
    + `and it does not track you: there are no accounts, no cookies and no third-party requests. The pages are static files.</p>`;
  return shell({ title: 'Sources & methods', current: 'methodology.html', body, root: '' });
}

function dataJs(): string {
  const slim = {
    source: 'World Bank Open Data, World Development Indicators',
    metrics: METRICS.map((m) => ({ key: m.key, label: m.label, short: m.short, kind: m.kind, higherIsBetter: m.higherIsBetter })),
    countries: COUNTRIES.map((c) => ({ code: c.code, name: c.name, region: c.region, values: c.values })),
  };
  return 'window.ATLAS_DATA = ' + JSON.stringify(slim) + ';\n';
}

// ---------- build ----------
rmSync(out, { recursive: true, force: true });
mkdirSync(appOut, { recursive: true });
mkdirSync(join(appOut, 'country'), { recursive: true });

const pages: [string, string][] = [
  ['index.html', pageIndex()],
  ['rankings.html', pageRankings()],
  ['countries.html', pageCountries()],
  ['compare.html', pageCompare()],
  ['methodology.html', pageMethodology()],
  ...COUNTRIES.map((c): [string, string] => [`country/${c.code}.html`, pageCountry(c)]),
];
for (const [name, html] of pages) writeFileSync(join(appOut, name), html);
writeFileSync(join(appOut, 'style.css'), STYLE);
writeFileSync(join(appOut, 'app.js'), APPJS);
writeFileSync(join(appOut, 'data.js'), dataJs());

mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the bytes; the others refuse an entry the
// scorer would refuse (more than 4 screenshots or one over 256 KiB; more than 993 files and directories in app/ or
// 16 MiB of app files: app/ counts beside /output's own 1000-entry cap, its screenshots/ and dossier.json).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: 163840, screenshots: { max: 4, max_bytes: 262144 }, app_max_files: 993, app_max_bytes: 16777216 }),
);

console.log(`Atlas of Nations: ${pages.length} pages + style.css + app.js + data.js written to ${appOut} (dossier.json included)`);
