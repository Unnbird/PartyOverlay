/**
 * 隊伍 PR 總覽 (FFLogsViewer/FF14MarketOverlay-inspired UI)
 *
 * OverlayPlugin wiring (initOverlayEvents / onPartyState / enablePreview) follows the
 * same handshake pattern as uiold/js/pr.js - that part works and isn't being redesigned.
 * Everything else (markup, styling, collapse behaviour, icons) is new.
 *
 * Party roster comes from PartyOverlayPlugin (onPartyOverlayUpdate).
 * PR values come from the TC ranking project:
 *   encounter list : https://ranking.init.engineer/data/encounters.json
 *   per character  : <repo>/data/users/<character name>.json
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

  var SHORT_LABELS = {
    savage_m1s: 'M1', savage_m2s: 'M2', savage_m3s: 'M3', savage_m4s: 'M4',
    savage_m5s: 'M5', savage_m6s: 'M6', savage_m7s: 'M7', savage_m8s: 'M8',
    extreme_valigarmanda: '豔翼', extreme_zoraal_ja: '佐拉', extreme_queen_eternal: '永恆',
    extreme_zelenia: '澤蓮', unreal_byakko: '白虎', unreal_suzaku: '朱雀',
    chaotic_cloud_of_darkness: '暗雲', ultimate_bahamut: '巴哈', ultimate_ultima_weapon: '究極',
    ultimate_alexander: '亞歷', ultimate_dragonsong: '龍詩', ultimate_omega: '歐米',
    ultimate_futures_rewritten: '伊甸'
  };

  var JOB_ABBR = {
    Paladin: 'PLD', Warrior: 'WAR', DarkKnight: 'DRK', Gunbreaker: 'GNB',
    WhiteMage: 'WHM', Scholar: 'SCH', Astrologian: 'AST', Sage: 'SGE',
    Monk: 'MNK', Dragoon: 'DRG', Ninja: 'NIN', Samurai: 'SAM', Reaper: 'RPR', Viper: 'VPR',
    Bard: 'BRD', Machinist: 'MCH', Dancer: 'DNC',
    BlackMage: 'BLM', Summoner: 'SMN', RedMage: 'RDM', Pictomancer: 'PCT', BlueMage: 'BLU'
  };

  var TIERS = [
    { min: 100, label: '100', parse: '#e5cc80', ord: '#cde2fb', parseInk: '#0b0b0b', ordInk: '#0b0b0b', star: true },
    { min: 99, label: '99', parse: '#e268a8', ord: '#cde2fb', parseInk: '#0b0b0b', ordInk: '#0b0b0b' },
    { min: 95, label: '95', parse: '#ff8000', ord: '#9ec5f4', parseInk: '#0b0b0b', ordInk: '#0b0b0b' },
    { min: 75, label: '75', parse: '#a335ee', ord: '#6da7ec', parseInk: '#ffffff', ordInk: '#0b0b0b' },
    { min: 50, label: '50', parse: '#0070ff', ord: '#3987e5', parseInk: '#ffffff', ordInk: '#ffffff' },
    { min: 25, label: '25', parse: '#1eff00', ord: '#256abf', parseInk: '#0b0b0b', ordInk: '#ffffff' },
    { min: 0, label: '<25', parse: '#666666', ord: '#184f95', parseInk: '#ffffff', ordInk: '#ffffff' }
  ];

  // ---------------------------------------------------------------- DOM elements

  var el = {
    root: document.getElementById('app'),
    statusDot: document.getElementById('statusDot'),
    partyCount: document.getElementById('partyCount'),
    collapseBtn: document.getElementById('collapseBtn'),

    btnPartyView: document.getElementById('btnPartyView'),
    btnSingleView: document.getElementById('btnSingleView'),
    partyLayoutGroup: document.getElementById('partyLayoutGroup'),
    btnEncounterLayout: document.getElementById('btnEncounterLayout'),
    btnStatLayout: document.getElementById('btnStatLayout'),
    partyListBtn: document.getElementById('partyListBtn'),
    partyMembersMenu: document.getElementById('partyMembersMenu'),

    jobDropdownBtn: document.getElementById('jobDropdownBtn'),
    jobDropdownMenu: document.getElementById('jobDropdownMenu'),
    jobDropdownLabel: document.getElementById('jobDropdownLabel'),
    metricDropdownBtn: document.getElementById('metricDropdownBtn'),
    metricDropdownMenu: document.getElementById('metricDropdownMenu'),
    metricDropdownLabel: document.getElementById('metricDropdownLabel'),
    partitionDropdownBtn: document.getElementById('partitionDropdownBtn'),
    partitionDropdownMenu: document.getElementById('partitionDropdownMenu'),
    partitionDropdownLabel: document.getElementById('partitionDropdownLabel'),
    statEncounterBtn: document.getElementById('statEncounterBtn'),
    statEncounterMenu: document.getElementById('statEncounterMenu'),
    statEncounterLabel: document.getElementById('statEncounterLabel'),

    timeframeBtn: document.getElementById('timeframeBtn'),
    categoryChips: document.getElementById('categoryChips'),
    scaleChips: document.getElementById('scaleChips'),
    refreshBtn: document.getElementById('refreshBtn'),

    mainContent: document.getElementById('mainContent'),
    matrixScroll: document.getElementById('matrixScroll'),
    matrixHead: document.getElementById('matrixHead'),
    matrixBody: document.getElementById('matrixBody'),

    statLayoutScroll: document.getElementById('statLayoutScroll'),
    statMatrixBody: document.getElementById('statMatrixBody'),
    statMetricHeader: document.getElementById('statMetricHeader'),

    singleViewScroll: document.getElementById('singleViewScroll'),
    singleCharAvatar: document.getElementById('singleCharAvatar'),
    singleCharName: document.getElementById('singleCharName'),
    singleCharWorld: document.getElementById('singleCharWorld'),
    singleCharAvgPr: document.getElementById('singleCharAvgPr'),
    singleCharClearedCount: document.getElementById('singleCharClearedCount'),
    singleCharMainJob: document.getElementById('singleCharMainJob'),
    singleCharTableBody: document.getElementById('singleCharTableBody'),
    singleMetricHeader: document.getElementById('singleMetricHeader'),
    btnBackToParty: document.getElementById('btnBackToParty'),

    emptyState: document.getElementById('emptyState'),
    emptyText: document.getElementById('emptyText'),
    emptySub: document.getElementById('emptySub'),

    legend: document.getElementById('legend'),
    meta: document.getElementById('meta'),
    tooltip: document.getElementById('tooltip')
  };

  // ---------------------------------------------------------------- application state

  var state = {
    connected: false,
    preview: false,
    collapsed: false,
    viewMode: 'party',
    partyLayout: 'encounter',
    selectedStatEncounterKey: null,
    selectedCharName: null,
    jobFilter: 'ALL',
    metric: 'perf',
    partition: 'standard',
    timeframe: 'historical',
    category: '*',
    scale: 'parse',
    encounters: [],
    members: [],
    prByName: {},
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

  function icon(name, size) {
    return window.PartyOverlayIcons ? window.PartyOverlayIcons.svg(name, size) : '';
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

  function formatTime(seconds) {
    if (typeof seconds !== 'number' || isNaN(seconds)) return '—';
    var m = Math.floor(seconds / 60);
    var s = Math.floor(seconds % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
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
    } catch (e) { /* ignore */ }
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

  // ---------------------------------------------------------------- fetching & distilling

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
      if (!state.selectedStatEncounterKey && cached.length > 0) {
        state.selectedStatEncounterKey = cached[0].key;
      }
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
      if (!state.selectedStatEncounterKey && encounters.length > 0) {
        state.selectedStatEncounterKey = encounters[0].key;
      }
      cacheSet('encounters', encounters);
      return encounters;
    });
  }

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
        rdps: best.rdps || 0,
        adps: best.adps || best.rdps || 0,
        ndps: best.ndps || best.rdps || 0,
        cdps: best.cdps || best.rdps || 0,
        hps: best.hps || 0,
        clearSeconds: best.clear_time_seconds,
        recordedAt: best.recorded_at_iso,
        patch: best.game_version,
        reportCode: best.report_code,
        jobCount: (entry.best_by_job || []).length,
        kills: entry.kills_count || 1,
        medianPr: entry.median_percentile || perf.score_percentile
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
      if (record.status === 'missing') cacheSet('user.' + name, record);
    });
  }

  function loadAll(force) {
    if (state.loading) return;
    state.loading = true;
    el.refreshBtn.classList.add('is-busy');
    if (force) cacheClear();

    if (el.matrixBody.childElementCount > 0) el.matrixScroll.classList.add('is-stale');

    loadEncounters()
      .catch(function (err) { state.encountersError = err && err.message; })
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

  // ---------------------------------------------------------------- filtering & rendering

  function visibleEncounters() {
    if (state.category === '*') return state.encounters;
    return state.encounters.filter(function (e) { return e.category === state.category; });
  }

  function filteredMembers() {
    if (state.jobFilter === 'ALL') return state.members;
    if (state.jobFilter === 'Tank' || state.jobFilter === 'Healer' || state.jobFilter === 'DPS') {
      return state.members.filter(function (m) { return (m.jobRole || 'DPS') === state.jobFilter; });
    }
    return state.members.filter(function (m) { return (m.jobName || '') === state.jobFilter; });
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
    if (el.legend) el.legend.innerHTML = '';
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

  function renderPartyMembersPopup() {
    var container = el.partyMembersMenu;
    if (!state.members || state.members.length === 0) {
      container.innerHTML = '<div class="dropdown-empty">目前未加入隊伍</div>';
      return;
    }

    var html = '';
    state.members.forEach(function (m) {
      var jobAbbr = m.jobName || 'ADV';
      html += '<div class="popover-row" data-name="' + esc(m.name) + '">' +
        '<div class="popover-row-left">' +
        '<span class="job-badge" data-role="' + esc(m.jobRole || 'DPS') + '">' + esc(jobAbbr) + '</span>' +
        '<span>' + esc(m.name) + '</span>' +
        '</div>' +
        '<span class="member-world">' + esc(m.world ? '@' + m.world : '') + '</span>' +
        '</div>';
    });
    container.innerHTML = html;
  }

  // ---------------------------------------------------------------- Encounter Matrix View
  // Transposed: columns = members (compact job-icon + name-initial header), rows = encounters.

  function firstChar(name) {
    if (!name) return '';
    var chars = Array.from(String(name).trim());
    return chars.length ? chars[0] : '';
  }

  function renderMatrixHead(members) {
    var row = '<tr><th class="duty-col-th">副本</th>';

    members.forEach(function (member) {
      var record = state.prByName[member.name] || {};
      var jobAbbr = member.jobName || 'ADV';
      var worldMismatch = record.status === 'ok' && member.world && record.servers &&
        record.servers.length > 0 && record.servers.indexOf(member.world) === -1;
      var warn = worldMismatch || record.status === 'error';

      var titleBits = [member.name + (member.world ? '@' + member.world : '')];
      if (record.status === 'missing') titleBits.push('無公開紀錄');
      if (record.status === 'error') titleBits.push('讀取失敗: ' + (record.error || ''));
      if (worldMismatch) titleBits.push('同名伺服器不同');

      row += '<th class="member-col-th" title="' + esc(titleBits.join(' · ')) + '">' +
        '<div class="member-col" data-name="' + esc(member.name) + '" data-role="' + esc(member.jobRole || 'DPS') + '">' +
        '<span class="job-badge job-badge-compact" data-role="' + esc(member.jobRole || 'DPS') + '">' + esc(jobAbbr) + '</span>' +
        '<span class="member-initial' + (warn ? ' is-warn' : '') + '">' + esc(firstChar(member.name)) + '</span>' +
        '</div>' +
        '</th>';
    });

    row += '</tr>';
    el.matrixHead.innerHTML = row;
  }

  function renderMatrixBody(encounters, members) {
    var colCount = members.length + 1;
    var isMetricMode = state.metric !== 'perf';

    if (el.root) {
      el.root.classList.toggle('is-metric-mode', isMetricMode);
    }

    if (encounters.length === 0) {
      el.matrixBody.innerHTML = '<tr><td class="dropdown-empty" colspan="' + colCount + '">此分類無副本</td></tr>';
      return;
    }

    var html = '';
    var lastCategory = null;
    var bestByMember = {};

    encounters.forEach(function (enc) {
      if (enc.category !== lastCategory) {
        lastCategory = enc.category;
        html += '<tr class="cat-row"><td colspan="' + colCount + '">' + esc(enc.category) + '</td></tr>';
      }

      html += '<tr><td class="duty-td" title="' + esc(enc.name) + '">' + esc(enc.short) + '</td>';

      members.forEach(function (member) {
        var record = state.prByName[member.name] || { status: 'pending', encounters: {} };
        var cell = record.encounters ? record.encounters[enc.key] : null;

        if (!cell) {
          html += '<td class="cell is-empty" title="' + esc(member.name) + ' - ' + esc(enc.name) + '：無紀錄">–</td>';
          return;
        }

        var val = isMetricMode ? (cell[state.metric] || cell.rdps || 0) : cell.pr;

        if (bestByMember[member.name] === undefined || val > bestByMember[member.name].val) {
          bestByMember[member.name] = { val: val, pr: cell.pr };
        }

        var shownPr = Math.floor(cell.pr);
        var tier = tierFor(shownPr);
        var displayStr = isMetricMode ? formatNumber(Math.round(val), 0) : shownPr;

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

        html += '<td class="cell' + (isMetricMode ? ' is-metric' : '') + '" tabindex="0"' +
          ' style="background:' + tierFill(tier) + ';color:' + tierInk(tier) + '"' +
          ' data-tip="' + esc(JSON.stringify(payload)) + '">' +
          displayStr + (!isMetricMode && tier.star && state.scale === 'ordinal' ? '<span class="star">★</span>' : '') +
          '</td>';
      });

      html += '</tr>';
    });

    html += '<tr class="summary-row"><td class="duty-td summary-label">最佳</td>';
    members.forEach(function (member) {
      var bestObj = bestByMember[member.name];
      if (bestObj !== undefined) {
        var summaryStr = isMetricMode ? formatNumber(Math.round(bestObj.val), 0) : Math.floor(bestObj.pr);
        html += '<td class="cell is-summary"><b>' + summaryStr + '</b></td>';
      } else {
        html += '<td class="cell is-summary"><span>—</span></td>';
      }
    });
    html += '</tr>';

    el.matrixBody.innerHTML = html;
  }

  // ---------------------------------------------------------------- Stat Layout View

  function renderStatLayout() {
    var encounters = visibleEncounters();
    if (encounters.length === 0) {
      el.statMatrixBody.innerHTML = '<tr><td colspan="7" class="dropdown-empty">此分類無副本</td></tr>';
      return;
    }

    if (!state.selectedStatEncounterKey && encounters.length > 0) {
      state.selectedStatEncounterKey = encounters[0].key;
    }

    var menuHtml = '';
    var selectedName = '副本選擇';
    encounters.forEach(function (e) {
      var isSel = e.key === state.selectedStatEncounterKey;
      if (isSel) selectedName = e.name;
      menuHtml += '<div class="dropdown-option' + (isSel ? ' is-selected' : '') + '" data-value="' + esc(e.key) + '">' +
        esc(e.category) + ' - ' + esc(e.name) +
        '</div>';
    });
    el.statEncounterMenu.innerHTML = menuHtml;
    el.statEncounterLabel.textContent = selectedName;

    var metricLabels = { perf: '最高 Percentile', rdps: '最高 rDPS', adps: '最高 aDPS', ndps: '最高 nDPS', cdps: '最高 cDPS', hps: '最高 HPS' };
    el.statMetricHeader.textContent = metricLabels[state.metric] || '最高 rDPS';

    var members = filteredMembers();
    var html = '';

    members.forEach(function (m) {
      var record = state.prByName[m.name] || { status: 'pending', encounters: {} };
      var cell = record.encounters ? record.encounters[state.selectedStatEncounterKey] : null;
      var jobAbbr = m.jobName || 'ADV';

      html += '<tr class="member-row" data-name="' + esc(m.name) + '" style="cursor:pointer;" title="點擊查看個人詳細戰績">';
      html += '<td class="member-td"><div class="member" data-role="' + esc(m.jobRole || 'DPS') + '">' +
        '<span class="job-badge" data-role="' + esc(m.jobRole || 'DPS') + '">' + esc(jobAbbr) + '</span>' +
        '<span class="member-name">' + esc(m.name) + '</span>' +
        (m.world ? ' <span class="member-world">@' + esc(m.world) + '</span>' : '') +
        '</div></td>';

      if (!cell) {
        html += '<td class="summary-td" colspan="6"><span class="member-note">無此副本紀錄</span></td></tr>';
        return;
      }

      var shownPr = Math.floor(cell.pr);
      var tier = tierFor(shownPr);
      var metricVal = state.metric === 'perf' ? shownPr + '%' : formatNumber(cell[state.metric] || cell.rdps || 0);

      html += '<td class="summary-td"><span class="swatch" style="background:' + tierFill(tier) + ';color:' + tierInk(tier) + ';padding:2px 8px;border-radius:4px;">' + shownPr + '</span></td>';
      html += '<td class="summary-td">' + Math.floor(cell.medianPr || cell.pr) + '</td>';
      html += '<td class="summary-td">' + (cell.kills || 1) + ' 次</td>';
      html += '<td class="summary-td">' + formatTime(cell.clearSeconds) + '</td>';
      html += '<td class="summary-td"><b>' + metricVal + '</b></td>';
      html += '<td class="summary-td">' + esc(JOB_ABBR[cell.job] || cell.job || jobAbbr) + '</td>';
      html += '</tr>';
    });

    el.statMatrixBody.innerHTML = html;
  }

  // ---------------------------------------------------------------- Single View

  function renderSingleView() {
    if (!state.selectedCharName && state.members.length > 0) {
      state.selectedCharName = state.members[0].name;
    }

    var charName = state.selectedCharName;
    if (!charName) {
      el.singleCharName.textContent = '未選擇玩家';
      el.singleCharTableBody.innerHTML = '<tr><td colspan="9" class="dropdown-empty">請先選擇隊伍成員</td></tr>';
      return;
    }

    var memberObj = state.members.filter(function (m) { return m.name === charName; })[0];
    var record = state.prByName[charName] || { status: 'pending', encounters: {} };

    el.singleCharName.textContent = charName;
    el.singleCharWorld.textContent = memberObj && memberObj.world ? '@' + memberObj.world : '';
    el.singleCharAvatar.textContent = memberObj ? (memberObj.jobName || 'ADV') : 'ADV';

    var encounters = visibleEncounters();
    var clearedCount = 0;
    var prSum = 0;
    var jobCounts = {};

    encounters.forEach(function (enc) {
      var cell = record.encounters ? record.encounters[enc.key] : null;
      if (cell) {
        clearedCount++;
        prSum += cell.pr;
        if (cell.job) jobCounts[cell.job] = (jobCounts[cell.job] || 0) + 1;
      }
    });

    var avgPr = clearedCount > 0 ? (prSum / clearedCount).toFixed(1) : '—';
    el.singleCharAvgPr.textContent = avgPr;
    el.singleCharClearedCount.textContent = clearedCount + ' / ' + encounters.length + ' 本';

    var mainJob = '—';
    var maxCount = 0;
    Object.keys(jobCounts).forEach(function (j) {
      if (jobCounts[j] > maxCount) {
        maxCount = jobCounts[j];
        mainJob = JOB_ABBR[j] || j;
      }
    });
    el.singleCharMainJob.textContent = mainJob;

    var metricLabels = { perf: 'Perf %', rdps: 'rDPS', adps: 'aDPS', ndps: 'nDPS', cdps: 'cDPS', hps: 'HPS' };
    el.singleMetricHeader.textContent = metricLabels[state.metric] || 'rDPS';

    var html = '';
    encounters.forEach(function (enc) {
      var cell = record.encounters ? record.encounters[enc.key] : null;
      if (!cell) {
        html += '<tr>' +
          '<td class="single-th">' + esc(enc.category) + '</td>' +
          '<td class="single-th">' + esc(enc.name) + '</td>' +
          '<td class="summary-td" colspan="7"><span class="member-note">無紀錄</span></td>' +
          '</tr>';
        return;
      }

      var shownPr = Math.floor(cell.pr);
      var tier = tierFor(shownPr);
      var metricVal = state.metric === 'perf' ? shownPr + '%' : formatNumber(cell[state.metric] || cell.rdps || 0);

      html += '<tr>' +
        '<td class="single-th">' + esc(enc.category) + '</td>' +
        '<td class="single-th"><b>' + esc(enc.name) + '</b></td>' +
        '<td class="summary-td"><span class="swatch" style="background:' + tierFill(tier) + ';color:' + tierInk(tier) + ';padding:2px 8px;border-radius:4px;">' + shownPr + '</span></td>' +
        '<td class="summary-td">' + Math.floor(cell.medianPr || cell.pr) + '</td>' +
        '<td class="summary-td">' + (cell.rank ? formatNumber(cell.rank) + ' / ' + formatNumber(cell.sampleCount) : '—') + '</td>' +
        '<td class="summary-td"><b>' + metricVal + '</b></td>' +
        '<td class="summary-td">' + formatTime(cell.clearSeconds) + '</td>' +
        '<td class="summary-td">' + esc(JOB_ABBR[cell.job] || cell.job || '—') + '</td>' +
        '<td class="summary-td">' + formatDate(cell.recordedAt) + '</td>' +
        '</tr>';
    });

    el.singleCharTableBody.innerHTML = html;
  }

  // ---------------------------------------------------------------- collapse / expand

  function applyCollapse() {
    el.root.classList.toggle('is-collapsed', state.collapsed);
    el.collapseBtn.innerHTML = icon(state.collapsed ? 'maximize2' : 'minimize2', 15);
    var label = state.collapsed ? '展開' : '縮小';
    el.collapseBtn.title = label;
    el.collapseBtn.setAttribute('aria-label', label);
  }

  function setCollapsed(value) {
    state.collapsed = value;
    try { localStorage.setItem(CACHE_PREFIX + 'collapsed', value ? '1' : '0'); } catch (e) { /* ignore */ }
    applyCollapse();
  }

  // ---------------------------------------------------------------- main render dispatch

  function renderHeaderControls() {
    el.btnPartyView.classList.toggle('is-active', state.viewMode === 'party');
    el.btnSingleView.classList.toggle('is-active', state.viewMode === 'single');

    el.partyLayoutGroup.style.display = state.viewMode === 'party' ? 'flex' : 'none';
    el.btnEncounterLayout.classList.toggle('is-active', state.partyLayout === 'encounter');
    el.btnStatLayout.classList.toggle('is-active', state.partyLayout === 'stat');

    el.timeframeBtn.textContent = state.timeframe === 'historical' ? 'H%' : 'T%';
    el.timeframeBtn.title = state.timeframe === 'historical' ? '目前顯示：Historical 歷史最高 % (點擊切換為 Today)' : '目前顯示：Today 當前 Percentile (點擊切換為 Historical)';
  }

  function render() {
    renderHeaderControls();
    renderCategoryChips();
    renderLegend();
    renderPartyMembersPopup();

    var hasParty = state.members.length > 0;
    el.partyCount.textContent = hasParty ? '隊伍 ' + state.members.length + ' 人' : '—';

    var updated = null;
    Object.keys(state.prByName).forEach(function (n) {
      var u = state.prByName[n].updated;
      if (u && (!updated || u > updated)) updated = u;
    });
    state.dataUpdatedAt = updated;

    if (!hasParty) {
      el.matrixScroll.style.display = 'none';
      el.statLayoutScroll.style.display = 'none';
      el.singleViewScroll.style.display = 'none';
      el.emptyState.classList.add('is-visible');
      el.emptyText.textContent = state.connected ? '目前未加入隊伍' : '等待 OverlayPlugin 連線...';
      el.emptySub.textContent = state.partyDiagnostic || '組隊後會自動載入每位成員的 PR';
      renderMeta();
      return;
    }

    el.emptyState.classList.remove('is-visible');

    if (state.viewMode === 'single') {
      el.matrixScroll.style.display = 'none';
      el.statLayoutScroll.style.display = 'none';
      el.singleViewScroll.style.display = 'block';
      renderSingleView();
    } else if (state.partyLayout === 'stat') {
      el.matrixScroll.style.display = 'none';
      el.statLayoutScroll.style.display = 'block';
      el.singleViewScroll.style.display = 'none';
      renderStatLayout();
    } else {
      el.matrixScroll.style.display = 'block';
      el.statLayoutScroll.style.display = 'none';
      el.singleViewScroll.style.display = 'none';
      var encounters = visibleEncounters();
      var members = filteredMembers();
      renderMatrixHead(members);
      renderMatrixBody(encounters, members);
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

    left = Math.max(4, Math.min(left, window.innerWidth - t.width - 4));
    top = Math.max(4, Math.min(top, window.innerHeight - t.height - 4));

    el.tooltip.style.left = left + 'px';
    el.tooltip.style.top = top + 'px';
  }

  function hideTooltip() {
    el.tooltip.classList.remove('is-visible');
    el.tooltip.setAttribute('aria-hidden', 'true');
  }

  el.mainContent.addEventListener('mouseover', function (e) {
    var cell = e.target.closest ? e.target.closest('.cell') : null;
    if (cell && !cell.classList.contains('is-empty')) showTooltip(cell);
  });
  el.mainContent.addEventListener('mouseout', function (e) {
    var cell = e.target.closest ? e.target.closest('.cell') : null;
    if (cell) hideTooltip();
  });

  // ---------------------------------------------------------------- custom dropdown & event listeners

  function closeAllMenus() {
    document.querySelectorAll('.custom-dropdown.is-open').forEach(function (d) {
      d.classList.remove('is-open');
    });
  }

  function setupCustomDropdown(btnEl, menuEl, onSelect) {
    if (!btnEl || !menuEl) return;
    var dropdown = btnEl.closest('.custom-dropdown');

    btnEl.addEventListener('click', function (e) {
      e.stopPropagation();
      var isOpen = dropdown.classList.contains('is-open');
      closeAllMenus();
      if (!isOpen) dropdown.classList.add('is-open');
    });

    menuEl.addEventListener('click', function (e) {
      var opt = e.target.closest ? e.target.closest('.dropdown-option') : null;
      if (!opt) return;
      e.stopPropagation();
      var val = opt.getAttribute('data-value');

      Array.prototype.forEach.call(menuEl.querySelectorAll('.dropdown-option'), function (o) {
        o.classList.toggle('is-selected', o === opt);
      });

      dropdown.classList.remove('is-open');
      if (onSelect) onSelect(val, opt.textContent.trim());
    });
  }

  setupCustomDropdown(el.jobDropdownBtn, el.jobDropdownMenu, function (val) {
    state.jobFilter = val;
    el.jobDropdownLabel.textContent = '職業: ' + (val === 'ALL' ? '全部' : val);
    render();
  });

  setupCustomDropdown(el.metricDropdownBtn, el.metricDropdownMenu, function (val) {
    state.metric = val;
    var shortLabel = val === 'perf' ? 'Perf %' : val.toUpperCase();
    el.metricDropdownLabel.textContent = '指標: ' + shortLabel;
    render();
  });

  setupCustomDropdown(el.partitionDropdownBtn, el.partitionDropdownMenu, function (val, text) {
    state.partition = val;
    el.partitionDropdownLabel.textContent = text;
    loadAll(false);
  });

  setupCustomDropdown(el.statEncounterBtn, el.statEncounterMenu, function (val, text) {
    state.selectedStatEncounterKey = val;
    el.statEncounterLabel.textContent = text.split(' - ').pop();
    renderStatLayout();
  });

  setupCustomDropdown(el.partyListBtn, el.partyMembersMenu, null);
  el.partyMembersMenu.addEventListener('click', function (e) {
    var row = e.target.closest ? e.target.closest('.popover-row') : null;
    if (!row) return;
    var name = row.getAttribute('data-name');
    if (name) {
      state.selectedCharName = name;
      state.viewMode = 'single';
      closeAllMenus();
      render();
    }
  });

  document.addEventListener('click', function (e) {
    if (!e.target.closest('.custom-dropdown')) closeAllMenus();
  });

  // View Mode Switcher
  el.btnPartyView.addEventListener('click', function () {
    state.viewMode = 'party';
    render();
  });
  el.btnSingleView.addEventListener('click', function () {
    state.viewMode = 'single';
    if (!state.selectedCharName && state.members.length > 0) {
      state.selectedCharName = state.members[0].name;
    }
    render();
  });

  el.btnEncounterLayout.addEventListener('click', function () {
    state.partyLayout = 'encounter';
    render();
  });
  el.btnStatLayout.addEventListener('click', function () {
    state.partyLayout = 'stat';
    render();
  });

  el.btnBackToParty.addEventListener('click', function () {
    state.viewMode = 'party';
    render();
  });

  el.mainContent.addEventListener('click', function (e) {
    var memberEl = e.target.closest ? (e.target.closest('.member') || e.target.closest('.member-row') || e.target.closest('.member-col')) : null;
    if (memberEl) {
      var name = memberEl.getAttribute('data-name');
      if (name) {
        state.selectedCharName = name;
        state.viewMode = 'single';
        render();
      }
    }
  });

  el.timeframeBtn.addEventListener('click', function () {
    state.timeframe = state.timeframe === 'historical' ? 'today' : 'historical';
    loadAll(false);
  });

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

  el.refreshBtn.addEventListener('click', function (e) { loadAll(e.ctrlKey); });

  el.collapseBtn.addEventListener('click', function () { setCollapsed(!state.collapsed); });

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

    if (changed) {
      // A new/changed roster is worth surfacing even if the user collapsed the overlay earlier.
      if (state.collapsed && members.length > 0) setCollapsed(false);
      loadAll(false);
    } else {
      render();
    }
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
    }).catch(function () { /* fallback event push */ });
  }

  /**
   * Browser preview: fixed 8-person roster to exercise party, stat, and single view.
   */
  function enablePreview(reason) {
    state.preview = true;
    el.statusDot.classList.add('is-preview');
    el.statusDot.title = reason || '預覽模式';
    state.members = [
      { name: '加加財富鳥', world: '利維坦', jobName: 'RDM', jobRole: 'DPS', groupIndex: 0 },
      { name: '我不是洗ㄅㄚ', world: '利維坦', jobName: 'AST', jobRole: 'Healer', groupIndex: 0 },
      { name: 'Alpha Shield', world: 'Asura', jobName: 'PLD', jobRole: 'Tank', groupIndex: 0 },
      { name: 'Titan Defender', world: 'Titan', jobName: 'GNB', jobRole: 'Tank', groupIndex: 0 },
      { name: 'Sage Master', world: 'Anima', jobName: 'SGE', jobRole: 'Healer', groupIndex: 0 },
      { name: 'Shadow Reaper', world: 'Belias', jobName: 'RPR', jobRole: 'DPS', groupIndex: 0 },
      { name: 'Viper Blade', world: 'Chocobo', jobName: 'VPR', jobRole: 'DPS', groupIndex: 0 },
      { name: 'Star Dancer', world: 'Pandaemonium', jobName: 'DNC', jobRole: 'DPS', groupIndex: 0 }
    ];
    loadAll(false);
  }

  // ---------------------------------------------------------------- boot

  function injectStaticIcons() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-icon]'), function (node) {
      var size = node.getAttribute('data-icon-size') || 14;
      node.innerHTML = icon(node.getAttribute('data-icon'), Number(size));
    });
  }

  injectStaticIcons();

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

  try {
    state.collapsed = localStorage.getItem(CACHE_PREFIX + 'collapsed') === '1';
  } catch (e) { /* ignore */ }
  applyCollapse();

  render();
  loadEncounters().then(render).catch(function () { /* fallback */ });
  initOverlayEvents();
})();
