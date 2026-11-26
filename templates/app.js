// Atlas of Nations — client behaviour.
// One file, one job: the small interactions of the generated static site.
// No imports, no network: every page it runs on already carries its data in
// the markup (or, on the compare page, in the data.js script loaded before it).

(function () {
  'use strict';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /* Format a raw indicator value the way the site prints it (mirrors main.ts). */
  function formatValue(kind, n) {
    var commas = function (x) { return Math.round(x).toLocaleString('en-US'); };
    if (kind === 'int') return commas(n);
    if (kind === 'money') {
      if (n >= 1e12) return '$' + (n / 1e12).toFixed(2) + ' trillion';
      if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + ' billion';
      return '$' + (n / 1e6).toFixed(1) + ' million';
    }
    if (kind === 'usd') return '$' + commas(n);
    if (kind === 'years') return n.toFixed(1) + ' years';
    if (kind === 'area') return commas(n) + ' km²';
    if (kind === 'tonnes') return n.toFixed(1) + ' t';
    if (kind === 'pct') return n.toFixed(1) + '%';
    if (kind === 'rate') return n.toFixed(2);
    if (kind === 'per1000') return n.toFixed(1) + ' per 1,000';
    return String(n);
  }

  /* ---- live search on the country directory ---- */
  var search = $('#country-search');
  if (search) {
    var tiles = $all('.country-tile');
    var count = $('#country-count');
    search.addEventListener('input', function () {
      var q = search.value.trim().toLowerCase();
      var shown = 0;
      tiles.forEach(function (tile) {
        var hit = !q || tile.getAttribute('data-search').indexOf(q) !== -1;
        tile.style.display = hit ? '' : 'none';
        if (hit) shown += 1;
      });
      if (count) count.textContent = shown + ' of ' + tiles.length + ' countries shown';
    });
    var region = $('#region-filter');
    if (region) {
      region.addEventListener('change', function () {
        var want = region.value;
        var shown = 0;
        tiles.forEach(function (tile) {
          var hit = !want || tile.getAttribute('data-region') === want;
          var q = search.value.trim().toLowerCase();
          if (q && tile.getAttribute('data-search').indexOf(q) === -1) hit = false;
          tile.style.display = hit ? '' : 'none';
          if (hit) shown += 1;
        });
        if (count) count.textContent = shown + ' of ' + tiles.length + ' countries shown';
      });
    }
  }

  /* ---- sortable ranking tables: click a column header to re-sort ---- */
  $all('table.data.sortable').forEach(function (table) {
    var buttons = $all('th button.sort', table);
    buttons.forEach(function (button) {
      button.addEventListener('click', function () {
        var th = button.parentElement;
        var index = Array.prototype.indexOf.call(th.parentElement.children, th);
        var body = table.tBodies[0];
        var rows = $all('tr', body);
        var ascending = th.getAttribute('data-dir') !== 'asc';
        $all('th', table).forEach(function (other) { other.removeAttribute('data-dir'); });
        th.setAttribute('data-dir', ascending ? 'asc' : 'desc');
        var numeric = button.getAttribute('data-type') === 'number';
        rows.sort(function (a, b) {
          var av = a.children[index].getAttribute('data-value') || a.children[index].textContent;
          var bv = b.children[index].getAttribute('data-value') || b.children[index].textContent;
          if (numeric) return ascending ? Number(av) - Number(bv) : Number(bv) - Number(av);
          return ascending ? av.localeCompare(bv) : bv.localeCompare(av);
        });
        rows.forEach(function (row, i) {
          body.appendChild(row);
          var rankCell = row.querySelector('td.rank');
          if (rankCell) rankCell.textContent = i + 1;
        });
      });
    });
  });

  /* ---- metric tabs on the rankings page: one table visible at a time ---- */
  var tabButtons = $all('.tabs button[data-table]');
  if (tabButtons.length) {
    tabButtons.forEach(function (button) {
      button.addEventListener('click', function () {
        tabButtons.forEach(function (other) { other.setAttribute('aria-pressed', 'false'); });
        button.setAttribute('aria-pressed', 'true');
        $all('.metric-table').forEach(function (wrap) {
          wrap.hidden = wrap.id !== 'table-' + button.getAttribute('data-table');
        });
      });
    });
  }

  /* ---- compare page: pick up to three countries, table + bars rebuild ---- */
  var compareForm = $('#compare-form');
  if (compareForm && window.ATLAS_DATA) {
    var data = window.ATLAS_DATA;
    var byCode = {};
    data.countries.forEach(function (c) { byCode[c.code] = c; });
    var selects = $all('select', compareForm);
    function readPicks() {
      var params = new URLSearchParams(window.location.search);
      return selects.map(function (sel, i) {
        var fromUrl = params.get(['a', 'b', 'c'][i]);
        return fromUrl && byCode[fromUrl] ? fromUrl : sel.value;
      });
    }
    function render() {
      var picks = readPicks();
      selects.forEach(function (sel, i) { sel.value = picks[i]; });
      var chosen = picks.map(function (code) { return byCode[code]; }).filter(Boolean);
      var body = $('#compare-body');
      var head = $('#compare-head');
      if (!body || !head || chosen.length === 0) return;
      head.innerHTML = '<th scope="col">Indicator</th>' + chosen.map(function (c) {
        return '<th scope="col"><a href="country/' + c.code + '.html">' + c.name + '</a></th>';
      }).join('');
      var rows = data.metrics.map(function (m) {
        var cells = chosen.map(function (c) {
          var v = c.values[m.key];
          if (!v) return '<td class="num">—</td>';
          var best = m.higherIsBetter
            ? Math.max.apply(null, chosen.map(function (x) { return x.values[m.key] ? x.values[m.key].value : -Infinity; }))
            : Math.min.apply(null, chosen.map(function (x) { return x.values[m.key] ? x.values[m.key].value : Infinity; }));
          var cls = v.value === best && chosen.length > 1 ? ' class="num winner"' : ' class="num"';
          return '<td' + cls + ' data-value="' + v.value + '">' + formatValue(m.kind, v.value) + ' <span class="small">(' + v.year + ')</span></td>';
        }).join('');
        return '<tr><th scope="row">' + m.label + '</th>' + cells + '</tr>';
      }).join('');
      body.innerHTML = rows;
      var note = $('#compare-note');
      if (note) note.textContent = 'Best value in each row is highlighted. Figures as reported; years in brackets.';
      var chart = $('#compare-chart');
      if (chart) {
        var metric = data.metrics[0];
        var max = Math.max.apply(null, chosen.map(function (c) { return c.values[metric.key].value; }));
        var bars = chosen.map(function (c, i) {
          var v = c.values[metric.key].value;
          var w = Math.max(2, (v / max) * 470);
          var y = 24 + i * 44;
          var colors = ['#0f766e', '#d97706', '#2563eb'];
          return '<text x="0" y="' + (y + 15) + '" class="bar-label">' + c.name + '</text>'
            + '<rect x="150" y="' + y + '" width="' + w.toFixed(1) + '" height="26" rx="4" fill="' + colors[i % 3] + '"/>'
            + '<text x="' + (158 + w) + '" y="' + (y + 17) + '" class="bar-value">' + formatValue(metric.kind, v) + '</text>';
        }).join('');
        chart.innerHTML = '<svg class="chart" viewBox="0 0 760 ' + (24 + chosen.length * 44 + 8) + '" role="img" aria-label="Population comparison chart">'
          + '<text x="0" y="14" class="axis">' + metric.label + ' — latest year</text>' + bars + '</svg>';
      }
    }
    selects.forEach(function (sel, i) {
      sel.addEventListener('change', function () {
        var params = new URLSearchParams(window.location.search);
        params.set(['a', 'b', 'c'][i], sel.value);
        window.history.replaceState(null, '', window.location.pathname + '?' + params.toString());
        render();
      });
    });
    render();
  }
})();
