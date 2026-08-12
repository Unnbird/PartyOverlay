/**
 * PartyOverlay - 隊伍成員 (roster card overlay)
 *
 * OverlayPlugin wiring (handshake + auto preview fallback) follows the same
 * pattern as ui/js/pr.js / uiold/js/pr.js.
 */

(function () {
  'use strict';

  var CACHE_PREFIX = 'partyoverlay.roster.';
  var HANDSHAKE_TIMEOUT_MS = 15000;

  var el = {
    root: document.getElementById('app'),
    partyGrid: document.getElementById('partyGrid'),
    emptyState: document.getElementById('emptyState'),
    emptyText: document.getElementById('emptyText'),
    emptyDiagnostic: document.getElementById('emptyDiagnostic'),
    partyTitle: document.getElementById('partyTitle'),
    partyBadge: document.getElementById('partyBadge'),
    statusIndicator: document.getElementById('statusIndicator'),
    collapseBtn: document.getElementById('collapseBtn')
  };

  var state = {
    connected: false,
    preview: false,
    collapsed: false
  };

  function icon(name, size) {
    return window.PartyOverlayIcons ? window.PartyOverlayIcons.svg(name, size) : '';
  }

  function escapeHtml(str) {
    if (str === undefined || str === null) return '';
    return String(str).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
    });
  }

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

  function renderParty(data) {
    if (!data || !data.members || data.members.length === 0) {
      el.partyGrid.innerHTML = '';
      el.emptyState.classList.add('is-visible');
      el.emptyText.textContent = state.connected ? '目前未加入隊伍' : '等待 OverlayPlugin 連線...';
      el.emptyDiagnostic.textContent = (data && data.diagnostic) ? data.diagnostic : '等待組隊邀請或搜尋隊伍中...';
      el.partyBadge.textContent = '未組隊';
      el.partyBadge.className = 'badge';
      return;
    }

    if (data.members.length > 0 && state.collapsed) setCollapsed(false);

    el.emptyState.classList.remove('is-visible');

    var isCross = data.isCrossRealm || data.partyType === 'CrossRealmParty';
    var isAlliance = data.partyType === 'Alliance';

    el.partyBadge.textContent = isCross ? '跨服 ' + data.members.length + ' 人'
      : isAlliance ? '團隊 ' + data.members.length + ' 人'
      : '隊伍 ' + data.members.length + ' 人';
    el.partyBadge.className = 'badge' + (isCross ? ' cross-realm' : isAlliance ? ' alliance' : '');
    el.partyBadge.title = [data.source, data.diagnostic].filter(Boolean).join(' | ');
    el.partyTitle.textContent = isCross ? '跨服隊伍 (Cross-Realm Party)'
      : isAlliance ? '團隊列表 (Alliance)'
      : '隊伍成員 (Party Members)';

    el.partyGrid.innerHTML = data.members.map(function (m) {
      var role = m.jobRole || 'DPS';
      var worldTag = m.homeWorldName ? '@' + m.homeWorldName : '';
      var groupTag = m.groupIndex > 0 ? String.fromCharCode(65 + m.groupIndex) : '';

      return '' +
        '<div class="member-row" data-role="' + escapeHtml(role) + '">' +
          '<span class="job-badge" data-role="' + escapeHtml(role) + '" title="' + escapeHtml(role) + '">' + escapeHtml(m.jobName || 'ADV') + '</span>' +
          '<div class="member-info">' +
            '<div class="name-row">' +
              '<span class="member-name">' +
                escapeHtml(m.name) +
                (m.isLeader ? '<span class="leader-icon" title="隊長">' + icon('crown', 12) + '</span>' : '') +
              '</span>' +
              '<span class="world-tag' + (m.isCrossRealm ? ' cross-world' : '') + '">' + escapeHtml(worldTag) + '</span>' +
            '</div>' +
            '<div class="detail-row">' +
              '<span class="level-text">Lv.' + (m.level || 0) + '</span>' +
              '<span>·</span>' +
              '<span>' + escapeHtml(role) + '</span>' +
              (groupTag ? '<span>·</span><span>Group ' + groupTag + '</span>' : '') +
              (m.inCurrentZone === false ? '<span>·</span><span title="不在同一區域">區域外</span>' : '') +
            '</div>' +
          '</div>' +
        '</div>';
    }).join('');
  }

  function onConnected() {
    if (state.connected) return;
    state.connected = true;
    el.statusIndicator.classList.add('is-online');
  }

  function initOverlayEvents() {
    if (!window.addOverlayListener || !window.callOverlayHandler) {
      enablePreview('common.js 未載入');
      return;
    }

    window.addOverlayListener('onPartyOverlayUpdate', function (e) {
      onConnected();
      if (!state.preview) renderParty(e && e.detail ? e.detail : e);
    });

    window.addOverlayListener('onCrossRealmPartyChanged', function (e) {
      onConnected();
      if (!state.preview) renderParty(e && e.detail ? e.detail : e);
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
      renderParty(data);
    }).catch(function () { /* fallback event push */ });
  }

  /**
   * Browser preview: fixed cross-realm roster to exercise the card layout.
   */
  function enablePreview(reason) {
    state.preview = true;
    el.statusIndicator.classList.add('is-preview');
    el.statusIndicator.title = reason || '預覽模式';
    renderParty({
      partyType: 'CrossRealmParty',
      isCrossRealm: true,
      members: [
        { name: 'Alpha Leader', jobName: 'PLD', jobRole: 'Tank', level: 100, homeWorldName: 'Asura', isLeader: true, isCrossRealm: false },
        { name: 'Iron Shield', jobName: 'GNB', jobRole: 'Tank', level: 100, homeWorldName: 'Titan', isLeader: false, isCrossRealm: true },
        { name: 'Light Healer', jobName: 'WHM', jobRole: 'Healer', level: 100, homeWorldName: 'Anima', isLeader: false, isCrossRealm: true },
        { name: 'Sage Master', jobName: 'SGE', jobRole: 'Healer', level: 100, homeWorldName: 'Asura', isLeader: false, isCrossRealm: false },
        { name: 'Shadow Reaper', jobName: 'RPR', jobRole: 'DPS', level: 100, homeWorldName: 'Belias', isLeader: false, isCrossRealm: true },
        { name: 'Viper Blade', jobName: 'VPR', jobRole: 'DPS', level: 100, homeWorldName: 'Asura', isLeader: false, isCrossRealm: false },
        { name: 'Pictomancer', jobName: 'PCT', jobRole: 'DPS', level: 100, homeWorldName: 'Chocobo', isLeader: false, isCrossRealm: true },
        { name: 'Dancer Star', jobName: 'DNC', jobRole: 'DPS', level: 100, homeWorldName: 'Asura', isLeader: false, isCrossRealm: false }
      ]
    });
  }

  el.collapseBtn.addEventListener('click', function () { setCollapsed(!state.collapsed); });

  Array.prototype.forEach.call(document.querySelectorAll('[data-icon]'), function (node) {
    var size = node.getAttribute('data-icon-size') || 14;
    node.innerHTML = icon(node.getAttribute('data-icon'), Number(size));
  });

  try {
    state.collapsed = localStorage.getItem(CACHE_PREFIX + 'collapsed') === '1';
  } catch (e) { /* ignore */ }
  applyCollapse();

  renderParty(null);
  initOverlayEvents();
})();
