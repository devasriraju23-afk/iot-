// script.js — Smart Door Security System frontend
// All buttons wired with addEventListener — no inline onclick dependencies

/* ════════════════════════════════════════════════════════════════
   ALARM SOUND  (Web Audio API — no external files needed)
════════════════════════════════════════════════════════════════ */
var AlarmAudio = {
  ctx:      null,   // AudioContext
  interval: null,   // repeating beep interval
  active:   false,

  // Initialise (or resume) the AudioContext.
  // Browsers block audio until the first user gesture, so we call this
  // inside the button-click handler — always after a user interaction.
  _getCtx: function() {
    if (!AlarmAudio.ctx) {
      AlarmAudio.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    // Safari / Chrome may suspend the context after a period of inactivity
    if (AlarmAudio.ctx.state === 'suspended') {
      AlarmAudio.ctx.resume();
    }
    return AlarmAudio.ctx;
  },

  // Rapid beeping — car alarm style (fast short sharp beeps)
  _beep: function() {
    var ctx    = AlarmAudio._getCtx();
    var now    = ctx.currentTime;
    var volume = 0.8;

    // ── Sharp square-wave beep ─────────────────────────────────
    var osc   = ctx.createOscillator();
    var gain  = ctx.createGain();
    osc.type  = 'square';
    osc.frequency.value = 1046;   // C6 — sharp, attention-grabbing pitch

    // Very fast attack + hard cut-off = "beep!" not "beeee"
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.005);  // 5 ms attack
    gain.gain.setValueAtTime(volume, now + 0.09);            // hold 90 ms
    gain.gain.linearRampToValueAtTime(0, now + 0.11);        // 20 ms release

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.12);
  },

  // Start repeating — fires every 180 ms for rapid-fire beeping
  start: function() {
    if (AlarmAudio.active) return;
    AlarmAudio.active = true;
    AlarmAudio._beep();
    AlarmAudio.interval = setInterval(function() {
      if (AlarmAudio.active) AlarmAudio._beep();
    }, 180);   // 180 ms gap = ~5.5 beeps per second
  },

  // Stop alarm — call on dismiss
  stop: function() {
    AlarmAudio.active = false;
    if (AlarmAudio.interval) {
      clearInterval(AlarmAudio.interval);
      AlarmAudio.interval = null;
    }
  },
};

/* ════════════════════════════════════════════════════════════════
   STATE
════════════════════════════════════════════════════════════════ */
var State = {
  user:            null,
  door:            null,
  relockTimer:     null,
  relockRemaining: 0,
  pollInterval:    null,
  currentSection:  'dashboard',
  activityPage:    0,
  activityLimit:   15,
  charts: { pie: null, bar: null, line: null },
};

/* ════════════════════════════════════════════════════════════════
   HELPERS
════════════════════════════════════════════════════════════════ */
function el(id) { return document.getElementById(id); }

function api(path, opts) {
  opts = opts || {};
  return fetch(path, {
    credentials: 'include',
    headers: Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {}),
    method:  opts.method  || 'GET',
    body:    opts.body    || undefined,
  }).then(function(res) {
    return res.json().catch(function() { return {}; }).then(function(data) {
      if (res.status === 401) {
        window.location.href = '/login.html';
        return Promise.reject(new Error('Unauthorized'));
      }
      return { ok: res.ok, status: res.status, data: data };
    });
  });
}

function formatDateTime(isoStr) {
  if (!isoStr) return '—';
  var str = isoStr.indexOf('T') >= 0 ? isoStr : isoStr.replace(' ', 'T');
  if (!str.endsWith('Z')) str += 'Z';
  var d = new Date(str);
  if (isNaN(d)) return isoStr;
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function timeAgo(isoStr) {
  var str = isoStr.indexOf('T') >= 0 ? isoStr : isoStr.replace(' ', 'T');
  if (!str.endsWith('Z')) str += 'Z';
  var d    = new Date(str);
  if (isNaN(d)) return isoStr;
  var secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs <  60)   return secs + 's ago';
  if (secs < 3600)  return Math.floor(secs / 60)   + 'm ago';
  if (secs < 86400) return Math.floor(secs / 3600)  + 'h ago';
  return Math.floor(secs / 86400) + 'd ago';
}

function showFeedback(id, msg, type) {
  var e = el(id);
  if (!e) return;
  e.textContent = msg;
  e.className   = 'action-feedback ' + (type || 'success');
  e.classList.remove('hidden');
  clearTimeout(e._timer);
  e._timer = setTimeout(function() { e.classList.add('hidden'); }, 4000);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function eventIcon(type) {
  var map = {
    unlock: 'fa-lock-open', lock: 'fa-lock', open: 'fa-door-open',
    close: 'fa-door-closed', unauthorized: 'fa-user-slash',
    alarm: 'fa-bell', login: 'fa-right-to-bracket',
    logout: 'fa-right-from-bracket', settings: 'fa-gear',
  };
  return map[type] || 'fa-circle';
}

/* ════════════════════════════════════════════════════════════════
   LIVE CLOCK
════════════════════════════════════════════════════════════════ */
function startClock() {
  function tick() {
    var e = el('topbarClock');
    if (e) e.textContent = new Date().toLocaleTimeString();
  }
  tick();
  setInterval(tick, 1000);
}

/* ════════════════════════════════════════════════════════════════
   AUTH GUARD
════════════════════════════════════════════════════════════════ */
function authGuard() {
  return api('/api/auth/me').catch(function() {
    return { ok: false, data: {} };
  }).then(function(r) {
    if (!r.ok || !r.data.loggedIn) {
      window.location.href = '/login.html';
      return false;
    }
    State.user = { username: r.data.username, role: r.data.role };
    return true;
  });
}

/* ════════════════════════════════════════════════════════════════
   LOGOUT
════════════════════════════════════════════════════════════════ */
function logout() {
  api('/api/auth/logout', { method: 'POST' }).catch(function() {}).then(function() {
    window.location.href = '/login.html';
  });
}

/* ════════════════════════════════════════════════════════════════
   NAVIGATION
════════════════════════════════════════════════════════════════ */
function navigateTo(section) {
  document.querySelectorAll('.section').forEach(function(s) { s.classList.remove('active'); });
  document.querySelectorAll('.nav-item').forEach(function(l) { l.classList.remove('active'); });

  var sec  = el('section-' + section);
  var link = document.querySelector('[data-section="' + section + '"]');
  if (sec)  sec.classList.add('active');
  if (link) link.classList.add('active');

  State.currentSection = section;

  var titles = {
    dashboard: 'Dashboard', door: 'Door Control', activity: 'Activity Log',
    analytics: 'Analytics', device: 'Device Status', settings: 'Settings',
  };
  var t = el('sectionTitle');
  if (t) t.textContent = titles[section] || section;

  if (section === 'activity')  loadActivity();
  if (section === 'analytics') loadCharts();
  if (section === 'device')    loadDeviceStatus();
  if (section === 'door')      updateDoorDetailView();
  if (section === 'settings')  loadSettings();
}

function toggleSidebar() {
  var sb = el('sidebar'), ov = el('sidebarOverlay');
  if (sb) sb.classList.toggle('open');
  if (ov) ov.classList.toggle('hidden');
}
function closeSidebar() {
  var sb = el('sidebar'), ov = el('sidebarOverlay');
  if (sb) sb.classList.remove('open');
  if (ov) ov.classList.add('hidden');
}

/* ════════════════════════════════════════════════════════════════
   INIT SIDEBAR — wires all nav + button events
════════════════════════════════════════════════════════════════ */
function initSidebar() {
  var u = el('sidebarUsername'), r = el('sidebarRole');
  var su = el('settingsUsername'), sr = el('settingsRole');
  if (u)  u.textContent  = State.user.username;
  if (r)  r.textContent  = State.user.role;
  if (su) su.textContent = State.user.username;
  if (sr) { sr.textContent = State.user.role; sr.className = 'badge badge-' + State.user.role; }

  // Sidebar nav links
  document.querySelectorAll('.nav-item').forEach(function(link) {
    link.addEventListener('click', function(e) {
      e.preventDefault();
      navigateTo(link.dataset.section);
      closeSidebar();
    });
  });

  // Sidebar toggle button
  var tog = el('sidebarToggle');
  if (tog) tog.addEventListener('click', toggleSidebar);

  // Sidebar overlay click
  var ov = el('sidebarOverlay');
  if (ov) ov.addEventListener('click', closeSidebar);

  // Logout button in sidebar
  var lb = el('logoutBtn');
  if (lb) lb.addEventListener('click', logout);

  // ── Quick control buttons (Dashboard) ──────────────────────
  bindBtn('btnUnlock',  function() { doorAction('unlock'); });
  bindBtn('btnLock',    function() { doorAction('lock'); });
  bindBtn('btnOpen',    function() { doorAction('open'); });
  bindBtn('btnClose',   function() { doorAction('close'); });
  bindBtn('btnUnauth',  function() { doorAction('unauthorized'); });
  bindBtn('btnDismiss', function() { dismissAlarm(); });

  // ── Alarm overlay dismiss ───────────────────────────────────
  bindBtn('alarmDismissBtn',    function() { dismissAlarm(); });
  bindBtn('btnDismissAlerts',   function() { dismissAlarm(); });
  bindBtn('refreshActivityBtn', function() { loadActivity(); });

  // ── Topbar alarm indicator ──────────────────────────────────
  var ai = el('alarmIndicator');
  if (ai) ai.addEventListener('click', showAlarmOverlay);

  // ── Topbar refresh ──────────────────────────────────────────
  var rb = el('topbarRefreshBtn');
  if (rb) rb.addEventListener('click', refreshAll);

  // ── Sim banner close ────────────────────────────────────────
  var sbc = el('simBannerClose');
  if (sbc) sbc.addEventListener('click', function() {
    var sb = el('simBanner');
    if (sb) sb.style.display = 'none';
  });

  // ── Activity filters ────────────────────────────────────────
  var ft = el('filterType'),   fs = el('filterStatus');
  var cf = el('clearFiltersBtn');
  if (ft) ft.addEventListener('change', function() { State.activityPage = 0; loadActivity(); });
  if (fs) fs.addEventListener('change', function() { State.activityPage = 0; loadActivity(); });
  if (cf) cf.addEventListener('click',  function() { clearFilters(); });

  // ── Activity pagination ─────────────────────────────────────
  bindBtn('prevPage', function() { activityPage(-1); });
  bindBtn('nextPage', function() { activityPage(1); });

  // ── View All activity link ──────────────────────────────────
  var va = el('viewAllActivity');
  if (va) va.addEventListener('click', function(e) { e.preventDefault(); navigateTo('activity'); });

  // ── Door Control section action buttons ────────────────────
  bindBtn('doorBtnUnlock',  function() { doorAction('unlock'); });
  bindBtn('doorBtnLock',    function() { doorAction('lock'); });
  bindBtn('doorBtnOpen',    function() { doorAction('open'); });
  bindBtn('doorBtnClose',   function() { doorAction('close'); });
  bindBtn('doorBtnUnauth',  function() { doorAction('unauthorized'); });
  bindBtn('doorBtnDismiss', function() { dismissAlarm(); });

  // ── Settings save button ────────────────────────────────────
  bindBtn('saveRelockBtn', function() { saveRelockSetting(); });

  // ── Settings logout button ──────────────────────────────────
  bindBtn('settingsLogoutBtn', function() { logout(); });

  // ── Device refresh button ───────────────────────────────────
  bindBtn('deviceRefreshBtn', function() { loadDeviceStatus(); });
}

function bindBtn(id, fn) {
  var b = el(id);
  if (b) b.addEventListener('click', fn);
}

/* ════════════════════════════════════════════════════════════════
   ROLE-BASED ACCESS  (demo user = read-only)
════════════════════════════════════════════════════════════════ */
function applyRoleRestrictions() {
  if (!State.user || State.user.role === 'admin') return; // admin: full access

  // ── IDs of every action button the demo user cannot use ──────
  var restrictedBtns = [
    'btnUnlock', 'btnLock', 'btnOpen', 'btnClose', 'btnUnauth', 'btnDismiss',
    'doorBtnUnlock', 'doorBtnLock', 'doorBtnOpen', 'doorBtnClose',
    'doorBtnUnauth', 'doorBtnDismiss',
    'btnDismissAlerts', 'alarmDismissBtn',
    'saveRelockBtn',
  ];

  restrictedBtns.forEach(function(id) {
    var b = el(id);
    if (!b) return;
    b.disabled = true;
    b.title    = 'Admin access required';
    b.style.opacity = '0.45';
    b.style.cursor  = 'not-allowed';
  });

  // ── Add a "view-only" banner to the Quick Controls card ───────
  var qc = el('quickControlsCard');
  if (qc) {
    var banner = document.createElement('div');
    banner.className   = 'role-banner';
    banner.innerHTML   =
      '<i class="fa fa-lock"></i> ' +
      '<strong>View-Only Mode</strong> — You are logged in as <strong>demo</strong> (user role). ' +
      'Door controls are restricted to admin users.';
    qc.insertBefore(banner, qc.firstChild);
  }

  // ── Add same banner to Door Control section ───────────────────
  var dc = el('doorControlCard');
  if (dc) {
    var banner2 = document.createElement('div');
    banner2.className = 'role-banner';
    banner2.innerHTML =
      '<i class="fa fa-lock"></i> ' +
      '<strong>View-Only Mode</strong> — Door actions are restricted to admin users.';
    dc.insertBefore(banner2, dc.firstChild);
  }

  // ── Hide the relock setting row (demo cannot change settings) ─
  var saveRow = el('saveRelockBtn');
  if (saveRow) {
    var row = saveRow.closest('.setting-row');
    if (row) row.style.opacity = '0.4';
  }

  // ── Mark sidebar role badge ────────────────────────────────────
  var rb = el('sidebarRole');
  if (rb) rb.textContent = 'demo (view-only)';
}

/* ════════════════════════════════════════════════════════════════
   DOOR STATE — Fetch & Render
════════════════════════════════════════════════════════════════ */
function fetchDoorStatus() {
  return api('/api/door/status').then(function(r) {
    if (!r.ok) return;
    State.door = r.data;
    renderDoorState(r.data);
  });
}

function renderDoorState(state) {
  if (!state) return;
  var lock     = state.lock_status;
  var pos      = state.door_position;
  var alarmed  = state.alarm_active;

  // ── Door frame visual ───────────────────────────────────────
  var frame = el('doorFrame'), panel = el('doorPanel');
  var knob  = el('doorKnob'),  lockIconEl = el('lockIconEl');

  if (frame) {
    frame.classList.remove('unlocked', 'alarmed', 'open');
    if (alarmed)               frame.classList.add('alarmed');
    else if (lock === 'unlocked') frame.classList.add('unlocked');
    else if (pos  === 'open')     frame.classList.add('open');
  }
  if (panel) panel.classList.toggle('open', pos === 'open');
  if (knob)  knob.classList.toggle('unlocked', lock === 'unlocked');
  if (lockIconEl) lockIconEl.className = lock === 'unlocked' ? 'fa fa-lock-open' : 'fa fa-lock';

  // ── Status pills ────────────────────────────────────────────
  setPill('pillLock',     'pill-' + lock,
    lock === 'unlocked' ? 'fa fa-lock-open' : 'fa fa-lock',
    lock === 'unlocked' ? 'Unlocked' : 'Locked',
    'pillLockText');
  setPill('pillPosition', 'pill-' + pos,
    pos === 'open' ? 'fa fa-door-open' : 'fa fa-door-closed',
    pos === 'open' ? 'Open' : 'Closed',
    'pillPositionText');
  setPill('pillAlarm',    alarmed ? 'pill-alarm-on' : '',
    alarmed ? 'fa fa-bell' : 'fa fa-bell-slash',
    alarmed ? 'ALARM ON' : 'Alarm Off',
    'pillAlarmText');

  // ── Last updated ────────────────────────────────────────────
  var du = el('doorUpdatedAt');
  if (du) du.textContent = formatDateTime(state.updated_at);

  // ── Topbar alarm indicator ──────────────────────────────────
  var ai = el('alarmIndicator');
  if (ai) ai.classList.toggle('hidden', !alarmed);

  // Stop alarm sound if alarm is no longer active
  if (!alarmed) AlarmAudio.stop();

  // ── Alerts panel ────────────────────────────────────────────
  renderAlertsPanel(state);
  updateDoorDetailView();
}

function setPill(pillId, cls, iconClass, text, textId) {
  var p = el(pillId);
  if (!p) return;
  p.className = 'status-pill ' + cls;
  var i = p.querySelector('i');
  if (i) i.className = iconClass;
  var t = el(textId);
  if (t) t.textContent = text;
}

function updateDoorDetailView() {
  var state = State.door;
  if (!state) return;
  var dl = el('detailLock'), dp = el('detailPosition'), da = el('detailAlarm');
  var dr = el('detailRelock'), dud = el('detailUpdated');
  if (dl) dl.innerHTML = state.lock_status === 'unlocked'
    ? '<i class="fa fa-lock-open text-green"></i> Unlocked'
    : '<i class="fa fa-lock text-red"></i> Locked';
  if (dp) dp.innerHTML = state.door_position === 'open'
    ? '<i class="fa fa-door-open text-teal"></i> Open'
    : '<i class="fa fa-door-closed text-gray"></i> Closed';
  if (da) da.innerHTML = state.alarm_active
    ? '<i class="fa fa-bell text-red"></i> ACTIVE'
    : '<i class="fa fa-bell-slash text-green"></i> Off';
  if (dr)  dr.textContent  = state.auto_relock_sec + 's';
  if (dud) dud.textContent = formatDateTime(state.updated_at);
}

function renderAlertsPanel(state) {
  var panel = el('alertsPanel'), list = el('alertsList');
  if (!panel || !list) return;
  if (state.alarm_active) {
    panel.classList.add('alarm-active');
    list.innerHTML =
      '<div class="alert-item">' +
        '<div class="alert-item-icon"><i class="fa fa-triangle-exclamation"></i></div>' +
        '<div class="alert-item-body">' +
          '<div class="alert-item-title">🚨 Security Alarm Active</div>' +
          '<div class="alert-item-desc">Unauthorized access attempt detected. Simulated alarm is sounding.</div>' +
          '<div class="alert-item-time">Just now — <em>This is a software simulation</em></div>' +
        '</div>' +
      '</div>';
  } else {
    panel.classList.remove('alarm-active');
    list.innerHTML = '<div class="no-alerts"><i class="fa fa-shield-check"></i> No active alerts. System is secure.</div>';
  }
}

/* ════════════════════════════════════════════════════════════════
   DOOR ACTIONS
════════════════════════════════════════════════════════════════ */
function doorAction(action) {
  // Block non-admin users
  if (State.user && State.user.role !== 'admin') {
    showFeedback('actionFeedback',  '✗ Admin access required to perform door actions.', 'error');
    showFeedback('actionFeedback2', '✗ Admin access required to perform door actions.', 'error');
    return;
  }
  var paths = {
    unlock:       '/api/door/unlock',
    lock:         '/api/door/lock',
    open:         '/api/door/open',
    close:        '/api/door/close',
    unauthorized: '/api/door/unauthorized',
  };
  var path = paths[action];
  if (!path) return;

  // Disable buttons during request
  document.querySelectorAll('.control-btn').forEach(function(b) { b.disabled = true; });

  api(path, { method: 'POST' }).then(function(r) {
    if (r.ok) {
      if (r.data.state) {
        State.door = r.data.state;
        renderDoorState(State.door);
      }
      var msg  = r.data.message || 'Action completed.';
      var type = action === 'unauthorized' ? 'warning' : 'success';
      showFeedback('actionFeedback',  '✓ ' + msg, type);
      showFeedback('actionFeedback2', '✓ ' + msg, type);

      if (action === 'unlock' && r.data.state) {
        startRelockCountdown(r.data.state.auto_relock_sec);
      }
      if (action === 'unauthorized') {
        showAlarmOverlay();
        AlarmAudio.start();   // play repeating wee-woo alarm sound
      }
      loadStats();
      loadRecentActivity();
    } else {
      var err = (r.data && r.data.error) ? r.data.error : 'Action failed.';
      showFeedback('actionFeedback',  '✗ ' + err, 'error');
      showFeedback('actionFeedback2', '✗ ' + err, 'error');
    }
  }).catch(function() {
    showFeedback('actionFeedback',  '✗ Network error. Please try again.', 'error');
    showFeedback('actionFeedback2', '✗ Network error. Please try again.', 'error');
  }).then(function() {
    document.querySelectorAll('.control-btn').forEach(function(b) { b.disabled = false; });
  });
}

function dismissAlarm() {
  AlarmAudio.stop();   // stop alarm sound immediately
  api('/api/door/dismiss-alarm', { method: 'POST' }).then(function(r) {
    if (r.ok) {
      if (r.data.state) { State.door = r.data.state; renderDoorState(State.door); }
      var ov = el('alarmOverlay');
      if (ov) ov.classList.add('hidden');
      showFeedback('actionFeedback',  '✓ Alarm dismissed.', 'success');
      showFeedback('actionFeedback2', '✓ Alarm dismissed.', 'success');
      loadRecentActivity();
    }
  });
}

function showAlarmOverlay() {
  var ov = el('alarmOverlay');
  if (ov) ov.classList.remove('hidden');
}

/* ── Auto-relock countdown ─────────────────────────────────── */
function startRelockCountdown(seconds) {
  if (State.relockTimer) { clearInterval(State.relockTimer); State.relockTimer = null; }
  State.relockRemaining = seconds;
  var cd = el('relockCountdown'), se = el('relockSecs');
  if (!cd || !se) return;
  cd.classList.remove('hidden');
  se.textContent = seconds;
  State.relockTimer = setInterval(function() {
    State.relockRemaining--;
    se.textContent = State.relockRemaining;
    if (State.relockRemaining <= 0) {
      clearInterval(State.relockTimer);
      State.relockTimer = null;
      cd.classList.add('hidden');
      setTimeout(fetchDoorStatus, 1200);
    }
  }, 1000);
}

/* ════════════════════════════════════════════════════════════════
   STATS
════════════════════════════════════════════════════════════════ */
function loadStats() {
  return api('/api/stats').then(function(r) {
    if (!r.ok) return;
    var d = r.data;
    var st = el('statTotal'),  ss = el('statSuccess');
    var sf = el('statFailed'), sa = el('statAlarms');
    if (st) st.textContent = d.total   != null ? d.total   : '0';
    if (ss) ss.textContent = d.success != null ? d.success : '0';
    if (sf) sf.textContent = d.failed  != null ? d.failed  : '0';
    if (sa) sa.textContent = d.alarms  != null ? d.alarms  : '0';
    if (State.currentSection === 'analytics') renderCharts(d);
    else State.latestStats = d;
  });
}

/* ════════════════════════════════════════════════════════════════
   RECENT ACTIVITY (mini table on dashboard)
════════════════════════════════════════════════════════════════ */
function loadRecentActivity() {
  return api('/api/activity?limit=8&offset=0').then(function(r) {
    if (!r.ok) return;
    var tbody = el('recentActivityBody');
    if (!tbody) return;
    var logs = r.data.logs || [];
    if (logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="loading-row">No activity yet.</td></tr>';
      return;
    }
    tbody.innerHTML = logs.map(function(log) {
      return '<tr>' +
        '<td>' + timeAgo(log.created_at) + '</td>' +
        '<td><span class="event-badge event-' + log.event_type + '">' +
          '<i class="fa ' + eventIcon(log.event_type) + '"></i> ' + log.event_type +
        '</span></td>' +
        '<td>' + escapeHtml(log.description) + '</td>' +
        '<td>' + escapeHtml(log.actor || '—') + '</td>' +
        '<td>' + (log.success
          ? '<span class="status-success"><i class="fa fa-check-circle"></i> Success</span>'
          : '<span class="status-failed"><i class="fa fa-times-circle"></i> Failed</span>') + '</td>' +
      '</tr>';
    }).join('');
  });
}

/* ════════════════════════════════════════════════════════════════
   FULL ACTIVITY LOG
════════════════════════════════════════════════════════════════ */
function loadActivity() {
  var type    = (el('filterType')    || {}).value || '';
  var success = (el('filterStatus')  || {}).value;
  if (success === undefined) success = '';
  var offset  = State.activityPage * State.activityLimit;

  var q = 'limit=' + State.activityLimit + '&offset=' + offset;
  if (type)    q += '&event_type=' + encodeURIComponent(type);
  if (success !== '') q += '&success=' + encodeURIComponent(success);

  api('/api/activity?' + q).then(function(r) {
    var tbody = el('fullActivityBody');
    if (!tbody) return;
    if (!r.ok) {
      tbody.innerHTML = '<tr><td colspan="6" class="loading-row">Error loading activity.</td></tr>';
      return;
    }
    var logs = r.data.logs || [];
    if (logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="loading-row">No matching activity found.</td></tr>';
      updatePagination(false); return;
    }
    tbody.innerHTML = logs.map(function(log, i) {
      return '<tr>' +
        '<td>' + (offset + i + 1) + '</td>' +
        '<td>' + formatDateTime(log.created_at) + '</td>' +
        '<td><span class="event-badge event-' + log.event_type + '">' +
          '<i class="fa ' + eventIcon(log.event_type) + '"></i> ' + log.event_type +
        '</span></td>' +
        '<td>' + escapeHtml(log.description) + '</td>' +
        '<td>' + escapeHtml(log.actor || '—') + '</td>' +
        '<td>' + (log.success
          ? '<span class="status-success"><i class="fa fa-check-circle"></i> Success</span>'
          : '<span class="status-failed"><i class="fa fa-times-circle"></i> Failed</span>') + '</td>' +
      '</tr>';
    }).join('');
    updatePagination(logs.length === State.activityLimit);
    var pi = el('pageInfo');
    if (pi) pi.textContent = 'Page ' + (State.activityPage + 1);
  });
}

function activityPage(dir) {
  var next = State.activityPage + dir;
  if (next < 0) return;
  State.activityPage = next;
  loadActivity();
}

function updatePagination(hasMore) {
  var prev = el('prevPage'), next = el('nextPage');
  if (prev) prev.disabled = State.activityPage === 0;
  if (next) next.disabled = !hasMore;
}

function clearFilters() {
  var ft = el('filterType'), fs = el('filterStatus');
  if (ft) ft.value = '';
  if (fs) fs.value = '';
  State.activityPage = 0;
  loadActivity();
}

/* ════════════════════════════════════════════════════════════════
   CHARTS
════════════════════════════════════════════════════════════════ */
function loadCharts() {
  return api('/api/stats').then(function(r) {
    if (r.ok) renderCharts(r.data);
  });
}

function renderCharts(data) {
  if (typeof Chart === 'undefined') return;
  Chart.defaults.color = '#8fa3c0';

  // Doughnut
  var pieCtx = el('pieChart');
  if (pieCtx) {
    if (State.charts.pie) State.charts.pie.destroy();
    State.charts.pie = new Chart(pieCtx, {
      type: 'doughnut',
      data: {
        labels: ['Successful', 'Failed'],
        datasets: [{ data: [data.success || 0, data.failed || 0],
          backgroundColor: ['rgba(34,197,94,0.8)', 'rgba(239,68,68,0.8)'],
          borderColor:     ['rgba(34,197,94,1)',   'rgba(239,68,68,1)'],
          borderWidth: 2, hoverOffset: 6 }],
      },
      options: { responsive: true, maintainAspectRatio: false, cutout: '62%',
        plugins: { legend: { position: 'bottom', labels: { padding: 16, font: { size: 13 } } } } },
    });
  }

  // Bar (last 7 days)
  var barCtx = el('barChart');
  if (barCtx) {
    if (State.charts.bar) State.charts.bar.destroy();
    var days = [], dayMap = {};
    for (var i = 6; i >= 0; i--) {
      var d = new Date(); d.setDate(d.getDate() - i);
      var key = d.toISOString().slice(0, 10);
      var lbl = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      days.push(lbl); dayMap[key] = { success: 0, failed: 0 };
    }
    (data.daily || []).forEach(function(row) {
      if (dayMap[row.day]) { dayMap[row.day].success = row.successful; dayMap[row.day].failed = row.failed; }
    });
    var vals  = Object.values(dayMap);
    State.charts.bar = new Chart(barCtx, {
      type: 'bar',
      data: { labels: days, datasets: [
        { label: 'Successful', data: vals.map(function(v) { return v.success; }),
          backgroundColor: 'rgba(34,197,94,0.7)', borderColor: 'rgba(34,197,94,1)', borderWidth: 1, borderRadius: 4 },
        { label: 'Failed',     data: vals.map(function(v) { return v.failed; }),
          backgroundColor: 'rgba(239,68,68,0.7)', borderColor: 'rgba(239,68,68,1)', borderWidth: 1, borderRadius: 4 },
      ]},
      options: { responsive: true, maintainAspectRatio: false,
        scales: { x: { grid: { color: 'rgba(255,255,255,0.06)' } }, y: { grid: { color: 'rgba(255,255,255,0.06)' }, beginAtZero: true, ticks: { stepSize: 1 } } },
        plugins: { legend: { position: 'bottom', labels: { padding: 14 } } } },
    });
  }

  // Line
  var lineCtx = el('lineChart');
  if (lineCtx) {
    if (State.charts.line) State.charts.line.destroy();
    var days2 = [], dayMap2 = {};
    for (var j = 6; j >= 0; j--) {
      var d2 = new Date(); d2.setDate(d2.getDate() - j);
      var key2 = d2.toISOString().slice(0, 10);
      var lbl2 = d2.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      days2.push(lbl2); dayMap2[key2] = { success: 0, failed: 0 };
    }
    (data.daily || []).forEach(function(row) {
      if (dayMap2[row.day]) { dayMap2[row.day].success = row.successful; dayMap2[row.day].failed = row.failed; }
    });
    var vals2 = Object.values(dayMap2);
    State.charts.line = new Chart(lineCtx, {
      type: 'line',
      data: { labels: days2, datasets: [{ label: 'Total Events per Day',
        data: vals2.map(function(v) { return v.success + v.failed; }),
        borderColor: 'rgba(59,130,246,1)', backgroundColor: 'rgba(59,130,246,0.1)',
        borderWidth: 2, fill: true, tension: 0.4,
        pointBackgroundColor: 'rgba(59,130,246,1)', pointRadius: 4, pointHoverRadius: 6 }] },
      options: { responsive: true, maintainAspectRatio: false,
        scales: { x: { grid: { color: 'rgba(255,255,255,0.06)' } }, y: { grid: { color: 'rgba(255,255,255,0.06)' }, beginAtZero: true, ticks: { stepSize: 1 } } },
        plugins: { legend: { position: 'bottom', labels: { padding: 14 } } } },
    });
  }
}

/* ════════════════════════════════════════════════════════════════
   DEVICE STATUS
════════════════════════════════════════════════════════════════ */
function loadDeviceStatus() {
  return api('/api/device/status').then(function(r) {
    if (!r.ok) return;
    var d = r.data;
    function s(id, val) { var e = el(id); if (e) e.textContent = val; }
    s('devConnectivity', d.connectivity || '—');
    s('devSignal',       (d.signal_strength != null ? d.signal_strength : '—') + ' %');
    s('devBattery',      (d.battery_level  != null ? d.battery_level  : '—') + ' %');
    s('devTemp',         (d.temperature_c  != null ? d.temperature_c  : '—') + ' °C');
    s('devUptime',       (d.uptime_hours   != null ? d.uptime_hours   : '—') + ' hrs');
    s('devFirmware',     d.firmware_version || '—');
    s('devName',         d.device_name     || '—');
    s('devPing',         d.last_ping ? formatDateTime(d.last_ping) : '—');
  });
}

/* ════════════════════════════════════════════════════════════════
   SETTINGS
════════════════════════════════════════════════════════════════ */
function loadSettings() {
  var inp = el('relockInput');
  if (inp && State.door) inp.value = State.door.auto_relock_sec;
}

function saveRelockSetting() {
  var inp = el('relockInput');
  var val = inp ? parseInt(inp.value, 10) : NaN;
  if (isNaN(val) || val < 5 || val > 300) {
    showFeedback('settingsFeedback', '✗ Value must be between 5 and 300 seconds.', 'error');
    return;
  }
  api('/api/door/settings', { method: 'POST', body: JSON.stringify({ auto_relock_sec: val }) })
    .then(function(r) {
      if (r.ok) {
        if (State.door) State.door.auto_relock_sec = val;
        showFeedback('settingsFeedback', '✓ Auto-relock timer set to ' + val + ' seconds.', 'success');
      } else {
        showFeedback('settingsFeedback', '✗ ' + ((r.data && r.data.error) || 'Failed to save.'), 'error');
      }
    });
}

/* ════════════════════════════════════════════════════════════════
   REFRESH ALL
════════════════════════════════════════════════════════════════ */
function refreshAll() {
  var icon = el('refreshIcon');
  if (icon) icon.classList.add('fa-spin');
  Promise.all([fetchDoorStatus(), loadStats(), loadRecentActivity()]).then(function() {
    if (State.currentSection === 'activity')  loadActivity();
    if (State.currentSection === 'analytics') loadCharts();
    if (State.currentSection === 'device')    loadDeviceStatus();
    if (icon) setTimeout(function() { icon.classList.remove('fa-spin'); }, 400);
  });
}

/* ════════════════════════════════════════════════════════════════
   POLLING (every 10s)
════════════════════════════════════════════════════════════════ */
function startPolling() {
  State.pollInterval = setInterval(function() {
    fetchDoorStatus();
    loadStats();
    if (State.currentSection === 'activity')  loadActivity();
    if (State.currentSection === 'dashboard') loadRecentActivity();
  }, 10000);
}

/* ════════════════════════════════════════════════════════════════
   BOOT
════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', function() {
  authGuard().then(function(authed) {
    if (!authed) return;
    initSidebar();
    applyRoleRestrictions();   // restrict demo user to read-only
    startClock();
    Promise.all([fetchDoorStatus(), loadStats(), loadRecentActivity()]).then(function() {
      startPolling();
    });
  });
});
