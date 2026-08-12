/**
 * PartyOverlay Frontend JS Engine
 * Handles OverlayPlugin event subscription and dynamic DOM rendering.
 */

(function () {
  'use strict';

  // DOM Elements
  const partyGridEl = document.getElementById('partyGrid');
  const emptyStateEl = document.getElementById('emptyState');
  const emptyTextEl = document.getElementById('emptyText');
  const emptyDiagnosticEl = document.getElementById('emptyDiagnostic');
  const partyTitleEl = document.getElementById('partyTitle');
  const partyBadgeEl = document.getElementById('partyBadge');
  const toggleMockBtn = document.getElementById('toggleMockBtn');
  const statusIndicatorEl = document.getElementById('statusIndicator');

  // How long we wait for the plugin to answer before assuming we run in a plain browser.
  const HANDSHAKE_TIMEOUT_MS = 15000;

  let isMocking = false;
  let isConnected = false;

  // Mock Cross-Realm Party Data for Demonstration & Browser Testing
  const mockPartyData = {
    partyType: 'CrossRealmParty',
    partyId: 'CR-1042-9981',
    leaderIndex: 0,
    memberCount: 8,
    isCrossRealm: true,
    members: [
      { name: 'Alpha Leader', jobId: 19, jobName: 'PLD', jobRole: 'Tank', level: 100, homeWorldName: 'Asura', isLeader: true, isCrossRealm: false },
      { name: 'Iron Shield', jobId: 37, jobName: 'GNB', jobRole: 'Tank', level: 100, homeWorldName: 'Titan', isLeader: false, isCrossRealm: true },
      { name: 'Light Healer', jobId: 24, jobName: 'WHM', jobRole: 'Healer', level: 100, homeWorldName: 'Anima', isLeader: false, isCrossRealm: true },
      { name: 'Sage Master', jobId: 40, jobName: 'SGE', jobRole: 'Healer', level: 100, homeWorldName: 'Asura', isLeader: false, isCrossRealm: false },
      { name: 'Shadow Reaper', jobId: 39, jobName: 'RPR', jobRole: 'DPS', level: 100, homeWorldName: 'Belias', isLeader: false, isCrossRealm: true },
      { name: 'Viper Blade', jobId: 41, jobName: 'VPR', jobRole: 'DPS', level: 100, homeWorldName: 'Asura', isLeader: false, isCrossRealm: false },
      { name: 'Pictomancer', jobId: 42, jobName: 'PCT', jobRole: 'DPS', level: 100, homeWorldName: 'Chocobo', isLeader: false, isCrossRealm: true },
      { name: 'Dancer Star', jobId: 38, jobName: 'DNC', jobRole: 'DPS', level: 100, homeWorldName: 'Asura', isLeader: false, isCrossRealm: false }
    ]
  };

  /**
   * Render Party Members into the UI
   */
  function renderParty(data) {
    if (!data || !data.members || data.members.length === 0) {
      partyGridEl.innerHTML = '';
      emptyStateEl.classList.remove('hidden');
      emptyTextEl.textContent = isConnected ? '目前未加入隊伍' : '等待 OverlayPlugin 連線...';
      // Surface why we have no data instead of silently showing an empty list.
      emptyDiagnosticEl.textContent = (data && data.diagnostic) ? data.diagnostic : '等待組隊邀請或搜尋隊伍中...';
      partyBadgeEl.textContent = '未組隊';
      partyBadgeEl.className = 'party-badge';
      return;
    }

    emptyStateEl.classList.add('hidden');

    // Update Header Badge
    const isCross = data.isCrossRealm || data.partyType === 'CrossRealmParty';
    const isAlliance = data.partyType === 'Alliance';
    partyBadgeEl.textContent = isCross ? `跨服 ${data.members.length}人`
      : isAlliance ? `團隊 ${data.members.length}人`
      : `隊伍 ${data.members.length}人`;
    partyBadgeEl.className = `party-badge ${isCross ? 'cross-realm' : ''}`;
    // Hovering the badge shows where the data came from (InfoProxyCrossRealm / GroupManager).
    partyBadgeEl.title = [data.source, data.diagnostic].filter(Boolean).join(' | ');
    partyTitleEl.textContent = isCross ? '跨服隊伍 (Cross-Realm Party)'
      : isAlliance ? '團隊列表 (Alliance)'
      : '隊伍成員 (Party Members)';

    // Build Cards HTML
    partyGridEl.innerHTML = data.members.map((m) => {
      const role = m.jobRole || 'DPS';
      const worldTag = m.homeWorldName ? `@${m.homeWorldName}` : '';
      const groupTag = m.groupIndex > 0 ? String.fromCharCode(65 + m.groupIndex) : '';

      return `
        <div class="member-card" data-role="${escapeHtml(role)}">
          <div class="job-badge" title="${escapeHtml(role)}">${escapeHtml(m.jobName || 'ADV')}</div>
          <div class="member-info">
            <div class="name-row">
              <span class="member-name">
                ${escapeHtml(m.name)}
                ${m.isLeader ? '<span class="leader-icon" title="隊長">👑</span>' : ''}
              </span>
              <span class="world-tag ${m.isCrossRealm ? 'cross-world' : ''}">${escapeHtml(worldTag)}</span>
            </div>
            <div class="detail-row">
              <span class="level-text">Lv.${m.level || 0}</span>
              <span>•</span>
              <span>${escapeHtml(role)}</span>
              ${groupTag ? `<span>•</span><span>Group ${groupTag}</span>` : ''}
              ${m.inCurrentZone === false ? '<span>•</span><span title="不在同一區域">區域外</span>' : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  function escapeHtml(str) {
    if (str === undefined || str === null) return '';
    return String(str).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
    });
  }

  /**
   * Register OverlayPlugin API Listeners.
   *
   * We never guess the environment from `window.OverlayPluginApi`: in the CEF overlay that binding
   * can still be missing at DOMContentLoaded, which used to make the overlay drop into Mock Mode
   * forever. common.js queues our calls until the API (or websocket) is ready, so we just call the
   * plugin and see whether it answers.
   */
  function initOverlayEvents() {
    if (!window.addOverlayListener || !window.callOverlayHandler) {
      console.error('common.js was not loaded; no OverlayPlugin API available.');
      enableMockMode();
      return;
    }

    window.addOverlayListener('onPartyOverlayUpdate', (e) => {
      onConnected();
      if (!isMocking) renderParty(e && e.detail ? e.detail : e);
    });

    window.addOverlayListener('onCrossRealmPartyChanged', (e) => {
      onConnected();
      if (!isMocking) renderParty(e && e.detail ? e.detail : e);
    });

    window.startOverlayEvents();

    // Handshake: whichever answers first wins.
    let settled = false;
    const timer = setTimeout(() => {
      if (settled || isConnected) return;
      settled = true;
      console.log('No response from OverlayPlugin; assuming standalone browser preview.');
      enableMockMode();
    }, HANDSHAKE_TIMEOUT_MS);

    window.callOverlayHandler({ call: 'getPartyOverlayData' })
      .then((data) => {
        if (settled && isMocking) return;
        settled = true;
        clearTimeout(timer);
        onConnected();
        if (!isMocking) renderParty(data);
      })
      .catch((err) => {
        console.log('getPartyOverlayData failed: ', err);
      });
  }

  function onConnected() {
    if (isConnected) return;
    isConnected = true;
    statusIndicatorEl.classList.add('online');
    console.log('OverlayPlugin API connected successfully.');
  }

  function enableMockMode() {
    isMocking = true;
    toggleMockBtn.style.background = 'rgba(6, 182, 212, 0.3)';
    toggleMockBtn.style.borderColor = '#06b6d4';
    renderParty(mockPartyData);
  }

  function disableMockMode() {
    isMocking = false;
    toggleMockBtn.style.background = 'rgba(255, 255, 255, 0.1)';
    toggleMockBtn.style.borderColor = 'var(--border-glass)';

    if (window.callOverlayHandler) {
      window.callOverlayHandler({ call: 'getPartyOverlayData' })
        .then((data) => {
          onConnected();
          renderParty(data);
        })
        .catch(() => renderParty(null));
    } else {
      renderParty(null);
    }
  }

  toggleMockBtn.addEventListener('click', () => {
    if (isMocking) {
      disableMockMode();
    } else {
      enableMockMode();
    }
  });

  renderParty(null);
  initOverlayEvents();
})();
