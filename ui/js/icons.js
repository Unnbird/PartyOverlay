/**
 * Inline lucide-style line icon set (24x24, stroke-based).
 * Kept dependency-free so the overlay stays a static HTML page for OverlayPlugin -
 * matches the icon language used by FF14MarketOverlay (lucide-react).
 */
(function () {
  'use strict';

  var PATHS = {
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
    heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    swords: '<path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="M13 19l6-6"/><path d="M16 16l4 4"/><path d="M19 21l2-2"/><path d="M9.5 6.5 21 18v3h-3L6.5 9.5"/><path d="M17 5l-4 4"/><path d="M8 8l-4-4"/><path d="M5 3 3 5"/>',
    trendingUp: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
    refreshCw: '<path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/>',
    chevronDown: '<polyline points="6 9 12 15 18 9"/>',
    minimize2: '<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" x2="21" y1="10" y2="3"/><line x1="3" x2="10" y1="21" y2="14"/>',
    maximize2: '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/>',
    wifi: '<path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" x2="12.01" y1="20" y2="20"/>',
    wifiOff: '<line x1="2" x2="22" y1="2" y2="22"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M2 8.82a15 15 0 0 1 4.17-2.65"/><path d="M10.66 5c4.01-.36 8.14.9 11.34 3.76"/><path d="M16.85 11.25a10 10 0 0 1 2.22 1.68"/><path d="M5 13a10 10 0 0 1 5.24-2.76"/><line x1="12" x2="12.01" y1="20" y2="20"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
    crown: '<path d="m2 4 3 12h14l3-12-6 7-4-7-4 7Z"/><path d="M5 20h14"/>',
    x: '<path d="M18 6 6 18"/><path d="M6 6l12 12"/>',
    arrowLeft: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    layoutGrid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
    barChart: '<line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/>',
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>'
  };

  var JOB_NAMES = {
    PLD: 'Paladin', Paladin: 'Paladin',
    WAR: 'Warrior', Warrior: 'Warrior',
    DRK: 'DarkKnight', DarkKnight: 'DarkKnight',
    GNB: 'Gunbreaker', Gunbreaker: 'Gunbreaker',
    WHM: 'WhiteMage', WhiteMage: 'WhiteMage',
    SCH: 'Scholar', Scholar: 'Scholar',
    AST: 'Astrologian', Astrologian: 'Astrologian',
    SGE: 'Sage', Sage: 'Sage',
    MNK: 'Monk', Monk: 'Monk',
    DRG: 'Dragoon', Dragoon: 'Dragoon',
    NIN: 'Ninja', Ninja: 'Ninja',
    SAM: 'Samurai', Samurai: 'Samurai',
    RPR: 'Reaper', Reaper: 'Reaper',
    VPR: 'Viper', Viper: 'Viper',
    BRD: 'Bard', Bard: 'Bard',
    MCH: 'Machinist', Machinist: 'Machinist',
    DNC: 'Dancer', Dancer: 'Dancer',
    BLM: 'BlackMage', BlackMage: 'BlackMage',
    SMN: 'Summoner', Summoner: 'Summoner',
    RDM: 'RedMage', RedMage: 'RedMage',
    PCT: 'Pictomancer', Pictomancer: 'Pictomancer',
    BLU: 'BlueMage', BlueMage: 'BlueMage'
  };

  // Traditional-Chinese job labels, keyed by the abbreviation the plugin sends
  // (kept aligned with WorldJobData.JobMap on the C# side). Base classes and
  // DoH/DoL are here too: a member can be on one when the party forms.
  var JOB_ZH = {
    ADV: '冒險者',
    GLA: '劍術師', PGL: '格鬥家', MRD: '斧術師', LNC: '槍術師', ARC: '弓箭手',
    CNJ: '幻術師', THM: '咒術師', ACN: '秘術師', ROG: '雙劍師',
    CRP: '刻木匠', BSM: '鍛鐵匠', ARM: '鎧甲匠', GSM: '雕金匠', LTW: '製革匠',
    WVR: '裁縫匠', ALC: '鍊金術士', CUL: '烹調師', MIN: '採礦工', BTN: '園藝工', FSH: '捕魚人',
    PLD: '騎士', WAR: '戰士', DRK: '暗黑騎士', GNB: '絕槍戰士',
    WHM: '白魔道士', SCH: '學者', AST: '占星術士', SGE: '賢者',
    MNK: '武僧', DRG: '龍騎士', NIN: '忍者', SAM: '武士', RPR: '奪魂者', VPR: '毒蛇劍士',
    BRD: '吟遊詩人', MCH: '機工士', DNC: '舞者',
    BLM: '黑魔道士', SMN: '召喚師', RDM: '赤魔道士', PCT: '繪靈法師', BLU: '青魔道士'
  };

  // FFLogs reports jobs by full English name ("Paladin"), so alias those onto the
  // same labels rather than maintaining a second table.
  Object.keys(JOB_NAMES).forEach(function (key) {
    var zh = JOB_ZH[key.toUpperCase()];
    if (zh) JOB_ZH[JOB_NAMES[key]] = zh;
  });

  var ROLE_ZH = {
    Tank: '坦克', Healer: '治療', DPS: '輸出',
    Crafter: '工匠', Gatherer: '採集', Unknown: '未知'
  };

  function jobLabel(jobKey) {
    var key = String(jobKey || '').trim();
    if (!key) return JOB_ZH.ADV;
    return JOB_ZH[key.toUpperCase()] || JOB_ZH[key] || key;
  }

  function roleLabel(roleKey) {
    var key = String(roleKey || '').trim();
    return ROLE_ZH[key] || key || ROLE_ZH.Unknown;
  }

  var JOB_PATHS = {
    PLD: '<path d="M12 2L4 6v6c0 5.5 3.8 10.7 8 12 4.2-1.3 8-6.5 8-12V6l-8-4zm0 4l4 3h-3v7h-2V9H8l4-3z"/>',
    WAR: '<path d="M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2"/>',
    DRK: '<path d="M12 2v14M9 5l3-3 3 3M7 16h10M12 16v6"/>',
    GNB: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18M8 8l8 8M16 8l-8 8"/>',
    WHM: '<path d="M12 2a5 5 0 0 0-5 5c0 4 5 11 5 11s5-7 5-11a5 5 0 0 0-5-5zm0 7a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/>',
    SCH: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5z"/><path d="M6 6h10M6 10h10"/>',
    AST: '<circle cx="12" cy="12" r="9"/><polygon points="12 2 15 9 22 12 15 15 12 22 9 15 2 12 9 9 12 2"/>',
    SGE: '<path d="M6 3l6 6 6-6M6 21l6-6 6 6M3 12h18"/>',
    MNK: '<path d="M6 4v16M12 2v20M18 4v16"/>',
    DRG: '<path d="M12 2l3 6-3 14-3-14 3-6zM5 8l14 8M19 8L5 16"/>',
    NIN: '<polygon points="12 2 22 12 12 22 2 12 12 2"/><polygon points="12 7 17 12 12 17 7 12 12 7"/>',
    SAM: '<path d="M4 20L20 4M8 20l12-12M4 16L16 4"/>',
    RPR: '<path d="M18 3c-5 0-9 4-9 9v9M9 7l9-4"/>',
    VPR: '<path d="M7 3l10 18M17 3L7 21"/>',
    BRD: '<path d="M12 3c-5 0-9 4-9 9s4 9 9 9M12 3v18M16 7l-4 5 4 5"/>',
    MCH: '<rect x="5" y="5" width="14" height="14" rx="2"/><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    DNC: '<circle cx="8" cy="12" r="5"/><circle cx="16" cy="12" r="5"/>',
    BLM: '<polygon points="12 2 15 8 21 9 17 14 18 21 12 17 6 21 7 14 3 9 9 8 12 2"/>',
    SMN: '<path d="M12 2L4 20h16L12 2zm0 6l4 8H8l4-8z"/>',
    RDM: '<path d="M12 2l8 10-8 10-8-10 8-10zM12 6v12M6 12h12"/>',
    PCT: '<path d="M18.37 2.63a2.12 2.12 0 0 1 3 3L8.5 18.5l-5 1.5 1.5-5L18.37 2.63z"/>',
    BLU: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7zm10 4a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/>',
    ADV: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>'
  };

  function svg(name, size) {
    var body = PATHS[name];
    if (!body) return '';
    var s = size || 16;
    return '<svg class="icon icon-' + name + '" width="' + s + '" height="' + s +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
  }

  function jobSvg(jobKey, size) {
    var key = String(jobKey || 'ADV').toUpperCase();
    var body = JOB_PATHS[key] || JOB_PATHS.ADV;
    var s = size || 16;
    return '<svg class="icon icon-job icon-job-' + key.toLowerCase() + '" width="' + s + '" height="' + s +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
  }

  function jobIcon(jobKey, size) {
    var key = String(jobKey || 'ADV').trim();
    var upper = key.toUpperCase();
    var fullName = JOB_NAMES[upper] || JOB_NAMES[key] || key;
    var s = size || 16;

    if (fullName && fullName !== 'ADV') {
      var localUrl = 'icons/jobs/' + fullName + '.png';
      var fallbackSvg = jobSvg(upper, s).replace(/"/g, '&quot;');
      return '<img class="job-icon-img" src="' + localUrl + '" width="' + s + '" height="' + s +
        '" alt="' + upper + '" title="' + upper + '" onerror="this.outerHTML=this.getAttribute(\'data-fallback\')" data-fallback="' + fallbackSvg + '" />';
    }

    return jobSvg(upper, s);
  }

  window.PartyOverlayIcons = {
    svg: svg, jobIcon: jobIcon, jobSvg: jobSvg,
    jobLabel: jobLabel, roleLabel: roleLabel
  };
})();
