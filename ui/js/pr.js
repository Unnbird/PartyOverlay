/**
 * 隊伍 PR 總覽
 *
 * Party roster comes from PartyOverlayPlugin (onPartyOverlayUpdate, which is fed by
 * InfoProxyCrossRealm so cross-world members show up too). PR values come from the
 * TC ranking project:
 *
 *   encounter list : https://ranking.init.engineer/data/encounters.json
 *   per character  : <repo>/data/users/<character name>.json
 *
 * The per-character files are NOT on ranking.init.engineer - the site pulls them from
 * its GitHub repo (raw.githubusercontent, with jsdelivr as fallback). Both send
 * `access-control-allow-origin: *`, so the overlay can fetch them directly.
 *
 * "PR" here is best_entry.performance.score_percentile (its complement is top_percent).
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------- constants

  var ENCOUNTERS_URL = 'https://ranking.init.engineer/data/encounters.json';
  var USER_BASES = [
    'https://raw.githubusercontent.com/Kantai235/Final-Fantasy-XIV-Ranking-for-TC-Users/refs/heads/main/',
    'https://cdn.jsdelivr.net/gh/Kantai235/Final-Fantasy-XIV-Ranking-for-TC-Users@main/'
  ];

  var CACHE_PREFIX = 'partyoverlay.pr.';
  var ENCOUNTER_TTL_MS = 24 * 60 * 60 * 1000;
  var USER_TTL_MS = 30 * 60 * 1000;
  var HANDSHAKE_TIMEOUT_MS = 15000;

  // Short column labels. 21 duties don't fit as full names; the full name lives in
  // the header title and in every tooltip.
  var SHORT_LABELS = {
    savage_m1s: 'M1', savage_m2s: 'M2', savage_m3s: 'M3', savage_m4s: 'M4',
    savage_m5s: 'M5', savage_m6s: 'M6', savage_m7s: 'M7', savage_m8s: 'M8',
    extreme_valigarmanda: '豔翼', extreme_zoraal_ja: '佐拉', extreme_queen_eternal: '永恆',
    extreme_zelenia: '澤蓮', unreal_byakko: '白虎', unreal_suzaku: '朱雀',
    chaotic_cloud_of_darkness: '暗雲', ultimate_bahamut: '巴哈', ultimate_ultima_weapon: '究極',
    ultimate_alexander: '亞歷', ultimate_dragonsong: '龍詩', ultimate_omega: '歐米',
    ultimate_futures_rewritten: '伊甸'
  };

  // Job english name -> abbreviation, for the "which job scored this" hint.
  var JOB_ABBR = {
    Paladin: 'PLD', Warrior: 'WAR', DarkKnight: 'DRK', Gunbreaker: 'GNB',
    WhiteMage: 'WHM', Scholar: 'SCH', Astrologian: 'AST', Sage: 'SGE',
    Monk: 'MNK', Dragoon: 'DRG', Ninja: 'NIN', Samurai: 'SAM', Reaper: 'RPR', Viper: 'VPR',
    Bard: 'BRD', Machinist: 'MCH', Dancer: 'DNC',
    BlackMage: 'BLM', Summoner: 'SMN', RedMage: 'RDM', Pictomancer: 'PCT', BlueMage: 'BLU'
  };

  /**
   * PR tiers, highest first. `parse` is the FFLogs convention; `ord` is the
   * validated single-hue ramp (see pr.css for what was measured).
   * `ink` is chosen per fill so the numeral always clears contrast - the numeral
   * is the primary encoding, colour is the redundant channel.
   */
  var TIERS = [
    { min: 100, label: '100', parse: '#e5cc80', ord: '#cde2fb', parseInk: '#0b0b0b', ordInk: '#0b0b0b', star: true },
    { min: 99,  label: '99',  parse: '#e268a8', ord: '#cde2fb', parseInk: '#0b0b0b', ordInk: '#0b0b0b' },
    { min: 95,  label: '95',  parse: '#ff8000', ord: '#9ec5f4', parseInk: '#0b0b0b', ordInk: '#0b0b0b' },
    { min: 75,  label: '75',  parse: '#a335ee', ord: '#6da7ec', parseInk: '#ffffff', ordInk: '#0b0b0b' },
    { min: 50,  label: '50',  parse: '#0070ff', ord: '#3987e5', parseInk: '#ffffff', ordInk: '#ffffff' },
    { min: 25,  label: '25',  parse: '#1eff00', ord: '#256abf', parseInk: '#0b0b0b', ordInk: '#ffffff' },
    { min: 0,   label: '<25', parse: '#666666', ord: '#184f95', parseInk: '#ffffff', ordInk: '#ffffff' }
  ];

  // ---------------------------------------------------------------- elements

  var el = {
    root: document.getElementById('app'),
    statusDot: document.getElementById('statusDot'),
    partyCount: document.getElementById('partyCount'),
    categoryChips: document.getElementById('categoryChips'),
    scaleChips: document.getElementById('scaleChips'),
    refreshBtn: document.getElementById('refreshBtn'),
    matrixScroll: document.getElementById('matrixScroll'),
    matrixHead: document.getElementById('matrixHead'),
    matrixBody: document.getElementById('matrixBody'),
    emptyState: document.getElementById('emptyState'),
    emptyText: document.getElementById('emptyText'),
    emptySub: document.getElementById('emptySub'),
    legend: document.getElementById('legend'),
    meta: document.getElementById('meta'),
    tooltip: document.getElementById('tooltip')
  };

  // ---------------------------------------------------------------- state

  var state = {
    connected: false,
    preview: false,
    scale: 'parse',
    category: '*',
    encounters: [],
    members: [],          // [{ name, world, jobName, jobRole, groupIndex }]
    prByName: {},         // name -> { status, servers, encounters: { key: {...} }, updated }
    dataUpdatedAt: null,
    loading: false
  };

  // ---------------------------------------------------------------- utilities

  function esc(value) {
    if (value === undefined || value === null) return '';
    return String(value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c];
    });
  }

  function tierFor(pr) {
    for (var i = 0; i < TIERS.length; i++) {
      if (pr >= TIERS[i].min) return TIERS[i];
    }
    return TIERS[TIERS.length - 1];
  }

  function tierFill(tier) { return state.scale === 'parse' ? tier.parse : tier.ord; }
  function tierInk(tier) { return state.scale === 'parse' ? tier.parseInk : tier.ordInk; }

  function formatDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function formatNumber(value, digits) {
    if (typeof value !== 'number' || isNaN(value)) return '—';
    return value.toLocaleString('zh-TW', { minimumFractionDigits: digits || 0, maximumFractionDigits: digits || 0 });
  }

  // ---------------------------------------------------------------- caching

  function cacheGet(key, ttl) {
    try {
      var raw = localStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.t !== 'number') return null;
      if (Date.now() - parsed.t > ttl) return null;
      return parsed.v;
    } catch (e) {
      return null;
    }
  }

  function cacheSet(key, value) {
    try {
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ t: Date.now(), v: value }));
    } catch (e) {
      // Quota or private mode - caching is an optimisation, not a requirement.
    }
  }

  function cacheClear() {
    try {
      var doomed = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(CACHE_PREFIX) === 0) doomed.push(k);
      }
      doomed.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------- fetching

  function fetchJson(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) {
        var err = new Error('HTTP ' + r.status);
        err.status = r.status;
        throw err;
      }
      return r.json();
    });
  }

  /** Tries each base in order; a 404 on the first base is authoritative (no data). */
  function fetchUserFile(name) {
    var path = 'data/users/' + encodeURIComponent(name) + '.json';

    return fetchJson(USER_BASES[0] + path).catch(function (err) {
      if (err && err.status === 404) throw err;
      return fetchJson(USER_BASES[1] + path);
    });
  }

  function loadEncounters() {
    var cached = cacheGet('encounters', ENCOUNTER_TTL_MS);
    if (cached) {
      state.encounters = cached;
      return Promise.resolve(cached);
    }

    return fetchJson(ENCOUNTERS_URL).then(function (list) {
      var encounters = (list || [])
        .filter(function (e) { return e && e.enabled !== false; })
        .map(function (e) {
          return {
            key: e.key,
            name: e.name || e.key,
            category: e.category || '其他',
            short: SHORT_LABELS[e.key] || (e.name || e.key).slice(-2)
          };
        });
      state.encounters = encounters;
      cacheSet('encounters', encounters);
      return encounters;
    });
  }

  /** Distils a user file down to what the matrix needs, so the cache stays small. */
  function distil(file) {
    var out = { status: 'ok', servers: file.servers || [], encounters: {}, updated: file.generated_at_iso || null };

    (file.encounters || []).forEach(function (entry) {
      var best = entry.best_entry;
      if (!best) return;
      var perf = best.performance || {};
      if (typeof perf.score_percentile !== 'number') return;

      out.encounters[entry.encounter_key] = {
        pr: perf.score_percentile,
        topPercent: perf.top_percent,
        rank: perf.rank,
        sampleCount: perf.sample_count,
        qualified: perf.qualified !== false,
        job: best.job,
        rdps: best.rdps,
        clearSeconds: best.clear_time_seconds,
        recordedAt: best.recorded_at_iso,
        patch: best.game_version,
        reportCode: best.report_code,
        jobCount: (entry.best_by_job || []).length
      };
    });

    return out;
  }

  function loadMember(name) {
    var cached = cacheGet('user.' + name, USER_TTL_MS);
    if (cached) {
      state.prByName[name] = cached;
      return Promise.resolve();
    }

    return fetchUserFile(name).then(function (file) {
      var distilled = distil(file);
      state.prByName[name] = distilled;
      cacheSet('user.' + name, distilled);
    }).catch(function (err) {
      var record = { status: err && err.status === 404 ? 'missing' : 'error', encounters: {}, error: err && err.message };
      state.prByName[name] = record;
      // Don't cache transport errors; a 404 is stable enough to cache briefly.
      if (record.status === 'missing') cacheSet('user.' + name, record);
    });
  }

  function loadAll(force) {
    if (state.loading) return;
    state.loading = true;
    el.refreshBtn.classList.add('is-busy');
    if (force) cacheClear();

    // Hold the previous render at reduced opacity instead of flashing a skeleton.
    if (el.matrixBody.childElementCount > 0) el.matrixScroll.classList.add('is-stale');

    loadEncounters()
      .catch(function (err) {
        state.encountersError = err && err.message;
      })
      .then(function () {
        var names = state.members.map(function (m) { return m.name; }).filter(Boolean);
        var unique = names.filter(function (n, i) { return names.indexOf(n) === i; });
        return Promise.all(unique.map(loadMember));
      })
      .then(function () {
        state.loading = false;
        el.refreshBtn.classList.remove('is-busy');
        el.matrixScroll.classList.remove('is-stale');
        render();
      });
  }

  // ---------------------------------------------------------------- rendering

  function visibleEncounters() {
    if (state.category === '*') return state.encounters;
    return state.encounters.filter(function (e) { return e.category === state.category; });
  }

  function renderCategoryChips() {
    var seen = [];
    state.encounters.forEach(function (e) {
      if (seen.indexOf(e.category) === -1) seen.push(e.category);
    });

    var html = '<button class="chip' + (state.category === '*' ? ' is-active' : '') + '" data-category="*">全部</button>';
    seen.forEach(function (c) {
      html += '<button class="chip' + (state.category === c ? ' is-active' : '') +
        '" data-category="' + esc(c) + '">' + esc(c) + '</button>';
    });
    el.categoryChips.innerHTML = html;
  }

  function renderLegend() {
    var html = '<span class="legend-label">PR</span>';
    // Low → high reads naturally left to right.
    TIERS.slice().reverse().forEach(function (tier) {
      html += '<span class="swatch" style="background:' + tierFill(tier) + ';color:' + tierInk(tier) + '">' +
        esc(tier.label) + (tier.star && state.scale === 'ordinal' ? '<span class="star">★</span>' : '') +
        '</span>';
    });
    el.legend.innerHTML = html;
  }

  function renderMeta() {
    var bits = [];
    if (state.dataUpdatedAt) bits.push('排行資料 ' + formatDate(state.dataUpdatedAt));
    if (state.preview) bits.push('<span class="meta-warn">預覽模式</span>');
    if (state.encountersError) bits.push('<span class="meta-warn">副本清單讀取失敗</span>');
    var errored = Object.keys(state.prByName).filter(function (n) { return state.prByName[n].status === 'error'; });
    if (errored.length) bits.push('<span class="meta-warn">' + errored.length + ' 人讀取失敗</span>');
    el.meta.innerHTML = bits.join(' · ');
  }

  function renderHead(encounters) {
    // Category band, then the duty columns.
    var groups = [];
    encounters.forEach(function (e) {
      var last = groups[groups.length - 1];
      if (last && last.category === e.category) last.count++;
      else groups.push({ category: e.category, count: 1 });
    });

    var row1 = '<tr><th class="member-th" rowspan="2">成員</th>';
    groups.forEach(function (g) {
      row1 += '<th class="cat-th" colspan="' + g.count + '">' + esc(g.category) + '</th>';
    });
    row1 += '<th class="summary-th" rowspan="2">最佳</th></tr>';

    var row2 = '<tr>';
    encounters.forEach(function (e) {
      row2 += '<th class="duty-th" title="' + esc(e.name) + '">' + esc(e.short) + '</th>';
    });
    row2 += '</tr>';

    el.matrixHead.innerHTML = row1 + row2;
  }

  function renderBody(encounters) {
    var html = '';

    state.members.forEach(function (member) {
      var record = state.prByName[member.name] || { status: 'pending', encounters: {} };
      var jobAbbr = member.jobName || 'ADV';

      // A name that resolves to a different world is a possible name collision:
      // the ranking project keys users by character name alone.
      var worldMismatch = record.status === 'ok' && member.world && record.servers &&
        record.servers.length > 0 && record.servers.indexOf(member.world) === -1;

      html += '<tr>';
      html += '<td class="member-td"><div class="member" data-role="' + esc(member.jobRole || 'DPS') + '">' +
        '<span class="job-badge">' + esc(jobAbbr) + '</span>' +
        '<span><span class="member-name">' + esc(member.name) + '</span>' +
        (member.world ? ' <span class="member-world">@' + esc(member.world) + '</span>' : '') +
        (worldMismatch ? ' <span class="member-warn" title="排行榜上同名角色的伺服器為 ' +
          esc(record.servers.join('/')) + '，可能是同名不同人">⚠</span>' : '') +
        (record.status === 'missing' ? ' <span class="member-note">無公開紀錄</span>' : '') +
        (record.status === 'error' ? ' <span class="member-warn" title="' + esc(record.error || '') + '">讀取失敗</span>' : '') +
        (record.status === 'pending' ? ' <span class="member-note">載入中…</span>' : '') +
        '</span></div></td>';

      var best = null;
      var cleared = 0;

      encounters.forEach(function (enc) {
        var cell = record.encounters ? record.encounters[enc.key] : null;

        if (!cell) {
          html += '<td class="cell is-empty" title="' + esc(enc.name) + '：無紀錄">–</td>';
          return;
        }

        cleared++;
        if (!best || cell.pr > best.pr) best = cell;

        // Truncate, never round: a 99.6 parse is a 99, and rounding it to "100"
        // would print a number the tier colour disagrees with. Flooring keeps the
        // numeral and the fill consistent by construction.
        var shown = Math.floor(cell.pr);
        var tier = tierFor(shown);
        var payload = {
          member: member.name,
          duty: enc.name,
          pr: cell.pr,
          topPercent: cell.topPercent,
          rank: cell.rank,
          sampleCount: cell.sampleCount,
          job: cell.job,
          rdps: cell.rdps,
          recordedAt: cell.recordedAt,
          patch: cell.patch,
          reportCode: cell.reportCode,
          qualified: cell.qualified
        };

        html += '<td class="cell" tabindex="0"' +
          ' style="background:' + tierFill(tier) + ';color:' + tierInk(tier) + '"' +
          ' data-tip="' + esc(JSON.stringify(payload)) + '">' +
          shown + (tier.star && state.scale === 'ordinal' ? '<span class="star">★</span>' : '') +
          '</td>';
      });

      html += '<td class="summary-td">' +
        (best ? '<b>' + Math.floor(best.pr) + '</b> <span>/ ' + cleared + ' 本</span>' : '<span>—</span>') +
        '</td>';
      html += '</tr>';
    });

    el.matrixBody.innerHTML = html;
  }

  function render() {
    renderCategoryChips();
    renderLegend();

    var encounters = visibleEncounters();
    var hasParty = state.members.length > 0;

    el.partyCount.textContent = hasParty ? '隊伍 ' + state.members.length + ' 人' : '—';

    // Newest generated_at among the loaded members.
    var updated = null;
    Object.keys(state.prByName).forEach(function (n) {
      var u = state.prByName[n].updated;
      if (u && (!updated || u > updated)) updated = u;
    });
    state.dataUpdatedAt = updated;

    if (!hasParty || encounters.length === 0) {
      el.matrixScroll.style.display = 'none';
      el.emptyState.classList.add('is-visible');
      el.emptyText.textContent = state.connected ? '目前未加入隊伍' : '等待 OverlayPlugin 連線...';
      el.emptySub.textContent = hasParty
        ? '這個分類沒有副本'
        : (state.partyDiagnostic || '組隊後會自動載入每位成員的 PR');
    } else {
      el.matrixScroll.style.display = '';
      el.emptyState.classList.remove('is-visible');
      renderHead(encounters);
      renderBody(encounters);
    }

    renderMeta();
  }

  // ---------------------------------------------------------------- tooltip

  function showTooltip(cell) {
    var raw = cell.getAttribute('data-tip');
    if (!raw) return;

    var d;
    try { d = JSON.parse(raw); } catch (e) { return; }

    var rows = '';
    var row = function (label, value) {
      rows += '<div class="tt-row"><span>' + esc(label) + '</span><span>' + value + '</span></div>';
    };

    row('PR', d.pr.toFixed(2));
    if (typeof d.topPercent === 'number') row('前段', d.topPercent.toFixed(2) + '%');
    if (typeof d.rank === 'number' && typeof d.sampleCount === 'number') {
      row('名次', formatNumber(d.rank) + ' / ' + formatNumber(d.sampleCount));
    }
    if (d.job) row('職業', esc(JOB_ABBR[d.job] || d.job));
    if (typeof d.rdps === 'number') row('rDPS', formatNumber(d.rdps, 0));
    row('紀錄日期', formatDate(d.recordedAt));
    if (d.patch) row('版本', esc(d.patch));

    var foot = '';
    if (d.qualified === false) foot += '未達門檻（active% 偏低）<br>';
    if (d.reportCode) foot += 'fflogs.com/reports/' + esc(d.reportCode);

    el.tooltip.innerHTML =
      '<div class="tt-title">' + esc(d.duty) + '</div>' +
      '<div class="tt-row"><span>' + esc(d.member) + '</span><span></span></div>' +
      rows +
      (foot ? '<div class="tt-foot">' + foot + '</div>' : '');

    el.tooltip.classList.add('is-visible');
    el.tooltip.setAttribute('aria-hidden', 'false');
    positionTooltip(cell);
  }

  function positionTooltip(cell) {
    var r = cell.getBoundingClientRect();
    var t = el.tooltip.getBoundingClientRect();
    var left = r.left + r.width / 2 - t.width / 2;
    var top = r.top - t.height - 8;

    if (top < 4) top = r.bottom + 8;

    // Overlay windows are short (a party is 2-8 rows), so a tall tooltip fits
    // neither above nor below. Clamping keeps it fully readable - overlapping the
    // matrix is better than being cut off by the window edge.
    left = Math.max(4, Math.min(left, window.innerWidth - t.width - 4));
    top = Math.max(4, Math.min(top, window.innerHeight - t.height - 4));

    el.tooltip.style.left = left + 'px';
    el.tooltip.style.top = top + 'px';
  }

  function hideTooltip() {
    el.tooltip.classList.remove('is-visible');
    el.tooltip.setAttribute('aria-hidden', 'true');
  }

  // Delegated so it survives every re-render. Keyboard focus shows the same as hover.
  el.matrixBody.addEventListener('mouseover', function (e) {
    var cell = e.target.closest ? e.target.closest('.cell') : null;
    if (cell && !cell.classList.contains('is-empty')) showTooltip(cell);
  });
  el.matrixBody.addEventListener('mouseout', function (e) {
    var cell = e.target.closest ? e.target.closest('.cell') : null;
    if (cell) hideTooltip();
  });
  el.matrixBody.addEventListener('focusin', function (e) {
    var cell = e.target.closest ? e.target.closest('.cell') : null;
    if (cell && !cell.classList.contains('is-empty')) showTooltip(cell);
  });
  el.matrixBody.addEventListener('focusout', hideTooltip);

  // ---------------------------------------------------------------- controls

  el.categoryChips.addEventListener('click', function (e) {
    var chip = e.target.closest ? e.target.closest('.chip') : null;
    if (!chip) return;
    state.category = chip.getAttribute('data-category');
    hideTooltip();
    render();
  });

  el.scaleChips.addEventListener('click', function (e) {
    var chip = e.target.closest ? e.target.closest('.chip') : null;
    if (!chip) return;
    state.scale = chip.getAttribute('data-scale');
    Array.prototype.forEach.call(el.scaleChips.children, function (c) {
      c.classList.toggle('is-active', c === chip);
    });
    try { localStorage.setItem(CACHE_PREFIX + 'scale', state.scale); } catch (err) { /* ignore */ }
    hideTooltip();
    render();
  });

  el.refreshBtn.addEventListener('click', function () { loadAll(true); });

  // ---------------------------------------------------------------- party feed

  function membersFromState(data) {
    if (!data || !data.members) return [];
    return data.members.map(function (m) {
      return {
        name: m.name,
        world: m.homeWorldName,
        jobName: m.jobName,
        jobRole: m.jobRole,
        groupIndex: m.groupIndex || 0
      };
    }).filter(function (m) { return m.name; });
  }

  function sameRoster(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i].name !== b[i].name || a[i].jobName !== b[i].jobName) return false;
    }
    return true;
  }

  function onPartyState(data) {
    state.partyDiagnostic = data && data.diagnostic;
    var members = membersFromState(data);
    var changed = !sameRoster(members, state.members);
    state.members = members;

    if (changed) loadAll(false);
    else render();
  }

  function onConnected() {
    if (state.connected) return;
    state.connected = true;
    el.statusDot.classList.add('is-online');
  }

  function initOverlayEvents() {
    if (!window.addOverlayListener || !window.callOverlayHandler) {
      enablePreview('common.js 未載入');
      return;
    }

    window.addOverlayListener('onPartyOverlayUpdate', function (e) {
      onConnected();
      if (!state.preview) onPartyState(e && e.detail ? e.detail : e);
    });

    window.startOverlayEvents();

    var settled = false;
    var timer = setTimeout(function () {
      if (settled || state.connected) return;
      settled = true;
      enablePreview('未偵測到 OverlayPlugin');
    }, HANDSHAKE_TIMEOUT_MS);

    window.callOverlayHandler({ call: 'getPartyOverlayData' }).then(function (data) {
      if (settled && state.preview) return;
      settled = true;
      clearTimeout(timer);
      onConnected();
      onPartyState(data);
    }).catch(function () { /* the event push will cover it */ });
  }

  /**
   * Browser preview: no plugin, so use a fixed roster to exercise the real fetch
   * path. Marked in the footer so it can't be mistaken for live data.
   */
  function enablePreview(reason) {
    state.preview = true;
    el.statusDot.classList.add('is-preview');
    el.statusDot.title = reason || '預覽模式';
    state.members = [
      { name: '加加財富鳥', world: '利維坦', jobName: 'RDM', jobRole: 'DPS', groupIndex: 0 },
      { name: '我不是洗ㄅㄚ', world: '利維坦', jobName: 'AST', jobRole: 'Healer', groupIndex: 0 }
    ];
    loadAll(false);
  }

  // ---------------------------------------------------------------- boot

  // Scale preference: #scale=ordinal in the overlay URL wins (lets the choice be
  // baked into the overlay config), otherwise the last toggle is remembered.
  try {
    var hashScale = /(?:^|[#&])scale=(parse|ordinal)/.exec(location.hash || '');
    var savedScale = hashScale ? hashScale[1] : localStorage.getItem(CACHE_PREFIX + 'scale');
    if (savedScale === 'parse' || savedScale === 'ordinal') {
      state.scale = savedScale;
      Array.prototype.forEach.call(el.scaleChips.children, function (c) {
        c.classList.toggle('is-active', c.getAttribute('data-scale') === savedScale);
      });
    }
  } catch (e) { /* ignore */ }

  render();
  loadEncounters().then(render).catch(function () { /* rendered again after loadAll */ });
  initOverlayEvents();
})();
