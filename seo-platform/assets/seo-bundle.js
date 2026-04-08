// SEO Platform — Core Module
// Shared state, utilities, navigation, SEO API object
'use strict';

// Global error handler — catch network errors and show user-friendly toast
window.addEventListener('unhandledrejection', function(e) {
  var msg = e.reason?.message || String(e.reason || 'Unknown error');
  if (msg.indexOf('Failed to fetch') !== -1 || msg.indexOf('NetworkError') !== -1) {
    showToast('Network error — social dashboard API may be down', 'error', 8000);
  }
  e.preventDefault();
});

const SEO = {
  // Auto-detect API: plugin route (OpenVoiceUI) vs social dashboard (JamBot standalone)
  API: (function() {
    // If running inside OpenVoiceUI (canvas page), use plugin route
    if (window.location.pathname.indexOf('/pages/') !== -1 || document.querySelector('meta[name="seo-api-base"]')) {
      var meta = document.querySelector('meta[name="seo-api-base"]');
      return meta ? meta.content : '/api/seo-platform';
    }
    // Standalone / JamBot deployment
    return '/social-api/api/seo';
  })(),
  TENANT: window.location.hostname.split('.')[0],
  // Track cumulative cost per user-initiated action
  _actionCost: 0,
  _actionCalls: 0,

  // Start tracking cost for a multi-call action
  startAction() { this._actionCost = 0; this._actionCalls = 0; },
  // Get actual cost of completed action
  getActionCost() { return { cost: this._actionCost, calls: this._actionCalls }; },
  // Format cost for display
  fmtCost(cost) { return cost < 0.01 ? '<$0.01' : '$' + cost.toFixed(2); },

  // Generic proxy call to DataForSEO (COSTS MONEY)
  async dfs(endpoint, data, method) {
    var payload = { endpoint, data: Array.isArray(data) ? data : [data] };
    if (method) payload.method = method;
    const r = await fetch(this.API + '/proxy?tenant=' + this.TENANT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await r.json();
    if (json.status_code && json.status_code !== 20000) {
      var errMsg = json.status_message || 'API error';
      showToast('API Error: ' + errMsg, 'error', 6000);
      throw new Error(errMsg);
    }
    if (json.error) {
      showToast('Request failed: ' + json.error, 'error', 6000);
      throw new Error(json.error);
    }
    // Track actual cost from DataForSEO response
    var callCost = json.cost || json.tasks?.[0]?.cost || 0;
    this._actionCost += callCost;
    this._actionCalls++;
    SEO.refreshCosts();
    return json;
  },

  // FREE reads from saved data — auto-fallback: if target search returns no results, retry without target
  async history(params = {}) {
    const qs = new URLSearchParams({ tenant: this.TENANT, ...params });
    const r = await fetch(this.API + '/history?' + qs);
    const data = await r.json();
    // If we searched by target and got no results, retry without target to find data saved under different names
    if (params.target && (!data.queries || data.queries.length === 0)) {
      const fallbackParams = { ...params };
      delete fallbackParams.target;
      const qs2 = new URLSearchParams({ tenant: this.TENANT, ...fallbackParams });
      const r2 = await fetch(this.API + '/history?' + qs2);
      return r2.json();
    }
    return data;
  },
  async historyById(id) {
    const r = await fetch(this.API + '/history/' + id + '?tenant=' + this.TENANT);
    return r.json();
  },
  async dashboard() {
    const r = await fetch(this.API + '/dashboard?tenant=' + this.TENANT);
    return r.json();
  },
  async projects() {
    const r = await fetch(this.API + '/projects?tenant=' + this.TENANT);
    return r.json();
  },
  async saveProject(project) {
    const r = await fetch(this.API + '/projects?tenant=' + this.TENANT, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(project)
    });
    return r.json();
  },
  async deleteProject(domain) {
    const r = await fetch(this.API + '/projects/' + encodeURIComponent(domain) + '?tenant=' + this.TENANT, { method: 'DELETE' });
    return r.json();
  },
  async preferences() {
    const r = await fetch(this.API + '/preferences?tenant=' + this.TENANT);
    return r.json();
  },
  async savePreferences(prefs) {
    const r = await fetch(this.API + '/preferences?tenant=' + this.TENANT, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prefs)
    });
    return r.json();
  },
  async trackedKeywords(domain) {
    const qs = new URLSearchParams({ tenant: this.TENANT });
    if (domain) qs.set('domain', domain);
    const r = await fetch(this.API + '/tracked-keywords?' + qs);
    return r.json();
  },
  async trackKeyword(domain, keywords) {
    const r = await fetch(this.API + '/tracked-keywords?tenant=' + this.TENANT, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain, keywords: Array.isArray(keywords) ? keywords : [keywords] })
    });
    return r.json();
  },
  async removeTrackedKeyword(id) {
    const r = await fetch(this.API + '/tracked-keywords/' + id + '?tenant=' + this.TENANT, { method: 'DELETE' });
    return r.json();
  },
  async snapshots(domain, days = 30) {
    const qs = new URLSearchParams({ tenant: this.TENANT, days });
    if (domain) qs.set('domain', domain);
    const r = await fetch(this.API + '/snapshots?' + qs);
    return r.json();
  },
  async generateSnapshot(domain) {
    const r = await fetch(this.API + '/snapshots/generate?tenant=' + this.TENANT, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain })
    });
    return r.json();
  },
  async costs() {
    const r = await fetch(this.API + '/costs?tenant=' + this.TENANT);
    return r.json();
  },
  async balance() {
    const r = await fetch(this.API + '/user?tenant=' + this.TENANT);
    return r.json();
  },
  async accumulatedKeywords(params = {}) {
    const qs = new URLSearchParams({ tenant: this.TENANT, ...params });
    const r = await fetch(this.API + '/accumulated/keywords?' + qs);
    return r.json();
  },
  async accumulatedCompetitors(domain) {
    const qs = new URLSearchParams({ tenant: this.TENANT });
    if (domain) qs.set('domain', domain);
    const r = await fetch(this.API + '/accumulated/competitors?' + qs);
    return r.json();
  },
  async accumulatedBacklinks(domain) {
    const qs = new URLSearchParams({ tenant: this.TENANT });
    if (domain) qs.set('domain', domain);
    const r = await fetch(this.API + '/accumulated/backlinks?' + qs);
    return r.json();
  },
  async accumulatedLocal(domain) {
    const qs = new URLSearchParams({ tenant: this.TENANT });
    if (domain) qs.set('domain', domain);
    const r = await fetch(this.API + '/accumulated/local?' + qs);
    return r.json();
  },
  async accumulatedAudits(domain) {
    const qs = new URLSearchParams({ tenant: this.TENANT });
    if (domain) qs.set('domain', domain);
    const r = await fetch(this.API + '/accumulated/audits?' + qs);
    return r.json();
  },
  async accumulatedContentMonitor(domain, days) {
    const qs = new URLSearchParams({ tenant: this.TENANT, days: days || 30 });
    if (domain) qs.set('domain', domain);
    const r = await fetch(this.API + '/accumulated/content-monitor?' + qs);
    return r.json();
  },

  // Cost display refresh
  async refreshCosts() {
    try {
      const [costs, bal] = await Promise.all([this.costs(), this.balance()]);
      updateCostDisplay(costs, bal);
    } catch(e) { console.warn('Cost refresh failed:', e); }
  },

  // Active project state (NO localStorage)
  _activeProject: null,
  get activeProject() { return this._activeProject; },
  set activeProject(domain) {
    this._activeProject = domain;
    this.savePreferences({ active_project: domain }).catch(e => console.warn('Pref save failed:', e));
  }
};

/* =======================================================
   DATA PIPELINE DIAGNOSTIC
   ======================================================= */

function toggleDiagnosticPanel() {
  var panel = document.getElementById('diagnostic-panel');
  if (!panel) return;
  var isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : '';
  if (!isOpen) runDiagnostic();
}

async function runDiagnostic() {
  var body = document.getElementById('diagnostic-body');
  if (!body) return;
  body.innerHTML = '<div style="text-align:center;padding:20px;color:#8c909f"><div style="width:24px;height:24px;border:3px solid #35343a;border-top-color:#adc6ff;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 12px"></div>Running diagnostics...</div>';

  try {
    var domain = SEO.activeProject || '';
    var url = SEO.API + '/diagnostic?tenant=' + SEO.TENANT;
    if (domain) url += '&domain=' + encodeURIComponent(domain);
    var res = await fetch(url);
    var data = await res.json();

    if (data.error) {
      body.innerHTML = '<div style="color:#ffb3ad;padding:16px">Error: ' + escHtml(data.error) + '</div>';
      return;
    }

    var s = data.summary || {};
    var healthColor = s.health_pct >= 80 ? '#4ae176' : s.health_pct >= 50 ? '#f59e0b' : '#ef4444';

    var html = '<div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap">'
      + '<div style="flex:1;min-width:80px;background:#1a1a22;padding:10px;border-radius:8px;text-align:center">'
      + '<div style="font-size:24px;font-weight:800;color:' + healthColor + '">' + s.health_pct + '%</div>'
      + '<div style="font-size:9px;color:#8c909f;text-transform:uppercase;font-weight:600">Health</div></div>'
      + '<div style="flex:1;min-width:60px;background:#1a1a22;padding:10px;border-radius:8px;text-align:center">'
      + '<div style="font-size:18px;font-weight:800;color:#4ae176">' + s.ok + '</div>'
      + '<div style="font-size:9px;color:#8c909f;text-transform:uppercase;font-weight:600">OK</div></div>'
      + '<div style="flex:1;min-width:60px;background:#1a1a22;padding:10px;border-radius:8px;text-align:center">'
      + '<div style="font-size:18px;font-weight:800;color:#f59e0b">' + s.stale + '</div>'
      + '<div style="font-size:9px;color:#8c909f;text-transform:uppercase;font-weight:600">Stale</div></div>'
      + '<div style="flex:1;min-width:60px;background:#1a1a22;padding:10px;border-radius:8px;text-align:center">'
      + '<div style="font-size:18px;font-weight:800;color:#ef4444">' + s.field_issues + '</div>'
      + '<div style="font-size:9px;color:#8c909f;text-transform:uppercase;font-weight:600">Field Issues</div></div>'
      + '<div style="flex:1;min-width:60px;background:#1a1a22;padding:10px;border-radius:8px;text-align:center">'
      + '<div style="font-size:18px;font-weight:800;color:#8c909f">' + s.no_data + '</div>'
      + '<div style="font-size:9px;color:#8c909f;text-transform:uppercase;font-weight:600">No Data</div></div>'
      + '</div>';

    var statusIcons = { ok: '&#10003;', stale: '&#9888;', fields_missing: '&#10007;', no_data: '&#8212;' };
    var statusColors = { ok: '#4ae176', stale: '#f59e0b', fields_missing: '#ef4444', no_data: '#64687a' };

    var checks = data.checks || {};
    var viewLabels = {
      dashboard: 'Dashboard', position_tracking: 'Position Tracking', domain_analysis: 'Domain Analysis',
      keyword_magic: 'Keyword Magic', keyword_overview: 'Keyword Overview', site_audit: 'Site Audit',
      backlinks: 'Backlinks', ai_visibility: 'AI Visibility', local_seo: 'Local SEO', content_monitor: 'Content Monitor'
    };

    for (var viewKey in checks) {
      var viewChecks = checks[viewKey];
      var viewLabel = viewLabels[viewKey] || viewKey;
      var anyIssue = false;

      html += '<div style="margin-bottom:12px;background:#1a1a22;border-radius:10px;overflow:hidden;border:1px solid rgba(66,71,84,0.1)">'
        + '<div style="padding:10px 14px;font-size:12px;font-weight:700;color:#e4e1e9;border-bottom:1px solid rgba(66,71,84,0.1);display:flex;align-items:center;gap:6px">'
        + '<span style="font-size:14px">' + escHtml(viewLabel) + '</span></div>';

      for (var toolKey in viewChecks) {
        var c = viewChecks[toolKey];
        var icon = statusIcons[c.status] || '?';
        var color = statusColors[c.status] || '#8c909f';
        var detail = '';

        if (c.status === 'ok') {
          detail = c.items_count + ' items, ' + c.age_label;
        } else if (c.status === 'stale') {
          detail = c.items_count + ' items but ' + c.age_label + ' old';
          anyIssue = true;
        } else if (c.status === 'fields_missing') {
          detail = 'Missing: ' + c.missing_fields.join(', ');
          anyIssue = true;
        } else if (c.status === 'no_data') {
          detail = c.message || 'Never fetched';
        }

        html += '<div style="padding:6px 14px;display:flex;align-items:center;gap:8px;border-bottom:1px solid rgba(66,71,84,0.05)">'
          + '<span style="font-size:12px;color:' + color + ';flex-shrink:0;width:16px;text-align:center">' + icon + '</span>'
          + '<span style="font-size:11px;font-weight:600;color:#c2c6d6;min-width:120px">' + escHtml(c.tool) + '</span>'
          + '<span style="font-size:10px;color:#8c909f;flex:1">' + escHtml(detail) + '</span>'
          + '</div>';
      }

      html += '</div>';
    }

    body.innerHTML = html;
  } catch(e) {
    body.innerHTML = '<div style="color:#ffb3ad;padding:16px">Diagnostic failed: ' + escHtml(e.message) + '</div>';
  }
}

/* =======================================================
   SEO ALERTS — notification badge + panel
   ======================================================= */

var _alertsData = [];
var _alertsUnread = 0;

async function loadAlerts() {
  try {
    var res = await fetch(SEO.API + '/alerts?tenant=' + SEO.TENANT + '&unread=true');
    var data = await res.json();
    _alertsData = data.alerts || [];
    _alertsUnread = data.unread_count || 0;
    _updateAlertBadge();
  } catch(e) { /* alerts optional */ }
}

function _updateAlertBadge() {
  var badge = document.getElementById('alert-badge');
  if (!badge) {
    // Create badge on the first nav item that says "Dashboard"
    var dashNav = document.querySelector('[data-view="dashboard"]');
    if (dashNav) {
      badge = document.createElement('span');
      badge.id = 'alert-badge';
      badge.style.cssText = 'position:absolute;top:-2px;right:-6px;min-width:16px;height:16px;border-radius:8px;background:#ef4444;color:white;font-size:9px;font-weight:800;display:flex;align-items:center;justify-content:center;padding:0 4px';
      dashNav.style.position = 'relative';
      dashNav.appendChild(badge);
    }
  }
  if (badge) {
    badge.style.display = _alertsUnread > 0 ? 'flex' : 'none';
    badge.textContent = _alertsUnread > 9 ? '9+' : _alertsUnread;
  }
}

function renderAlertPanel() {
  var container = document.getElementById('dashboard-alerts-panel');
  if (!container) return;

  if (_alertsData.length === 0) {
    container.innerHTML = '';
    return;
  }

  var html = '<div style="background:#131318;border:1px solid rgba(66,71,84,0.2);border-radius:12px;overflow:hidden;margin-bottom:16px">'
    + '<div style="padding:12px 16px;border-bottom:1px solid rgba(66,71,84,0.1);display:flex;align-items:center;justify-content:space-between">'
    + '<div style="display:flex;align-items:center;gap:8px"><span class="material-symbols-outlined" style="font-size:18px;color:#ef4444">notifications_active</span>'
    + '<h3 style="font-size:14px;font-weight:700;color:#e4e1e9">Alerts</h3>'
    + '<span style="font-size:10px;font-weight:700;background:#ef4444;color:white;padding:1px 8px;border-radius:8px">' + _alertsData.length + '</span></div>'
    + '<button onclick="markAlertsRead()" style="font-size:10px;color:#8c909f;background:none;border:none;cursor:pointer;text-decoration:underline">Mark all read</button>'
    + '</div><div style="max-height:300px;overflow-y:auto">';

  var icons = { rank_drop_top3: 'trending_down', traffic_drop: 'show_chart', backlinks_lost: 'link_off', health_drop: 'health_and_safety', ref_domains_lost: 'domain_disabled' };
  var colors = { critical: '#ef4444', warning: '#f59e0b' };

  _alertsData.forEach(function(a) {
    var icon = icons[a.alert_type] || 'warning';
    var color = colors[a.severity] || '#f59e0b';
    var date = new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    html += '<div style="padding:10px 16px;border-bottom:1px solid rgba(66,71,84,0.06);display:flex;align-items:start;gap:10px">'
      + '<span class="material-symbols-outlined" style="font-size:16px;color:' + color + ';flex-shrink:0;margin-top:2px">' + icon + '</span>'
      + '<div style="flex:1;min-width:0">'
      + '<div style="font-size:12px;font-weight:600;color:#e4e1e9">' + escHtml(a.title) + '</div>'
      + '<div style="font-size:10px;color:#8c909f;margin-top:2px">' + escHtml(a.domain) + ' &middot; ' + date + '</div>'
      + '</div>'
      + '<span style="font-size:9px;font-weight:700;padding:2px 8px;border-radius:4px;color:' + color + ';background:' + color + '15;flex-shrink:0">' + (a.severity || 'warning').toUpperCase() + '</span>'
      + '</div>';
  });

  html += '</div></div>';
  container.innerHTML = html;
}

async function markAlertsRead() {
  try {
    var ids = _alertsData.map(function(a) { return a.id; });
    await fetch(SEO.API + '/alerts/read?tenant=' + SEO.TENANT, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ids })
    });
    _alertsData = [];
    _alertsUnread = 0;
    _updateAlertBadge();
    renderAlertPanel();
    showToast('Alerts marked as read', 'success');
  } catch(e) { showToast('Failed to mark alerts', 'error'); }
}

/* =======================================================
   FULL REFRESH — one button to refresh ALL data + generate report
   ======================================================= */

async function refreshAll(btn) {
  var domain = SEO.activeProject;
  if (!domain) { showToast('Select a project first', 'warning'); return; }
  if (!checkBalanceWarning(0.35)) return;

  // Show confirmation modal with cost breakdown
  var existing = document.getElementById('refresh-all-confirm');
  if (existing) existing.remove();

  var modal = document.createElement('div');
  modal.id = 'refresh-all-confirm';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:300;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML = '<div style="background:#131318;border:1px solid rgba(66,71,84,0.3);border-radius:16px;max-width:420px;width:100%;box-shadow:0 20px 50px rgba(0,0,0,0.6)">'
    + '<div style="padding:20px 24px;border-bottom:1px solid rgba(66,71,84,0.2)">'
    + '<h3 style="font-size:16px;font-weight:800;color:#e4e1e9;margin:0">Full Data Refresh</h3>'
    + '<p style="font-size:12px;color:#8c909f;margin:4px 0 0">' + escHtml(domain) + '</p></div>'
    + '<div style="padding:16px 24px;font-size:12px;color:#c2c6d6">'
    + '<div style="display:grid;grid-template-columns:1fr auto;gap:4px 16px;margin-bottom:12px">'
    + '<span>Keywords + Traffic + Competitors</span><span style="color:#8c909f;text-align:right">$0.04</span>'
    + '<span>Categories + Tech + Top Pages</span><span style="color:#8c909f;text-align:right">$0.04</span>'
    + '<span>Backlinks (summary + domains + anchors)</span><span style="color:#8c909f;text-align:right">$0.06</span>'
    + '<span>Brand Mentions + Sentiment</span><span style="color:#8c909f;text-align:right">$0.06</span>'
    + '<span>Local SEO (GMB + Maps)</span><span style="color:#8c909f;text-align:right">$0.01</span>'
    + '<span>AI Model Mentions</span><span style="color:#8c909f;text-align:right">$0.10</span>'
    + '<span>Snapshot + Alerts</span><span style="color:#4ae176;text-align:right">FREE</span>'
    + '<span>AI Report Generation</span><span style="color:#4ae176;text-align:right">FREE</span>'
    + '</div>'
    + '<div style="border-top:1px solid rgba(66,71,84,0.2);padding-top:10px;display:flex;justify-content:space-between;font-weight:700">'
    + '<span style="color:#e4e1e9">Estimated Total</span><span style="color:#f59e0b;font-size:14px">~$0.33</span></div>'
    + '<p style="font-size:10px;color:#64687a;margin-top:8px">16 API calls run in parallel. Report opens automatically when complete.</p>'
    + '</div>'
    + '<div style="padding:12px 24px 20px;display:flex;gap:10px;justify-content:flex-end">'
    + '<button onclick="document.getElementById(\'refresh-all-confirm\').remove()" style="padding:10px 20px;border-radius:8px;border:1px solid rgba(66,71,84,0.3);background:transparent;color:#8c909f;font-size:13px;font-weight:600;cursor:pointer;min-height:44px">Cancel</button>'
    + '<button id="refresh-all-go-btn" style="padding:10px 24px;border-radius:8px;border:none;background:#4ae176;color:#0e0e13;font-size:13px;font-weight:800;cursor:pointer;min-height:44px">Refresh All</button>'
    + '</div></div>';
  document.body.appendChild(modal);

  // Close on backdrop click
  modal.addEventListener('click', function(e) { if (e.target === modal) modal.remove(); });

  // Wait for user to confirm
  return new Promise(function(resolve) {
    document.getElementById('refresh-all-go-btn').addEventListener('click', function() {
      modal.remove();
      _doRefreshAll(btn);
      resolve();
    });
  });
}

async function _doRefreshAll(btn) {
  var domain = SEO.activeProject;
  if (!domain) return;
  if (_debounceTimers['refreshAll']) return;
  _debounceTimers['refreshAll'] = true;
  setTimeout(function() { _debounceTimers['refreshAll'] = false; }, 10000);

  var origHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span style="display:inline-block;width:14px;height:14px;border:2px solid #35343a;border-top-color:#adc6ff;border-radius:50%;animation:spin 0.8s linear infinite;margin-right:6px"></span>Refreshing all data...';
  }

  // Show a progress overlay
  var overlay = document.createElement('div');
  overlay.id = 'refresh-all-overlay';
  overlay.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#131318;border:1px solid rgba(66,71,84,0.3);border-radius:12px;padding:16px 20px;z-index:200;box-shadow:0 10px 30px rgba(0,0,0,0.5);min-width:280px';
  overlay.innerHTML = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">'
    + '<div style="width:20px;height:20px;border:3px solid #35343a;border-top-color:#3b82f6;border-radius:50%;animation:spin 0.8s linear infinite;flex-shrink:0"></div>'
    + '<span style="font-size:13px;font-weight:700;color:#e4e1e9">Full Refresh Running</span></div>'
    + '<div id="refresh-all-status" style="font-size:11px;color:#8c909f">Calling 16 DataForSEO endpoints...</div>';
  document.body.appendChild(overlay);

  try {
    var res = await fetch(SEO.API + '/refresh-all?tenant=' + SEO.TENANT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: domain })
    });
    var data = await res.json();

    if (data.error) {
      showToast('Refresh failed: ' + data.error, 'error');
      return;
    }

    // Update progress
    var statusEl = document.getElementById('refresh-all-status');
    if (statusEl) {
      statusEl.innerHTML = '<div style="color:#4ae176;font-weight:600">' + data.successes + '/' + data.calls + ' endpoints OK</div>'
        + '<div>Cost: $' + (data.total_cost || 0).toFixed(3) + '</div>'
        + (data.report_url ? '<div style="margin-top:6px"><a href="' + data.report_url + '" target="_blank" style="color:#3b82f6;text-decoration:none;font-weight:600">View Report</a></div>' : '')
        + (data.errors?.length > 0 ? '<div style="color:#f59e0b;margin-top:4px">' + data.errors.length + ' errors</div>' : '');
    }

    // Show toast
    var msg = 'Full refresh complete: ' + data.successes + '/' + data.calls + ' OK, $' + (data.total_cost || 0).toFixed(3);
    if (data.report_url) msg += ' — report generated';
    showToast(msg, data.errors?.length > 0 ? 'warning' : 'success', 8000);

    // Open report if generated
    if (data.report_url) {
      setTimeout(function() { window.open(data.report_url, '_blank'); }, 1000);
    }

    // Refresh costs display
    SEO.refreshCosts();

    // Reload current view to show fresh data
    var currentView = _currentSeoView || 'dashboard';
    setTimeout(function() { loadViewData(currentView); }, 500);

    // Remove overlay after 5 seconds
    setTimeout(function() {
      var ol = document.getElementById('refresh-all-overlay');
      if (ol) ol.remove();
    }, 5000);

  } catch(e) {
    showToast('Full refresh failed: ' + e.message, 'error');
    var ol = document.getElementById('refresh-all-overlay');
    if (ol) ol.remove();
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = origHtml; }
  }
}

/* =======================================================
   PHASE 1.3 - LOADING/ERROR/EMPTY STATES + TOAST
   ======================================================= */
function showViewLoading(viewId) {
  var view = document.getElementById('view-' + viewId);
  if (!view || view.querySelector('.view-loading-bar')) return;
  var bar = document.createElement('div');
  bar.className = 'view-loading-bar';
  bar.style.cssText = 'position:sticky;top:0;z-index:40;padding:8px 16px;background:#1b1b20;border-bottom:1px solid #35343a;display:flex;align-items:center;gap:8px;font-size:12px;color:#8c909f';
  bar.innerHTML = '<div style="width:16px;height:16px;border:2px solid #35343a;border-top-color:#adc6ff;border-radius:50%;animation:spin 0.8s linear infinite;flex-shrink:0"></div>Loading data...';
  view.prepend(bar);
}
function hideViewLoading(viewId) {
  var view = document.getElementById('view-' + viewId);
  if (!view) return;
  var bar = view.querySelector('.view-loading-bar');
  if (bar) bar.remove();
}

function showLoading(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;padding:40px;color:#8c909f"><div style="width:24px;height:24px;border:3px solid #35343a;border-top-color:#adc6ff;border-radius:50%;animation:spin 0.8s linear infinite;margin-right:12px"></div>Loading...</div>';
}

function showError(containerId, message) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '<div style="padding:24px;text-align:center;color:#ffb3ad;background:#1b1b20;border-radius:12px;margin:12px 0"><div style="font-size:18px;margin-bottom:8px">Error</div><div style="font-size:14px;color:#8c909f">' + escHtml(message) + '</div></div>';
}

function showEmpty(containerId, message, actionLabel, actionFnName) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '<div style="padding:40px;text-align:center;color:#8c909f;background:#1b1b20;border-radius:12px;margin:12px 0"><div style="font-size:16px;margin-bottom:16px">' + escHtml(message) + '</div>' + (actionLabel ? '<button onclick="' + actionFnName + '()" style="background:#adc6ff;color:#0e0e13;border:none;padding:10px 20px;border-radius:8px;font-size:14px;cursor:pointer;min-height:44px">' + escHtml(actionLabel) + '</button>' : '') + '</div>';
}

function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// Global generic domain filter — used everywhere competitors are shown
var GENERIC_DOMAINS = [
  'youtube.com','facebook.com','reddit.com','twitter.com','x.com','instagram.com','linkedin.com',
  'pinterest.com','tiktok.com','wikipedia.org','amazon.com','yelp.com','bbb.org','glassdoor.com',
  'indeed.com','quora.com','medium.com','apple.com','google.com','microsoft.com','yahoo.com',
  'bing.com','nextdoor.com','tripadvisor.com','trustpilot.com','craigslist.org','ebay.com',
  'walmart.com','homedepot.com','lowes.com','angieslist.com','angi.com','thumbtack.com',
  'homeadvisor.com','mapquest.com','yellowpages.com','whitepages.com'
];
function isGenericDomain(d) {
  if (!d) return false;
  d = d.toLowerCase().replace(/^www\./, '');
  return GENERIC_DOMAINS.some(function(g) { return d === g || d.endsWith('.' + g); });
}

// CSV Export — works on any HTML table or data array
function exportTableCSV(tableId, filename) {
  var table = document.getElementById(tableId);
  if (!table) { showToast('Table not found', 'error'); return; }
  var rows = table.querySelectorAll('tr');
  var csv = [];
  rows.forEach(function(row) {
    var cols = row.querySelectorAll('th, td');
    var line = [];
    cols.forEach(function(col) {
      var text = (col.textContent || '').trim().replace(/"/g, '""');
      line.push('"' + text + '"');
    });
    csv.push(line.join(','));
  });
  downloadCSV(csv.join('\n'), filename || 'export.csv');
}

function exportDataCSV(data, columns, filename) {
  if (!data || !data.length) { showToast('No data to export', 'warning'); return; }
  var csv = [columns.map(function(c) { return '"' + (c.label || c.key) + '"'; }).join(',')];
  data.forEach(function(row) {
    var line = columns.map(function(c) {
      var val = row[c.key];
      if (val == null) val = '';
      return '"' + String(val).replace(/"/g, '""') + '"';
    });
    csv.push(line.join(','));
  });
  downloadCSV(csv.join('\n'), filename || 'export.csv');
}

function downloadCSV(csvStr, filename) {
  var blob = new Blob([csvStr], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = filename; a.style.display = 'none';
  document.body.appendChild(a); a.click();
  setTimeout(function() { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  showToast('Exported ' + filename, 'success');
}

// Toast notification system
const toastContainer = document.createElement('div');
toastContainer.id = 'toast-container';
toastContainer.style.cssText = 'position:fixed;bottom:80px;right:20px;z-index:10000;display:flex;flex-direction:column;gap:8px';
document.body.appendChild(toastContainer);

function showToast(message, type, duration) {
  type = type || 'info';
  duration = duration || 4000;
  const colors = { success: '#4ae176', error: '#ffb3ad', info: '#adc6ff', warning: '#f59e0b' };
  const toast = document.createElement('div');
  toast.style.cssText = 'padding:12px 20px;background:#1b1b20;border-left:3px solid ' + (colors[type] || colors.info) + ';border-radius:8px;color:#e4e1e9;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.4);max-width:360px;animation:slideIn 0.3s ease';
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(function() { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(function() { toast.remove(); }, 300); }, duration);
}

/* =======================================================
   PHASE 1.3b - DEBOUNCE + PROJECT LOCATION + BALANCE WARNING
   ======================================================= */
// Debounce: prevent double-clicks on paid refresh buttons
var _debounceTimers = {};
function debounceAction(key, fn, delay) {
  delay = delay || 2000;
  if (_debounceTimers[key]) return;
  _debounceTimers[key] = true;
  fn();
  setTimeout(function() { _debounceTimers[key] = false; }, delay);
}

// Get project location/language (falls back to United States/English)
var _projectsCache = {};
function getProjectLocLang() {
  var domain = SEO.activeProject;
  var proj = _projectsCache[domain] || {};
  return {
    location_name: proj.location_name || 'United States',
    language_name: proj.language_name || 'English'
  };
}

function getProjectBrand() {
  var domain = SEO.activeProject;
  var proj = _projectsCache[domain] || {};
  var gmb = proj.gmb_data || {};
  if (proj.brand_name) return proj.brand_name;
  if (gmb.name) return gmb.name;
  if (proj.label && proj.label.length > 3) return proj.label;
  return domain.replace(/^www\./, '').replace(/\.(com|net|org|io|co|us|biz)$/i, '').replace(/[-_]/g, ' ');
}

function getProjectInfo() {
  var domain = SEO.activeProject;
  var proj = _projectsCache[domain] || {};
  var gmb = proj.gmb_data || {};
  return {
    domain: domain,
    brand_name: proj.brand_name || gmb.name || proj.label || domain,
    phone: proj.phone || gmb.phone || '',
    address: proj.address || gmb.address || '',
    category: proj.business_category || gmb.category || '',
    location: proj.location_name || 'United States',
    language: proj.language_name || 'English'
  };
}

// Balance warning — tracked so we don't spam
var _lastBalanceWarning = 0;
function checkBalanceWarning(estimatedCost) {
  var now = Date.now();
  if (now - _lastBalanceWarning < 60000) return true; // skip if warned within 1 min
  var balEl = document.getElementById('seo-cost-display');
  if (!balEl) return true;
  var match = balEl.textContent.match(/\$([\d.]+)/);
  if (!match) return true;
  var balance = parseFloat(match[1]);
  if (balance < 1.0) {
    showToast('Low balance: $' + balance.toFixed(2) + ' — DataForSEO queries may fail', 'warning', 8000);
    _lastBalanceWarning = now;
  }
  if (estimatedCost && balance < estimatedCost) {
    showToast('Insufficient balance ($' + balance.toFixed(2) + ') for this action (~$' + estimatedCost + ')', 'error', 8000);
    _lastBalanceWarning = now;
    return false;
  }
  return true;
}

/* =======================================================
   PHASE 1.4 - COST & BALANCE DISPLAY
   ======================================================= */
function updateCostDisplay(costs, balanceData) {
  // Handle both admin response (full DataForSEO object) and client response (simple {balance} object)
  var balance = 0;
  if (typeof balanceData?.balance === 'number') {
    balance = balanceData.balance; // Client response: {balance: 42.15}
  } else if (balanceData?.tasks) {
    balance = balanceData.tasks?.[0]?.result?.[0]?.money?.balance || 0; // Admin response: full DFS object
  }
  var monthCost = costs?.month?.cost || 0;
  var monthQueries = costs?.month?.queries || 0;
  // Desktop: show balance + this tenant's monthly usage
  var el = document.getElementById('seo-cost-display');
  if (el) el.innerHTML = '<span style="color:#4ae176">$' + balance.toFixed(2) + '</span> <span style="color:#8c909f">|</span> <span style="color:#adc6ff">$' + monthCost.toFixed(2) + '</span> <span style="color:#8c909f">(' + monthQueries + ' queries)</span>';
  // Mobile
  var mob = document.getElementById('seo-cost-display-mobile');
  if (mob) mob.innerHTML = '<span style="color:#4ae176">$' + balance.toFixed(2) + '</span>';
}

/* =======================================================
   PHASE 1.5 - REFRESH BUTTON INFRASTRUCTURE
   ======================================================= */
/* =======================================================
   USAGE & COSTS PANEL
   ======================================================= */
function toggleUsagePanel() {
  var panel = document.getElementById('usage-panel');
  if (!panel) return;
  var visible = panel.style.display !== 'none';
  panel.style.display = visible ? 'none' : 'block';
  if (!visible) loadUsagePanel();
}

async function loadUsagePanel() {
  var el = document.getElementById('usage-panel-content');
  if (!el) return;
  el.innerHTML = '<div style="text-align:center;color:#8c909f;font-size:12px;padding:20px"><div style="width:24px;height:24px;border:2px solid #35343a;border-top-color:#adc6ff;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 8px"></div>Loading costs...</div>';

  try {
    var [costs, balRes] = await Promise.all([
      fetch(SEO.API + '/costs?tenant=' + SEO.TENANT).then(function(r) { return r.json(); }),
      fetch(SEO.API + '/user?tenant=' + SEO.TENANT).then(function(r) { return r.json(); })
    ]);

    var balance = 0;
    if (typeof balRes?.balance === 'number') balance = balRes.balance;
    else if (balRes?.tasks) balance = balRes.tasks?.[0]?.result?.[0]?.money?.balance || 0;

    var today = costs?.today || { cost: 0, queries: 0 };
    var month = costs?.month || { cost: 0, queries: 0 };
    var byTool = costs?.byTool || [];
    var byDate = costs?.byDate || [];

    var html = '';

    // KPI cards
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">';
    html += '<div style="background:#1b1b20;border-radius:10px;padding:14px;text-align:center">'
      + '<div style="font-size:10px;color:#8c909f;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">Balance</div>'
      + '<div style="font-size:22px;font-weight:900;color:#4ae176;font-variant-numeric:tabular-nums">$' + balance.toFixed(2) + '</div></div>';
    html += '<div style="background:#1b1b20;border-radius:10px;padding:14px;text-align:center">'
      + '<div style="font-size:10px;color:#8c909f;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">This Month</div>'
      + '<div style="font-size:22px;font-weight:900;color:#adc6ff;font-variant-numeric:tabular-nums">$' + month.cost.toFixed(2) + '</div>'
      + '<div style="font-size:10px;color:#8c909f">' + month.queries + ' queries</div></div>';
    html += '<div style="background:#1b1b20;border-radius:10px;padding:14px;text-align:center">'
      + '<div style="font-size:10px;color:#8c909f;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">Today</div>'
      + '<div style="font-size:18px;font-weight:800;color:#e4e1e9;font-variant-numeric:tabular-nums">$' + today.cost.toFixed(2) + '</div>'
      + '<div style="font-size:10px;color:#8c909f">' + today.queries + ' queries</div></div>';
    html += '<div style="background:#1b1b20;border-radius:10px;padding:14px;text-align:center">'
      + '<div style="font-size:10px;color:#8c909f;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">Avg/Query</div>'
      + '<div style="font-size:18px;font-weight:800;color:#e4e1e9;font-variant-numeric:tabular-nums">$' + (month.queries > 0 ? (month.cost / month.queries).toFixed(4) : '0.00') + '</div></div>';
    html += '</div>';

    // Cost by tool breakdown
    if (byTool.length > 0) {
      html += '<div style="margin-bottom:16px">'
        + '<div style="font-size:11px;font-weight:700;color:#8c909f;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">Cost by API Module</div>';
      var maxToolCost = byTool[0]?.cost || 1;
      byTool.slice(0, 10).forEach(function(t) {
        var pct = Math.round(t.cost / maxToolCost * 100);
        var toolName = (t.tool || 'unknown').replace(/_/g, ' ');
        html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">'
          + '<div style="width:120px;font-size:11px;color:#c2c6d6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(toolName) + '</div>'
          + '<div style="flex:1;height:6px;background:#2a292f;border-radius:3px;overflow:hidden">'
          + '<div style="height:100%;width:' + pct + '%;background:#adc6ff;border-radius:3px"></div></div>'
          + '<div style="width:65px;text-align:right;font-size:11px;font-weight:700;color:#e4e1e9;font-variant-numeric:tabular-nums">$' + t.cost.toFixed(3) + '</div>'
          + '<div style="width:30px;text-align:right;font-size:10px;color:#8c909f;font-variant-numeric:tabular-nums">' + t.queries + '</div>'
          + '</div>';
      });
      html += '</div>';
    }

    // Daily cost sparkline (last 7 days from byDate)
    if (byDate.length > 0) {
      html += '<div>'
        + '<div style="font-size:11px;font-weight:700;color:#8c909f;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">Daily Spending (Last 30 Days)</div>';
      var last7 = byDate.slice(-7);
      var maxDay = Math.max.apply(null, last7.map(function(d) { return d.cost; })) || 1;
      html += '<div style="display:flex;align-items:flex-end;gap:4px;height:60px">';
      last7.forEach(function(d) {
        var h = Math.max(4, Math.round(d.cost / maxDay * 56));
        var dateStr = new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        html += '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">'
          + '<div style="width:100%;height:' + h + 'px;background:#adc6ff;border-radius:3px 3px 0 0;min-width:8px" title="' + dateStr + ': $' + d.cost.toFixed(3) + ' (' + d.queries + ' queries)"></div>'
          + '<div style="font-size:8px;color:#8c909f;white-space:nowrap">' + dateStr.replace(/[A-Za-z]+ /, '') + '</div>'
          + '</div>';
      });
      html += '</div></div>';
    }

    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<div style="padding:20px;text-align:center;color:#ffb3ad;font-size:12px">Failed to load costs: ' + escHtml(e.message) + '</div>';
  }
}

// Close usage panel when clicking outside
document.addEventListener('click', function(e) {
  var panel = document.getElementById('usage-panel');
  if (panel && panel.style.display !== 'none') {
    if (!panel.contains(e.target) && !e.target.closest('#seo-cost-display') && !e.target.closest('#seo-cost-display-mobile')) {
      panel.style.display = 'none';
    }
  }
});

/* =======================================================
   GAUGE RENDERERS (preserved from original)
   ======================================================= */
function drawRingGauge(canvasId, value, max, opts) {
  var c = document.getElementById(canvasId);
  if (!c) return;
  var ctx = c.getContext('2d');
  var w = c.width, h = c.height;
  var cx = w / 2, cy = h / 2;
  var r = Math.min(cx, cy) - 20;
  var lw = opts.lineWidth || 16;
  var pct = Math.min(value / max, 1);
  var color;
  if (pct >= 0.8) color = opts.colorHigh || '#4ae176';
  else if (pct >= 0.5) color = opts.colorMid || '#f59e0b';
  else color = opts.colorLow || '#ffb3ad';
  ctx.clearRect(0, 0, w, h);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(66,71,84,0.25)';
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.stroke();
  if (pct > 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct);
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
  var valEl = document.getElementById(canvasId + '-val');
  var lblEl = document.getElementById(canvasId + '-label');
  if (valEl) valEl.textContent = value;
  if (lblEl) {
    var label = pct >= 0.8 ? 'Excellent' : pct >= 0.6 ? 'Good' : pct >= 0.4 ? 'Fair' : 'Poor';
    lblEl.textContent = opts.label || label;
    lblEl.style.color = color;
  }
}

function drawSemiGauge(canvasId, value, max, opts) {
  var c = document.getElementById(canvasId);
  if (!c) return;
  var ctx = c.getContext('2d');
  var w = c.width, h = c.height;
  var cx = w / 2, cy = h - 10;
  var r = Math.min(cx - 20, h - 30);
  var lw = opts.lineWidth || 14;
  var pct = Math.min(value / max, 1);
  var color;
  if (value <= 30) color = '#4ae176';
  else if (value <= 60) color = '#f59e0b';
  else color = '#ffb3ad';
  ctx.clearRect(0, 0, w, h);
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, 0);
  ctx.strokeStyle = 'rgba(66,71,84,0.25)';
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.stroke();
  if (pct > 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI, Math.PI + Math.PI * pct);
    var grad = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
    grad.addColorStop(0, '#4ae176');
    grad.addColorStop(0.5, '#f59e0b');
    grad.addColorStop(1, '#ffb3ad');
    ctx.strokeStyle = grad;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
  var valEl = document.getElementById(canvasId + '-val');
  var lblEl = document.getElementById(canvasId + '-label');
  var descEl = document.getElementById(canvasId + '-desc');
  if (valEl) valEl.textContent = value;
  if (lblEl) {
    var label = value <= 15 ? 'Very Easy' : value <= 30 ? 'Easy' : value <= 50 ? 'Medium' : value <= 70 ? 'Hard' : 'Very Hard';
    lblEl.textContent = label;
    lblEl.style.color = color;
  }
  if (descEl) {
    var desc = value <= 30 ? 'Easy to rank. Basic on-page SEO and quality content should be sufficient.'
      : value <= 50 ? 'Possible to rank. You will need high-quality content and some backlinks.'
      : value <= 70 ? 'Competitive keyword. Strong content, backlinks, and domain authority needed.'
      : 'Very competitive. Extensive link building and authoritative content required.';
    descEl.textContent = desc;
  }
}

function renderGauges(healthScore, kdScore) {
  drawRingGauge('gauge-health', healthScore, 100, { lineWidth: 18, colorHigh: '#4ae176', colorMid: '#f59e0b', colorLow: '#ffb3ad' });
  drawSemiGauge('gauge-kd', kdScore, 100, { lineWidth: 16 });
}

/* =======================================================
   HELPERS
   ======================================================= */
// Per-view last-updated timestamps
var _lastUpdated = {};
function setLastUpdated(viewId, dateStr) {
  _lastUpdated[viewId] = dateStr;
  var el = document.getElementById('last-updated-' + viewId);
  if (el) el.textContent = dateStr ? 'Updated ' + timeAgo(dateStr) : '';
}

function fmtNum(n) {
  if (n == null) return '--';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function timeAgo(dateStr) {
  if (!dateStr) return 'Never';
  var diff = Date.now() - new Date(dateStr).getTime();
  var mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return mins + 'm ago';
  var hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  var days = Math.floor(hrs / 24);
  if (days < 30) return days + 'd ago';
  return new Date(dateStr).toLocaleDateString();
}

function fmtMoney(n) {
  if (n == null) return '--';
  return '$' + Number(n).toFixed(2);
}

function pctChange(cur, prev) {
  if (!prev || !cur) return { text: '0%', cls: 'text-on-surface-variant', icon: '' };
  const pct = ((cur - prev) / prev * 100).toFixed(1);
  if (pct > 0) return { text: '+' + pct + '%', cls: 'text-secondary', icon: 'arrow_upward' };
  if (pct < 0) return { text: pct + '%', cls: 'text-tertiary', icon: 'arrow_downward' };
  return { text: '0%', cls: 'text-on-surface-variant', icon: '' };
}

function intentBadge(intent) {
  if (!intent) return '';
  const map = {
    commercial: { bg: 'bg-primary/10', border: 'border-primary/20', text: 'text-primary' },
    informational: { bg: 'bg-secondary/10', border: 'border-secondary/20', text: 'text-secondary' },
    transactional: { bg: 'bg-error-container/10', border: 'border-tertiary/20', text: 'text-tertiary' },
    navigational: { bg: 'bg-primary-container/10', border: 'border-primary-container/20', text: 'text-primary-container' }
  };
  const m = map[intent.toLowerCase()] || map.informational;
  return '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ' + m.bg + ' ' + m.text + ' border ' + m.border + '">' + escHtml(intent) + '</span>';
}

function kdColor(kd) {
  if (kd <= 30) return '#4ae176';
  if (kd <= 60) return '#f59e0b';
  return '#ffb3ad';
}

function positionBadge(pos) {
  if (pos == null) return '<span class="text-xs text-outline-variant/40">--</span>';
  let cls = 'bg-surface-container-highest text-on-surface-variant';
  if (pos <= 3) cls = 'bg-yellow-500/10 text-yellow-500 border border-yellow-500/20';
  else if (pos <= 10) cls = 'bg-secondary-container/10 text-secondary border border-secondary/20';
  return '<span class="inline-block px-2 py-0.5 rounded text-[10px] font-black ' + cls + '">#' + pos + '</span>';
}

/* =======================================================
   NAVIGATION (preserved + extended)
   ======================================================= */
function setProject(domain) {
  SEO._activeProject = domain;
  document.querySelectorAll('[data-project-domain]').forEach(function(el) {
    el.textContent = domain || 'Select a project';
  });
  document.getElementById('topbar-domain').textContent = domain || 'No project';
  var dot = document.querySelector('.project-dot');
  if (dot) dot.style.background = domain ? '#4ae176' : '#8c909f';
  // Persist to server (NO localStorage)
  if (domain) SEO.savePreferences({ active_project: domain }).catch(function(e) { console.warn('Pref save failed:', e); });
  // Show competitors management panel
  if (typeof showCompetitorsPanel === 'function') showCompetitorsPanel();
}

function selectProject(domain) {
  setProject(domain);
  // Clear view loaded cache so data reloads for the new project
  _viewLoaded = {};
  // Navigate to dashboard with newly selected project
  nav('dashboard');
}

var _currentSeoView = 'projects';

function nav(view) {
  document.querySelectorAll('.view-panel').forEach(function(v) { v.style.display = 'none'; });
  var el = document.getElementById('view-' + view);
  if (el) el.style.display = 'block';

  document.querySelectorAll('#sidebar .nav-item').forEach(function(n) { n.classList.remove('active'); });
  var sideLink = document.querySelector('#sidebar [data-view="' + view + '"]');
  if (sideLink) sideLink.classList.add('active');

  document.querySelectorAll('#bottom-nav .nav-item').forEach(function(n) { n.classList.remove('active'); });
  var bottomLink = document.querySelector('#bottom-nav [data-view="' + view + '"]');
  if (bottomLink) bottomLink.classList.add('active');

  _currentSeoView = view;
  loadViewData(view);
}

function getCurrentView() {
  return _currentSeoView || 'projects';
}

// Track which views have been loaded so we don't re-fetch on every tab switch
var _viewLoaded = {};

/* =======================================================
   UTILITY: setHtml
   ======================================================= */
function setHtml(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = String(html);
}
// SEO Platform — Projects Module
'use strict';

/* =======================================================
   PHASE 2.1 - PROJECTS VIEW WIRING
   ======================================================= */
async function loadProjectsData() {
  var listEl = document.getElementById('project-list');
  if (!listEl) return;
  try {
    var data = await SEO.projects();
    var projects = data?.projects || [];
    // Cache projects for getProjectLocLang()
    projects.forEach(function(p) { _projectsCache[p.domain] = p; });
    if (projects.length === 0) {
      listEl.innerHTML = '';
      showEmpty('project-list', 'No projects yet. Add your first domain to get started.', 'Add Project', 'openAddProject');
      return;
    }
    // Enrich each project with stats from saved history + snapshots for % change
    for (var i = 0; i < projects.length; i++) {
      var p = projects[i];
      try {
        // Ranked keywords (current)
        var stats = await SEO.history({ tool: 'ranked_keywords', target: p.domain, limit: 1 }).catch(function() { return {}; });
        var q = (stats?.queries || [])[0];
        if (q) {
          p.keyword_count = q.summary?.total_count || q.result_count || q.summary?.count || 0;
          p.top3 = q.summary?.top3 || 0;
          p.top10 = q.summary?.top10 || 0;
          p.last_query = q.created_at;
        }

        // Traffic (current)
        var tStats = await SEO.history({ tool: 'traffic_estimate', target: p.domain, limit: 1 }).catch(function() { return {}; });
        var tq = (tStats?.queries || [])[0];
        if (tq && tq.id) {
          var tFull = await SEO.historyById(tq.id).catch(function() { return {}; });
          var tItems = tFull?.items || [];
          p.traffic = Math.round(tItems[0]?.metrics?.organic?.etv || 0);
        }

        // Backlinks (current)
        var blStats = await SEO.history({ tool: 'backlinks', target: p.domain, limit: 1 }).catch(function() { return {}; });
        var blq = (blStats?.queries || [])[0];
        if (blq && blq.id) {
          var blFull = await SEO.historyById(blq.id).catch(function() { return {}; });
          var blItems = blFull?.items || [];
          p.backlinks = blItems[0]?.backlinks || 0;
          p.referring_domains = blItems[0]?.referring_domains || 0;
        }

        // Site Health from audit
        var auditStats = await SEO.history({ tool: 'on_page', target: p.domain, limit: 1 }).catch(function() { return {}; });
        var aq = (auditStats?.queries || []).find(function(x) { return x.summary?.onpage_score != null; });
        if (aq) {
          p.health_score = Math.round(aq.summary.onpage_score);
        }

        // AI Visibility mentions count
        var aiStats = await SEO.history({ tool: 'ai_visibility', target: p.domain, limit: 1 }).catch(function() { return {}; });
        var aiq = (aiStats?.queries || [])[0];
        if (aiq) {
          p.ai_mentions = aiq.result_count || aiq.summary?.total_count || 0;
        }

        // Snapshots for % change (latest 2)
        var snaps = await SEO.snapshots(p.domain, 60).catch(function() { return {}; });
        var snapList = (snaps?.snapshots || snaps || []);
        if (Array.isArray(snapList) && snapList.length >= 2) {
          var curr = snapList[0];
          var prev = snapList[1];
          p.kw_change = prev.total_keywords > 0 ? ((curr.total_keywords - prev.total_keywords) / prev.total_keywords * 100).toFixed(1) : null;
          p.traffic_change = prev.est_traffic > 0 ? ((curr.est_traffic - prev.est_traffic) / prev.est_traffic * 100).toFixed(1) : null;
          p.bl_change = prev.backlinks_count > 0 ? ((curr.backlinks_count - prev.backlinks_count) / prev.backlinks_count * 100).toFixed(1) : null;
          p.health_change = prev.health_score > 0 ? (curr.health_score - prev.health_score) : null;
        }
      } catch(enrichErr) {
        console.warn('Project enrich failed for ' + p.domain + ':', enrichErr);
      }
    }
    _allProjects = projects;
    renderProjectCards(projects);
    renderProjectDropdown(projects);
    // Update portfolio summary
    var totalKw = 0, totalTraffic = 0;
    projects.forEach(function(p) { totalKw += (p.keyword_count || 0); totalTraffic += (p.traffic || 0); });
    setHtml('portfolio-keywords', fmtNum(totalKw));
    setHtml('portfolio-traffic', totalTraffic > 0 ? (fmtNum(totalTraffic) + ' est. traffic') : '');
    setHtml('portfolio-project-count', projects.length + ' Project' + (projects.length !== 1 ? 's' : ''));
    // Show monthly cost
    SEO.costs().then(function(c) {
      setHtml('portfolio-cost', 'This month: $' + (c?.month?.cost || 0).toFixed(2) + ' (' + (c?.month?.queries || 0) + ' queries)');
    }).catch(function() {});
  } catch (e) {
    console.warn('Projects load error:', e.message);
  }
}

function _projectStatCell(label, value, changePct, color) {
  var displayVal = typeof value === 'number' ? fmtNum(value) : (value || '--');
  var changeHtml = '';
  if (changePct != null && changePct !== 'null') {
    var pct = parseFloat(changePct);
    if (!isNaN(pct)) {
      var isPositive = pct > 0;
      var isNeutral = Math.abs(pct) < 0.1;
      // For health_change, it's absolute points not percentage
      var displayPct = label === 'Site Health' ? (pct > 0 ? '+' + pct : pct) : (pct > 0 ? '+' + pct + '%' : pct + '%');
      var changeColor = isNeutral ? '#8c909f' : isPositive ? '#4ae176' : '#ef4444';
      changeHtml = '<div style="font-size:9px;font-weight:700;color:' + changeColor + ';margin-top:2px;font-variant-numeric:tabular-nums">' + displayPct + '</div>';
    }
  }
  return '<div style="text-align:center;padding:8px 4px;background:#131318;border-radius:8px">'
    + '<div style="font-size:16px;font-weight:800;color:' + color + ';font-variant-numeric:tabular-nums;line-height:1.2">' + displayVal + '</div>'
    + changeHtml
    + '<div style="font-size:8px;font-weight:600;color:#8c909f;text-transform:uppercase;letter-spacing:0.03em;margin-top:2px">' + label + '</div>'
    + '</div>';
}

var _allProjects = [];

function filterProjects(query) {
  var q = (query || '').trim().toLowerCase();
  if (!q) { renderProjectCards(_allProjects); return; }
  var filtered = _allProjects.filter(function(p) {
    return (p.domain || '').toLowerCase().indexOf(q) !== -1
      || (p.label || '').toLowerCase().indexOf(q) !== -1;
  });
  renderProjectCards(filtered);
}

function renderProjectCards(projects) {
  var listEl = document.getElementById('project-list');
  if (!listEl) return;
  var html = '';
  projects.forEach(function(p) {
    var domain = p.domain || '';
    var label = p.label || domain;
    var kws = p.keyword_count || 0;
    var traffic = p.traffic || 0;
    var backlinks = p.backlinks || 0;
    var refDomains = p.referring_domains || 0;
    var top3 = p.top3 || 0;
    var lastQuery = p.last_query ? timeAgo(p.last_query) : 'No data yet';
    var isActive = SEO.activeProject === domain;
    var hasData = kws > 0 || traffic > 0;
    var statusColor = hasData ? '#4ae176' : '#8c909f';
    var statusText = hasData ? 'Data available' : 'Needs refresh';
    // Parse GMB data
    var gmb = p.gmb_data || {};
    if (typeof gmb === 'string') try { gmb = JSON.parse(gmb); } catch(e) { gmb = {}; }
    p.gmb_cid = gmb.cid || p.gmb_cid || '';
    p.gmb_name = gmb.name || p.gmb_name || '';
    p.gmb_address = gmb.address || p.gmb_address || '';
    p.gmb_rating = gmb.rating || p.gmb_rating || '';

    html += '<div onclick="selectProject(\'' + escHtml(domain) + '\')" style="background:' + (isActive ? 'rgba(173,198,255,0.06)' : '#1b1b20') + ';border:1px solid ' + (isActive ? 'rgba(173,198,255,0.3)' : 'rgba(66,71,84,0.2)') + ';border-radius:12px;padding:14px;cursor:pointer;transition:all 150ms" onmouseover="this.style.borderColor=\'rgba(173,198,255,0.3)\'" onmouseout="this.style.borderColor=\'' + (isActive ? 'rgba(173,198,255,0.3)' : 'rgba(66,71,84,0.2)') + '\'">'
      + '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">'
      + '<div style="width:36px;height:36px;border-radius:8px;background:#2a292f;display:grid;place-items:center;border:1px solid rgba(66,71,84,0.2);flex-shrink:0"><span class="material-symbols-outlined" style="color:#adc6ff;font-size:18px">language</span></div>'
      + '<div style="flex:1;min-width:0"><div style="font-size:14px;font-weight:700;color:#e4e1e9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(label) + '</div>'
      + '<div style="font-size:10px;color:#8c909f">' + escHtml(domain) + ' - ' + escHtml(lastQuery) + '</div></div>'
      + '<div style="display:flex;align-items:center;gap:4px;padding:3px 8px;border-radius:6px;background:' + statusColor + '15;border:1px solid ' + statusColor + '30"><span style="width:6px;height:6px;border-radius:50%;background:' + statusColor + '"></span><span style="font-size:10px;font-weight:700;color:' + statusColor + '">' + escHtml(statusText) + '</span></div>'
      + '</div>'
      + '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:10px">'
      + _projectStatCell('Organic Keywords', kws, p.kw_change, '#adc6ff')
      + _projectStatCell('Organic Traffic', traffic, p.traffic_change, '#4ae176')
      + _projectStatCell('Backlinks', backlinks, p.bl_change, '#e4e1e9')
      + _projectStatCell('Site Health', p.health_score != null ? p.health_score + '%' : '--', p.health_change, p.health_score >= 80 ? '#4ae176' : p.health_score >= 50 ? '#f59e0b' : '#ffb3ad')
      + _projectStatCell('AI Mentions', p.ai_mentions || 0, null, '#3b82f6')
      + _projectStatCell('Top 3', top3, null, '#f59e0b')
      + '</div>'
      // GMB Connection Status
      + (p.gmb_cid
        ? '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:rgba(74,225,118,0.06);border:1px solid rgba(74,225,118,0.2);border-radius:8px">'
          + '<span class="material-symbols-outlined" style="font-size:16px;color:#4ae176">storefront</span>'
          + '<div style="flex:1;min-width:0"><div style="font-size:11px;font-weight:700;color:#e4e1e9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(p.gmb_name || p.gmb_query || 'Connected') + '</div>'
          + '<div style="font-size:9px;color:#8c909f">' + escHtml(p.gmb_address || '') + (p.gmb_rating ? ' - ' + p.gmb_rating + ' stars' : '') + '</div></div>'
          + '<span style="font-size:9px;font-weight:700;color:#4ae176;text-transform:uppercase">GMB Connected</span></div>'
        : '<div onclick="event.stopPropagation();searchGMB(\'' + escHtml(domain) + '\')" style="display:flex;align-items:center;justify-content:center;gap:6px;padding:8px 12px;background:rgba(173,198,255,0.06);border:1px dashed rgba(173,198,255,0.3);border-radius:8px;cursor:pointer;min-height:40px" onmouseover="this.style.borderColor=\'rgba(173,198,255,0.6)\'" onmouseout="this.style.borderColor=\'rgba(173,198,255,0.3)\'">'
          + '<span class="material-symbols-outlined" style="font-size:16px;color:#adc6ff">add_business</span>'
          + '<span style="font-size:11px;font-weight:600;color:#adc6ff">Connect Google Business Profile</span></div>')
      + '</div>';
  });
  // Add new project button
  html += '<div onclick="openAddProject()" style="border:2px dashed rgba(66,71,84,0.3);border-radius:12px;padding:20px;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;color:#8c909f;font-size:13px;font-weight:600;transition:all 150ms;min-height:44px" onmouseover="this.style.borderColor=\'rgba(173,198,255,0.4)\';this.style.color=\'#adc6ff\'" onmouseout="this.style.borderColor=\'rgba(66,71,84,0.3)\';this.style.color=\'#8c909f\'"><span class="material-symbols-outlined" style="font-size:20px">add_circle</span>Add New Project</div>';
  listEl.innerHTML = html;
}

function renderProjectDropdown(projects) {
  // Update the topbar domain selector to match active project
  if (SEO.activeProject) {
    setProject(SEO.activeProject);
  }
}

function openAddProject(editDomain) {
  const modal = document.getElementById('add-project-modal');
  if (modal) modal.style.display = 'flex';
  // Pre-fill fields if editing an existing project
  if (editDomain) {
    var proj = _projectsCache[editDomain] || {};
    var gmb = proj.gmb_data || {};
    var domEl = document.getElementById('add-proj-domain');
    var lblEl = document.getElementById('add-proj-label');
    var locEl = document.getElementById('add-proj-location');
    var compEl = document.getElementById('add-proj-competitors');
    var gmbEl = document.getElementById('add-proj-gmb');
    var brandEl = document.getElementById('add-proj-brand');
    var phoneEl = document.getElementById('add-proj-phone');
    var addrEl = document.getElementById('add-proj-address');
    var catEl = document.getElementById('add-proj-category');
    var langEl = document.getElementById('add-proj-language');
    if (domEl) domEl.value = editDomain;
    if (lblEl) lblEl.value = proj.label || '';
    if (locEl) locEl.value = proj.location_name || 'United States';
    if (compEl) compEl.value = (proj.competitors || []).join(', ');
    if (gmbEl) gmbEl.value = proj.gmb_query || proj.gmb_search_query || '';
    if (brandEl) brandEl.value = proj.brand_name || gmb.name || '';
    if (phoneEl) phoneEl.value = proj.phone || gmb.phone || '';
    if (addrEl) addrEl.value = proj.address || gmb.address || '';
    if (catEl) catEl.value = proj.business_category || gmb.category || '';
    if (langEl) langEl.value = proj.language_name || 'English';
  }
}

function closeAddProject() {
  const modal = document.getElementById('add-project-modal');
  if (modal) modal.style.display = 'none';
  // Clear form
  ['add-proj-domain','add-proj-label','add-proj-competitors','add-proj-gmb','add-proj-brand','add-proj-phone','add-proj-address','add-proj-category','add-proj-language'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
}

async function submitAddProject() {
  const domain = (document.getElementById('add-proj-domain')?.value || '').trim();
  if (!domain) { showToast('Domain is required', 'error'); return; }
  const label = (document.getElementById('add-proj-label')?.value || '').trim();
  const location_name = (document.getElementById('add-proj-location')?.value || 'United States').trim();
  const competitorsRaw = (document.getElementById('add-proj-competitors')?.value || '').trim();
  const competitors = competitorsRaw ? competitorsRaw.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];
  const gmb_query = (document.getElementById('add-proj-gmb')?.value || '').trim();
  const brand_name = (document.getElementById('add-proj-brand')?.value || '').trim();
  const phone = (document.getElementById('add-proj-phone')?.value || '').trim();
  const address = (document.getElementById('add-proj-address')?.value || '').trim();
  const business_category = (document.getElementById('add-proj-category')?.value || '').trim();
  const language_name = (document.getElementById('add-proj-language')?.value || 'English').trim();

  const btn = document.getElementById('add-proj-submit');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  try {
    await SEO.saveProject({ domain, label, location_name, competitors, gmb_query, brand_name, phone, address, business_category, language_name });
    showToast('Project "' + domain + '" added', 'success');
    closeAddProject();
    setProject(domain);
    await loadProjectsData();
    // Auto-trigger GMB search if we have a business name to search with
    var gmbSearchTerm = brand_name || gmb_query || label;
    if (gmbSearchTerm) {
      searchGMB(domain);
      // Pre-fill search input and auto-search
      var gmbInput = document.getElementById('gmb-search-input');
      if (gmbInput) gmbInput.value = gmbSearchTerm;
      doGMBSearch();
    }
  } catch (e) {
    showToast('Failed to add project: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Add Project'; }
  }
}

/* =======================================================
   PHASE 2.1b - GMB SEARCH & CONNECT
   ======================================================= */
var _gmbConnectDomain = null;

function searchGMB(domain) {
  _gmbConnectDomain = domain;
  var modal = document.getElementById('gmb-modal');
  var input = document.getElementById('gmb-search-input');
  var domainEl = document.getElementById('gmb-search-domain');
  if (modal) modal.style.display = 'flex';
  // Pre-fill with business name from project or domain
  var proj = _projectsCache[domain] || {};
  var defaultQuery = proj.gmb_query || proj.label || getProjectBrand();
  if (input) input.value = defaultQuery;
  if (domainEl) { domainEl.style.display = 'block'; domainEl.innerHTML = '<span style="font-size:11px;color:#8c909f">Connecting to: <strong style="color:#e4e1e9">' + escHtml(domain) + '</strong></span>'; }
  document.getElementById('gmb-results').innerHTML = '<div style="padding:16px;text-align:center;color:#8c909f">Enter a business name and click Search.</div>';
}

async function doGMBSearch() {
  var query = (document.getElementById('gmb-search-input')?.value || '').trim();
  if (!query) { showToast('Enter a business name', 'warning'); return; }
  var btn = document.getElementById('gmb-search-btn');
  var resultsEl = document.getElementById('gmb-results');
  if (btn) { btn.disabled = true; btn.textContent = 'Searching...'; }
  try {
    var locLang = getProjectLocLang();
    var projectDomain = _gmbConnectDomain ? (_gmbConnectDomain).replace(/^www\./, '').toLowerCase() : '';
    var allItems = [];
    var seenCids = {};

    // Search 1: Google Maps SERP — returns multiple candidates (~$0.002)
    var res = await SEO.dfs('serp/google/maps/live/advanced', {
      keyword: query,
      location_name: locLang.location_name,
      language_name: locLang.language_name,
      depth: 20
    });
    var mapItems = res?.tasks?.[0]?.result?.[0]?.items || [];
    mapItems.forEach(function(b) { if (b.cid && !seenCids[b.cid]) { seenCids[b.cid] = true; allItems.push(b); } });

    // Search 2: If project has address info, also search with location hint
    if (allItems.length < 3 && _gmbConnectDomain) {
      var proj = _projectsCache[_gmbConnectDomain] || {};
      var locHint = '';
      if (proj.address) {
        var parts = proj.address.split(',').map(function(s){ return s.trim(); });
        locHint = parts.slice(-2).join(', ');
      }
      if (locHint && query.toLowerCase().indexOf(locHint.toLowerCase().split(',')[0].toLowerCase()) === -1) {
        if (btn) btn.textContent = 'Expanding search...';
        var res2 = await SEO.dfs('serp/google/maps/live/advanced', {
          keyword: query + ' ' + locHint,
          location_name: locLang.location_name,
          language_name: locLang.language_name,
          depth: 10
        });
        var mapItems2 = res2?.tasks?.[0]?.result?.[0]?.items || [];
        mapItems2.forEach(function(b) { if (b.cid && !seenCids[b.cid]) { seenCids[b.cid] = true; allItems.push(b); } });
      }
    }

    if (allItems.length === 0) {
      resultsEl.innerHTML = '<div style="padding:20px;text-align:center;color:#8c909f">No businesses found for "' + escHtml(query) + '". Try adding city/state to the name.</div>';
      return;
    }

    // Sort: domain matches first, then by review count
    allItems.sort(function(a, b) {
      var aDomain = (a.domain || '').replace(/^www\./, '').toLowerCase();
      var bDomain = (b.domain || '').replace(/^www\./, '').toLowerCase();
      var aMatch = projectDomain && aDomain === projectDomain ? 1 : 0;
      var bMatch = projectDomain && bDomain === projectDomain ? 1 : 0;
      if (aMatch !== bMatch) return bMatch - aMatch;
      var aReviews = a.rating?.votes_count || 0;
      var bReviews = b.rating?.votes_count || 0;
      return bReviews - aReviews;
    });

    var html = '<div style="font-size:11px;color:#8c909f;padding:0 4px 8px;text-align:right">' + allItems.length + ' results</div>';
    allItems.forEach(function(b, idx) {
      var name = b.title || b.name || '--';
      var addr = b.address || b.address_info?.address || '--';
      var phone = b.phone || '--';
      var rating = b.rating?.value || b.rating || '--';
      var reviews = b.rating?.votes_count || b.reviews_count || 0;
      var category = b.category || b.main_category || '--';
      var website = (b.domain || b.url || '').replace(/^www\./, '').toLowerCase();
      var isDomainMatch = projectDomain && website === projectDomain;
      var borderColor = isDomainMatch ? 'rgba(74,225,118,0.5)' : 'rgba(66,71,84,0.2)';
      var bgColor = isDomainMatch ? 'rgba(74,225,118,0.06)' : '#131318';
      html += '<div style="padding:14px;background:' + bgColor + ';border:1px solid ' + borderColor + ';border-radius:10px;margin-bottom:8px">'
        + (isDomainMatch ? '<div style="font-size:10px;font-weight:700;color:#4ae176;text-transform:uppercase;margin-bottom:6px;letter-spacing:0.05em">DOMAIN MATCH — ' + escHtml(website) + '</div>' : '')
        + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">'
        + '<div style="flex:1;min-width:0">'
        + '<div style="font-size:15px;font-weight:700;color:#e4e1e9">' + escHtml(name) + '</div>'
        + '<div style="font-size:12px;color:#8c909f;margin-top:4px">' + escHtml(addr) + '</div>'
        + '<div style="display:flex;gap:16px;margin-top:8px;flex-wrap:wrap">'
        + '<span style="font-size:11px;color:#f59e0b;font-weight:700">' + rating + ' stars (' + reviews + ' reviews)</span>'
        + '<span style="font-size:11px;color:#8c909f">' + escHtml(category) + '</span>'
        + (phone !== '--' ? '<span style="font-size:11px;color:#adc6ff">' + escHtml(phone) + '</span>' : '')
        + '</div>'
        + (b.domain && !isDomainMatch ? '<div style="font-size:10px;color:#adc6ff;margin-top:4px">' + escHtml(b.domain) + '</div>' : '')
        + '</div>'
        + '<button onclick="connectGMB(' + idx + ')" style="background:' + (isDomainMatch ? '#4ae176' : '#adc6ff') + ';color:#0e0e13;border:none;padding:8px 16px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;min-height:40px">' + (isDomainMatch ? 'Connect' : 'Connect') + '</button>'
        + '</div></div>';
    });
    resultsEl.innerHTML = html;
    window._gmbSearchResults = allItems;
  } catch(e) {
    resultsEl.innerHTML = '<div style="padding:16px;text-align:center;color:#ffb3ad">Search failed: ' + escHtml(e.message) + '</div>';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Search (~$0.002)'; }
  }
}

async function connectGMB(idx) {
  var b = (window._gmbSearchResults || [])[idx];
  if (!b || !_gmbConnectDomain) return;
  var bName = b.title || b.name || '';
  var bAddr = b.address || b.address_info?.address || '';
  var bPhone = b.phone || '';
  var bCategory = b.category || b.main_category || '';
  try {
    // Save GMB data + business info to the project
    await SEO.saveProject({
      domain: _gmbConnectDomain,
      brand_name: bName,
      phone: bPhone,
      address: bAddr,
      business_category: bCategory,
      gmb_cid: b.cid || '',
      gmb_place_id: b.place_id || '',
      gmb_name: bName,
      gmb_address: bAddr,
      gmb_phone: bPhone,
      gmb_rating: (b.rating?.value || b.rating || '').toString(),
      gmb_reviews: (b.rating?.votes_count || b.reviews_count || 0).toString(),
      gmb_category: bCategory,
      gmb_query: bName
    });
    showToast('GMB connected: ' + bName, 'success');
    document.getElementById('gmb-modal').style.display = 'none';
    // Auto-fill project form fields if modal is open
    var brandEl = document.getElementById('add-proj-brand');
    var phoneEl = document.getElementById('add-proj-phone');
    var addrEl = document.getElementById('add-proj-address');
    var catEl = document.getElementById('add-proj-category');
    if (brandEl && !brandEl.value) brandEl.value = bName;
    if (phoneEl && !phoneEl.value) phoneEl.value = bPhone;
    if (addrEl && !addrEl.value) addrEl.value = bAddr;
    if (catEl && !catEl.value) catEl.value = bCategory;
    // Refresh project list to show connected status
    loadProjectsData();
  } catch(e) {
    showToast('Failed to save GMB: ' + e.message, 'error');
  }
}

/* =======================================================
   COMPETITORS MANAGEMENT PANEL
   ======================================================= */

function toggleCompetitorsPanel(header) {
  var body = document.getElementById('comp-mgmt-body');
  if (!body) return;
  var isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : '';
  var chevron = header.querySelector('.comp-panel-chevron');
  if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
  if (!isOpen) loadManagedCompetitors();
}

function showCompetitorsPanel() {
  var panel = document.getElementById('competitors-mgmt');
  if (!panel) return;
  var domain = SEO.activeProject;
  if (!domain) { panel.style.display = 'none'; return; }
  panel.style.display = '';
  setHtml('comp-mgmt-domain', escHtml(domain));
}

function loadManagedCompetitors() {
  var domain = SEO.activeProject;
  if (!domain) return;
  var proj = _projectsCache[domain] || {};
  var competitors = (proj.competitors || []).filter(Boolean);
  var container = document.getElementById('comp-mgmt-list');
  if (!container) return;

  if (competitors.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:#64687a;font-size:12px;padding:16px">No competitors set. Use "Auto-Discover" or add manually above.</div>';
    return;
  }

  var html = '<div style="display:flex;flex-wrap:wrap;gap:6px">';
  competitors.forEach(function(comp, idx) {
    html += '<div style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px;background:#1a1a22;border:1px solid rgba(66,71,84,0.2);border-radius:8px;font-size:12px;color:#e4e1e9;transition:all 150ms" onmouseover="this.style.borderColor=\'rgba(173,198,255,0.3)\'" onmouseout="this.style.borderColor=\'rgba(66,71,84,0.2)\'">'
      + '<img src="https://www.google.com/s2/favicons?domain=' + encodeURIComponent(comp) + '&sz=16" width="14" height="14" style="border-radius:2px" onerror="this.style.display=\'none\'"/>'
      + '<span style="font-weight:600">' + escHtml(comp) + '</span>'
      + '<span onclick="removeManagedCompetitor(\'' + escHtml(comp).replace(/'/g, "\\'") + '\',this.parentElement)" class="material-symbols-outlined" style="font-size:14px;color:#64687a;cursor:pointer;margin-left:2px;transition:color 150ms" onmouseover="this.style.color=\'#ef4444\'" onmouseout="this.style.color=\'#64687a\'" title="Remove competitor">close</span>'
      + '</div>';
  });
  html += '</div>';
  container.innerHTML = html;
}

async function addManagedCompetitor() {
  var domain = SEO.activeProject;
  if (!domain) { showToast('Select a project first', 'warning'); return; }
  var input = document.getElementById('comp-mgmt-input');
  var raw = (input?.value || '').trim();
  if (!raw) return;

  var newComps = raw.split(',').map(function(s) {
    return s.trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase();
  }).filter(function(d) { return d && d !== domain && !isGenericDomain(d); });

  if (newComps.length === 0) { showToast('Enter valid competitor domains', 'warning'); return; }

  var proj = _projectsCache[domain] || {};
  var existing = (proj.competitors || []).map(function(c) { return c.toLowerCase(); });
  var merged = existing.slice();
  newComps.forEach(function(c) { if (merged.indexOf(c) === -1) merged.push(c); });

  try {
    await SEO.saveProject({ domain: domain, competitors: merged });
    if (_projectsCache[domain]) _projectsCache[domain].competitors = merged;
    if (input) input.value = '';
    showToast('Added ' + newComps.length + ' competitor' + (newComps.length > 1 ? 's' : ''), 'success');
    loadManagedCompetitors();
  } catch(e) {
    showToast('Failed to save: ' + e.message, 'error');
  }
}

async function removeManagedCompetitor(comp, chipEl) {
  var domain = SEO.activeProject;
  if (!domain) return;
  var proj = _projectsCache[domain] || {};
  var updated = (proj.competitors || []).filter(function(c) { return c.toLowerCase() !== comp.toLowerCase(); });

  try {
    await SEO.saveProject({ domain: domain, competitors: updated });
    if (_projectsCache[domain]) _projectsCache[domain].competitors = updated;
    if (chipEl) {
      chipEl.style.opacity = '0';
      chipEl.style.transform = 'scale(0.8)';
      chipEl.style.transition = 'all 200ms';
      setTimeout(function() { chipEl.remove(); }, 200);
    }
    showToast('Competitor removed', 'success');
  } catch(e) {
    showToast('Failed to remove: ' + e.message, 'error');
  }
}

async function discoverCompetitors(btn) {
  var domain = SEO.activeProject;
  if (!domain) { showToast('Select a project first', 'warning'); return; }
  if (!checkBalanceWarning(0.02)) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Discovering...'; }

  try {
    var res = await SEO.dfs('dataforseo_labs/google/competitors_domain/live', {
      target: domain,
      location_name: getProjectLocLang().location_name,
      language_name: getProjectLocLang().language_name,
      limit: 15
    });
    var items = res?.tasks?.[0]?.result?.[0]?.items || [];
    var discovered = items.map(function(i) { return (i.domain || '').replace(/^www\./, ''); })
      .filter(function(d) { return d && d !== domain && !isGenericDomain(d); });

    if (discovered.length > 0) {
      var proj = _projectsCache[domain] || {};
      var existing = (proj.competitors || []).map(function(c) { return c.toLowerCase(); });
      var merged = existing.slice();
      discovered.forEach(function(c) { if (merged.indexOf(c.toLowerCase()) === -1) merged.push(c); });
      merged = merged.slice(0, 20);
      await SEO.saveProject({ domain: domain, competitors: merged });
      if (_projectsCache[domain]) _projectsCache[domain].competitors = merged;
      showToast('Discovered ' + discovered.length + ' competitors', 'success');
      loadManagedCompetitors();
    } else {
      showToast('No competitors found for this domain', 'info');
    }
  } catch(e) {
    showToast('Discovery failed: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Auto-Discover'; }
  }
}
// SEO Platform — Dashboard/Overview Module
'use strict';

async function generateSEOReport(btn) {
  var domain = SEO.activeProject;
  if (!domain) {
    showToast('Select a project first', 'error');
    return;
  }
  var origText = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = '<span class="material-symbols-outlined text-[16px] animate-spin">progress_activity</span> Generating...';

  try {
    var resp = await fetch(SEO.API + '/report/generate?tenant=' + SEO.TENANT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: domain })
    });
    var data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Report generation failed');

    showToast('Report generated!', 'success');
    loadReportHistory();

    // Open the report in a new tab
    if (data.url) {
      window.open(data.url, '_blank');
    }
  } catch (err) {
    showToast('Report error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = origText.indexOf('Create') >= 0
      ? '<span class="material-symbols-outlined text-[16px]">summarize</span> Create Report'
      : 'Create Report';
  }
}

async function loadReportHistory() {
  var container = document.getElementById('report-history-list');
  if (!container) return;
  var domain = SEO.activeProject;

  try {
    var url = SEO.API + '/reports?tenant=' + SEO.TENANT;
    if (domain) url += '&domain=' + encodeURIComponent(domain);
    var resp = await fetch(url);
    var data = await resp.json();
    var reports = data.reports || [];

    if (!reports.length) {
      container.innerHTML = '<div style="text-align:center;color:#64687a;font-size:13px;padding:24px">' +
        '<span class="material-symbols-outlined" style="font-size:32px;display:block;margin-bottom:8px;opacity:0.5">description</span>' +
        'No reports generated yet. Click <strong style="color:#adc6ff">Create Report</strong> to generate your first comprehensive SEO report.</div>';
      return;
    }

    var html = '<div style="display:flex;flex-direction:column;gap:8px">';
    for (var i = 0; i < reports.length; i++) {
      var r = reports[i];
      var date = new Date(r.generatedAt);
      var dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      var timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      var kpis = r.kpis || {};
      var score = kpis.healthScore != null ? Math.round(kpis.healthScore) : '--';
      var scoreColor = score >= 80 ? '#4ade80' : score >= 50 ? '#facc15' : '#f87171';

      html += '<div onclick="window.open(\'/pages/' + r.fileName + '\', \'_blank\')" style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:#1a1a22;border:1px solid #1e1e24;border-radius:10px;cursor:pointer;transition:all 150ms" onmouseover="this.style.borderColor=\'#3b82f640\';this.style.background=\'#1e1e28\'" onmouseout="this.style.borderColor=\'#1e1e24\';this.style.background=\'#1a1a22\'">';
      html += '<div style="flex-shrink:0;width:40px;height:40px;border-radius:8px;background:#3b82f615;display:flex;align-items:center;justify-content:center"><span class="material-symbols-outlined" style="font-size:20px;color:#3b82f6">description</span></div>';
      html += '<div style="flex:1;min-width:0">';
      html += '<div style="font-size:13px;font-weight:700;color:#e4e1e9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + r.domain + '</div>';
      html += '<div style="font-size:11px;color:#64687a">' + dateStr + ' at ' + timeStr + '</div>';
      html += '</div>';
      html += '<div class="hidden md:flex" style="gap:16px;font-size:11px;color:#8c909f;font-weight:600">';
      html += '<span>' + (kpis.keywords || 0).toLocaleString() + ' kw</span>';
      html += '<span>' + (kpis.traffic || 0).toLocaleString() + ' traffic</span>';
      html += '<span>' + (kpis.backlinks || 0).toLocaleString() + ' links</span>';
      html += '<span style="color:' + scoreColor + '">' + score + '/100</span>';
      html += '</div>';
      html += '<span class="material-symbols-outlined" style="font-size:18px;color:#64687a;flex-shrink:0">open_in_new</span>';
      html += '</div>';
    }
    html += '</div>';
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = '<div style="text-align:center;color:#f87171;font-size:12px;padding:16px">Failed to load reports: ' + err.message + '</div>';
  }
}

async function loadDashboardData() {
  showViewLoading('dashboard');
  const domain = SEO.activeProject;
  if (!domain) {
    // Show prompt to select a website/project first
    var dashEl = document.getElementById('view-dashboard');
    if (dashEl) {
      var notice = dashEl.querySelector('.no-project-notice');
      if (!notice) {
        notice = document.createElement('div');
        notice.className = 'no-project-notice';
        notice.style.cssText = 'padding:60px 24px;text-align:center;color:#8c909f';
        notice.innerHTML = '<div style="font-size:40px;margin-bottom:16px;opacity:0.4">&#9776;</div>'
          + '<div style="font-size:18px;margin-bottom:8px;color:#e4e1e9">No website selected</div>'
          + '<div style="font-size:14px;margin-bottom:20px">Go to <a href="#" onclick="nav(\'projects\');return false" style="color:#adc6ff;text-decoration:underline">Projects</a> to add or select a website to analyze.</div>';
        dashEl.insertBefore(notice, dashEl.firstChild);
      }
    }
    return;
  }
  // Remove notice if project is now selected
  var oldNotice = document.querySelector('#view-dashboard .no-project-notice');
  if (oldNotice) oldNotice.remove();
  try {
    // Load from saved history (FREE)
    // API returns {queries: [...], stats: {...}} — tool names must match seoToolCategory() in server.js
    var [histRanked, histTraffic, histBacklinks, histCompetitors] = await Promise.all([
      SEO.history({ tool: 'ranked_keywords', target: domain, limit: 2 }).catch(function() { return {}; }),
      SEO.history({ tool: 'traffic_estimate', target: domain, limit: 2 }).catch(function() { return {}; }),
      SEO.history({ tool: 'backlinks', target: domain, limit: 2 }).catch(function() { return {}; }),
      SEO.history({ tool: 'competitors', target: domain, limit: 1 }).catch(function() { return {}; })
    ]);

    // Find most recent timestamp across all history queries
    var _dashTs = [histRanked, histTraffic, histBacklinks, histCompetitors]
      .map(function(h) { return h?.queries?.[0]?.created_at; }).filter(Boolean)
      .sort().reverse();
    if (_dashTs.length) setLastUpdated('dashboard', _dashTs[0]);

    // If no ranked_keywords history, try cheap domain_rank_overview ($0.01) for quick KPIs
    var rankedQueries = histRanked?.queries || [];
    if (rankedQueries.length === 0) {
      try {
        var dro = await SEO.history({ tool: 'domain_rank_overview', target: domain, limit: 1 }).catch(function() { return {}; });
        if (dro?.queries?.length > 0 && dro.queries[0].id) {
          var droFull = await SEO.historyById(dro.queries[0].id).catch(function() { return {}; });
          var droItem = droFull?.items?.[0] || {};
          if (droItem.organic) {
            setHtml('dash-organic-keywords', fmtNum(droItem.organic.count || 0));
            setHtml('dash-organic-traffic', fmtNum(Math.round(droItem.organic.etv || 0)));
            // Position distribution from overview
            if (droItem.organic.pos_1 != null) {
              setHtml('pos-dist-top3', fmtNum((droItem.organic.pos_1 || 0) + (droItem.organic.pos_2_3 || 0)));
              setHtml('pos-dist-4to10', fmtNum(droItem.organic.pos_4_10 || 0));
              setHtml('pos-dist-11to20', fmtNum(droItem.organic.pos_11_20 || 0));
              setHtml('pos-dist-21to100', fmtNum(droItem.organic.pos_21_100 || 0));
            }
          }
          if (droItem.paid) {
            var paidEl = document.getElementById('dash-paid-traffic');
            if (paidEl) paidEl.textContent = fmtNum(Math.round(droItem.paid.etv || 0));
          }
        }
      } catch(e) { console.warn('Domain rank overview fallback:', e); }
    }

    // Ranked keywords
    if (rankedQueries.length > 0) {
      var latest = rankedQueries[0];
      var prev = rankedQueries[1];
      var summary = latest.summary || {};
      var totalKw = summary.total_count || latest.result_count || summary.count || 0;
      var prevKw = prev ? (prev.summary?.total_count || prev.result_count || prev.summary?.count || 0) : 0;
      var change = pctChange(totalKw, prevKw);
      setHtml('dash-organic-keywords', fmtNum(totalKw));
      setHtml('dash-organic-keywords-change', '<span class="material-symbols-outlined text-[12px]">' + change.icon + '</span>' + change.text);
      var kwChangeEl = document.getElementById('dash-organic-keywords-change');
      if (kwChangeEl) kwChangeEl.setAttribute('class', 'text-[10px] font-medium tabular flex items-center ' + change.cls);
      // top3 count shown in Rank Tracking view; dashboard shows it via position distribution chart

      // Get full items for table + position distribution
      if (latest.id) {
        try {
          var fullData = await SEO.historyById(latest.id);
          var items = fullData?.items || [];
          if (items.length > 0) {
            renderDashTopKeywords(items.slice(0, 10));
            renderPositionDistribution(items);
          }
        } catch(e) { console.warn('Full ranked data load:', e); }
      }
    }

    // Traffic
    var trafficQueries = histTraffic?.queries || [];
    if (trafficQueries.length > 0) {
      var tLatest = trafficQueries[0];
      var tPrev = trafficQueries[1];
      // Get full items for traffic data
      if (tLatest.id) {
        try {
          var tFull = await SEO.historyById(tLatest.id);
          var tItems = tFull?.items || [];
          var etv = tItems[0]?.metrics?.organic?.etv || 0;
          var prevEtv = 0;
          if (tPrev?.id) {
            var tPrevFull = await SEO.historyById(tPrev.id).catch(function() { return {}; });
            prevEtv = (tPrevFull?.items || [])[0]?.metrics?.organic?.etv || 0;
          }
          var tChange = pctChange(etv, prevEtv);
          setHtml('dash-organic-traffic', fmtNum(Math.round(etv)));
          setHtml('dash-organic-traffic-change', tChange.text);
          var trafficChangeEl = document.getElementById('dash-organic-traffic-change');
          if (trafficChangeEl) trafficChangeEl.setAttribute('class', 'text-[10px] font-medium tabular ' + tChange.cls);
          // Traffic by country
          var countryEl = document.getElementById('dash-traffic-country');
          if (countryEl && tItems.length > 0) {
            var metrics = tItems[0]?.metrics || {};
            var countries = Object.entries(metrics).filter(function(e) { return e[0] !== 'organic' && e[0] !== 'paid' && e[1]?.etv > 0; })
              .map(function(e) { return { country: e[0], etv: e[1].etv || 0, count: e[1].count || 0 }; })
              .sort(function(a, b) { return b.etv - a.etv; }).slice(0, 5);
            if (countries.length > 0) {
              var maxEtv = countries[0].etv || 1;
              var cHtml = '';
              countries.forEach(function(c) {
                var pct = Math.round(c.etv / maxEtv * 100);
                cHtml += '<div class="flex items-center justify-between text-xs"><span class="text-on-surface-variant font-medium uppercase">' + escHtml(c.country) + '</span>'
                  + '<span class="text-on-surface tabular-nums font-bold">' + fmtNum(Math.round(c.etv)) + '</span></div>'
                  + '<div class="w-full h-1.5 bg-surface-container-highest rounded-full mt-1 mb-3"><div class="h-full bg-primary rounded-full" style="width:' + pct + '%"></div></div>';
              });
              countryEl.innerHTML = cHtml;
            }
          }
        } catch(e) { console.warn('Traffic data load:', e); }
      }
    }

    // Backlinks
    var blQueries = histBacklinks?.queries || [];
    if (blQueries.length > 0) {
      if (blQueries[0].id) {
        try {
          var blFull = await SEO.historyById(blQueries[0].id);
          var blItems = blFull?.items || [];
          // backlinks/summary returns result as the item itself
          var blData = blItems[0] || blFull?.summary || {};
          var totalBl = blData.backlinks || 0;
          var refDomains = blData.referring_domains || 0;
          var rank = blData.rank || 0;
          var dofollow = totalBl > 0 ? Math.round((totalBl - (blData.backlinks_nofollow || 0)) / totalBl * 100) : 0;
          setHtml('dash-backlinks', fmtNum(totalBl));
          setHtml('dash-referring-domains', fmtNum(refDomains));
          setHtml('dash-domain-authority', rank);
          setHtml('dash-domain-authority-rank', 'Rank ' + fmtNum(rank));
          setHtml('dash-backlinks-total', fmtNum(totalBl));
          setHtml('dash-backlinks-dofollow', dofollow + '%');
          setHtml('dash-backlinks-nofollow', (100 - dofollow) + '%');
        } catch(e) { console.warn('Backlinks data load:', e); }
      }
    }

    // Competitors
    var compQueries = histCompetitors?.queries || [];
    if (compQueries.length > 0 && compQueries[0].id) {
      try {
        var compFull = await SEO.historyById(compQueries[0].id);
        var compItems = compFull?.items || [];
        if (compItems.length > 0) {
          renderDashCompetitors(compItems.slice(0, 20), domain);
        }
      } catch(e) { console.warn('Competitors data load:', e); }
    }

    // Site Health — load from accumulated audits
    try {
      var auditData = await SEO.accumulatedAudits(domain).catch(function() { return {}; });
      var audits = auditData?.audits || [];
      if (audits.length > 0) {
        var latestAudit = audits[audits.length - 1]; // ASC order, last = newest
        var healthScore = latestAudit.onpage_score || 0;
        setHtml('dash-site-health', Math.round(healthScore) + '%');
        setHtml('dash-health-pct', Math.round(healthScore) + '% Health');
        setHtml('dash-health-score', Math.round(healthScore));
        setHtml('dash-health-critical', latestAudit.errors || 0);
        setHtml('dash-health-warning', latestAudit.warnings || 0);
        setHtml('dash-health-notice', latestAudit.notices || 0);
      }
    } catch(e) { console.warn('Dashboard health load:', e); }

    // Render overview trend chart
    renderOverviewTrend();
    loadReportHistory();

  } catch (e) {
    console.warn('Dashboard load error:', e);
  } finally {
    hideViewLoading('dashboard');
  }
}

function renderDashTopKeywords(items) {
  const tbody = document.getElementById('dash-top-keywords-body');
  if (!tbody) return;
  let html = '';
  items.forEach(function(item) {
    const kw = item?.keyword_data?.keyword || item?.keyword || '';
    const pos = item?.ranked_serp_element?.serp_item?.rank_group || item?.position || '--';
    const vol = item?.keyword_data?.keyword_info?.search_volume || item?.search_volume || 0;
    const etv = item?.ranked_serp_element?.serp_item?.etv || 0;
    const totalEtv = items.reduce(function(s, i) { return s + (i?.ranked_serp_element?.serp_item?.etv || 0); }, 0);
    const trafficPct = totalEtv > 0 ? (etv / totalEtv * 100).toFixed(1) : '0';
    html += '<tr class="hover:bg-surface-container-high transition-colors tabular">'
      + '<td style="padding:6px 8px;font-size:11px;font-weight:500;color:#e4e1e9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px">' + escHtml(kw) + '</td>'
      + '<td style="padding:6px 8px;text-align:right">' + positionBadge(pos) + '</td>'
      + '<td style="padding:6px 8px;text-align:right;font-size:11px;color:#8c909f">' + fmtNum(vol) + '</td>'
      + '<td style="padding:6px 8px;text-align:right;font-size:11px;color:#8c909f">' + trafficPct + '%</td>'
      + '<td style="padding:6px 8px;text-align:center"><svg class="mx-auto" height="12" width="40"><path d="M0 8 L10 6 L20 4 L30 5 L40 3" fill="none" stroke="#4ae176" stroke-width="1.5"></path></svg></td>'
      + '</tr>';
  });
  tbody.innerHTML = html;
}

function renderPositionDistribution(items) {
  let top3 = 0, p4to10 = 0, p11to20 = 0, p21to100 = 0;
  items.forEach(function(item) {
    const pos = item?.ranked_serp_element?.serp_item?.rank_group || 999;
    if (pos <= 3) top3++;
    else if (pos <= 10) p4to10++;
    else if (pos <= 20) p11to20++;
    else p21to100++;
  });
  const total = items.length || 1;
  // Update position tracking view if elements exist
  setHtml('pos-dist-top3', top3 + ' <span class="text-[10px] text-on-surface-variant font-normal">(' + (top3/total*100).toFixed(1) + '%)</span>');
  setHtml('pos-dist-4to10', p4to10 + ' <span class="text-[10px] text-on-surface-variant font-normal">(' + (p4to10/total*100).toFixed(1) + '%)</span>');
  setHtml('pos-dist-11to20', p11to20 + ' <span class="text-[10px] text-on-surface-variant font-normal">(' + (p11to20/total*100).toFixed(1) + '%)</span>');
  setHtml('pos-dist-21to100', p21to100 + ' <span class="text-[10px] text-on-surface-variant font-normal">(' + (p21to100/total*100).toFixed(1) + '%)</span>');
}

// Generic domains that appear as "competitors" due to keyword overlap but are NOT real business competitors
var _genericDomains = [
  'youtube.com','facebook.com','reddit.com','twitter.com','x.com','instagram.com','linkedin.com',
  'pinterest.com','tiktok.com','wikipedia.org','amazon.com','yelp.com','bbb.org','glassdoor.com',
  'indeed.com','quora.com','medium.com','apple.com','google.com','microsoft.com','yahoo.com',
  'bing.com','nextdoor.com','tripadvisor.com','trustpilot.com','craigslist.org','ebay.com',
  'walmart.com','homedepot.com','lowes.com','angieslist.com','angi.com','thumbtack.com',
  'homeadvisor.com','mapquest.com','yellowpages.com','whitepages.com'
];

/* DataForSEO category code → name lookup */
var DFS_CATEGORY_NAMES = {
  10001:"Vehicles",10002:"Family & Community",10003:"Real Estate",10004:"Business & Industrial",10005:"Beauty & Personal Care",
  10006:"Computers & Electronics",10007:"Internet & Telecom",10008:"Online Communities",10009:"Home & Garden",10010:"Food & Groceries",
  10011:"Health",10012:"Finance",10013:"Arts & Entertainment",10014:"Sports & Fitness",10015:"Hobbies & Leisure",10016:"Jobs & Education",
  10017:"Travel & Tourism",10018:"Law & Government",10019:"Science",10020:"Pets & Animals",10021:"Apparel",10022:"Shopping",
  10023:"News & Media",10024:"Motor Vehicles",10026:"Vehicle Parts & Accessories",10028:"Community Service & Social Organizations",
  10031:"Romance & Relationships",10042:"Real Estate Listings",10085:"Health Conditions & Concerns",10091:"Health Care Services",
  10095:"Investing",10098:"Business News & Media",10102:"Insurance",10105:"Entertainment Industry",10121:"Sporting Goods",
  10139:"Jobs & Careers",10141:"Education & Training",10145:"Tourist Attractions & Destinations",10161:"Legal Forms & Kits",
  10163:"Legal",10186:"Commercial Vehicles",10253:"Consumer Vehicle Shipping Services",10276:"Business Management",
  10282:"Building Construction & Maintenance",10303:"Business & Commercial Insurance",10404:"Home Improvement & Maintenance",
  10418:"Home Heating & Cooling",10457:"Weight Loss",10462:"Sexual & Reproductive Health",10487:"Dental Health",
  10514:"Dentists & Dental Services",10539:"Life Insurance",10544:"Health Insurance",10545:"Liability Insurance",
  10546:"Travel Insurance",10547:"Property Insurance",10548:"Disaster Insurance",10550:"Vehicle Insurance",
  10856:"Labor & Employment Law",11005:"Work & Labor Issues",11067:"Occupational Health & Safety",11084:"Human Resources",
  11098:"Management Consulting",11140:"Roofing Installation & Repair",11141:"Commercial & General Contracting",
  11143:"Electrician Services",11145:"Construction Estimation",11151:"Building Restoration & Preservation",
  11154:"Construction Consulting",11285:"Roofing",11365:"Worker's Compensation Insurance",
  11366:"Professional Liability & Malpractice Insurance",11848:"Personal Liability Insurance",11849:"Homeowners Insurance",
  11854:"Car Insurance",12373:"Compensation & Benefits",12387:"Tax Preparation & Planning",12394:"Risk Management",
  13414:"Government",13464:"Industrial Goods & Manufacturing",13686:"Attorneys & Law Firms"
};

/* Domain keywords pagination state */
var _domainKwPage = 0;
var _domainKwItems = [];

function renderDashCompetitors(items, ownDomain) {
  const tbody = document.getElementById('dash-competitors-body');
  if (!tbody) return;

  // Filter out generic/social/marketplace domains — keep only real business competitors
  var filtered = items.filter(function(item) {
    var d = (item.domain || '').toLowerCase().replace(/^www\./, '');
    if (d === ownDomain.toLowerCase().replace(/^www\./, '')) return false;
    return !_genericDomains.some(function(g) { return d === g || d.endsWith('.' + g); });
  });

  // Pull own-domain stats from the already-rendered KPI elements
  var ownKw = document.getElementById('dash-organic-keywords')?.textContent?.replace(/[^0-9]/g, '') || '--';
  var ownTraffic = document.getElementById('dash-organic-traffic')?.textContent?.replace(/[^0-9]/g, '') || '--';
  var ownBl = document.getElementById('dash-backlinks')?.textContent?.replace(/[^0-9]/g, '') || '--';

  // Add own domain as first row with actual stats
  var cp = 'padding:6px 8px;font-size:11px;';
  let html = '<tr style="background:rgba(59,130,246,0.05)">'
    + '<td style="' + cp + 'font-weight:700;color:#60a5fa">' + escHtml(ownDomain) + '</td>'
    + '<td style="' + cp + 'text-align:right;font-weight:600;color:#e4e1e9">' + (ownKw || '--') + '</td>'
    + '<td style="' + cp + 'text-align:right;font-weight:600;color:#e4e1e9">' + (ownTraffic || '--') + '</td>'
    + '<td style="' + cp + 'text-align:right;font-weight:600;color:#e4e1e9">' + (ownBl || '--') + '</td>'
    + '<td style="' + cp + 'text-align:right;color:#8c909f">—</td></tr>';
  // Auto-save discovered competitors to project
  var newComps = filtered.slice(0, 10).map(function(i) { return (i.domain || '').toLowerCase().replace(/^www\./, ''); }).filter(Boolean);
  if (newComps.length > 0) {
    var proj = _projectsCache[ownDomain] || {};
    var existing = (proj.competitors || []).map(function(c) { return c.toLowerCase(); });
    var toAdd = newComps.filter(function(c) { return existing.indexOf(c) === -1; });
    if (toAdd.length > 0) {
      var merged = existing.concat(toAdd).slice(0, 20);
      SEO.saveProject(Object.assign({}, proj, { domain: ownDomain, competitors: merged })).catch(function() {});
      if (_projectsCache[ownDomain]) _projectsCache[ownDomain].competitors = merged;
    }
  }

  filtered.slice(0, 10).forEach(function(item) {
    const compDomain = item.domain || '';
    const kws = item.metrics?.organic?.count || 0;
    const etv = item.metrics?.organic?.etv || 0;
    const avgPos = item.avg_position ? item.avg_position.toFixed(1) : '--';
    html += '<tr class="hover:bg-surface-container-high transition-colors">'
      + '<td style="' + cp + 'font-weight:500;color:#e4e1e9">' + escHtml(compDomain) + '</td>'
      + '<td style="' + cp + 'text-align:right;color:#8c909f">' + fmtNum(kws) + '</td>'
      + '<td style="' + cp + 'text-align:right;color:#8c909f">' + fmtNum(Math.round(etv)) + '</td>'
      + '<td style="' + cp + 'text-align:right;color:#8c909f">--</td>'
      + '<td style="' + cp + 'text-align:right;color:#8c909f">' + avgPos + '</td></tr>';
  });

  // If all competitors were filtered out, show a note
  if (filtered.length === 0) {
    html += '<tr><td colspan="5" style="' + cp + 'text-align:center;color:#64687a;padding:16px 8px">No direct competitors found. Refresh to fetch more.</td></tr>';
  }

  tbody.innerHTML = html;
}

async function refreshDashboard(btn) {
  const domain = SEO.activeProject;
  if (!domain) { showToast('Select a project first', 'warning'); return; }
  if (!checkBalanceWarning(0.04)) return;
  debounceAction('refreshDashboard', async function() {
    SEO.startAction();
    if (btn) { btn.disabled = true; btn.innerHTML = '<span style="display:inline-block;width:14px;height:14px;border:2px solid #35343a;border-top-color:#adc6ff;border-radius:50%;animation:spin 0.8s linear infinite;margin-right:6px"></span>Refreshing...'; }
    var loc = getProjectLocLang();
    try {
      const results = await Promise.all([
        SEO.dfs('dataforseo_labs/google/ranked_keywords/live', { target: domain, language_name: loc.language_name, location_name: loc.location_name, limit: 100 }).catch(function(e) { return { error: e.message }; }),
        SEO.dfs('dataforseo_labs/google/bulk_traffic_estimation/live', { targets: [domain] }).catch(function(e) { return { error: e.message }; }),
        SEO.dfs('dataforseo_labs/google/competitors_domain/live', { target: domain, language_name: loc.language_name, location_name: loc.location_name, limit: 20 }).catch(function(e) { return { error: e.message }; }),
        SEO.dfs('dataforseo_labs/google/domain_rank_overview/live', { target: domain, language_name: loc.language_name, location_name: loc.location_name }).catch(function(e) { return { error: e.message }; })
      ]);
      var ac = SEO.getActionCost();
      showToast('Dashboard refreshed — ' + ac.calls + ' API calls, actual cost: ' + SEO.fmtCost(ac.cost), 'success', 6000);
      loadDashboardData();
    } catch (e) {
      showToast('Refresh failed: ' + e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = 'Refresh Data (~$0.03)'; }
    }
  });
}
// SEO Platform — Keyword Magic Tool
'use strict';

/* =======================================================
   PHASE 2.3 - KEYWORD MAGIC WIRING
   ======================================================= */
var _kwData = []; // Holds current keyword data for client-side filtering
var _kwFilters = { minVol: 0, maxVol: Infinity, minKd: 0, maxKd: 100, minCpc: 0, maxCpc: Infinity, include: '', exclude: '', tab: 'all' };
var _kwResearchMode = 'suggestions'; // suggestions | ideas | related | categories

function switchKwTab(btn, tab) {
  _kwFilters.tab = tab;
  // Update tab styles
  document.querySelectorAll('.kw-tab').forEach(function(t) {
    t.classList.remove('font-bold', 'border-b-2', 'border-primary', 'text-primary');
    t.classList.add('font-medium', 'text-on-surface-variant');
  });
  btn.classList.remove('font-medium', 'text-on-surface-variant');
  btn.classList.add('font-bold', 'border-b-2', 'border-primary', 'text-primary');
  renderKeywordsTable(_kwData, 0);
  updateKeywordStats(_kwFiltered || _kwData);
}

async function loadKeywordsData() {
  showViewLoading('keywords');
  const domain = SEO.activeProject;
  if (!domain) {
    var kwEl = document.getElementById('view-keywords');
    if (kwEl) {
      var notice = kwEl.querySelector('.no-project-notice');
      if (!notice) {
        notice = document.createElement('div');
        notice.className = 'no-project-notice';
        notice.style.cssText = 'padding:60px 24px;text-align:center;color:#8c909f';
        notice.innerHTML = '<div style="font-size:40px;margin-bottom:16px;opacity:0.4">&#128270;</div>'
          + '<div style="font-size:18px;margin-bottom:8px;color:#e4e1e9">No website selected</div>'
          + '<div style="font-size:14px;margin-bottom:20px">Select a website from <a href="#" onclick="nav(\'projects\');return false" style="color:#adc6ff;text-decoration:underline">Projects</a> first.</div>';
        kwEl.insertBefore(notice, kwEl.firstChild);
      }
    }
    return;
  }
  var oldNotice = document.querySelector('#view-keywords .no-project-notice');
  if (oldNotice) oldNotice.remove();
  try {
    // Load ALL accumulated keywords for this tenant (no domain filter — keyword research is cross-domain)
    var data = await SEO.accumulatedKeywords({});
    var keywords = data?.keywords || [];
    if (keywords.length > 0) {
      // Map accumulated format to table format
      _kwData = keywords.map(function(k) {
        return {
          keyword: k.keyword,
          search_volume: k.volume || 0,
          cpc: k.cpc || 0,
          competition: k.competition || '',
          kd: k.difficulty || 0,
          keyword_difficulty: k.difficulty || 0,
          intent: k.intent || '',
          rank: k.rank,
          domain: k.domain,
          source: k.source
        };
      });
      renderKeywordsTable(_kwData);
      updateKeywordStats(_kwData);
      renderKeywordClusters(_kwData);
    }
    // If no accumulated data, try history fallback
    if (keywords.length === 0) {
      var hist = await SEO.history({ tool: 'keyword_suggestions', limit: 1 }).catch(function() { return {}; });
      var histQueries = hist?.queries || [];
      if (histQueries.length > 0 && histQueries[0].id) {
        var full = await SEO.historyById(histQueries[0].id).catch(function() { return {}; });
        var items = full?.items || [];
        if (items.length > 0) {
          _kwData = items.map(function(i) {
            return {
              keyword: i.keyword,
              search_volume: i.keyword_info?.search_volume || 0,
              cpc: i.keyword_info?.cpc || 0,
              competition: i.keyword_info?.competition_level || '',
              kd: i.keyword_properties?.keyword_difficulty || 0,
              intent: i.intent || '',
              source: 'keyword_suggestions'
            };
          });
          renderKeywordsTable(_kwData);
          updateKeywordStats(_kwData);
          renderKeywordClusters(_kwData);
        }
      }
    }
  } catch (e) {
    console.warn('Keywords load error:', e);
  } finally {
    hideViewLoading('keywords');
  }
}

var _kwPage = 0;
var _kwPerPage = 50;
var _kwFiltered = [];

function renderKeywordsTable(data, page) {
  const tbody = document.querySelector('#view-keywords .divide-y.divide-outline-variant\\/10');
  if (!tbody) return;
  if (typeof page === 'number') _kwPage = page;
  // Apply filters
  _kwFiltered = data.filter(function(kw) {
    const vol = kw.search_volume || 0;
    const kd = kw.kd || kw.keyword_difficulty || 0;
    const cpc = kw.cpc || 0;
    if (vol < _kwFilters.minVol || vol > _kwFilters.maxVol) return false;
    if (kd < _kwFilters.minKd || kd > _kwFilters.maxKd) return false;
    if (cpc < _kwFilters.minCpc || cpc > _kwFilters.maxCpc) return false;
    if (_kwFilters.include && kw.keyword && kw.keyword.indexOf(_kwFilters.include) === -1) return false;
    if (_kwFilters.exclude && kw.keyword && kw.keyword.indexOf(_kwFilters.exclude) !== -1) return false;
    if (_kwFilters.tab === 'questions') {
      const qWords = ['who','what','when','where','why','how','can','does','is','are','will','should'];
      const first = (kw.keyword || '').split(' ')[0].toLowerCase();
      if (qWords.indexOf(first) === -1) return false;
    }
    if (_kwFilters.tab === 'broad' || _kwFilters.tab === 'phrase' || _kwFilters.tab === 'exact') {
      var seed = (document.querySelector('#view-keywords input[type="text"]')?.value || '').trim().toLowerCase();
      if (!seed) return false; // no seed = can't match, show hint via _kwNeedsSeed flag
      var kwLower = (kw.keyword || '').toLowerCase();
      if (_kwFilters.tab === 'exact' && kwLower !== seed) return false;
      if (_kwFilters.tab === 'phrase' && kwLower.indexOf(seed) === -1) return false;
      if (_kwFilters.tab === 'broad') {
        var seedWords = seed.split(/\s+/);
        var hasAny = seedWords.some(function(w) { return w.length > 2 && kwLower.indexOf(w) !== -1; });
        if (!hasAny) return false;
      }
    }
    return true;
  });
  // Sort by volume descending
  _kwFiltered.sort(function(a, b) { return (b.search_volume || 0) - (a.search_volume || 0); });
  // Paginate
  var start = _kwPage * _kwPerPage;
  var end = start + _kwPerPage;
  const shown = _kwFiltered.slice(start, end);
  let html = '';
  shown.forEach(function(kw) {
    const keyword = kw.keyword || '';
    const vol = kw.search_volume || 0;
    const kd = kw.kd || kw.keyword_difficulty || 0;
    const cpc = kw.cpc || 0;
    const comp = kw.competition || kw.competition_level || '';
    const intent = kw.intent || '';
    const kdCol = kdColor(kd);
    html += '<tr class="hover:bg-surface-container-high transition-colors group">'
      + '<td class="px-2 md:px-4 py-4 md:py-5"><div class="flex items-center gap-2">'
      + '<span class="material-symbols-outlined text-sm text-outline-variant group-hover:text-primary cursor-pointer" data-track-kw="' + escHtml(keyword) + '">add_circle</span>'
      + '<span class="text-xs md:text-sm font-medium text-on-surface">' + escHtml(keyword) + '</span></div></td>'
      + '<td class="px-2 md:px-4 py-5 hidden md:table-cell">' + intentBadge(intent) + '</td>'
      + '<td class="px-2 md:px-4 py-4 md:py-5 text-right tabular-nums text-xs md:text-sm font-semibold">' + fmtNum(vol) + '</td>'
      + '<td class="px-2 md:px-4 py-5 hidden md:table-cell"><div class="flex items-end justify-center gap-0.5 h-6">'
      + '<div class="w-1 bg-primary/30 h-3 rounded-t-[1px]"></div><div class="w-1 bg-primary/50 h-4 rounded-t-[1px]"></div><div class="w-1 bg-primary/70 h-5 rounded-t-[1px]"></div><div class="w-1 bg-primary h-6 rounded-t-[1px]"></div><div class="w-1 bg-primary/80 h-4 rounded-t-[1px]"></div>'
      + '</div></td>'
      + '<td class="px-2 md:px-4 py-4 md:py-5"><div class="flex items-center gap-2 md:gap-3"><span class="text-xs tabular-nums w-6 md:w-8">' + Math.round(kd) + '</span>'
      + '<div class="flex-1 h-1 bg-surface-container-highest rounded-full min-w-[60px] overflow-hidden"><div class="h-full rounded-full" style="width:' + Math.min(kd, 100) + '%;background:' + kdCol + '"></div></div></div></td>'
      + '<td class="px-2 md:px-4 py-4 md:py-5 text-right tabular-nums text-xs md:text-sm">' + fmtMoney(cpc) + '</td>'
      + '<td class="px-2 md:px-4 py-5 text-center tabular-nums text-sm hidden md:table-cell">' + (comp ? escHtml(String(comp).substring(0, 4)) : '--') + '</td>'
      + '<td class="px-2 md:px-4 py-5 text-center hidden md:table-cell"><span class="material-symbols-outlined text-on-surface-variant text-lg">visibility</span></td>'
      + '</tr>';
  });
  if (shown.length === 0) {
    var needsSeed = (_kwFilters.tab === 'broad' || _kwFilters.tab === 'phrase' || _kwFilters.tab === 'exact')
      && !(document.querySelector('#view-keywords input[type="text"]')?.value || '').trim();
    var emptyMsg = needsSeed
      ? 'Enter a search term above to use ' + _kwFilters.tab.charAt(0).toUpperCase() + _kwFilters.tab.slice(1) + ' Match filtering'
      : 'No keywords match your filters';
    html = '<tr><td colspan="8" style="padding:40px;text-align:center;color:#8c909f">' + emptyMsg + '</td></tr>';
  }
  tbody.innerHTML = html;
  // Event delegation for track keyword (fixes XSS from inline onclick)
  tbody.querySelectorAll('[data-track-kw]').forEach(function(el) {
    el.addEventListener('click', function() { trackKw(el.getAttribute('data-track-kw')); });
  });
  // Render pagination controls
  renderKwPagination(_kwFiltered.length);
}

function renderKwPagination(totalItems) {
  var totalPages = Math.ceil(totalItems / _kwPerPage);
  var paginationEl = document.querySelector('#view-keywords .flex.items-center.justify-between.mt-8');
  if (!paginationEl) return;
  var start = _kwPage * _kwPerPage + 1;
  var end = Math.min((_kwPage + 1) * _kwPerPage, totalItems);
  var html = '<div class="text-xs text-on-surface-variant">'
    + 'Showing <span class="text-on-surface font-bold">' + start + '-' + end + '</span> of ' + fmtNum(totalItems) + ' keywords'
    + '</div><div class="flex items-center gap-2">';
  if (_kwPage > 0) {
    html += '<button onclick="kwPageNav(0)" class="px-2 py-1 text-xs bg-surface-container rounded" style="min-height:32px;border:1px solid #35343a;color:#adc6ff;cursor:pointer">First</button>';
    html += '<button onclick="kwPageNav(' + (_kwPage - 1) + ')" class="px-2 py-1 text-xs bg-surface-container rounded" style="min-height:32px;border:1px solid #35343a;color:#adc6ff;cursor:pointer">Prev</button>';
  }
  html += '<span class="text-xs text-on-surface-variant px-2">Page ' + (_kwPage + 1) + ' of ' + totalPages + '</span>';
  if (_kwPage < totalPages - 1) {
    html += '<button onclick="kwPageNav(' + (_kwPage + 1) + ')" class="px-2 py-1 text-xs bg-surface-container rounded" style="min-height:32px;border:1px solid #35343a;color:#adc6ff;cursor:pointer">Next</button>';
    html += '<button onclick="kwPageNav(' + (totalPages - 1) + ')" class="px-2 py-1 text-xs bg-surface-container rounded" style="min-height:32px;border:1px solid #35343a;color:#adc6ff;cursor:pointer">Last</button>';
  }
  html += '</div>';
  paginationEl.innerHTML = html;
}

function kwPageNav(page) {
  _kwPage = page;
  renderKeywordsTable(_kwData, page);
  // Scroll to top of keywords view
  var view = document.getElementById('view-keywords');
  if (view) view.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updateKeywordStats(data) {
  const totalKw = data.length;
  const totalVol = data.reduce(function(s, k) { return s + (k.search_volume || 0); }, 0);
  // Update the stats in the keyword magic tab bar
  const statsArea = document.querySelector('#view-keywords .ml-auto.hidden.md\\:flex');
  if (statsArea) {
    statsArea.innerHTML = '<span class="text-xs text-on-surface-variant">Keywords: <span class="text-on-surface font-bold tabular-nums">' + fmtNum(totalKw) + '</span></span>'
      + '<span class="text-xs text-on-surface-variant">Total Vol: <span class="text-on-surface font-bold tabular-nums">' + fmtNum(totalVol) + '</span></span>';
  }
  // Pagination text is handled by renderKwPagination() — no need to duplicate here
}

function renderKeywordClusters(data) {
  var container = document.getElementById('kwm-clusters');
  if (!container || !data || data.length === 0) return;
  // Extract 2+ word common terms from keywords
  var wordCounts = {};
  data.forEach(function(k) {
    var words = (k.keyword || '').toLowerCase().split(/\s+/);
    words.forEach(function(w) {
      if (w.length > 3) { wordCounts[w] = (wordCounts[w] || 0) + 1; }
    });
  });
  // Sort by frequency, take top 6
  var clusters = Object.keys(wordCounts)
    .map(function(w) { return { word: w, count: wordCounts[w] }; })
    .filter(function(c) { return c.count >= 2; })
    .sort(function(a,b) { return b.count - a.count; })
    .slice(0, 6);
  if (clusters.length === 0) { container.innerHTML = '<div class="text-[10px] text-on-surface-variant text-center py-3">No clusters found</div>'; return; }
  var html = '';
  clusters.forEach(function(c) {
    html += '<div class="flex justify-between items-center p-2 rounded hover:bg-surface-container-highest cursor-pointer group transition-colors" onclick="filterByCluster(\'' + escHtml(c.word) + '\')">'
      + '<span class="text-sm text-on-surface/90">' + escHtml(c.word.charAt(0).toUpperCase() + c.word.slice(1)) + '</span>'
      + '<span class="text-[10px] tabular-nums text-on-surface-variant bg-surface-container px-2 py-0.5 rounded">' + c.count + '</span></div>';
  });
  container.innerHTML = html;
}

function applyKwFilters() {
  if (!_kwData) return;
  var kdMin = parseInt(document.getElementById('kwm-kd-min')?.value || '0');
  var kdMax = parseInt(document.getElementById('kwm-kd-max')?.value || '100');
  var volMin = parseInt(document.getElementById('kwm-vol-min')?.value || '') || 0;
  var volMax = parseInt(document.getElementById('kwm-vol-max')?.value || '') || Infinity;
  var cpcMin = parseFloat(document.getElementById('kwm-cpc-min')?.value || '') || 0;
  var cpcMax = parseFloat(document.getElementById('kwm-cpc-max')?.value || '') || Infinity;
  var include = (document.getElementById('kwm-include')?.value || '').trim().toLowerCase();
  var exclude = (document.getElementById('kwm-exclude')?.value || '').trim().toLowerCase();
  var filtered = _kwData.filter(function(k) {
    var kd = k.kd || 0;
    var vol = k.volume || 0;
    var cpc = k.cpc || 0;
    var kw = (k.keyword || '').toLowerCase();
    if (kd < kdMin || kd > kdMax) return false;
    if (vol < volMin || vol > volMax) return false;
    if (cpc < cpcMin || cpc > cpcMax) return false;
    if (include && kw.indexOf(include) === -1) return false;
    if (exclude && kw.indexOf(exclude) !== -1) return false;
    return true;
  });
  renderKeywordsTable(filtered);
}

function filterByCluster(word) {
  if (!_kwData) return;
  var filtered = _kwData.filter(function(k) { return (k.keyword || '').toLowerCase().indexOf(word.toLowerCase()) !== -1; });
  renderKeywordsTable(filtered);
  showToast('Filtered to ' + filtered.length + ' keywords containing "' + word + '"', 'info');
}

function setKwResearchMode(mode, btn) {
  _kwResearchMode = mode;
  document.querySelectorAll('.kw-mode-btn').forEach(function(b) {
    if (b.getAttribute('data-mode') === mode) {
      b.className = 'kw-mode-btn px-3 py-1.5 rounded-lg text-xs font-bold bg-primary text-on-primary transition-all';
    } else {
      b.className = 'kw-mode-btn px-3 py-1.5 rounded-lg text-xs font-bold text-on-surface-variant bg-surface-container border border-outline-variant/10 transition-all';
    }
  });
  // Update placeholder text
  var input = document.querySelector('#view-keywords input[type="text"]');
  if (input) {
    var placeholders = {
      suggestions: 'Enter a keyword to research...',
      ideas: 'Enter a seed keyword for broader ideas...',
      related: 'Enter a keyword to find topic clusters...',
      categories: 'Enter a keyword or domain for category keywords...'
    };
    input.placeholder = placeholders[mode] || placeholders.suggestions;
  }
}

async function kwSearch() {
  const input = document.querySelector('#view-keywords input[type="text"]');
  const seed = (input?.value || '').trim();
  if (!seed) { showToast('Enter a keyword to search', 'warning'); return; }
  const searchBtn = document.querySelector('#view-keywords button.bg-primary');
  if (searchBtn) { searchBtn.disabled = true; searchBtn.textContent = 'Searching...'; }
  SEO.startAction();

  try {
    var endpoint, payload;
    var loc = getProjectLocLang();

    // Dispatch based on research mode
    if (_kwResearchMode === 'ideas') {
      endpoint = 'dataforseo_labs/google/keyword_ideas/live';
      payload = { keywords: [seed], location_name: loc.location_name, language_name: loc.language_name, limit: 50 };
    } else if (_kwResearchMode === 'related') {
      endpoint = 'dataforseo_labs/google/related_keywords/live';
      payload = { keyword: seed, location_name: loc.location_name, language_name: loc.language_name, limit: 50 };
    } else if (_kwResearchMode === 'categories') {
      endpoint = 'dataforseo_labs/google/keywords_for_categories/live';
      // For categories, first look up the category — seed can be keyword or domain
      payload = { keyword: seed, location_name: loc.location_name, language_name: loc.language_name, limit: 50 };
      // If seed looks like a domain, use categories_for_domain first
      if (seed.indexOf('.') !== -1 && seed.indexOf(' ') === -1) {
        try {
          var catRes = await SEO.dfs('dataforseo_labs/google/categories_for_domain/live', {
            target: seed, location_name: loc.location_name, language_name: loc.language_name
          });
          var cats = catRes?.tasks?.[0]?.result?.[0]?.items || catRes?.tasks?.[0]?.result?.[0]?.categories || [];
          if (cats.length > 0) {
            var catCodes = cats.slice(0, 3).map(function(c) { return c.categories ? c.categories[0] : null; }).filter(Boolean);
            if (catCodes.length > 0) {
              payload = { category_codes: catCodes, location_name: loc.location_name, language_name: loc.language_name, limit: 50 };
            }
          }
        } catch(e) { /* fall through to keyword-based categories */ }
      }
    } else {
      // Default: suggestions
      endpoint = 'dataforseo_labs/google/keyword_suggestions/live';
      payload = { keyword: seed, location_name: loc.location_name, language_name: loc.language_name, limit: 50 };
    }

    var res = await SEO.dfs(endpoint, payload);

    // Extract items — handle different response shapes
    var rawItems = res?.tasks?.[0]?.result?.[0]?.items || [];

    // For related_keywords, items may be nested under seed_keyword_data
    if (_kwResearchMode === 'related' && rawItems.length === 0) {
      var relResult = res?.tasks?.[0]?.result?.[0];
      if (relResult?.seed_keyword_data) {
        rawItems = relResult.items || [];
      }
    }

    // Get search intent for extracted keywords (~$0.001)
    var kwList = rawItems.map(function(i) { return i.keyword || i.keyword_data?.keyword || ''; }).filter(Boolean);
    var intents = {};
    if (kwList.length > 0) {
      try {
        var intentRes = await SEO.dfs('dataforseo_labs/google/search_intent/live', {
          keywords: kwList.slice(0, 100),
          language_name: loc.language_name
        });
        var intentItems = intentRes?.tasks?.[0]?.result || [];
        intentItems.forEach(function(item) {
          if (item?.keyword) intents[item.keyword] = item.keyword_intent?.label || '';
        });
      } catch(e) { console.warn('Intent classification failed:', e); }
    }

    // Normalize items to common format
    _kwData = rawItems.map(function(i) {
      // Handle both flat format (suggestions) and nested format (ideas/related/categories)
      var kw = i.keyword || i.keyword_data?.keyword || '';
      var vol = i.keyword_info?.search_volume || i.keyword_data?.keyword_info?.search_volume || 0;
      var cpc = i.keyword_info?.cpc || i.keyword_data?.keyword_info?.cpc || 0;
      var comp = i.keyword_info?.competition_level || i.keyword_data?.keyword_info?.competition_level || '';
      var kd = i.keyword_properties?.keyword_difficulty || i.keyword_data?.keyword_properties?.keyword_difficulty || 0;
      var category = i.keyword_data?.keyword_info?.categories || i.categories || null;

      return {
        keyword: kw,
        search_volume: vol,
        cpc: cpc,
        competition: comp,
        kd: kd,
        intent: intents[kw] || '',
        monthly_searches: i.keyword_info?.monthly_searches || i.keyword_data?.keyword_info?.monthly_searches || [],
        source: _kwResearchMode,
        category: category
      };
    }).filter(function(k) { return k.keyword; });

    renderKeywordsTable(_kwData);
    updateKeywordStats(_kwData);
    renderKeywordClusters(_kwData);
    var ac = SEO.getActionCost();
    var modeLabel = { suggestions: 'suggestions', ideas: 'ideas', related: 'related keywords', categories: 'category keywords' }[_kwResearchMode] || 'keywords';
    showToast('Found ' + _kwData.length + ' ' + modeLabel + ' -- ' + ac.calls + ' calls, cost: ' + SEO.fmtCost(ac.cost), 'success', 6000);

    // Non-blocking: fetch trending/rising searches for this seed
    _fetchTrendingSearches(seed);
  } catch (e) {
    showToast('Search failed: ' + e.message, 'error');
  } finally {
    if (searchBtn) { searchBtn.disabled = false; searchBtn.textContent = 'Search'; }
  }
}

/* =======================================================
   TRENDING SEARCHES — dataforseo_labs/google/top_searches/live
   Clickable chips of trending/rising keywords
   ======================================================= */

var _trendingSearches = [];

function _renderTrendingSearches(items) {
  var container = document.getElementById('kwm-trending-searches');
  if (!container) {
    // Create the trending searches card in the filters sidebar
    var filtersAside = document.getElementById('kw-filters');
    if (!filtersAside) return;
    var card = document.createElement('div');
    card.className = 'bg-surface-container-low rounded-xl p-5 border border-outline-variant/5 flex-1 min-w-[250px]';
    card.innerHTML = '<h3 class="text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-4">Trending Searches</h3>'
      + '<div id="kwm-trending-searches" class="flex flex-wrap gap-2"></div>';
    filtersAside.appendChild(card);
    container = document.getElementById('kwm-trending-searches');
  }
  if (!container) return;

  if (!items || items.length === 0) {
    container.innerHTML = '<div class="text-[10px] text-on-surface-variant text-center py-3">No trending data found for this keyword</div>';
    return;
  }

  _trendingSearches = items;
  var html = '';
  items.slice(0, 15).forEach(function(item) {
    var kw = item.keyword || item.query || '';
    var vol = item.keyword_info?.search_volume || item.search_volume || 0;
    if (!kw) return;
    html += '<button onclick="fillTrendingKeyword(\'' + escHtml(kw).replace(/'/g, "\\'") + '\')" '
      + 'style="padding:6px 12px;font-size:11px;font-weight:600;color:#adc6ff;background:rgba(173,198,255,0.06);border:1px solid rgba(173,198,255,0.12);border-radius:16px;cursor:pointer;white-space:nowrap;transition:all 150ms;min-height:32px" '
      + 'onmouseover="this.style.background=\'rgba(173,198,255,0.15)\';this.style.borderColor=\'rgba(173,198,255,0.3)\'" '
      + 'onmouseout="this.style.background=\'rgba(173,198,255,0.06)\';this.style.borderColor=\'rgba(173,198,255,0.12)\'">'
      + escHtml(kw)
      + (vol > 0 ? ' <span style="font-size:9px;color:#8c909f;font-weight:400">' + fmtNum(vol) + '</span>' : '')
      + '</button>';
  });
  container.innerHTML = html;
}

function fillTrendingKeyword(kw) {
  var input = document.querySelector('#view-keywords input[type="text"]');
  if (input) {
    input.value = kw;
    input.focus();
  }
  showToast('Keyword set to "' + kw + '" -- press Search to research', 'info', 3000);
}

async function _fetchTrendingSearches(seed) {
  if (!seed) return;
  try {
    var loc = getProjectLocLang();
    var res = await SEO.dfs('dataforseo_labs/google/top_searches/live', {
      keywords: [seed],
      location_name: loc.location_name,
      language_name: loc.language_name,
      limit: 10
    }).catch(function(e) { console.warn('Trending searches:', e.message); return null; });
    if (res) {
      var items = res?.tasks?.[0]?.result?.[0]?.items || [];
      _renderTrendingSearches(items);
    }
  } catch(e) { console.warn('Trending searches error:', e); }
}

async function trackKw(keyword) {
  const domain = SEO.activeProject;
  if (!domain) { showToast('Select a project first', 'warning'); return; }
  try {
    await SEO.trackKeyword(domain, keyword);
    showToast('Tracking "' + keyword + '"', 'success');
  } catch (e) {
    showToast('Failed to track: ' + e.message, 'error');
  }
}
// SEO Platform — Keyword Overview
'use strict';

/* =======================================================
   PHASE 3.2 - KEYWORD OVERVIEW (Single Keyword Deep-Dive)
   ======================================================= */

/**
 * Called when navigating to the keyword overview tab.
 * Auto-loads the last analyzed keyword from history and refreshes the history panel.
 */
async function loadKeywordOverviewView() {
  // Always refresh history
  loadKeywordSearchHistory();

  // If data is already shown (keyword visible), don't reload
  var kwEl = document.getElementById('kwov-keyword');
  if (kwEl && kwEl.textContent && kwEl.textContent !== '--') return;

  // Load the most recent keyword from history (FREE) and display it
  try {
    var hist = await SEO.history({ tool: 'search_volume', limit: 1 });
    var queries = hist?.queries || [];
    if (queries.length > 0) {
      var lastKw = queries[0].query_target;
      if (lastKw) {
        var input = document.getElementById('kwov-search-input');
        if (input) input.value = lastKw;
        await analyzeKeyword(lastKw);
      }
    }
  } catch(e) { console.warn('Auto-load last keyword failed:', e); }
}

/**
 * Called when user clicks "Analyze" or presses Enter on the keyword overview search.
 * If keyword is provided directly, uses that. Otherwise reads from the search input.
 */
async function analyzeKeyword(keyword) {
  // Get keyword from argument or from search input
  if (!keyword) {
    var input = document.querySelector('#view-keyword-overview input[type="text"]');
    keyword = input ? input.value.trim() : '';
  }
  if (!keyword) {
    showToast('Enter a keyword to analyze', 'warning');
    return;
  }

  // Show loading state on the main container
  var viewEl = document.getElementById('view-keyword-overview');
  if (!viewEl) return;

  // Show loading overlay
  var overlay = viewEl.querySelector('.kwov-loading-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'kwov-loading-overlay';
    overlay.style.cssText = 'position:absolute;inset:0;background:rgba(14,14,19,0.85);display:flex;align-items:center;justify-content:center;z-index:50;border-radius:12px';
    overlay.innerHTML = '<div style="text-align:center;color:#8c909f"><div style="width:32px;height:32px;border:3px solid #35343a;border-top-color:#adc6ff;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 16px"></div>Analyzing "' + escHtml(keyword) + '"...</div>';
    viewEl.style.position = 'relative';
    viewEl.appendChild(overlay);
  }

  SEO.startAction();
  try {
    // Check history first (FREE)
    var cached = await SEO.history({ tool: 'search_volume', target: keyword, limit: 1 }).catch(function() { return {}; });

    var volData = null, kdData = null, serpData = null, suggestData = null, intentData = null, adTrafficData = null;
    var fromCache = false;

    if (cached?.queries?.length > 0) {
      // We have cached data - use it but still run fresh if user wants
      var age = Date.now() - new Date(cached.queries[0].created_at || 0).getTime();
      var ageHours = age / 3600000;
      // If less than 24h old, use cache
      if (ageHours < 24) {
        volData = cached.queries[0];
        fromCache = true;
        // Try to load other cached results too
        var cachedKd = await SEO.history({ tool: 'keyword_difficulty', target: keyword, limit: 1 }).catch(function() { return {}; });
        var cachedSerp = await SEO.history({ tool: 'serp_organic', target: keyword, limit: 1 }).catch(function() { return {}; });
        var cachedSuggest = await SEO.history({ tool: 'keyword_suggestions', target: keyword, limit: 1 }).catch(function() { return {}; });
        var cachedIntent = await SEO.history({ tool: 'search_intent', target: keyword, limit: 1 }).catch(function() { return {}; });
        var cachedAdTraffic = await SEO.history({ tool: 'ad_traffic', target: keyword, limit: 1 }).catch(function() { return {}; });
        var cachedSerpComp = await SEO.history({ tool: 'competitors', target: keyword, limit: 1 }).catch(function() { return {}; });

        if (cachedKd?.queries?.length) kdData = cachedKd.queries[0];
        if (cachedSerp?.queries?.length) serpData = cachedSerp.queries[0];
        if (cachedSuggest?.queries?.length) suggestData = cachedSuggest.queries[0];
        if (cachedIntent?.queries?.length) intentData = cachedIntent.queries[0];
        if (cachedAdTraffic?.queries?.length) adTrafficData = cachedAdTraffic.queries[0];

        // Render SERP competitors from cache
        if (cachedSerpComp?.queries?.length && cachedSerpComp.queries[0].id) {
          SEO.historyById(cachedSerpComp.queries[0].id).then(function(full) {
            var scItems = full?.items || [];
            if (scItems.length > 0) _renderSerpCompetitors(scItems);
          }).catch(function() {});
        }
      }
    }

    // If we don't have all data from cache, fetch fresh (~$0.07 total)
    if (!volData || !kdData || !serpData || !suggestData) {
      var results = await Promise.all([
        // Search volume (~$0.01)
        SEO.dfs('keywords_data/google_ads/search_volume/live', {
          keywords: [keyword],
          location_name: getProjectLocLang().location_name,
          language_name: getProjectLocLang().language_name
        }).catch(function(e) { console.warn('Search volume failed:', e); return null; }),

        // Keyword difficulty (~$0.02)
        SEO.dfs('dataforseo_labs/google/bulk_keyword_difficulty/live', {
          keywords: [keyword],
          location_name: getProjectLocLang().location_name,
          language_name: getProjectLocLang().language_name
        }).catch(function(e) { console.warn('KD failed:', e); return null; }),

        // SERP results (~$0.02)
        SEO.dfs('serp/google/organic/live/advanced', {
          keyword: keyword,
          location_name: getProjectLocLang().location_name,
          language_name: getProjectLocLang().language_name,
          depth: 20
        }).catch(function(e) { console.warn('SERP failed:', e); return null; }),

        // Keyword suggestions (~$0.01)
        SEO.dfs('dataforseo_labs/google/keyword_suggestions/live', {
          keyword: keyword,
          location_name: getProjectLocLang().location_name,
          language_name: getProjectLocLang().language_name,
          limit: 20
        }).catch(function(e) { console.warn('Suggestions failed:', e); return null; }),

        // Search intent (~$0.001)
        SEO.dfs('dataforseo_labs/google/search_intent/live', {
          keywords: [keyword],
          language_name: getProjectLocLang().language_name
        }).catch(function(e) { console.warn('Intent failed:', e); return null; }),

        // Ad traffic estimation (~$0.01)
        SEO.dfs('keywords_data/google_ads/ad_traffic_by_keywords/live', {
          keywords: [keyword],
          location_name: getProjectLocLang().location_name,
          language_name: getProjectLocLang().language_name,
          bid: 999
        }).catch(function(e) { console.warn('Ad traffic failed:', e); return null; }),

        // SERP Competitors (~$0.02)
        SEO.dfs('dataforseo_labs/google/serp_competitors/live', {
          keywords: [keyword],
          location_name: getProjectLocLang().location_name,
          language_name: getProjectLocLang().language_name,
          limit: 10
        }).catch(function(e) { console.warn('SERP competitors failed:', e); return null; })
      ]);

      volData = results[0];
      kdData = results[1];
      serpData = results[2];
      suggestData = results[3];
      intentData = results[4];
      adTrafficData = results[5];
      var serpCompetitorsData = results[6];
      fromCache = false;

      // Render SERP competitors (non-blocking, outside renderKeywordOverview)
      if (serpCompetitorsData) {
        var scItems = serpCompetitorsData?.tasks?.[0]?.result?.[0]?.items || [];
        _renderSerpCompetitors(scItems);
      }
    }

    renderKeywordOverview(keyword, volData, kdData, serpData, suggestData, intentData, adTrafficData, fromCache);
    if (!fromCache) {
      var ac = SEO.getActionCost();
      showToast('Keyword analyzed -- ' + ac.calls + ' calls, cost: ' + SEO.fmtCost(ac.cost), 'success', 6000);
    }

    // Google Trends — async, non-blocking ($0.01, loaded after main render)
    _loadGoogleTrends(keyword);

  } catch (e) {
    showToast('Keyword analysis failed: ' + e.message, 'error');
  } finally {
    // Remove loading overlay
    var ol = viewEl.querySelector('.kwov-loading-overlay');
    if (ol) ol.remove();
  }
}

/**
 * Renders all keyword overview sections with live data.
 */
function renderKeywordOverview(keyword, volData, kdData, serpData, suggestData, intentData, adTrafficData, fromCache) {
  // Extract data from responses
  // Volume data
  var volItem = null;
  if (volData?.tasks) {
    volItem = volData.tasks?.[0]?.result?.[0];
  } else if (volData?.items) {
    volItem = volData;
  }

  var searchVolume = volItem?.search_volume || volItem?.keyword_info?.search_volume || 0;
  var cpc = volItem?.cpc || volItem?.keyword_info?.cpc || 0;
  var competition = volItem?.competition || volItem?.keyword_info?.competition || 0;
  var monthlySearches = volItem?.monthly_searches || volItem?.keyword_info?.monthly_searches || [];

  // KD data — bulk_keyword_difficulty returns result[0].items[0].keyword_difficulty
  var kd = 0;
  if (kdData?.tasks) {
    var kdResult = kdData.tasks?.[0]?.result?.[0];
    kd = kdResult?.keyword_difficulty || kdResult?.items?.[0]?.keyword_difficulty || 0;
  } else if (kdData?.items && kdData.items.length > 0) {
    kd = kdData.items[0]?.keyword_difficulty || 0;
  } else if (kdData?.summary) {
    kd = kdData.summary?.keyword_difficulty || 0;
  }

  // Intent data
  var intent = '';
  if (intentData?.tasks) {
    var intentResult = intentData.tasks?.[0]?.result?.[0] || intentData.tasks?.[0]?.result || {};
    intent = intentResult?.keyword_intent?.label || intentResult?.intent || '';
  } else if (intentData?.items) {
    intent = intentData?.keyword_intent?.label || '';
  }

  // SERP data
  var serpItems = [];
  if (serpData?.tasks) {
    serpItems = serpData.tasks?.[0]?.result?.[0]?.items || [];
  } else if (serpData?.items) {
    serpItems = serpData?.items || [];
    if (!serpItems.length && serpData?.id) {
      // Need to fetch full data
      SEO.historyById(serpData.id).then(function(full) {
        var items = full?.items || full?.items || [];
        if (items.length) _renderSerpTable(items);
      }).catch(function() {});
    }
  }

  // Suggestion data
  var suggestItems = [];
  if (suggestData?.tasks) {
    suggestItems = suggestData.tasks?.[0]?.result?.[0]?.items || [];
  } else if (suggestData?.items) {
    suggestItems = suggestData?.items || [];
    if (!suggestItems.length && suggestData?.id) {
      SEO.historyById(suggestData.id).then(function(full) {
        var items = full?.items || full?.items || [];
        if (items.length) _renderVariationsTable(items);
      }).catch(function() {});
    }
  }

  // 1. Hero card: keyword, volume, intent, CPC, competition
  setHtml('kwov-keyword', escHtml(keyword));
  setHtml('kwov-volume-val', fmtNum(searchVolume));
  setHtml('kwov-global-val', '~' + fmtNum(Math.round(searchVolume * 2.5))); // Estimated global (labeled)
  setHtml('kwov-cpc-val', fmtMoney(cpc));
  setHtml('kwov-competition-val', typeof competition === 'number' ? competition.toFixed(2) : String(competition));

  // Competition bar
  var compBar = document.querySelector('#view-keyword-overview .bg-primary.h-full');
  if (compBar) {
    var compPct = typeof competition === 'number' ? Math.round(competition * 100) : 50;
    compBar.style.width = compPct + '%';
  }

  // PPC ad traffic badges under CPC
  _renderPpcBadges(adTrafficData);

  // Intent badge
  var intentEl = document.getElementById('kwov-intent');
  if (intentEl) {
    var intentLabel = intent || 'Unknown';
    intentEl.textContent = intentLabel;
    var intentColors = {
      transactional: { bg: 'rgba(255,179,173,0.1)', border: 'rgba(255,179,173,0.2)', color: '#ffb3ad' },
      commercial: { bg: 'rgba(173,198,255,0.1)', border: 'rgba(173,198,255,0.2)', color: '#adc6ff' },
      informational: { bg: 'rgba(74,225,118,0.1)', border: 'rgba(74,225,118,0.2)', color: '#4ae176' },
      navigational: { bg: 'rgba(140,144,159,0.1)', border: 'rgba(140,144,159,0.2)', color: '#8c909f' }
    };
    var ic = intentColors[intentLabel.toLowerCase()] || intentColors.informational;
    intentEl.style.background = ic.bg;
    intentEl.style.borderColor = ic.border;
    intentEl.style.color = ic.color;
  }

  // Volume change from monthly_searches
  var volChangeEl = document.getElementById('kwov-volume-change');
  if (volChangeEl && monthlySearches.length >= 2) {
    var recentVol = monthlySearches[monthlySearches.length - 1]?.search_volume || 0;
    var oldVol = monthlySearches[0]?.search_volume || 0;
    if (oldVol > 0) {
      var volChange = ((recentVol - oldVol) / oldVol * 100).toFixed(0);
      var volPositive = volChange >= 0;
      volChangeEl.className = (volPositive ? 'text-secondary' : 'text-tertiary') + ' text-xs flex items-center gap-1 font-bold';
      volChangeEl.innerHTML = '<span class="material-symbols-outlined text-[14px]">' + (volPositive ? 'trending_up' : 'trending_down') + '</span>' + (volPositive ? '+' : '') + volChange + '%';
    }
  }

  // 2. Difficulty gauge
  drawSemiGauge('gauge-kd', Math.round(kd), 100, { lineWidth: 16 });

  // 3. 12-month trend bars
  _renderTrendBars(monthlySearches);

  // 4. SERP Features
  _renderSerpFeatures(serpItems);

  // 5. Top 10 SERP results table
  _renderSerpTable(serpItems);

  // 6. People Also Ask
  _renderPaaSection(serpItems);

  // 7. Keyword Variations table
  _renderVariationsTable(suggestItems);

  // Show "from cache" toast if applicable
  if (fromCache) {
    showToast('Showing cached results. Click "Re-analyze" to refresh.', 'info');
  }
}

/**
 * Render 12-month trend bars in the Ads & Competition card.
 */
function _renderTrendBars(monthlySearches) {
  var container = document.querySelector('#view-keyword-overview .h-8.flex.items-end');
  if (!container) return;
  if (!monthlySearches || monthlySearches.length === 0) return;

  // Take last 12 months
  var data = monthlySearches.slice(-12);
  var maxVol = Math.max.apply(null, data.map(function(m) { return m.search_volume || 0; }));
  if (maxVol === 0) maxVol = 1;

  var html = '';
  data.forEach(function(m, i) {
    var vol = m.search_volume || 0;
    var pct = Math.max((vol / maxVol * 100), 5);
    var opacity = 0.2 + (i / data.length * 0.8);
    html += '<div class="flex-1 rounded-t-sm" style="height:' + pct + '%;background:rgba(173,198,255,' + opacity.toFixed(2) + ')"></div>';
  });
  container.innerHTML = html;
}

/**
 * Render SERP features badges from SERP items.
 */
function _renderSerpFeatures(serpItems) {
  var section = document.querySelector('#view-keyword-overview section.mb-4.md\\:mb-8');
  if (!section) {
    // Try alternate selector
    var allSections = document.querySelectorAll('#view-keyword-overview section');
    for (var i = 0; i < allSections.length; i++) {
      var h3 = allSections[i].querySelector('h3');
      if (h3 && h3.textContent.trim() === 'SERP Features') { section = allSections[i]; break; }
    }
  }
  if (!section) return;

  // Collect unique SERP feature types (exclude organic and paid)
  var featureTypes = {};
  var serpFeatureIcons = {
    featured_snippet: { icon: 'featured_play_list', label: 'Featured Snippet' },
    people_also_ask: { icon: 'quiz', label: 'People Also Ask' },
    local_pack: { icon: 'location_on', label: 'Local Pack' },
    images: { icon: 'image', label: 'Images' },
    video: { icon: 'smart_display', label: 'Video' },
    knowledge_graph: { icon: 'info', label: 'Knowledge Panel' },
    top_stories: { icon: 'newspaper', label: 'Top Stories' },
    twitter: { icon: 'tag', label: 'Twitter/X' },
    shopping: { icon: 'shopping_cart', label: 'Shopping' },
    recipes: { icon: 'restaurant', label: 'Recipes' },
    map: { icon: 'map', label: 'Map' },
    answer_box: { icon: 'check_box', label: 'Answer Box' },
    carousel: { icon: 'view_carousel', label: 'Carousel' },
    related_searches: { icon: 'search', label: 'Related Searches' },
    people_also_search: { icon: 'group', label: 'People Also Search' }
  };

  (serpItems || []).forEach(function(item) {
    var type = item?.type || '';
    if (type && type !== 'organic' && type !== 'paid') {
      featureTypes[type] = true;
    }
  });

  var container = section.querySelector('.flex.flex-wrap');
  if (!container) return;

  var typeKeys = Object.keys(featureTypes);
  if (typeKeys.length === 0) {
    container.innerHTML = '<span class="text-xs text-on-surface-variant">No special SERP features detected</span>';
    return;
  }

  var html = '';
  var colorCycle = ['primary', 'secondary', 'tertiary'];
  typeKeys.forEach(function(type, idx) {
    var info = serpFeatureIcons[type] || { icon: 'star', label: type.replace(/_/g, ' ') };
    var color = colorCycle[idx % colorCycle.length];
    html += '<div class="flex items-center gap-2 bg-' + color + '/10 border border-' + color + '/20 px-3 py-1.5 rounded text-' + color + '">'
      + '<span class="material-symbols-outlined text-[16px]">' + info.icon + '</span>'
      + '<span class="text-[10px] font-bold uppercase tracking-tight">' + escHtml(info.label) + '</span>'
      + '</div>';
  });
  container.innerHTML = html;
}

/**
 * Render Top 10 SERP results table.
 */
function _renderSerpTable(serpItems) {
  // Find the SERP table within keyword-overview
  var tables = document.querySelectorAll('#view-keyword-overview table');
  var serpTable = null;
  for (var i = 0; i < tables.length; i++) {
    var header = tables[i].querySelector('th');
    if (header && header.textContent.trim() === 'Pos') {
      serpTable = tables[i];
      break;
    }
  }
  if (!serpTable) return;

  var tbody = serpTable.querySelector('tbody');
  if (!tbody) return;

  // Filter to organic results only
  var organicItems = (serpItems || []).filter(function(item) {
    return item?.type === 'organic';
  }).slice(0, 10);

  if (organicItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="padding:24px;text-align:center;color:#8c909f">No organic results found</td></tr>';
    return;
  }

  var html = '';
  organicItems.forEach(function(item, idx) {
    var pos = item?.rank_group || item?.rank_absolute || (idx + 1);
    var title = item?.title || 'Untitled';
    var url = item?.url || '';
    var domain = '';
    try { domain = new URL(url).hostname; } catch(e) { domain = url.substring(0, 50); }
    var backlinks = item?.backlinks_info?.backlinks || '--';
    var etv = item?.estimated_paid_traffic_cost || item?.etv || '--';

    var posColor = pos <= 3 ? 'text-secondary' : 'text-on-surface-variant';

    html += '<tr class="hover:bg-surface-container-high transition-colors group">'
      + '<td class="px-6 py-4 tabular font-bold ' + posColor + '">#' + pos + '</td>'
      + '<td class="px-6 py-4"><div class="max-w-md">'
      + '<p class="text-primary font-bold truncate group-hover:underline underline-offset-4">' + escHtml(title) + '</p>'
      + '<p class="text-[10px] text-on-surface-variant mt-1 truncate">' + escHtml(domain + (url.replace(/https?:\/\/[^/]+/, '') || '/')) + '</p>'
      + '</div></td>'
      + '<td class="px-6 py-4 tabular text-right text-on-surface-variant">' + (typeof backlinks === 'number' ? fmtNum(backlinks) : backlinks) + '</td>'
      + '<td class="px-6 py-4 tabular text-right font-medium">' + (typeof etv === 'number' ? fmtNum(Math.round(etv)) : etv) + '</td>'
      + '</tr>';
  });
  tbody.innerHTML = html;
}

/**
 * Render People Also Ask section.
 */
function _renderPaaSection(serpItems) {
  // Find the PAA container in keyword-overview
  var paaContainer = null;
  var headings = document.querySelectorAll('#view-keyword-overview h3');
  for (var i = 0; i < headings.length; i++) {
    if (headings[i].textContent.trim().toLowerCase().indexOf('people also ask') !== -1) {
      paaContainer = headings[i].parentElement;
      break;
    }
  }
  if (!paaContainer) return;

  // Extract PAA items from SERP
  var paaItems = (serpItems || []).filter(function(item) {
    return item?.type === 'people_also_ask';
  });

  // Extract individual questions
  var questions = [];
  paaItems.forEach(function(item) {
    if (item?.items) {
      item.items.forEach(function(q) {
        if (q?.title) questions.push(q.title);
      });
    } else if (item?.title) {
      questions.push(item.title);
    }
  });

  var listContainer = paaContainer.querySelector('.space-y-4') || paaContainer.querySelector('div:last-child');
  if (!listContainer) return;

  if (questions.length === 0) {
    listContainer.innerHTML = '<div class="text-xs text-on-surface-variant p-4">No "People Also Ask" questions found for this keyword.</div>';
    return;
  }

  var html = '';
  questions.slice(0, 6).forEach(function(q) {
    html += '<div class="p-4 bg-surface-container rounded flex justify-between items-center group cursor-pointer hover:bg-surface-container-high transition-all">'
      + '<p class="text-sm font-medium text-on-surface">' + escHtml(q) + '</p>'
      + '<span class="material-symbols-outlined text-primary text-sm group-hover:translate-x-1 transition-transform">arrow_forward_ios</span>'
      + '</div>';
  });
  listContainer.innerHTML = html;
}

/**
 * Render keyword variations table from suggestions data.
 */
function _renderVariationsTable(suggestItems) {
  // Find the variations table in keyword-overview
  var variationsSection = null;
  var headings = document.querySelectorAll('#view-keyword-overview h3');
  for (var i = 0; i < headings.length; i++) {
    if (headings[i].textContent.trim() === 'Keyword Variations') {
      variationsSection = headings[i].closest('.bg-surface-container-low');
      break;
    }
  }
  if (!variationsSection) return;

  var tbody = variationsSection.querySelector('tbody');
  if (!tbody) return;

  var totalSpan = variationsSection.querySelector('.text-\\[10px\\].text-on-surface-variant');
  if (totalSpan) totalSpan.textContent = 'Total: ' + ((suggestItems || []).length);

  if (!suggestItems || suggestItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="padding:24px;text-align:center;color:#8c909f">No variations found</td></tr>';
    return;
  }

  var html = '';
  suggestItems.slice(0, 20).forEach(function(item) {
    var kw = item?.keyword || '';
    var vol = item?.keyword_info?.search_volume || 0;
    var kwKd = item?.keyword_properties?.keyword_difficulty || 0;
    var kwCpc = item?.keyword_info?.cpc || 0;
    var kdCol = kdColor(kwKd);

    var kdBgClass, kdTextClass;
    if (kwKd <= 30) { kdBgClass = 'bg-secondary-container/10'; kdTextClass = 'text-secondary'; }
    else if (kwKd <= 60) { kdBgClass = 'bg-tertiary-container/10'; kdTextClass = 'text-tertiary'; }
    else { kdBgClass = 'bg-tertiary-container/10'; kdTextClass = 'text-tertiary'; }

    html += '<tr class="hover:bg-surface-container-high/50 border-b border-outline-variant/5">'
      + '<td class="px-6 py-3 font-medium text-primary">' + escHtml(kw) + '</td>'
      + '<td class="px-6 py-3 tabular text-right">' + fmtNum(vol) + '</td>'
      + '<td class="px-6 py-3 tabular text-right"><span class="' + kdBgClass + ' ' + kdTextClass + ' px-1.5 py-0.5 rounded text-[10px] font-bold">' + Math.round(kwKd) + '</span></td>'
      + '<td class="px-6 py-3 tabular text-right text-on-surface-variant">' + fmtMoney(kwCpc) + '</td>'
      + '</tr>';
  });
  tbody.innerHTML = html;
}

/* =======================================================
   KEYWORD OVERVIEW SEARCH BAR INJECTION
   =======================================================
   The #view-keyword-overview mockup has no search input.
   This function injects a search bar at the top of the view.
   Call from DOMContentLoaded.
   ======================================================= */
function initKeywordOverviewSearch() {
  var viewEl = document.getElementById('view-keyword-overview');
  if (!viewEl) return;
  // Don't inject twice
  if (viewEl.querySelector('.kwov-search-bar')) return;

  var searchBar = document.createElement('div');
  searchBar.className = 'kwov-search-bar';
  searchBar.style.cssText = 'margin-bottom:24px';
  searchBar.innerHTML = '<div style="display:flex;align-items:center;gap:12px;background:#131318;padding:8px;border-radius:12px;border:1px solid rgba(66,71,84,0.2)">'
    + '<div style="flex:1;position:relative">'
    + '<input id="kwov-search-input" type="text" placeholder="Enter a keyword to analyze..." style="width:100%;background:#1b1b20;border:none;border-radius:8px;padding:14px 16px;font-size:16px;font-weight:500;color:#e4e1e9;outline:none;min-height:44px">'
    + '</div>'
    + '<button id="kwov-track-btn" onclick="trackCurrentKeyword()" style="background:transparent;color:#4ae176;font-weight:700;padding:14px 16px;border-radius:8px;border:1px solid rgba(74,225,118,0.3);cursor:pointer;font-size:13px;white-space:nowrap;min-height:44px" title="Add to tracked keywords">+ Track</button>'
    + '<button id="kwov-analyze-btn" onclick="analyzeKeyword()" style="background:#adc6ff;color:#0e0e13;font-weight:700;padding:14px 24px;border-radius:8px;border:none;cursor:pointer;font-size:14px;white-space:nowrap;min-height:44px">Analyze (~$0.10)</button>'
    + '</div>';
  viewEl.insertBefore(searchBar, viewEl.firstChild);

  // Inject recent searches panel at bottom of view
  var historyPanel = document.createElement('div');
  historyPanel.id = 'kwov-search-history';
  historyPanel.style.cssText = 'margin-top:32px';
  viewEl.appendChild(historyPanel);
  loadKeywordSearchHistory();

  // Wire Enter key
  var input = document.getElementById('kwov-search-input');
  if (input) {
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') analyzeKeyword();
    });
  }
}

/* =======================================================
   TRACK KEYWORD — Add current keyword to tracked list
   ======================================================= */
async function trackCurrentKeyword() {
  var input = document.getElementById('kwov-search-input');
  var kw = document.getElementById('kwov-keyword')?.textContent?.trim();
  if (!kw || kw === '--') kw = input?.value?.trim();
  if (!kw) { showToast('Search for a keyword first', 'warning'); return; }
  var domain = SEO.activeProject;
  if (!domain) { showToast('Select a project first', 'warning'); return; }

  var btn = document.getElementById('kwov-track-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

  try {
    await SEO.trackKeyword(domain, [kw]);
    showToast('Tracking "' + kw + '" — view in Position Tracking', 'success');
    if (btn) { btn.textContent = 'Tracked'; btn.style.color = '#4ae176'; btn.style.borderColor = '#4ae176'; }
  } catch(e) {
    showToast('Failed to track: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '+ Track'; }
  }
}

/* =======================================================
   RECENT KEYWORD SEARCHES — History panel
   Shows all past keyword overview searches with data
   ======================================================= */
async function loadKeywordSearchHistory() {
  var container = document.getElementById('kwov-search-history');
  if (!container) return;

  try {
    // Fetch recent search_volume queries (each represents a keyword analysis)
    var histData = await SEO.history({ tool: 'search_volume', limit: 20 });
    var queries = histData?.queries || [];

    // Deduplicate by keyword (keep most recent)
    var seen = {};
    var unique = [];
    queries.forEach(function(q) {
      var kw = (q.query_target || '').toLowerCase().trim();
      if (kw && !seen[kw]) {
        seen[kw] = true;
        unique.push(q);
      }
    });

    if (unique.length === 0) {
      container.innerHTML = '';
      return;
    }

    var html = '<div style="background:#131318;border:1px solid rgba(66,71,84,0.2);border-radius:12px;overflow:hidden">'
      + '<div style="padding:16px 20px;border-bottom:1px solid rgba(66,71,84,0.1);display:flex;align-items:center;justify-content:between">'
      + '<h3 style="font-size:14px;font-weight:700;color:#e4e1e9">Recent Keyword Searches</h3>'
      + '<span style="margin-left:auto;font-size:10px;color:#64687a;text-transform:uppercase;letter-spacing:0.05em">' + unique.length + ' keywords</span>'
      + '</div>'
      + '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse"><thead>'
      + '<tr style="background:rgba(30,30,38,0.5)">'
      + '<th style="padding:10px 16px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#8c909f;font-weight:600">Keyword</th>'
      + '<th style="padding:10px 16px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#8c909f;font-weight:600">Volume</th>'
      + '<th style="padding:10px 16px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#8c909f;font-weight:600">CPC</th>'
      + '<th style="padding:10px 16px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#8c909f;font-weight:600">Date</th>'
      + '<th style="padding:10px 16px;text-align:center;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#8c909f;font-weight:600">Actions</th>'
      + '</tr></thead><tbody>';

    unique.forEach(function(q) {
      var kw = q.query_target || '';
      var vol = q.summary?.avgVolume || q.summary?.search_volume || q.result_count || '--';
      var cpc = q.summary?.avgCpc || q.summary?.cpc;
      var date = new Date(q.created_at);
      var dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      var timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

      html += '<tr style="border-bottom:1px solid rgba(66,71,84,0.08);transition:background 150ms" onmouseover="this.style.background=\'rgba(30,30,38,0.5)\'" onmouseout="this.style.background=\'none\'">'
        + '<td style="padding:10px 16px"><span style="color:#adc6ff;font-weight:600;font-size:13px;cursor:pointer;text-decoration:none" onclick="document.getElementById(\'kwov-search-input\').value=\'' + escHtml(kw).replace(/'/g, "\\'") + '\';analyzeKeyword(\'' + escHtml(kw).replace(/'/g, "\\'") + '\')">' + escHtml(kw) + '</span></td>'
        + '<td style="padding:10px 16px;text-align:right;font-size:12px;color:#e4e1e9;font-weight:700;font-variant-numeric:tabular-nums">' + (typeof vol === 'number' ? fmtNum(vol) : vol) + '</td>'
        + '<td style="padding:10px 16px;text-align:right;font-size:12px;color:#8c909f;font-variant-numeric:tabular-nums">' + (typeof cpc === 'number' ? '$' + cpc.toFixed(2) : '--') + '</td>'
        + '<td style="padding:10px 16px;text-align:right;font-size:11px;color:#64687a">' + dateStr + ' ' + timeStr + '</td>'
        + '<td style="padding:10px 16px;text-align:center"><button onclick="document.getElementById(\'kwov-search-input\').value=\'' + escHtml(kw).replace(/'/g, "\\'") + '\';analyzeKeyword(\'' + escHtml(kw).replace(/'/g, "\\'") + '\')" style="background:rgba(173,198,255,0.1);color:#adc6ff;border:none;padding:4px 12px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer">Re-analyze</button></td>'
        + '</tr>';
    });

    html += '</tbody></table></div></div>';
    container.innerHTML = html;
  } catch(e) {
    console.warn('Failed to load keyword search history:', e);
  }
}

/* Refresh history after each new analysis completes */
var _origAnalyzeKw = analyzeKeyword;
analyzeKeyword = async function(keyword) {
  await _origAnalyzeKw(keyword);
  loadKeywordSearchHistory();
};

/* =======================================================
   GOOGLE TRENDS — async non-blocking trend sparkline ($0.01)
   ======================================================= */

async function _loadGoogleTrends(keyword) {
  if (!keyword) return;
  // Check history first
  var hist = await SEO.history({ tool: 'google_trends', target: keyword, limit: 1 }).catch(function() { return {}; });
  var trendData = null;

  if (hist?.queries?.length > 0 && hist.queries[0].id) {
    try {
      var full = await SEO.historyById(hist.queries[0].id);
      trendData = full?.items || [];
    } catch(e) { /* no cached trends */ }
  }

  // If no cached data, fetch live (only if user explicitly asks — trends cost $0.01)
  // For now, render from cache or show "fetch" button
  if (trendData && trendData.length > 0) {
    _renderGoogleTrendsChart(keyword, trendData);
  } else {
    var container = document.getElementById('kwov-trends-chart');
    if (container) {
      container.innerHTML = '<div style="text-align:center;padding:16px">'
        + '<button onclick="fetchGoogleTrends(\'' + escHtml(keyword).replace(/'/g, "\\'") + '\',this)" style="background:transparent;border:1px solid #35343a;color:#adc6ff;padding:8px 16px;border-radius:8px;font-size:11px;cursor:pointer;min-height:32px">'
        + '<span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;margin-right:4px">trending_up</span>Load Google Trends (~$0.01)</button></div>';
    }
  }
}

async function fetchGoogleTrends(keyword, btn) {
  if (!keyword) return;
  if (!checkBalanceWarning(0.02)) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Loading...'; }

  try {
    var res = await SEO.dfs('keywords_data/google_trends/explore/live', {
      keywords: [keyword],
      location_name: getProjectLocLang().location_name,
      language_name: getProjectLocLang().language_name,
      type: 'web'
    });
    var items = res?.tasks?.[0]?.result?.[0]?.items || [];
    if (items.length > 0) {
      _renderGoogleTrendsChart(keyword, items);
    } else {
      var container = document.getElementById('kwov-trends-chart');
      if (container) container.innerHTML = '<div style="text-align:center;padding:16px;color:#8c909f;font-size:12px">No trend data available for this keyword</div>';
    }
  } catch(e) {
    showToast('Trends failed: ' + e.message, 'error');
    if (btn) { btn.disabled = false; }
  }
}

function _renderGoogleTrendsChart(keyword, items) {
  var container = document.getElementById('kwov-trends-chart');
  if (!container) return;

  // Extract time series data from Google Trends response
  // Format: items[0].data = [{date_from, date_to, values: [{value}]}] or items[0].keywords_data = [{values: []}]
  var series = [];
  var dates = [];

  if (items[0]?.data) {
    // Standard format
    items[0].data.forEach(function(point) {
      dates.push(new Date(point.date_from).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }));
      series.push(point.values?.[0]?.value || 0);
    });
  } else if (items[0]?.keywords_data) {
    // Alternative format
    var kwData = items[0].keywords_data[0] || {};
    (kwData.values || []).forEach(function(v) {
      dates.push(new Date(v.date_from || v.date).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }));
      series.push(v.value || 0);
    });
  } else {
    // Try flat items
    items.forEach(function(item) {
      if (item.date_from) {
        dates.push(new Date(item.date_from).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }));
        series.push(item.values?.[0]?.value || item.value || 0);
      }
    });
  }

  if (series.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:16px;color:#8c909f;font-size:12px">No trend data points found</div>';
    return;
  }

  // Render with ApexCharts
  renderAreaChart('kwov-trends-chart', series, dates, {
    height: 160, name: 'Search Interest', colors: ['#3b82f6']
  });
}

/* =======================================================
   PPC AD TRAFFIC BADGES — show estimated daily clicks/impressions/cost
   ======================================================= */

function _renderPpcBadges(adTrafficData) {
  var container = document.getElementById('kwov-ppc-badges');
  if (!container) return;

  // Extract ad traffic item from response
  var item = null;
  if (adTrafficData?.tasks) {
    item = adTrafficData.tasks?.[0]?.result?.[0]?.items?.[0] || null;
  } else if (adTrafficData?.items) {
    item = adTrafficData.items?.[0] || null;
  }

  if (!item) {
    container.style.display = 'none';
    return;
  }

  var clicks = item.impressions_etd || item.daily_clicks_average || item.clicks || 0;
  var impressions = item.impressions_etd || item.daily_impressions_average || item.impressions || 0;
  var cost = item.daily_cost_average || item.cost || 0;

  // ad_traffic_by_keywords returns: average_cpc, impressions_etd, clicks_etd, cost_etd, match
  if (item.clicks_etd != null) clicks = item.clicks_etd;
  if (item.impressions_etd != null) impressions = item.impressions_etd;
  if (item.cost_etd != null) cost = item.cost_etd;

  var badges = [];
  if (impressions > 0) badges.push({ label: 'Est. Daily Impr.', value: fmtNum(Math.round(impressions)), color: '#adc6ff' });
  if (clicks > 0) badges.push({ label: 'Est. Daily Clicks', value: fmtNum(Math.round(clicks)), color: '#4ae176' });
  if (cost > 0) badges.push({ label: 'Est. Daily Cost', value: '$' + cost.toFixed(2), color: '#f59e0b' });

  if (badges.length === 0) {
    container.style.display = 'none';
    return;
  }

  var html = '';
  badges.forEach(function(b) {
    html += '<span style="display:inline-flex;align-items:center;gap:4px;background:' + b.color + '15;border:1px solid ' + b.color + '30;color:' + b.color + ';padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600">'
      + '<span style="font-size:9px;opacity:0.8">' + b.label + ':</span> ' + b.value + '</span>';
  });
  container.innerHTML = html;
  container.style.display = 'flex';
}

/* =======================================================
   YOUTUBE RESULTS — fetch & render YouTube SERP for keyword
   ======================================================= */

async function fetchYoutubeResults(btn) {
  var keyword = document.getElementById('kwov-keyword')?.textContent?.trim();
  if (!keyword || keyword === '--') {
    var input = document.getElementById('kwov-search-input');
    keyword = input ? input.value.trim() : '';
  }
  if (!keyword) { showToast('Analyze a keyword first', 'warning'); return; }
  if (!checkBalanceWarning(0.01)) return;

  if (btn) { btn.disabled = true; btn.textContent = 'Loading...'; }

  try {
    // Check cache first
    var cached = await SEO.history({ tool: 'serp_youtube', target: keyword, limit: 1 }).catch(function() { return {}; });
    if (cached?.queries?.length > 0) {
      var age = Date.now() - new Date(cached.queries[0].created_at || 0).getTime();
      if (age < 86400000 && cached.queries[0].id) {
        var full = await SEO.historyById(cached.queries[0].id).catch(function() { return null; });
        if (full?.items?.length > 0) {
          _renderYoutubeResults(full.items);
          showToast('YouTube results loaded from cache', 'info');
          if (btn) { btn.disabled = false; btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;margin-right:4px">smart_display</span>Refresh YouTube (~$0.002)'; }
          return;
        }
      }
    }

    SEO.startAction();
    var res = await SEO.dfs('serp/google/youtube/organic/live', {
      keyword: keyword,
      location_name: getProjectLocLang().location_name,
      language_name: getProjectLocLang().language_name,
      depth: 10
    });

    var items = res?.tasks?.[0]?.result?.[0]?.items || [];
    _renderYoutubeResults(items);

    var ac = SEO.getActionCost();
    showToast('YouTube results loaded — cost: ' + SEO.fmtCost(ac.cost), 'success', 5000);
  } catch(e) {
    showToast('YouTube fetch failed: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;margin-right:4px">smart_display</span>Refresh YouTube (~$0.002)'; }
  }
}

function _renderYoutubeResults(items) {
  var container = document.getElementById('kwov-youtube-results');
  if (!container) return;

  if (!items || items.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:20px;color:#8c909f;font-size:12px">No YouTube results found for this keyword</div>';
    return;
  }

  var html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">';
  items.slice(0, 10).forEach(function(item) {
    var title = item.title || 'Untitled Video';
    var channel = item.channel_name || item.breadcrumb || '';
    var url = item.url || '';
    var thumbnail = (item.images && item.images.length > 0) ? item.images[0] : '';
    if (typeof thumbnail === 'object') thumbnail = thumbnail.url || thumbnail.thumbnail || '';

    var thumbHtml = thumbnail
      ? '<img src="' + escHtml(thumbnail) + '" style="width:100%;height:140px;object-fit:cover;border-radius:8px 8px 0 0;background:#1f1f25" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">'
        + '<div style="display:none;width:100%;height:140px;background:#1f1f25;border-radius:8px 8px 0 0;align-items:center;justify-content:center"><span class="material-symbols-outlined" style="font-size:40px;color:#35343a">smart_display</span></div>'
      : '<div style="width:100%;height:140px;background:#1f1f25;border-radius:8px 8px 0 0;display:flex;align-items:center;justify-content:center"><span class="material-symbols-outlined" style="font-size:40px;color:#35343a">smart_display</span></div>';

    html += '<a href="' + escHtml(url) + '" target="_blank" rel="noopener" style="display:block;background:#1a1a22;border:1px solid rgba(66,71,84,0.15);border-radius:8px;overflow:hidden;text-decoration:none;transition:border-color 150ms" onmouseover="this.style.borderColor=\'rgba(173,198,255,0.3)\'" onmouseout="this.style.borderColor=\'rgba(66,71,84,0.15)\'">'
      + thumbHtml
      + '<div style="padding:10px 12px">'
      + '<p style="font-size:13px;font-weight:600;color:#e4e1e9;margin-bottom:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.3">' + escHtml(title) + '</p>'
      + '<p style="font-size:11px;color:#8c909f">' + escHtml(channel) + '</p>'
      + '</div></a>';
  });
  html += '</div>';
  container.innerHTML = html;
}

/* =======================================================
   PAID ADS — fetch & render Google Ads SERP for keyword
   ======================================================= */

function togglePaidAdsSection() {
  var body = document.getElementById('kwov-paid-ads-body');
  var chevron = document.getElementById('kwov-paid-ads-chevron');
  if (!body) return;
  var isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  if (chevron) chevron.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
}

async function fetchPaidAds(btn) {
  var keyword = document.getElementById('kwov-keyword')?.textContent?.trim();
  if (!keyword || keyword === '--') {
    var input = document.getElementById('kwov-search-input');
    keyword = input ? input.value.trim() : '';
  }
  if (!keyword) { showToast('Analyze a keyword first', 'warning'); return; }
  if (!checkBalanceWarning(0.01)) return;

  // Auto-expand the section
  var body = document.getElementById('kwov-paid-ads-body');
  var chevron = document.getElementById('kwov-paid-ads-chevron');
  if (body) body.style.display = 'block';
  if (chevron) chevron.style.transform = 'rotate(180deg)';

  if (btn) { btn.disabled = true; btn.textContent = 'Loading...'; }

  try {
    // Check cache first
    var cached = await SEO.history({ tool: 'serp_ads', target: keyword, limit: 1 }).catch(function() { return {}; });
    if (cached?.queries?.length > 0) {
      var age = Date.now() - new Date(cached.queries[0].created_at || 0).getTime();
      if (age < 86400000 && cached.queries[0].id) {
        var full = await SEO.historyById(cached.queries[0].id).catch(function() { return null; });
        if (full?.items?.length > 0) {
          _renderPaidAds(full.items);
          showToast('Paid ads loaded from cache', 'info');
          if (btn) { btn.disabled = false; btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;margin-right:4px">campaign</span>Refresh Ads (~$0.001)'; }
          return;
        }
      }
    }

    SEO.startAction();
    var res = await SEO.dfs('serp/google/ads_search/live', {
      keyword: keyword,
      location_name: getProjectLocLang().location_name,
      language_name: getProjectLocLang().language_name,
      depth: 5
    });

    var items = res?.tasks?.[0]?.result?.[0]?.items || [];
    _renderPaidAds(items);

    var ac = SEO.getActionCost();
    showToast('Paid ads loaded — cost: ' + SEO.fmtCost(ac.cost), 'success', 5000);
  } catch(e) {
    showToast('Paid ads fetch failed: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;margin-right:4px">campaign</span>Refresh Ads (~$0.001)'; }
  }
}

function _renderPaidAds(items) {
  var container = document.getElementById('kwov-paid-ads-results');
  if (!container) return;

  // Filter to paid/ads results only
  var adItems = (items || []).filter(function(item) {
    return item.type === 'paid' || item.type === 'ads_search' || item.type === 'shopping' || item.title;
  });

  if (adItems.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:20px;color:#8c909f;font-size:12px">No paid ads found for this keyword</div>';
    return;
  }

  var html = '<div style="display:flex;flex-direction:column;gap:10px">';
  adItems.slice(0, 5).forEach(function(item, idx) {
    var title = item.title || 'Untitled Ad';
    var desc = item.description || item.snippet || '';
    var displayUrl = item.displayed_link || item.breadcrumb || '';
    var url = item.url || '';
    var pos = item.rank_absolute || item.rank_group || (idx + 1);

    html += '<div style="background:#131318;border:1px solid rgba(66,71,84,0.15);border-left:3px solid #f59e0b;border-radius:6px;padding:14px 16px">'
      + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">'
      + '<span style="background:#f59e0b20;color:#f59e0b;font-size:9px;font-weight:800;padding:2px 6px;border-radius:3px;text-transform:uppercase;letter-spacing:0.05em">Ad #' + pos + '</span>'
      + (displayUrl ? '<span style="font-size:11px;color:#4ae176;font-weight:500">' + escHtml(displayUrl) + '</span>' : '')
      + '</div>'
      + '<p style="font-size:14px;font-weight:700;color:#adc6ff;margin-bottom:4px;line-height:1.3">' + escHtml(title) + '</p>'
      + (desc ? '<p style="font-size:12px;color:#8c909f;line-height:1.4">' + escHtml(desc) + '</p>' : '')
      + '</div>';
  });
  html += '</div>';
  container.innerHTML = html;
}

/* =======================================================
   SERP COMPETITORS — dataforseo_labs/google/serp_competitors/live
   Table showing competing domains for this keyword
   ======================================================= */

function _renderSerpCompetitors(items) {
  // Create or find the container
  var container = document.getElementById('kwov-serp-competitors');
  if (!container) {
    // Create the section dynamically after the SERP results table
    var viewEl = document.getElementById('view-keyword-overview');
    if (!viewEl) return;

    // Find the left column (col-span-7) where SERP table + PAA live
    var leftCol = viewEl.querySelector('.lg\\:col-span-7');
    if (!leftCol) return;

    var section = document.createElement('div');
    section.id = 'kwov-serp-competitors';
    section.className = 'bg-surface-container-low rounded-xl overflow-hidden';
    section.innerHTML = '<div class="px-6 py-4 flex justify-between items-center border-b border-outline-variant/10">'
      + '<h3 class="text-xs font-bold uppercase tracking-widest">SERP Competitors</h3>'
      + '<span class="text-[10px] text-on-surface-variant uppercase font-bold" id="kwov-sc-count"></span>'
      + '</div>'
      + '<div id="kwov-serp-competitors-body"></div>';
    leftCol.appendChild(section);
    container = section;
  }

  var bodyEl = document.getElementById('kwov-serp-competitors-body');
  var countEl = document.getElementById('kwov-sc-count');
  if (!bodyEl) return;

  if (!items || items.length === 0) {
    bodyEl.innerHTML = '<div style="padding:24px;text-align:center;color:#8c909f;font-size:12px">No SERP competitor data available</div>';
    if (countEl) countEl.textContent = '';
    return;
  }

  // Filter out generic/social domains and own domain
  var ownDomain = (SEO.activeProject || '').toLowerCase().replace(/^www\./, '');
  var filtered = items.filter(function(item) {
    var d = (item.domain || '').toLowerCase().replace(/^www\./, '');
    return d && d !== ownDomain && !isGenericDomain(d);
  });

  if (countEl) countEl.textContent = filtered.length + ' competitors';

  var html = '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">'
    + '<thead><tr style="background:rgba(30,30,38,0.5)">'
    + '<th style="padding:10px 16px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#8c909f;font-weight:600">Domain</th>'
    + '<th style="padding:10px 16px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#8c909f;font-weight:600">Avg. Pos</th>'
    + '<th style="padding:10px 16px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#8c909f;font-weight:600">Organic Kw</th>'
    + '<th style="padding:10px 16px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#8c909f;font-weight:600">Est. Traffic</th>'
    + '</tr></thead><tbody>';

  filtered.slice(0, 10).forEach(function(item) {
    var compDomain = item.domain || '';
    var avgPos = item.avg_position != null ? item.avg_position.toFixed(1) : '--';
    var orgKw = item.metrics?.organic?.count || item.relevant_serp_items || 0;
    var etv = item.metrics?.organic?.etv || item.estimated_paid_traffic_cost || 0;

    html += '<tr style="border-bottom:1px solid rgba(66,71,84,0.08);transition:background 150ms" onmouseover="this.style.background=\'rgba(30,30,38,0.4)\'" onmouseout="this.style.background=\'none\'">'
      + '<td style="padding:10px 16px"><div style="display:flex;align-items:center;gap:8px">'
      + '<img src="https://www.google.com/s2/favicons?domain=' + encodeURIComponent(compDomain) + '&sz=16" width="14" height="14" style="border-radius:2px" onerror="this.style.display=\'none\'"/>'
      + '<span style="font-size:12px;font-weight:600;color:#e4e1e9">' + escHtml(compDomain) + '</span></div></td>'
      + '<td style="padding:10px 16px;text-align:right;font-size:12px;font-weight:700;color:#adc6ff;font-variant-numeric:tabular-nums">' + avgPos + '</td>'
      + '<td style="padding:10px 16px;text-align:right;font-size:12px;color:#8c909f;font-variant-numeric:tabular-nums">' + fmtNum(orgKw) + '</td>'
      + '<td style="padding:10px 16px;text-align:right;font-size:12px;color:#8c909f;font-variant-numeric:tabular-nums">' + fmtNum(Math.round(etv)) + '</td>'
      + '</tr>';
  });

  html += '</tbody></table></div>';
  bodyEl.innerHTML = html;
}
// SEO Platform — Keyword Gap Analysis
'use strict';

// Holds the current keyword gap results for client-side filtering
var _kwGapData = { missing: [], weak: [], untapped: [], strong: [], all: [] };
var _kwGapFilter = 'all';

/**
 * loadKeywordGap - called on "Analyze" (sync button) click (~$0.02 per competitor)
 * Fetches domain_intersection for each competitor vs your domain.
 */
async function loadKeywordGap() {
  var domain = SEO.activeProject;
  if (!domain) { showToast('Select a project first', 'warning'); return; }

  // Read competitor domains from the input elements — strip protocol/path to bare domain
  var compEls = [document.getElementById('kwgap-domain-2'), document.getElementById('kwgap-domain-3')];
  var competitors = compEls.map(function(el) {
    var v = el ? (el.value || el.textContent || '').trim() : '';
    // Strip protocol, www, trailing slashes
    v = v.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').trim();
    // Update the input to show cleaned domain
    if (el && v) el.value = v;
    return v;
  }).filter(function(d) { return d && d !== '--' && d !== domain; });

  if (competitors.length === 0) {
    showToast('Add at least one competitor domain', 'warning');
    return;
  }

  // Update primary domain display
  setHtml('kwgap-domain-1', escHtml(domain));

  showLoading('kwgap-table-body');
  SEO.startAction();
  try {
    // Parallel intersection calls for each competitor
    var promises = competitors.map(function(comp) {
      return SEO.dfs('dataforseo_labs/google/domain_intersection/live', {
        target1: domain,
        target2: comp,
        location_name: getProjectLocLang().location_name,
        language_name: getProjectLocLang().language_name,
        limit: 200
      }).catch(function(e) { console.warn('Intersection failed for ' + comp + ':', e); return null; });
    });

    var results = await Promise.all(promises);

    // Classify keywords
    _kwGapData = { missing: [], weak: [], untapped: [], strong: [], all: [] };

    results.forEach(function(res, idx) {
      if (!res) return;
      var items = res?.tasks?.[0]?.result?.[0]?.items || [];
      var compDomain = competitors[idx];

      items.forEach(function(item) {
        var kw = item?.keyword_data?.keyword || '';
        var vol = item?.keyword_data?.keyword_info?.search_volume || 0;
        var kd = item?.keyword_data?.keyword_properties?.keyword_difficulty || 0;
        var intent = item?.keyword_data?.search_intent_info?.main_intent || '';

        // Extract positions for your domain (target1) and competitor (target2)
        var p1 = item?.first_domain_serp_element;
        var p2 = item?.second_domain_serp_element;
        var yourPos = (p1?.rank_group || p1?.serp_item?.rank_group) || null;
        var compPos = (p2?.rank_group || p2?.serp_item?.rank_group) || null;

        var entry = {
          keyword: kw,
          yourPos: yourPos,
          compPos: compPos,
          compDomain: compDomain,
          volume: vol,
          kd: kd,
          intent: intent,
          category: 'all'
        };

        // Classification
        if (!yourPos && compPos) {
          entry.category = 'missing';
          _kwGapData.missing.push(entry);
        } else if (yourPos && yourPos > 20 && compPos && compPos <= 10) {
          entry.category = 'weak';
          _kwGapData.weak.push(entry);
        } else if (yourPos && yourPos > 20 && (!compPos || compPos > 20)) {
          entry.category = 'untapped';
          _kwGapData.untapped.push(entry);
        } else if (yourPos && compPos && yourPos < compPos) {
          entry.category = 'strong';
          _kwGapData.strong.push(entry);
        }

        _kwGapData.all.push(entry);
      });
    });

    // Render summary badges in the venn area
    renderKwGapSummary();
    // Render the table with current filter
    renderKwGapTable(_kwGapFilter);

    // Save competitors to project so they persist across page loads
    SEO.saveProject({ domain: domain, competitors: competitors }).catch(function() {});

    var ac = SEO.getActionCost();
    if (_kwGapData.all.length === 0) {
      showToast('No keyword overlap found. These competitors may not rank for the same keywords, or the domains may be too small for DataForSEO to have data. Try larger/national competitors.', 'info', 10000);
    } else {
      showToast('Gap analysis: ' + _kwGapData.all.length + ' keywords — ' + ac.calls + ' calls, cost: ' + SEO.fmtCost(ac.cost), 'success', 6000);
    }
  } catch (e) {
    showError('kwgap-table-body', 'Gap analysis failed: ' + e.message);
  }
}

var _kwGapSortCol = 'volume';
var _kwGapSortAsc = false;

function sortKwGapTable(col) {
  if (_kwGapSortCol === col) {
    _kwGapSortAsc = !_kwGapSortAsc;
  } else {
    _kwGapSortCol = col;
    _kwGapSortAsc = (col === 'keyword' || col === 'intent'); // alpha asc by default, numbers desc
  }
  renderKwGapTable(_kwGapFilter);
}

function renderKwGapSummary() {
  var total = _kwGapData.all.length;
  var missingCount = _kwGapData.missing.length;
  var weakCount = _kwGapData.weak.length;
  var untappedCount = _kwGapData.untapped.length;
  var strongCount = _kwGapData.strong.length;

  // Update venn area total
  var vennSection = document.querySelector('#view-keyword-gap .lg\\:col-span-5');
  if (vennSection) {
    var totalP = vennSection.querySelector('.text-2xl.font-black');
    if (totalP) totalP.innerHTML = fmtNum(total) + ' <span class="text-xs font-normal text-on-surface-variant">Total</span>';
    var gridDivs = vennSection.querySelectorAll('.grid.grid-cols-3 .text-xl');
    if (gridDivs.length >= 3) {
      gridDivs[0].textContent = fmtNum(missingCount);
      gridDivs[1].textContent = fmtNum(untappedCount);
      gridDivs[2].textContent = fmtNum(weakCount);
    }
  }

  // Update the stat cards on the right
  setHtml('kwgap-stat-missing', fmtNum(missingCount));
  setHtml('kwgap-stat-weak', fmtNum(weakCount));
  setHtml('kwgap-stat-untapped', fmtNum(untappedCount));
  setHtml('kwgap-stat-strong', fmtNum(strongCount));

  // Render full Opportunities table
  _renderOpportunitiesTable();
  // Render full Risk Factors table
  _renderRiskTable();
}

/* Toggle expandable panels */
function toggleGapPanel(id, header) {
  var body = document.getElementById(id);
  if (!body) return;
  var isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : '';
  var chevron = header.querySelector('.kwgap-chevron');
  if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
}

/* Sortable sub-tables */
var _oppSortCol = 'volume', _oppSortAsc = false;
var _riskSortCol = 'volume', _riskSortAsc = false;

function sortOppTable(col) {
  if (_oppSortCol === col) _oppSortAsc = !_oppSortAsc;
  else { _oppSortCol = col; _oppSortAsc = (col === 'keyword'); }
  _renderOpportunitiesTable();
}
function sortRiskTable(col) {
  if (_riskSortCol === col) _riskSortAsc = !_riskSortAsc;
  else { _riskSortCol = col; _riskSortAsc = (col === 'keyword'); }
  _renderRiskTable();
}

function _sortItems(items, col, asc) {
  return items.slice().sort(function(a, b) {
    var va = a[col], vb = b[col];
    if (col === 'keyword' || col === 'intent' || col === 'compDomain') {
      va = (va || '').toLowerCase(); vb = (vb || '').toLowerCase();
      return asc ? va.localeCompare(vb) : vb.localeCompare(va);
    }
    if (col === 'gap') { va = (a.yourPos || 100) - (a.compPos || 1); vb = (b.yourPos || 100) - (b.compPos || 1); }
    va = va == null ? 9999 : va; vb = vb == null ? 9999 : vb;
    return asc ? va - vb : vb - va;
  });
}

function _sortArrow(activeCol, thisCol, asc) {
  if (activeCol !== thisCol) return '';
  return ' ' + (asc ? '&#9650;' : '&#9660;');
}

function _renderOpportunitiesTable() {
  var container = document.getElementById('kwgap-opportunities-body');
  if (!container) return;
  var opportunities = _kwGapData.missing.concat(_kwGapData.weak).filter(function(k) { return k.volume > 0; });
  var potentialTraffic = opportunities.reduce(function(s, k) { return s + (k.volume || 0); }, 0);
  var easyCount = opportunities.filter(function(k) { return k.kd < 35; }).length;

  setHtml('kwgap-opp-count', opportunities.length + ' keywords (' + easyCount + ' easy)');
  setHtml('kwgap-opp-traffic', '+' + fmtNum(potentialTraffic) + ' potential traffic/mo');

  if (opportunities.length === 0) {
    container.innerHTML = '<div style="padding:32px;text-align:center;color:#8c909f;font-size:13px">No opportunities found yet.</div>';
    return;
  }

  opportunities = _sortItems(opportunities, _oppSortCol, _oppSortAsc);

  var sc = _oppSortCol, sa = _oppSortAsc;
  var th = 'padding:8px 16px;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#8c909f;font-weight:600;cursor:pointer;user-select:none;white-space:nowrap';
  var html = '<table style="width:100%;border-collapse:collapse"><thead><tr style="background:rgba(30,30,38,0.5)">'
    + '<th style="' + th + ';text-align:left" onclick="sortOppTable(\'keyword\')">Keyword' + _sortArrow(sc,'keyword',sa) + '</th>'
    + '<th style="' + th + ';text-align:center" onclick="sortOppTable(\'yourPos\')">Your Pos' + _sortArrow(sc,'yourPos',sa) + '</th>'
    + '<th style="' + th + ';text-align:center" onclick="sortOppTable(\'compPos\')">Comp Pos' + _sortArrow(sc,'compPos',sa) + '</th>'
    + '<th style="' + th + ';text-align:right" onclick="sortOppTable(\'volume\')">Volume' + _sortArrow(sc,'volume',sa) + '</th>'
    + '<th style="' + th + ';text-align:center" onclick="sortOppTable(\'kd\')">KD' + _sortArrow(sc,'kd',sa) + '</th>'
    + '<th style="' + th + ';text-align:center">Type</th>'
    + '<th style="' + th + ';text-align:center">Difficulty</th>'
    + '</tr></thead><tbody>';

  var shown = opportunities.slice(0, 50);
  shown.forEach(function(k) {
    var kdCol = kdColor(k.kd || 0);
    var type = k.category === 'missing' ? 'Missing' : 'Weak';
    var typeCol = k.category === 'missing' ? '#adc6ff' : '#ffb3ad';
    var diffLabel = k.kd < 20 ? 'Very Easy' : k.kd < 35 ? 'Easy' : k.kd < 55 ? 'Medium' : k.kd < 75 ? 'Hard' : 'Very Hard';
    var diffCol = k.kd < 35 ? '#4ae176' : k.kd < 55 ? '#f59e0b' : '#ffb3ad';

    html += '<tr style="border-bottom:1px solid rgba(66,71,84,0.08);transition:background 150ms" onmouseover="this.style.background=\'rgba(30,30,38,0.4)\'" onmouseout="this.style.background=\'none\'">'
      + '<td style="padding:8px 16px;font-size:13px;font-weight:600;color:#e4e1e9">' + escHtml(k.keyword) + '</td>'
      + '<td style="padding:8px 16px;text-align:center;font-size:12px;color:#8c909f;font-variant-numeric:tabular-nums">' + (k.yourPos ? '#' + k.yourPos : '<span style="color:#ffb3ad">--</span>') + '</td>'
      + '<td style="padding:8px 16px;text-align:center;font-size:12px;color:#4ae176;font-weight:700;font-variant-numeric:tabular-nums">#' + (k.compPos || '?') + '</td>'
      + '<td style="padding:8px 16px;text-align:right;font-size:12px;color:#e4e1e9;font-weight:700;font-variant-numeric:tabular-nums">' + fmtNum(k.volume) + '</td>'
      + '<td style="padding:8px 16px;text-align:center"><span style="font-size:11px;font-weight:700;color:' + kdCol + ';font-variant-numeric:tabular-nums">' + Math.round(k.kd) + '</span></td>'
      + '<td style="padding:8px 16px;text-align:center"><span style="font-size:9px;font-weight:700;padding:2px 8px;border-radius:4px;color:' + typeCol + ';background:' + typeCol + '12">' + type + '</span></td>'
      + '<td style="padding:8px 16px;text-align:center"><span style="font-size:9px;font-weight:700;padding:2px 8px;border-radius:4px;color:' + diffCol + ';background:' + diffCol + '12">' + diffLabel + '</span></td>'
      + '</tr>';
  });

  html += '</tbody></table>';
  if (opportunities.length > 50) {
    html += '<div style="padding:12px 16px;border-top:1px solid rgba(66,71,84,0.1);text-align:center">'
      + '<span style="font-size:11px;color:#8c909f">Showing top 50 of ' + opportunities.length + ' — full list in All Keywords table below</span></div>';
  }
  container.innerHTML = html;
}

function _renderRiskTable() {
  var container = document.getElementById('kwgap-risks-body');
  if (!container) return;
  var risks = _kwGapData.weak.slice();

  setHtml('kwgap-risk-count', risks.length + ' keywords at risk');

  if (risks.length === 0) {
    container.innerHTML = '<div style="padding:32px;text-align:center;color:#8c909f;font-size:13px">No at-risk keywords found yet.</div>';
    return;
  }

  risks = _sortItems(risks, _riskSortCol, _riskSortAsc);

  var sc = _riskSortCol, sa = _riskSortAsc;
  var th = 'padding:8px 16px;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#8c909f;font-weight:600;cursor:pointer;user-select:none;white-space:nowrap';
  var html = '<table style="width:100%;border-collapse:collapse"><thead><tr style="background:rgba(30,30,38,0.5)">'
    + '<th style="' + th + ';text-align:left" onclick="sortRiskTable(\'keyword\')">Keyword' + _sortArrow(sc,'keyword',sa) + '</th>'
    + '<th style="' + th + ';text-align:center" onclick="sortRiskTable(\'yourPos\')">Your Position' + _sortArrow(sc,'yourPos',sa) + '</th>'
    + '<th style="' + th + ';text-align:center" onclick="sortRiskTable(\'compPos\')">Comp Position' + _sortArrow(sc,'compPos',sa) + '</th>'
    + '<th style="' + th + ';text-align:center" onclick="sortRiskTable(\'gap\')">Gap' + _sortArrow(sc,'gap',sa) + '</th>'
    + '<th style="' + th + ';text-align:right" onclick="sortRiskTable(\'volume\')">Volume' + _sortArrow(sc,'volume',sa) + '</th>'
    + '<th style="' + th + ';text-align:center" onclick="sortRiskTable(\'compDomain\')">Competitor' + _sortArrow(sc,'compDomain',sa) + '</th>'
    + '</tr></thead><tbody>';

  var shown = risks.slice(0, 50);
  shown.forEach(function(k) {
    var gap = (k.yourPos || 100) - (k.compPos || 1);
    var gapSeverity = gap > 30 ? '#ffb3ad' : gap > 15 ? '#f59e0b' : '#8c909f';

    html += '<tr style="border-bottom:1px solid rgba(66,71,84,0.08);transition:background 150ms" onmouseover="this.style.background=\'rgba(30,30,38,0.4)\'" onmouseout="this.style.background=\'none\'">'
      + '<td style="padding:8px 16px;font-size:13px;font-weight:600;color:#e4e1e9">' + escHtml(k.keyword) + '</td>'
      + '<td style="padding:8px 16px;text-align:center;font-size:13px;font-weight:800;color:#ffb3ad;font-variant-numeric:tabular-nums">#' + (k.yourPos || '?') + '</td>'
      + '<td style="padding:8px 16px;text-align:center;font-size:13px;font-weight:800;color:#4ae176;font-variant-numeric:tabular-nums">#' + (k.compPos || '?') + '</td>'
      + '<td style="padding:8px 16px;text-align:center"><span style="font-size:11px;font-weight:800;color:' + gapSeverity + ';font-variant-numeric:tabular-nums">-' + gap + '</span></td>'
      + '<td style="padding:8px 16px;text-align:right;font-size:12px;color:#e4e1e9;font-weight:700;font-variant-numeric:tabular-nums">' + fmtNum(k.volume) + '</td>'
      + '<td style="padding:8px 16px;text-align:center;font-size:10px;color:#8c909f">' + escHtml(k.compDomain || '') + '</td>'
      + '</tr>';
  });

  html += '</tbody></table>';
  if (risks.length > 50) {
    html += '<div style="padding:12px 16px;border-top:1px solid rgba(66,71,84,0.1);text-align:center">'
      + '<span style="font-size:11px;color:#8c909f">Showing top 50 of ' + risks.length + ' — full list in All Keywords table below</span></div>';
  }
  container.innerHTML = html;
}

function _scrollToGapTable() {
  var table = document.getElementById('kwgap-table-body');
  if (table) table.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

var _kwGapPage = 0, _kwGapPageSize = 50;

function kwGapTablePage(dir) {
  var data = _kwGapData[_kwGapFilter] || _kwGapData.all || [];
  var maxPage = Math.max(0, Math.ceil(data.length / _kwGapPageSize) - 1);
  _kwGapPage = Math.max(0, Math.min(maxPage, _kwGapPage + dir));
  renderKwGapTable(_kwGapFilter, true);
}

function renderKwGapTable(filter, isPageChange) {
  _kwGapFilter = filter || 'all';
  if (!isPageChange) _kwGapPage = 0;
  var data = (_kwGapData[_kwGapFilter] || _kwGapData.all).slice(); // copy for sorting
  var tbody = document.getElementById('kwgap-table-body');
  if (!tbody) return;

  // Sort by current sort column
  var col = _kwGapSortCol;
  var asc = _kwGapSortAsc;
  data.sort(function(a, b) {
    var va = a[col], vb = b[col];
    if (col === 'keyword' || col === 'intent') {
      va = (va || '').toLowerCase(); vb = (vb || '').toLowerCase();
      return asc ? va.localeCompare(vb) : vb.localeCompare(va);
    }
    va = va || 9999; vb = vb || 9999; // nulls sort last
    return asc ? va - vb : vb - va;
  });

  // Update tab button active state
  var tabBtns = document.querySelectorAll('#view-keyword-gap .flex.p-1.bg-surface-container-lowest button');
  tabBtns.forEach(function(t) {
    var label = t.textContent.trim().toLowerCase();
    if (label === _kwGapFilter) {
      t.className = 'px-3 md:px-4 py-1.5 rounded-md text-xs font-bold bg-primary text-on-primary transition-all whitespace-nowrap';
    } else {
      t.className = 'px-3 md:px-4 py-1.5 rounded-md text-xs font-bold text-on-surface-variant hover:text-on-surface transition-all whitespace-nowrap';
    }
  });

  var shown = data.slice(_kwGapPage * _kwGapPageSize, (_kwGapPage + 1) * _kwGapPageSize);
  var html = '';

  if (shown.length === 0) {
    html = '<tr><td colspan="8" style="padding:40px;text-align:center;color:#8c909f">No keywords in this category</td></tr>';
    tbody.innerHTML = html;
    return;
  }

  var intentColors = { transactional: '#ffb3ad', commercial: '#adc6ff', informational: '#4ae176', navigational: '#8c909f' };

  shown.forEach(function(item) {
    var kdCol = kdColor(item.kd || 0);
    var intentLbl = (item.intent || 'unknown').toLowerCase();
    var intentCol = intentColors[intentLbl] || '#8c909f';
    html += '<tr class="hover:bg-surface-container-high transition-colors group">'
      + '<td class="px-6 py-3 text-sm font-bold text-on-surface">' + escHtml(item.keyword) + '</td>'
      + '<td class="px-6 py-3 text-center">' + (item.yourPos ? positionBadge(item.yourPos) : '<span class="text-xs text-outline-variant/40">--</span>') + '</td>'
      + '<td class="px-6 py-3 text-center">' + (item.compPos ? positionBadge(item.compPos) : '<span class="text-xs text-outline-variant/40">--</span>') + '</td>'
      + '<td class="px-6 py-3 text-center"><span class="text-[10px] text-on-surface-variant">' + escHtml(item.compDomain || '') + '</span></td>'
      + '<td class="px-6 py-3 text-right"><span class="text-xs font-bold tabular-nums">' + fmtNum(item.volume) + '</span></td>'
      + '<td class="px-6 py-3 text-center"><div class="flex items-center justify-center gap-2">'
      + '<span class="text-xs tabular-nums font-bold" style="color:' + kdCol + '">' + Math.round(item.kd || 0) + '</span>'
      + '<div class="w-10 h-1 bg-surface-container-highest rounded-full overflow-hidden">'
      + '<div class="h-full rounded-full" style="width:' + Math.min(item.kd || 0, 100) + '%;background:' + kdCol + '"></div></div></div></td>'
      + '<td class="px-6 py-3 text-center"><span class="text-[9px] font-bold uppercase px-2 py-0.5 rounded" style="color:' + intentCol + ';background:' + intentCol + '15">' + escHtml(intentLbl) + '</span></td>'
      + '<td class="px-6 py-3 text-right">'
      + '<span class="material-symbols-outlined text-on-surface-variant text-lg cursor-pointer hover:text-primary" data-track-kw="' + escHtml(item.keyword) + '">add_circle</span>'
      + '</td></tr>';
  });

  tbody.innerHTML = html;
  tbody.querySelectorAll('[data-track-kw]').forEach(function(el) {
    el.addEventListener('click', function() { trackKw(el.getAttribute('data-track-kw')); });
  });

  // Pagination
  var gapPagEl = document.getElementById('kwgap-pagination');
  if (gapPagEl) {
    var start = _kwGapPage * _kwGapPageSize + 1;
    var end = Math.min(start + shown.length - 1, data.length);
    var totalPages = Math.ceil(data.length / _kwGapPageSize);
    gapPagEl.innerHTML = '<span class="text-xs text-on-surface-variant tabular-nums">Showing ' + start + '-' + end + ' of ' + data.length + ' keywords (page ' + (_kwGapPage + 1) + '/' + totalPages + ')</span>'
      + '<div class="flex gap-2">'
      + '<button onclick="kwGapTablePage(-1)" class="px-3 py-1 bg-surface-container-highest rounded border border-outline-variant/20 text-xs hover:text-on-surface transition-colors"' + (_kwGapPage === 0 ? ' disabled style="opacity:0.3;pointer-events:none"' : '') + '>Previous</button>'
      + '<button onclick="kwGapTablePage(1)" class="px-3 py-1 bg-surface-container-highest rounded border border-outline-variant/20 text-xs hover:text-on-surface transition-colors"' + ((_kwGapPage + 1) * _kwGapPageSize >= data.length ? ' disabled style="opacity:0.3;pointer-events:none"' : '') + '>Next</button>'
      + '</div>';
  }
}

function filterKwGapTable(query) {
  var q = (query || '').trim().toLowerCase();
  var el = document.getElementById('kwgap-search');
  if (el && !query) el.value = '';
  if (!_kwGapData) return;
  if (!q) { renderKwGapTable(_kwGapFilter); return; }
  var data = _kwGapData[_kwGapFilter] || _kwGapData.all || [];
  var filtered = data.filter(function(k) { return (k.keyword || '').toLowerCase().indexOf(q) !== -1; });
  var tbody = document.getElementById('kwgap-table-body');
  if (!tbody) return;
  var intentColors = { transactional: '#ffb3ad', commercial: '#adc6ff', informational: '#4ae176', navigational: '#8c909f' };
  var html = '';
  filtered.slice(0, 100).forEach(function(item) {
    var kdCol = kdColor(item.kd || 0);
    var intentLbl = (item.intent || 'unknown').toLowerCase();
    var intentCol = intentColors[intentLbl] || '#8c909f';
    html += '<tr class="hover:bg-surface-container-high transition-colors">'
      + '<td class="px-6 py-3 text-sm font-bold text-on-surface">' + escHtml(item.keyword) + '</td>'
      + '<td class="px-6 py-3 text-center">' + (item.yourPos ? positionBadge(item.yourPos) : '--') + '</td>'
      + '<td class="px-6 py-3 text-center">' + (item.compPos ? positionBadge(item.compPos) : '--') + '</td>'
      + '<td class="px-6 py-3 text-center text-[10px] text-on-surface-variant">' + escHtml(item.compDomain || '') + '</td>'
      + '<td class="px-6 py-3 text-right text-xs font-bold tabular-nums">' + fmtNum(item.volume || 0) + '</td>'
      + '<td class="px-6 py-3 text-center text-xs font-bold tabular-nums" style="color:' + kdCol + '">' + Math.round(item.kd || 0) + '</td>'
      + '<td class="px-6 py-3 text-center"><span class="text-[9px] font-bold uppercase px-2 py-0.5 rounded" style="color:' + intentCol + ';background:' + intentCol + '15">' + escHtml(intentLbl) + '</span></td>'
      + '<td class="px-6 py-3"></td></tr>';
  });
  var countText = filtered.length > 100 ? 'Showing 100 of ' + filtered.length + ' matches' : filtered.length + ' matches';
  tbody.innerHTML = html || '<tr><td colspan="8" style="padding:40px;text-align:center;color:#8c909f">No matching keywords</td></tr>';
  var pagEl = document.getElementById('kwgap-pagination');
  if (pagEl) pagEl.innerHTML = '<span class="text-xs text-on-surface-variant">' + countText + '</span><div></div>';
}

function exportKwGapCSV() {
  var data = _kwGapData?.[_kwGapFilter] || _kwGapData?.all || [];
  if (!data.length) { showToast('No gap data to export', 'warning'); return; }
  exportDataCSV(data, [
    {key:'keyword',label:'Keyword'}, {key:'yourPos',label:'Your Position'}, {key:'compPos',label:'Competitor Position'},
    {key:'compDomain',label:'Competitor'}, {key:'volume',label:'Volume'}, {key:'kd',label:'KD%'}, {key:'intent',label:'Intent'}
  ], 'keyword-gap-' + (_kwGapFilter || 'all') + '.csv');
}

function clearGapComp(inputId) {
  var el = document.getElementById(inputId);
  if (el) el.value = '';
}

function runKwGapAnalysis(btn) {
  loadKeywordGap();
}

/**
 * findCompetitors - auto-discover competitors (~$0.01)
 */
async function findCompetitors(btn) {
  var domain = SEO.activeProject;
  if (!domain) { showToast('Select a project first', 'warning'); return; }

  if (btn) { btn.disabled = true; btn.innerHTML = '<span style="display:inline-block;width:14px;height:14px;border:2px solid #35343a;border-top-color:#adc6ff;border-radius:50%;animation:spin 0.8s linear infinite;margin-right:6px"></span>Finding...'; }

  try {
    // First try accumulated competitors (FREE)
    var cached = await SEO.accumulatedCompetitors(domain).catch(function() { return {}; });
    var rawComps = cached?.competitors || [];
    // Extract domain strings, filter out own domain and generic sites
    var junkDomains = ['youtube.com','reddit.com','facebook.com','wikipedia.org','yelp.com','bbb.org','linkedin.com'];
    var competitors = rawComps.map(function(c) { return (typeof c === 'object' ? c.domain : c || '').toString().replace(/^https?:\/\//, '').replace(/^www\./, '').trim(); })
      .filter(function(d) { return d && d !== domain && !junkDomains.some(function(j) { return d.indexOf(j) !== -1; }); });

    // If none cached, fetch from API
    if (competitors.length === 0) {
      var res = await SEO.dfs('dataforseo_labs/google/competitors_domain/live', {
        target: domain,
        location_name: getProjectLocLang().location_name,
        language_name: getProjectLocLang().language_name,
        limit: 10
      });
      var items = res?.tasks?.[0]?.result?.[0]?.items || [];
      competitors = items.map(function(i) { return i.domain; }).filter(Boolean);
    }

    // Pre-fill competitor inputs and save to project
    if (competitors.length >= 1) { var el2 = document.getElementById('kwgap-domain-2'); if (el2) el2.value = competitors[0]; }
    if (competitors.length >= 2) { var el3 = document.getElementById('kwgap-domain-3'); if (el3) el3.value = competitors[1]; }
    if (competitors.length > 0) {
      // Merge with existing saved competitors
      var proj = _projectsCache[domain] || {};
      var existing = (proj.competitors || []).map(function(c) { return c.toLowerCase(); });
      var merged = existing.slice();
      competitors.forEach(function(c) { if (merged.indexOf(c.toLowerCase()) === -1) merged.push(c); });
      merged = merged.slice(0, 20);
      SEO.saveProject(Object.assign({}, proj, { domain: domain, competitors: merged })).catch(function() {});
      if (_projectsCache[domain]) _projectsCache[domain].competitors = merged;
      // Update datalist
      var datalist = document.getElementById('saved-competitors-list');
      if (datalist) datalist.innerHTML = merged.map(function(c) { return '<option value="' + escHtml(c) + '">'; }).join('');
    }

    showToast('Found ' + competitors.length + ' competitors for ' + domain, 'success');
  } catch (e) {
    showToast('Competitor discovery failed: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<span class="material-symbols-outlined">add</span><span class="text-xs">Add Competitor</span>'; }
  }
}

/**
 * Wire up keyword gap tab buttons and analyze button
 */
function wireKwGapControls() {
  // Tab filter buttons (Missing, Weak, Untapped, Strong, All)
  var tabBtns = document.querySelectorAll('#view-keyword-gap .flex.p-1.bg-surface-container-lowest button');
  tabBtns.forEach(function(tab) {
    tab.addEventListener('click', function() {
      var label = this.textContent.trim().toLowerCase();
      renderKwGapTable(label);
    });
  });
}

/**
 * loadKeywordGapView - loads cached gap data and pre-fills competitor inputs on view init.
 */
async function loadKeywordGapView() {
  var domain = SEO.activeProject;
  if (!domain) return;

  setHtml('kwgap-domain-1', escHtml(domain));

  function extractDomain(c) { return (typeof c === 'object' ? (c.domain || '') : (c || '')).toString().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').trim(); }

  // Load competitors: saved project first, fallback to accumulated
  var proj = _projectsCache[domain] || {};
  var savedComps = (proj.competitors || []).map(extractDomain).filter(Boolean);
  if (savedComps.length === 0) {
    try {
      var accData = await SEO.accumulatedCompetitors(domain).catch(function() { return {}; });
      var junk = ['youtube.com','reddit.com','facebook.com','wikipedia.org','yelp.com','bbb.org','linkedin.com'];
      savedComps = (accData?.competitors || []).map(extractDomain).filter(function(d) { return d && d !== domain && !junk.some(function(j) { return d.indexOf(j) !== -1; }); });
    } catch(e) {}
  }
  var el2 = document.getElementById('kwgap-domain-2');
  var el3 = document.getElementById('kwgap-domain-3');
  if (el2 && savedComps[0]) el2.value = savedComps[0];
  if (el3 && savedComps[1]) el3.value = savedComps[1];

  // Populate datalist with all saved competitors for autocomplete
  var datalist = document.getElementById('saved-competitors-list');
  if (datalist && savedComps.length > 0) {
    datalist.innerHTML = savedComps.map(function(c) { return '<option value="' + escHtml(c) + '">'; }).join('');
  }

  // Rebuild full analysis from cached domain_intersection queries (FREE)
  try {
    var hist = await SEO.history({ tool: 'domain_intersection', target: domain, limit: 10 }).catch(function() { return {}; });
    var queries = (hist?.queries || []).filter(function(q) { return q.result_count > 1; });
    if (queries.length === 0) return;

    _kwGapData = { missing: [], weak: [], untapped: [], strong: [], all: [] };
    for (var i = 0; i < Math.min(queries.length, 3); i++) {
      try {
        var full = await SEO.historyById(queries[i].id).catch(function() { return {}; });
        var items = full?.items || [];
        items.forEach(function(item) {
          var kw = item?.keyword_data?.keyword || '';
          if (!kw) return;
          var vol = item?.keyword_data?.keyword_info?.search_volume || 0;
          var kd = item?.keyword_data?.keyword_properties?.keyword_difficulty || 0;
          var intent = item?.keyword_data?.search_intent_info?.main_intent || '';
          var p1 = item?.first_domain_serp_element;
          var p2 = item?.second_domain_serp_element;
          var yourPos = (p1?.rank_group || p1?.serp_item?.rank_group) || null;
          var compPos = (p2?.rank_group || p2?.serp_item?.rank_group) || null;
          var compDom = (p2?.domain || '').replace(/^www\./, '') || '';
          var entry = { keyword: kw, yourPos: yourPos, compPos: compPos, compDomain: compDom, volume: vol, kd: kd, intent: intent, category: 'all' };
          if (!yourPos && compPos) entry.category = 'missing';
          else if (yourPos && yourPos > 20 && compPos && compPos <= 10) entry.category = 'weak';
          else if (yourPos && yourPos > 20 && (!compPos || compPos > 20)) entry.category = 'untapped';
          else if (yourPos && compPos && yourPos < compPos) entry.category = 'strong';
          _kwGapData[entry.category].push(entry);
          _kwGapData.all.push(entry);
        });
      } catch(e) { /* skip */ }
    }

    if (_kwGapData.all.length > 0) {
      renderKwGapSummary();
      renderKwGapTable(_kwGapFilter);
    }
  } catch(e) { console.warn('Keyword gap cache load:', e); }
}
// SEO Platform — Rank Tracking / Position Module
'use strict';

/* =======================================================
   PHASE 3.1 - RANK / POSITION TRACKING
   ======================================================= */

/**
 * Called when `nav('position')` fires via loadViewData.
 * Reads saved ranked_keywords history (FREE) and renders KPIs + table.
 */
async function loadPositionData() {
  showViewLoading('position');
  var domain = SEO.activeProject;
  if (!domain) {
    _showNoProjectNotice('view-position', 'position');
    return;
  }
  _removeNotice('view-position');

  // Load tracked keywords
  try {
    var tracked = await SEO.trackedKeywords(domain);
    var trackedItems = tracked?.keywords || tracked || [];
    _trackedKws = new Set(trackedItems.map(function(k) { return (k.keyword || '').toLowerCase(); }));
    _trackedKwList = trackedItems;
    setHtml('tracked-kw-count', trackedItems.length);
  } catch(e) { _trackedKws = new Set(); }

  // Update header domain label
  var headerSpan = document.querySelector('#view-position p .text-primary');
  if (headerSpan) headerSpan.textContent = domain;

  try {
    // Fetch last 2 ranked_keywords results for change comparison (FREE)
    var hist = await SEO.history({ tool: 'ranked_keywords', target: domain, limit: 2 }).catch(function() { return {}; });
    if (!hist?.queries?.length) {
      _showPositionEmpty();
      return;
    }

    var latest = hist.queries[0];
    var prev = hist.queries.length > 1 ? hist.queries[1] : null;

    // Load full items for latest
    var fullData = null;
    if (latest.id) {
      fullData = await SEO.historyById(latest.id).catch(function() { return null; });
    }
    var items = fullData?.items || fullData?.items || [];

    // Load full items for previous (for change arrows)
    var prevItems = [];
    if (prev?.id) {
      var prevFull = await SEO.historyById(prev.id).catch(function() { return null; });
      prevItems = prevFull?.items || prevFull?.items || [];
    }

    // Compute KPIs
    var totalVolume = 0;
    var weightedCtr = 0;
    var totalEtv = 0;
    var posSum = 0;
    var top3Count = 0;
    var count = items.length || 0;

    items.forEach(function(item) {
      var rank = item?.ranked_serp_element?.serp_item?.rank_group || 999;
      var vol = item?.keyword_data?.keyword_info?.search_volume || 0;
      var etv = item?.ranked_serp_element?.serp_item?.etv || 0;

      totalVolume += vol;
      totalEtv += etv;
      posSum += rank;

      // CTR model
      var ctr = 0;
      if (rank === 1) ctr = 0.31;
      else if (rank === 2) ctr = 0.15;
      else if (rank === 3) ctr = 0.10;
      else if (rank <= 10) ctr = 0.03;
      else if (rank <= 20) ctr = 0.01;
      else ctr = 0.001;
      weightedCtr += ctr * vol;

      if (rank <= 3) top3Count++;
    });

    var visibility = totalVolume > 0 ? (weightedCtr / totalVolume * 100) : 0;
    var avgPos = count > 0 ? (posSum / count) : 0;

    // Compute previous KPIs for change indicators
    var prevVis = 0, prevEtv = 0, prevAvg = 0, prevTop3 = 0;
    if (prevItems.length > 0) {
      var pTotalVol = 0, pWeightedCtr = 0, pPosSum = 0;
      prevItems.forEach(function(item) {
        var rank = item?.ranked_serp_element?.serp_item?.rank_group || 999;
        var vol = item?.keyword_data?.keyword_info?.search_volume || 0;
        pTotalVol += vol;
        pPosSum += rank;
        prevEtv += item?.ranked_serp_element?.serp_item?.etv || 0;
        var ctr = 0;
        if (rank === 1) ctr = 0.31;
        else if (rank === 2) ctr = 0.15;
        else if (rank === 3) ctr = 0.10;
        else if (rank <= 10) ctr = 0.03;
        else if (rank <= 20) ctr = 0.01;
        else ctr = 0.001;
        pWeightedCtr += ctr * vol;
        if (rank <= 3) prevTop3++;
      });
      prevVis = pTotalVol > 0 ? (pWeightedCtr / pTotalVol * 100) : 0;
      prevAvg = prevItems.length > 0 ? (pPosSum / prevItems.length) : 0;
    }

    // Fill KPI cards
    setHtml('pos-visibility-val', visibility.toFixed(1) + '%');
    _fillChangeIndicator('pos-visibility-change', visibility, prevVis, 'pct');
    // Update visibility progress bar
    var visBar = document.querySelector('#view-position .border-primary .h-full.bg-primary');
    if (visBar) visBar.style.width = Math.min(visibility, 100).toFixed(1) + '%';

    setHtml('pos-traffic-val', fmtNum(Math.round(totalEtv)));
    _fillChangeIndicator('pos-traffic-change', totalEtv, prevEtv, 'num');

    setHtml('pos-avgpos-val', avgPos > 0 ? avgPos.toFixed(1) : '--');
    _fillChangeIndicator('pos-avgpos-change', prevAvg, avgPos, 'pos'); // lower is better

    setHtml('pos-top3-val', top3Count);
    _fillChangeIndicator('pos-top3-change', top3Count, prevTop3, 'num');
    var totalRankedKw = latest.summary?.total_count || latest.result_count || count;
    setHtml('pos-top3-sub', 'Out of ' + fmtNum(totalRankedKw) + ' ranked keywords');

    // Position distribution
    renderPositionDistribution(items);

    // Rankings table
    renderPositionTable(items, prevItems);

    // Load rank history trend chart from saved snapshots (FREE, non-blocking)
    loadRankHistoryFromSnapshots();

  } catch (e) {
    console.warn('Position data load error:', e);
    showToast('Failed to load position data: ' + e.message, 'error');
  } finally {
    hideViewLoading('position');
  }
}

function _showPositionEmpty() {
  var tbody = document.getElementById('pos-keywords-body');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="6" style="padding:60px 24px;text-align:center;color:#8c909f">'
      + '<div style="font-size:16px;margin-bottom:16px">No ranking data yet for this domain.</div>'
      + '<button onclick="refreshPositionData(this)" style="background:#adc6ff;color:#0e0e13;border:none;padding:10px 20px;border-radius:8px;font-size:14px;cursor:pointer;font-weight:600;min-height:44px">Fetch Rankings (~$0.02)</button>'
      + '</td></tr>';
  }
  ['pos-visibility-val','pos-traffic-val','pos-avgpos-val','pos-top3-val'].forEach(function(id) { setHtml(id, '--'); });
}

/**
 * Refresh button handler. Calls DataForSEO ranked_keywords (~$0.01).
 */
async function refreshPositionData(btn) {
  var domain = SEO.activeProject;
  if (!domain) { showToast('Select a project first', 'warning'); return; }
  if (!checkBalanceWarning(0.02)) return;
  debounceAction('refreshPosition', async function() {
    if (btn) {
      btn.disabled = true;
      var origHtml = btn.innerHTML;
      btn.innerHTML = '<span style="display:inline-block;width:14px;height:14px;border:2px solid #35343a;border-top-color:#adc6ff;border-radius:50%;animation:spin 0.8s linear infinite;margin-right:6px"></span>Fetching...';
    }
    SEO.startAction();
    try {
      await SEO.dfs('dataforseo_labs/google/ranked_keywords/live', {
        target: domain,
        location_name: getProjectLocLang().location_name,
        language_name: getProjectLocLang().language_name,
        limit: 100,
        order_by: ['ranked_serp_element.serp_item.rank_group,asc']
      });
      var ac = SEO.getActionCost();
      showToast('Rankings refreshed — cost: ' + SEO.fmtCost(ac.cost), 'success', 6000);
      await loadPositionData();
    } catch (e) {
      showToast('Refresh failed: ' + e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = origHtml || 'Refresh'; }
    }
  });
}

/**
 * Renders the keyword rankings table in #pos-keywords-body.
 * Compares latest vs previous items to compute rank change.
 */
var _posAllItems = [], _posPrevMap = {}, _posPage = 0, _posPageSize = 50, _trackedKws = new Set();

function exportPosData() {
  if (!_posAllItems.length) { showToast('No ranking data to export', 'warning'); return; }
  exportDataCSV(_posAllItems.map(function(item) {
    return {
      keyword: item?.keyword_data?.keyword || '',
      position: item?.ranked_serp_element?.serp_item?.rank_group || '',
      url: item?.ranked_serp_element?.serp_item?.url || '',
      volume: item?.keyword_data?.keyword_info?.search_volume || 0,
      cpc: item?.keyword_data?.keyword_info?.cpc || 0,
      etv: item?.ranked_serp_element?.serp_item?.etv || 0,
    };
  }), [
    {key:'keyword',label:'Keyword'}, {key:'position',label:'Position'}, {key:'url',label:'URL'},
    {key:'volume',label:'Volume'}, {key:'cpc',label:'CPC'}, {key:'etv',label:'Est. Traffic'}
  ], 'rank-tracking-' + (SEO.activeProject || 'export') + '.csv');
}

function exportKwData() {
  if (!_kwData || !_kwData.length) { showToast('No keyword data to export', 'warning'); return; }
  exportDataCSV(_kwData, [
    {key:'keyword',label:'Keyword'}, {key:'volume',label:'Volume'}, {key:'kd',label:'KD%'},
    {key:'cpc',label:'CPC'}, {key:'competition',label:'Competition'}, {key:'intent',label:'Intent'}
  ], 'keywords-' + (SEO.activeProject || 'export') + '.csv');
}

function posTablePage(dir) {
  var maxPage = Math.max(0, Math.ceil(_posAllItems.length / _posPageSize) - 1);
  _posPage = Math.max(0, Math.min(maxPage, _posPage + dir));
  renderPositionTable(_posAllItems, null, true);
}

function renderPositionTable(items, prevItems, isPageChange) {
  var tbody = document.getElementById('pos-keywords-body');
  if (!tbody) return;

  // Store full items for pagination (only on fresh data, not page change)
  if (!isPageChange) {
    _posAllItems = items || [];
    _posPage = 0;
    // Build lookup of previous positions by keyword
    _posPrevMap = {};
    (prevItems || []).forEach(function(item) {
      var kw = item?.keyword_data?.keyword || '';
      var rank = item?.ranked_serp_element?.serp_item?.rank_group || null;
      if (kw) _posPrevMap[kw.toLowerCase()] = rank;
    });
  }

  var totalItems = _posAllItems.length;
  if (totalItems === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="padding:40px;text-align:center;color:#8c909f">No keywords found</td></tr>';
    return;
  }

  var pageItems = _posAllItems.slice(_posPage * _posPageSize, (_posPage + 1) * _posPageSize);
  var prevMap = _posPrevMap;

  var html = '';
  pageItems.forEach(function(item) {
    var kw = item?.keyword_data?.keyword || '';
    var rank = item?.ranked_serp_element?.serp_item?.rank_group || '--';
    var url = item?.ranked_serp_element?.serp_item?.relative_url || item?.ranked_serp_element?.serp_item?.url || '';
    var vol = item?.keyword_data?.keyword_info?.search_volume || 0;
    var etv = item?.ranked_serp_element?.serp_item?.etv || 0;

    // Compute visibility percentage for this keyword
    var ctr = 0;
    if (rank <= 1) ctr = 31;
    else if (rank <= 2) ctr = 15;
    else if (rank <= 3) ctr = 10;
    else if (rank <= 10) ctr = 3;
    else if (rank <= 20) ctr = 1;
    else ctr = 0.1;

    // Compute rank change
    var prevRank = prevMap[kw.toLowerCase()] || null;
    var changeHtml = '';
    if (prevRank !== null && rank !== '--') {
      var diff = prevRank - rank; // positive = improved
      if (diff > 0) {
        changeHtml = '<div class="flex items-center gap-1 text-secondary">'
          + '<span class="material-symbols-outlined text-sm">keyboard_arrow_up</span>'
          + diff + '</div>';
      } else if (diff < 0) {
        changeHtml = '<div class="flex items-center gap-1 text-tertiary">'
          + '<span class="material-symbols-outlined text-sm">keyboard_arrow_down</span>'
          + Math.abs(diff) + '</div>';
      } else {
        changeHtml = '<div class="flex items-center gap-1 text-on-surface-variant">'
          + '<span class="material-symbols-outlined text-sm">horizontal_rule</span>'
          + '0</div>';
      }
    } else {
      changeHtml = '<span class="text-on-surface-variant/50">--</span>';
    }

    // Truncate URL for display
    var displayUrl = url;
    if (displayUrl.length > 30) displayUrl = displayUrl.substring(0, 30) + '...';

    var isTracked = _trackedKws.has(kw.toLowerCase());
    var trackIcon = isTracked
      ? '<span class="material-symbols-outlined text-[16px] text-secondary cursor-pointer" style="font-variation-settings:\'FILL\' 1" data-track-pos="' + escHtml(kw) + '" title="Tracked">star</span>'
      : '<span class="material-symbols-outlined text-[16px] text-on-surface-variant/40 cursor-pointer opacity-0 group-hover:opacity-100" data-track-pos="' + escHtml(kw) + '" title="Track keyword">star</span>';
    var rowBg = isTracked ? ' bg-secondary/5' : '';

    html += '<tr class="hover:bg-surface-container-high transition-colors cursor-pointer group' + rowBg + '">'
      + '<td class="px-2 md:px-6 py-3 md:py-4"><div class="flex items-center gap-2">'
      + trackIcon
      + '<span class="text-xs md:text-sm font-medium text-on-surface">' + escHtml(kw) + '</span>'
      + '</div></td>'
      + '<td class="px-2 md:px-6 py-3 md:py-4 tabular-nums text-sm font-bold text-on-surface">' + rank + '</td>'
      + '<td class="px-2 md:px-6 py-3 md:py-4 tabular-nums text-xs font-bold">' + changeHtml + '</td>'
      + '<td class="px-2 md:px-6 py-3 md:py-4 hidden md:table-cell"><span class="text-xs text-on-surface-variant truncate max-w-[140px] inline-block">' + escHtml(displayUrl) + '</span></td>'
      + '<td class="px-2 md:px-6 py-3 md:py-4 tabular-nums text-sm text-on-surface-variant">' + fmtNum(vol) + '</td>'
      + '<td class="px-2 md:px-6 py-3 md:py-4 tabular-nums text-sm font-medium text-on-surface hidden md:table-cell">' + ctr + '%</td>'
      + '</tr>';
  });

  tbody.innerHTML = html;

  // Wire track keyword icons
  tbody.querySelectorAll('[data-track-pos]').forEach(function(el) {
    el.addEventListener('click', function(e) {
      e.stopPropagation();
      var kw = el.getAttribute('data-track-pos');
      if (_trackedKws.has(kw.toLowerCase())) {
        // Already tracked — for now just show info (untrack would need DELETE by ID)
        showToast('"' + kw + '" is already tracked', 'info');
      } else {
        trackKw(kw).then(function() {
          _trackedKws.add(kw.toLowerCase());
          el.style.fontVariationSettings = "'FILL' 1";
          el.classList.remove('text-on-surface-variant/40', 'opacity-0', 'group-hover:opacity-100');
          el.classList.add('text-secondary');
          el.closest('tr').classList.add('bg-secondary/5');
        });
      }
    });
  });

  // Update pagination text
  var paginationEl = document.querySelector('#view-position .p-4.border-t span');
  if (paginationEl) {
    var start = _posPage * _posPageSize + 1;
    var end = Math.min(start + pageItems.length - 1, totalItems);
    paginationEl.textContent = 'Showing ' + start + '-' + end + ' of ' + totalItems + ' keywords';
  }
  // Update button states
  var prevBtn = document.getElementById('pos-prev-btn');
  var nextBtn = document.getElementById('pos-next-btn');
  if (prevBtn) prevBtn.disabled = _posPage === 0;
  if (nextBtn) nextBtn.disabled = (_posPage + 1) * _posPageSize >= totalItems;
}

/**
 * Fill a change indicator element with arrow + value.
 * mode: 'pct' for percentage change, 'num' for absolute diff, 'pos' for position (lower=better)
 */
function _fillChangeIndicator(elementId, current, previous, mode) {
  var el = document.getElementById(elementId);
  if (!el) return;
  if (!previous || !current) {
    el.innerHTML = '';
    el.className = 'text-on-surface-variant flex items-center gap-1 text-xs font-bold';
    return;
  }

  var diff, text, positive;
  if (mode === 'pct') {
    diff = current - previous;
    text = (diff >= 0 ? '+' : '') + diff.toFixed(1) + '%';
    positive = diff >= 0;
  } else if (mode === 'pos') {
    // For position: current is "better" (previous avg pos), previous is "current avg pos" - lower is better
    diff = current - previous;
    text = (diff >= 0 ? '+' : '') + diff.toFixed(1);
    positive = diff >= 0; // Positive means previous was higher (worse), so improvement
  } else {
    diff = current - previous;
    text = (diff >= 0 ? '+' : '') + fmtNum(Math.round(Math.abs(diff)));
    if (diff < 0) text = '-' + fmtNum(Math.round(Math.abs(diff)));
    positive = diff >= 0;
  }

  var icon = positive ? 'trending_up' : 'trending_down';
  var cls = positive ? 'text-secondary' : 'text-tertiary';
  if (Math.abs(diff) < 0.01) { icon = 'horizontal_rule'; cls = 'text-on-surface-variant'; }

  el.className = cls + ' flex items-center gap-1 text-xs font-bold';
  el.innerHTML = '<span class="material-symbols-outlined text-sm">' + icon + '</span>' + escHtml(text);
}


/* =======================================================
   TRACKED KEYWORDS MANAGEMENT PANEL
   ======================================================= */

var _trackedKwList = []; // full list with IDs for deletion

function toggleTrackedPanel(header) {
  var panel = document.getElementById('tracked-kw-panel');
  if (!panel) return;
  var isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : '';
  var chevron = header.querySelector('.tracked-panel-chevron');
  if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
  if (!isOpen) loadTrackedKeywordsList();
}

async function loadTrackedKeywordsList() {
  var domain = SEO.activeProject;
  if (!domain) return;
  var container = document.getElementById('tracked-kw-list');
  if (!container) return;

  try {
    var data = await SEO.trackedKeywords(domain);
    var items = Array.isArray(data) ? data : (data?.keywords || data?.tracked || []);
    _trackedKwList = items;

    setHtml('tracked-kw-count', items.length);

    if (items.length === 0) {
      container.innerHTML = '<div style="text-align:center;color:#64687a;font-size:12px;padding:16px">No tracked keywords yet. Add keywords above or click the star icon on any keyword in the rankings table.</div>';
      return;
    }

    var html = '<div style="display:flex;flex-wrap:wrap;gap:6px">';
    items.forEach(function(item) {
      var kw = item.keyword || item;
      var id = item.id;
      var added = item.added_at ? new Date(item.added_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';

      html += '<div style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px;background:#1a1a22;border:1px solid rgba(66,71,84,0.2);border-radius:8px;font-size:12px;color:#e4e1e9;transition:all 150ms" onmouseover="this.style.borderColor=\'rgba(173,198,255,0.3)\'" onmouseout="this.style.borderColor=\'rgba(66,71,84,0.2)\'">'
        + '<span class="material-symbols-outlined" style="font-size:14px;color:#f59e0b;font-variation-settings:\'FILL\' 1">star</span>'
        + '<span style="font-weight:600">' + escHtml(kw) + '</span>';
      if (added) {
        html += '<span style="font-size:9px;color:#64687a">' + added + '</span>';
      }
      if (id) {
        html += '<span onclick="removeTrackedKw(' + id + ',this.parentElement)" class="material-symbols-outlined" style="font-size:14px;color:#64687a;cursor:pointer;margin-left:2px;transition:color 150ms" onmouseover="this.style.color=\'#ef4444\'" onmouseout="this.style.color=\'#64687a\'" title="Remove from tracking">close</span>';
      }
      html += '</div>';
    });
    html += '</div>';
    container.innerHTML = html;
  } catch(e) {
    container.innerHTML = '<div style="color:#ffb3ad;font-size:12px;padding:12px">Failed to load: ' + escHtml(e.message) + '</div>';
  }
}

async function addTrackedKeywords() {
  var domain = SEO.activeProject;
  if (!domain) { showToast('Select a project first', 'warning'); return; }
  var input = document.getElementById('tracked-kw-input');
  var raw = (input?.value || '').trim();
  if (!raw) { showToast('Enter keywords to track', 'warning'); return; }

  var keywords = raw.split(',').map(function(k) { return k.trim(); }).filter(function(k) { return k.length > 0; });
  if (keywords.length === 0) return;

  try {
    await SEO.trackKeyword(domain, keywords);
    // Update the local set used by the rankings table
    keywords.forEach(function(kw) { _trackedKws.add(kw.toLowerCase()); });
    showToast('Tracking ' + keywords.length + ' keyword' + (keywords.length > 1 ? 's' : ''), 'success');
    if (input) input.value = '';
    loadTrackedKeywordsList();
    // Re-render the rankings table to update star icons
    if (_posAllItems.length > 0) renderPositionTable(_posAllItems, null, true);
  } catch(e) {
    showToast('Failed to add: ' + e.message, 'error');
  }
}

async function removeTrackedKw(id, chipEl) {
  if (!id) return;
  try {
    await SEO.removeTrackedKeyword(id);
    // Remove from local list and set
    var removed = _trackedKwList.find(function(k) { return k.id === id; });
    if (removed) _trackedKws.delete((removed.keyword || '').toLowerCase());
    // Animate chip removal
    if (chipEl) {
      chipEl.style.opacity = '0';
      chipEl.style.transform = 'scale(0.8)';
      chipEl.style.transition = 'all 200ms';
      setTimeout(function() { chipEl.remove(); }, 200);
    }
    // Update count
    _trackedKwList = _trackedKwList.filter(function(k) { return k.id !== id; });
    setHtml('tracked-kw-count', _trackedKwList.length);
    showToast('Keyword removed from tracking', 'success');
    // Re-render rankings table to update star icons
    if (_posAllItems.length > 0) renderPositionTable(_posAllItems, null, true);
  } catch(e) {
    showToast('Failed to remove: ' + e.message, 'error');
  }
}

/* =======================================================
   POSITION VIEW BUTTON WIRING
   =======================================================
   Repurpose the "Export" button as "Refresh" and wire the
   "Add Keywords" button. Call from DOMContentLoaded.
   ======================================================= */
/* =======================================================
   RANK HISTORY TREND — built from saved ranked_keywords snapshots
   + optional historical_rank_overview/live ($0.10)
   ======================================================= */

/**
 * Build rank history from saved data (FREE).
 * Called automatically during loadPositionData.
 * Priority: 1) saved rank_history (from $0.10 fetch), 2) ranked_keywords snapshots.
 */
async function loadRankHistoryFromSnapshots() {
  var domain = SEO.activeProject;
  if (!domain) return;

  try {
    // First: check for saved rank_history data (from previous $0.10 fetches)
    var rhHist = await SEO.history({ tool: 'rank_history', target: domain, limit: 1 }).catch(function() { return {}; });
    var rhQuery = (rhHist?.queries || [])[0];
    if (rhQuery?.id) {
      try {
        var rhFull = await SEO.historyById(rhQuery.id);
        var rhItems = rhFull?.items || [];
        if (rhItems.length > 0) {
          var dates = [], top3Series = [], top10Series = [], top20Series = [], top100Series = [];
          rhItems.sort(function(a, b) { return (a.year * 100 + a.month) - (b.year * 100 + b.month); });
          rhItems.forEach(function(item) {
            var m = item.metrics?.organic || {};
            var date = new Date(item.year, (item.month || 1) - 1);
            dates.push(date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }));
            var p1 = m.pos_1 || 0;
            var p2_3 = m.pos_2_3 || 0;
            var p4_10 = m.pos_4_10 || 0;
            var p11_20 = m.pos_11_20 || 0;
            var p21_30 = m.pos_21_30 || 0;
            var p31_40 = m.pos_31_40 || 0;
            var p41_50 = m.pos_41_50 || 0;
            var p51_60 = m.pos_51_60 || 0;
            var p61_70 = m.pos_61_70 || 0;
            var p71_80 = m.pos_71_80 || 0;
            var p81_90 = m.pos_81_90 || 0;
            var p91_100 = m.pos_91_100 || 0;
            top3Series.push(p1 + p2_3);
            top10Series.push(p4_10);
            top20Series.push(p11_20);
            top100Series.push(p21_30 + p31_40 + p41_50 + p51_60 + p61_70 + p71_80 + p81_90 + p91_100);
          });
          _renderRankHistoryChart(dates, top3Series, top10Series, top20Series, top100Series);
          return; // done — used saved rank_history
        }
      } catch(e) { /* fall through to ranked_keywords */ }
    }

    // Fallback: reconstruct from ranked_keywords snapshots
    var hist = await SEO.history({ tool: 'ranked_keywords', target: domain, limit: 20 }).catch(function() { return {}; });
    var queries = (hist?.queries || []).reverse(); // oldest first
    if (queries.length < 2) return; // need at least 2 data points

    var dates = [];
    var top3Series = [];
    var top10Series = [];
    var top20Series = [];
    var top100Series = [];

    for (var i = 0; i < queries.length; i++) {
      var q = queries[i];
      var d = new Date(q.created_at);
      dates.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));

      // Try to get position distribution from summary
      var s = q.summary || {};
      var totalCount = s.total_count || s.metrics?.organic?.count || q.result_count || 0;

      // If we have full items, compute distribution
      if (q.id && totalCount > 0) {
        try {
          var full = await SEO.historyById(q.id);
          var items = full?.items || [];
          var t3 = 0, t10 = 0, t20 = 0, t100 = 0;
          items.forEach(function(item) {
            var rank = item?.ranked_serp_element?.serp_item?.rank_group || 999;
            if (rank <= 3) t3++;
            else if (rank <= 10) t10++;
            else if (rank <= 20) t20++;
            else t100++;
          });
          top3Series.push(t3);
          top10Series.push(t10);
          top20Series.push(t20);
          top100Series.push(t100);
        } catch(e) {
          // Can't load full items, use estimate from total
          top3Series.push(0);
          top10Series.push(0);
          top20Series.push(Math.round(totalCount * 0.3));
          top100Series.push(Math.round(totalCount * 0.7));
        }
      } else {
        top3Series.push(0);
        top10Series.push(0);
        top20Series.push(0);
        top100Series.push(totalCount);
      }
    }

    _renderRankHistoryChart(dates, top3Series, top10Series, top20Series, top100Series);
  } catch(e) {
    console.warn('Rank history load error:', e);
  }
}

/**
 * Fetch live historical rank overview from DataForSEO ($0.10).
 * Provides monthly rank snapshots going back up to 12 months.
 */
async function fetchRankHistory(btn) {
  var domain = SEO.activeProject;
  if (!domain) { showToast('Select a project first', 'warning'); return; }
  if (!checkBalanceWarning(0.12)) return;
  if (_debounceTimers['fetchRankHistory']) return;
  _debounceTimers['fetchRankHistory'] = true;
  setTimeout(function() { _debounceTimers['fetchRankHistory'] = false; }, 5000);

  if (btn) { btn.disabled = true; btn.innerHTML = '<span style="display:inline-block;width:14px;height:14px;border:2px solid #35343a;border-top-color:#adc6ff;border-radius:50%;animation:spin 0.8s linear infinite;margin-right:4px"></span>Loading...'; }
  SEO.startAction();

  try {
    var res = await SEO.dfs('dataforseo_labs/google/historical_rank_overview/live', {
      target: domain,
      location_name: getProjectLocLang().location_name,
      language_name: getProjectLocLang().language_name
    });

    var items = res?.tasks?.[0]?.result?.[0]?.items || [];
    if (items.length > 0) {
      // items are monthly snapshots with metrics.organic.pos_1/pos_2_3/pos_4_10/pos_11_20/pos_21_30 etc.
      var dates = [];
      var top3Series = [];
      var top10Series = [];
      var top20Series = [];
      var top100Series = [];

      // Sort by date ascending
      items.sort(function(a, b) { return (a.year * 100 + a.month) - (b.year * 100 + b.month); });

      items.forEach(function(item) {
        var m = item.metrics?.organic || {};
        var date = new Date(item.year, (item.month || 1) - 1);
        dates.push(date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }));
        var p1 = m.pos_1 || 0;
        var p2_3 = m.pos_2_3 || 0;
        var p4_10 = m.pos_4_10 || 0;
        var p11_20 = m.pos_11_20 || 0;
        var p21_30 = m.pos_21_30 || 0;
        var p31_40 = m.pos_31_40 || 0;
        var p41_50 = m.pos_41_50 || 0;
        var p51_60 = m.pos_51_60 || 0;
        var p61_70 = m.pos_61_70 || 0;
        var p71_80 = m.pos_71_80 || 0;
        var p81_90 = m.pos_81_90 || 0;
        var p91_100 = m.pos_91_100 || 0;
        top3Series.push(p1 + p2_3);
        top10Series.push(p4_10);
        top20Series.push(p11_20);
        top100Series.push(p21_30 + p31_40 + p41_50 + p51_60 + p61_70 + p71_80 + p81_90 + p91_100);
      });

      _renderRankHistoryChart(dates, top3Series, top10Series, top20Series, top100Series);
      var ac = SEO.getActionCost();
      showToast('Loaded ' + items.length + ' months of rank history — cost: ' + SEO.fmtCost(ac.cost), 'success');
    } else {
      showToast('No historical rank data available for this domain.', 'info');
    }
  } catch(e) {
    showToast('Rank history failed: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<span class="material-symbols-outlined text-sm">history</span> Fetch History (~$0.10)'; }
  }
}

function _renderRankHistoryChart(dates, top3, top10, top20, top100) {
  var el = document.getElementById('chart-rank-history');
  if (!el) return;

  // Stacked area chart using ApexCharts
  if (_charts['chart-rank-history']) {
    _charts['chart-rank-history'].destroy();
  }

  var options = {
    chart: { type: 'area', height: 220, stacked: true, background: 'transparent', toolbar: { show: false },
      fontFamily: 'Inter, sans-serif' },
    series: [
      { name: 'Pos 1-3', data: top3 },
      { name: 'Pos 4-10', data: top10 },
      { name: 'Pos 11-20', data: top20 },
      { name: 'Pos 21-100', data: top100 }
    ],
    colors: ['#f59e0b', '#4ae176', '#adc6ff', '#424754'],
    xaxis: { categories: dates, labels: { style: { colors: '#8c909f', fontSize: '10px' } },
      axisBorder: { show: false }, axisTicks: { show: false } },
    yaxis: { labels: { style: { colors: '#8c909f', fontSize: '10px' } } },
    grid: { borderColor: 'rgba(66,71,84,0.15)', strokeDashArray: 3 },
    stroke: { curve: 'smooth', width: 1.5 },
    fill: { type: 'solid', opacity: 0.3 },
    dataLabels: { enabled: false },
    legend: { position: 'top', horizontalAlign: 'left', fontSize: '11px',
      labels: { colors: '#8c909f' }, markers: { width: 8, height: 8, radius: 2 } },
    tooltip: { theme: 'dark', shared: true, intersect: false,
      y: { formatter: function(v) { return v + ' keywords'; } } },
    theme: { mode: 'dark' }
  };

  var chart = new ApexCharts(el, options);
  chart.render();
  _charts['chart-rank-history'] = chart;
}

function initPositionButtons() {
  var viewEl = document.getElementById('view-position');
  if (!viewEl) return;

  // Find the button group and replace first button with Refresh
  var buttons = viewEl.querySelectorAll('.flex.flex-wrap.gap-2 button');
  if (buttons.length >= 1) {
    buttons[0].innerHTML = '<span class="material-symbols-outlined text-base">refresh</span> Refresh (~$0.02)';
    buttons[0].onclick = function() { refreshPositionData(this); };
  }
}
// SEO Platform — Sitemap Module
'use strict';

/* =======================================================
   SITEMAP FETCH, CACHE, AND UI
   - _sitemapData          (global state)
   - fetchSitemap          (fetch live sitemap via API)
   - toggleSitemapDetail   (expand/collapse URL list)
   - loadCachedSitemap     (load server-cached sitemap on init)
   - initAuditButtons      (inject sitemap + crawl + lighthouse buttons)
   ======================================================= */

var _sitemapData = null;

async function fetchSitemap(btn) {
  var domain = SEO.activeProject;
  if (!domain) { showToast('Select a project first', 'error'); return; }
  var origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="material-symbols-outlined text-[16px] animate-spin">progress_activity</span> Fetching...';
  try {
    var resp = await fetch(SEO.API + '/sitemap?tenant=' + SEO.TENANT + '&domain=' + encodeURIComponent(domain));
    var data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Sitemap fetch failed');
    _sitemapData = data;

    // Update crawl button with page count
    var crawlBtn = document.getElementById('audit-start-crawl-btn');
    if (crawlBtn) {
      crawlBtn.disabled = false;
      crawlBtn.style.opacity = '1';
      var cost = Math.round(data.totalPages * 0.000375 * 1000) / 1000;
      crawlBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px">radar</span>Crawl All ' + data.totalPages + ' Pages (~$' + cost.toFixed(3) + ')';
    }

    // Show sitemap summary
    var infoEl = document.getElementById('audit-sitemap-info');
    if (infoEl) {
      var sitemapHtml = '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">';
      sitemapHtml += '<span style="font-size:12px;font-weight:700;color:#4ade80">' + data.totalPages + ' pages found</span>';
      sitemapHtml += '<span style="font-size:11px;color:#64687a">|</span>';
      sitemapHtml += '<span style="font-size:11px;color:#8c909f">' + data.sitemaps.length + ' sitemap' + (data.sitemaps.length !== 1 ? 's' : '') + '</span>';
      sitemapHtml += '<button onclick="toggleSitemapDetail()" style="font-size:11px;color:#adc6ff;background:none;border:none;cursor:pointer;font-weight:600;text-decoration:underline">View URLs</button>';
      sitemapHtml += '</div>';
      sitemapHtml += '<div id="sitemap-detail" style="display:none;margin-top:8px;max-height:200px;overflow-y:auto;background:#12121a;border-radius:8px;padding:8px 12px;font-size:11px;font-family:monospace;color:#8c909f">';
      var urls = data.urls || [];
      for (var i = 0; i < Math.min(urls.length, 200); i++) {
        sitemapHtml += '<div style="padding:2px 0;border-bottom:1px solid #1e1e24">' + urls[i].replace(/^https?:\/\//, '') + '</div>';
      }
      if (urls.length > 200) sitemapHtml += '<div style="padding:4px 0;color:#64687a">...and ' + (urls.length - 200) + ' more</div>';
      sitemapHtml += '</div>';
      infoEl.innerHTML = sitemapHtml;
    }

    showToast('Sitemap: ' + data.totalPages + ' pages found', 'success');

    // Cross-reference: compare sitemap count vs DataForSEO crawled/indexed count
    _checkSitemapCoverage(domain, data.totalPages);
  } catch (err) {
    showToast('Sitemap error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = origHtml;
  }
}

function toggleSitemapDetail() {
  var el = document.getElementById('sitemap-detail');
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function initAuditButtons() {
  var viewEl = document.getElementById('view-audit');
  if (!viewEl) return;

  // Inject action buttons after the header tabs
  var headerTabs = viewEl.querySelector('.flex.items-center.gap-1.bg-surface-container-low');
  if (headerTabs && !viewEl.querySelector('.audit-action-btns')) {
    var btnRow = document.createElement('div');
    btnRow.className = 'audit-action-btns';
    btnRow.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-top:12px';

    // Row 1: Sitemap + Crawl + Lighthouse buttons
    btnRow.innerHTML = '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">'
      + '<button onclick="fetchSitemap(this)" style="display:flex;align-items:center;gap:6px;background:transparent;border:1px solid #3b82f6;color:#3b82f6;font-weight:700;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:13px;min-height:44px">'
      + '<span class="material-symbols-outlined" style="font-size:16px">map</span>Fetch Sitemap</button>'
      + '<button id="audit-start-crawl-btn" onclick="startAudit(this)" style="display:flex;align-items:center;gap:6px;background:#adc6ff;color:#0e0e13;font-weight:700;padding:8px 16px;border-radius:8px;border:none;cursor:pointer;font-size:13px;min-height:44px;opacity:0.5" disabled>'
      + '<span class="material-symbols-outlined" style="font-size:16px">radar</span>Start Crawl (fetch sitemap first)</button>'
      + '<button onclick="runLighthouse(this)" style="display:flex;align-items:center;gap:6px;background:transparent;border:1px solid #35343a;color:#adc6ff;font-weight:600;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:13px;min-height:44px">'
      + '<span class="material-symbols-outlined" style="font-size:16px">speed</span>Run Lighthouse (~$0.004)</button>'
      + '</div>'
      // Row 2: Sitemap info area
      + '<div id="audit-sitemap-info" style="min-height:20px"></div>';
    headerTabs.parentElement.appendChild(btnRow);

    // Check for cached sitemap data
    loadCachedSitemap();
  }
}

async function loadCachedSitemap() {
  try {
    var resp = await fetch(SEO.API + '/sitemap/cached?tenant=' + SEO.TENANT);
    var data = await resp.json();
    if (data.totalPages > 0) {
      _sitemapData = data;
      var crawlBtn = document.getElementById('audit-start-crawl-btn');
      if (crawlBtn) {
        crawlBtn.disabled = false;
        crawlBtn.style.opacity = '1';
        var cost = Math.round(data.totalPages * 0.000375 * 1000) / 1000;
        crawlBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px">radar</span>Crawl All ' + data.totalPages + ' Pages (~$' + cost.toFixed(3) + ')';
      }
      var infoEl = document.getElementById('audit-sitemap-info');
      if (infoEl) {
        var age = Math.round((Date.now() - new Date(data.fetchedAt).getTime()) / 3600000);
        infoEl.innerHTML = '<span style="font-size:11px;color:#8c909f">' + data.totalPages + ' pages in sitemap (cached ' + (age < 1 ? 'just now' : age + 'h ago') + ')</span>';
      }
    }
  } catch {}
}

// Compare sitemap page count vs what search engines actually see
// Uses DataForSEO on_page or site: search to find crawlable pages
async function _checkSitemapCoverage(domain, sitemapCount) {
  try {
    // Use a site: SERP search to see how many pages Google has indexed
    var res = await SEO.dfs('serp/google/organic/live/regular', {
      keyword: 'site:' + domain,
      location_name: 'United States',
      language_name: 'English',
      depth: 10
    });
    var indexedCount = res?.tasks?.[0]?.result?.[0]?.items_count || 0;
    // Google shows total results count in search_information
    var totalResults = res?.tasks?.[0]?.result?.[0]?.se_results_count || indexedCount;

    var warningEl = document.getElementById('audit-sitemap-info');
    if (!warningEl) return;

    if (totalResults > 0 && sitemapCount < totalResults) {
      var missing = totalResults - sitemapCount;
      var pct = Math.round((missing / totalResults) * 100);
      var severity = pct > 30 ? 'critical' : pct > 10 ? 'warning' : 'info';
      var colors = {
        critical: { bg: 'rgba(255,84,81,0.08)', border: 'rgba(255,84,81,0.3)', text: '#ffb3ad', icon: 'error' },
        warning: { bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.3)', text: '#f59e0b', icon: 'warning' },
        info: { bg: 'rgba(173,198,255,0.08)', border: 'rgba(173,198,255,0.3)', text: '#adc6ff', icon: 'info' }
      };
      var c = colors[severity];
      var alertHtml = '<div style="margin-top:10px;padding:14px;background:' + c.bg + ';border:1px solid ' + c.border + ';border-radius:10px">'
        + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">'
        + '<span class="material-symbols-outlined" style="color:' + c.text + ';font-size:20px">' + c.icon + '</span>'
        + '<span style="font-size:14px;font-weight:800;color:' + c.text + '">Sitemap Coverage Gap</span></div>'
        + '<div style="font-size:13px;color:#e4e1e9;line-height:1.5">'
        + 'Google indexes <strong>' + totalResults + ' pages</strong> but sitemap only declares <strong>' + sitemapCount + '</strong>. '
        + '<strong>' + missing + ' pages (' + pct + '%)</strong> are missing from the sitemap.</div>'
        + '<div style="font-size:11px;color:#8c909f;margin-top:6px">Pages not in the sitemap may be slower to index and won\'t receive '
        + 'priority crawl signals. For local service area pages, this directly impacts local rankings.</div></div>';
      warningEl.innerHTML += alertHtml;
    } else if (totalResults > 0 && sitemapCount >= totalResults) {
      warningEl.innerHTML += '<div style="margin-top:8px;display:flex;align-items:center;gap:6px;font-size:12px;color:#4ae176">'
        + '<span class="material-symbols-outlined" style="font-size:16px">check_circle</span>'
        + 'Sitemap covers all ' + totalResults + ' indexed pages</div>';
    }
  } catch(e) {
    console.warn('Sitemap coverage check failed:', e);
  }
}
// SEO Platform — Site Audit Module (crawl, lighthouse, health analysis)
'use strict';

/* =======================================================
   CONTENTS:
   - loadAuditData        (entry point from nav('audit'))
   - startAudit           (kick off a site crawl)
   - _pollAuditStatus     (poll crawl task progress)
   - renderAuditResults   (health gauge, issues, cards)
   - toggleAuditDetail    (expand/collapse issue rows)
   - _showAuditEmpty      (empty state)
   - _renderNonIndexableCard
   - _renderResourceIssuesCard
   - _renderLinkAnalysisCard
   - runLighthouse        (Lighthouse analysis)
   - renderLighthouseResults
   - _renderCrawlHistory  (sparkline from past crawls)
   - auditTab             (tab switching)

   SHARED HELPERS (used by multiple modules):
   - _showNoProjectNotice
   - _removeNotice
   ======================================================= */

/* =======================================================
   PHASE 3.4 - SITE AUDIT
   ======================================================= */

// Track active audit task polling
var _auditPollTimer = null;
var _auditTaskId = null;

/**
 * Called when `nav('audit')` fires. Loads saved audit results (FREE).
 */
async function loadAuditData() {
  var domain = SEO.activeProject;
  if (!domain) {
    _showNoProjectNotice('view-audit', 'audit');
    return;
  }
  _removeNotice('view-audit');

  // Update header domain
  var headerSpan = document.querySelector('#view-audit h2 .text-primary-fixed-dim');
  if (headerSpan) headerSpan.textContent = domain;

  // Show loading indicator
  var findingsEl = document.getElementById('audit-findings-list');
  if (findingsEl) findingsEl.innerHTML = '<div style="padding:60px 24px;text-align:center;color:#8c909f"><div style="display:inline-block;width:24px;height:24px;border:3px solid #35343a;border-top-color:#adc6ff;border-radius:50%;animation:spin 0.8s linear infinite;margin-bottom:12px"></div><div style="font-size:14px">Loading audit data...</div></div>';

  try {
    var hist = await SEO.history({ tool: 'on_page', target: domain, limit: 20 }).catch(function() { return {}; });

    // Filter: only keep actual crawl summary records (on_page/summary/*), not lighthouse or task_post
    // Deduplicate by taskId — all polls for same crawl share the same endpoint path, keep latest (first in list)
    var seenTasks = {};
    var crawlQueries = (hist?.queries || []).filter(function(q) {
      if (!q.endpoint || q.endpoint.indexOf('on_page/summary/') !== 0) return false;
      if (q.endpoint.indexOf('lighthouse') >= 0) return false;
      var taskId = q.endpoint.replace('on_page/summary/', '');
      if (seenTasks[taskId]) return false;
      seenTasks[taskId] = true;
      return true;
    });

    if (crawlQueries.length === 0) {
      _showAuditEmpty(domain);
      return;
    }

    // Use the most recent actual crawl result
    var latest = crawlQueries[0];

    if (latest && latest.id) {
      var fullData = await SEO.historyById(latest.id).catch(function() { return null; });
      if (fullData) {
        // Data is inside items[0] — extract the crawl summary
        var auditSummary = fullData.items?.[0] || fullData;
        renderAuditResults(auditSummary, null, null);
      }
    } else if (latest) {
      renderAuditResults(latest, null, null);
    }

    // Update "last crawl" text
    var lastCrawlEl = document.querySelector('#view-audit .text-on-surface-variant.text-xs.md\\:text-sm.font-medium');
    if (lastCrawlEl && latest.created_at) {
      var d = new Date(latest.created_at);
      lastCrawlEl.textContent = 'Last full crawl: ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' at ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }

    // Render crawl history sparkline (only from real crawl results)
    _renderCrawlHistory(crawlQueries);

    // Render full audit history panel
    loadAuditHistory(crawlQueries);

    // Load last Lighthouse results from history (FREE)
    loadLighthouseHistory();

  } catch (e) {
    console.warn('Audit data load error:', e);
  }
}

/**
 * Load the most recent Lighthouse result from history (FREE).
 */
async function loadLighthouseHistory() {
  try {
    var hist = await SEO.history({ tool: 'on_page_lighthouse', limit: 3 }).catch(function() { return {}; });
    var queries = (hist?.queries || []).filter(function(q) {
      return q.endpoint && q.endpoint.indexOf('task_get') !== -1 && q.result_count > 0;
    });
    if (queries.length === 0) return;

    var latest = queries[0];
    if (!latest.id) return;
    var full = await SEO.historyById(latest.id).catch(function() { return null; });
    if (!full) return;

    // Lighthouse result can be in different shapes
    var lhResult = full.items?.[0] || full;
    // Sometimes the categories are nested under audits or directly at root
    if (lhResult.categories) {
      renderLighthouseResults(lhResult);
    } else if (lhResult.audits) {
      // Build categories from audits scores
      renderLighthouseResults(lhResult);
    }
  } catch(e) {
    console.warn('Lighthouse history load error:', e);
  }
}

function _showAuditEmpty(domain) {
  var findingsEl = document.getElementById('audit-findings-list');
  if (findingsEl) {
    findingsEl.innerHTML = '<div style="padding:60px 24px;text-align:center;color:#8c909f">'
      + '<div style="font-size:16px;margin-bottom:8px">No audit data for ' + escHtml(domain) + '</div>'
      + '<div style="font-size:14px;margin-bottom:20px;color:#8c909f">Run a site crawl to analyze your website\'s health.</div>'
      + '<button onclick="startAudit(this)" style="background:#adc6ff;color:#0e0e13;border:none;padding:10px 20px;border-radius:8px;font-size:14px;cursor:pointer;font-weight:600;min-height:44px">Start Crawl (~$0.075)</button>'
      + '</div>';
  }
  // Set defaults
  setHtml('gauge-health-val', '--');
  setHtml('gauge-health-label', '');
  ['audit-total-pages','audit-healthy','audit-broken','audit-redirected','audit-blocked'].forEach(function(id) { setHtml(id, '--'); });
  ['audit-critical-count','audit-warning-count','audit-notice-count'].forEach(function(id) { setHtml(id, '0'); });
}

/**
 * Start a new site crawl (~$0.03 for 200 pages).
 */
async function startAudit(btn) {
  var domain = SEO.activeProject;
  if (!domain) { showToast('Select a project first', 'warning'); return; }

  if (btn) {
    btn.disabled = true;
    var origHtml = btn.innerHTML;
    btn.innerHTML = '<span style="display:inline-block;width:14px;height:14px;border:2px solid #35343a;border-top-color:#adc6ff;border-radius:50%;animation:spin 0.8s linear infinite;margin-right:6px"></span>Starting crawl...';
  }

  SEO.startAction();
  var maxPages = (_sitemapData && _sitemapData.totalPages > 0) ? _sitemapData.totalPages : 200;
  try {
    // Submit crawl task — use sitemap page count if available
    var res = await SEO.dfs('on_page/task_post', [{
      target: 'https://' + domain,
      max_crawl_pages: maxPages,
      load_resources: true
    }]);

    var taskId = res?.tasks?.[0]?.id;
    if (!taskId) {
      showToast('Failed to start crawl: no task ID returned', 'error');
      return;
    }

    _auditTaskId = taskId;
    showToast('Crawl started for ' + domain + ' (' + maxPages + ' pages). This may take a few minutes...', 'success');

    // Show progress bar in the findings area
    var findingsEl = document.getElementById('audit-findings-list');
    if (findingsEl) {
      findingsEl.innerHTML = '<div id="audit-progress-container" style="padding:40px 24px;text-align:center">'
        + '<div style="font-size:16px;color:#e4e1e9;margin-bottom:16px">Crawling ' + escHtml(domain) + '...</div>'
        + '<div style="width:100%;max-width:400px;margin:0 auto;background:#1f1f25;border-radius:8px;overflow:hidden;height:8px">'
        + '<div id="audit-progress-bar" style="width:0%;height:100%;background:linear-gradient(90deg,#adc6ff,#4ae176);border-radius:8px;transition:width 0.5s"></div>'
        + '</div>'
        + '<div id="audit-progress-text" style="margin-top:12px;font-size:12px;color:#8c909f">0 / ' + maxPages + ' pages crawled</div>'
        + '</div>';
    }

    // Start polling for results
    _pollAuditStatus(taskId);

  } catch (e) {
    showToast('Crawl failed: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = origHtml || 'Start Crawl'; }
  }
}

/**
 * Poll audit task status every 10 seconds.
 */
function _pollAuditStatus(taskId) {
  if (_auditPollTimer) clearInterval(_auditPollTimer);

  _auditPollTimer = setInterval(async function() {
    try {
      var res = await SEO.dfs('on_page/summary/' + taskId, {}, 'GET');

      var summary = res?.tasks?.[0]?.result?.[0] || null;
      if (!summary) return;

      // DataForSEO structure: crawl_status has {pages_crawled, max_crawl_pages}, crawl_progress is "finished" string
      var cs = summary?.crawl_status || {};
      var crawled = cs.pages_crawled || summary?.crawl_progress?.pages_crawled || 0;
      var maxPages = cs.max_crawl_pages || summary?.crawl_progress?.max_crawl_pages || 200;
      var progressStr = summary?.crawl_progress || '';

      // Update progress bar
      var progressBar = document.getElementById('audit-progress-bar');
      var progressText = document.getElementById('audit-progress-text');
      if (progressBar) progressBar.style.width = Math.round(crawled / maxPages * 100) + '%';
      if (progressText) progressText.textContent = crawled + ' / ' + maxPages + ' pages crawled';

      // Check if done — crawl_progress becomes "finished" string when complete
      if (progressStr === 'finished' || crawled >= maxPages) {
        clearInterval(_auditPollTimer);
        _auditPollTimer = null;
        var ac = SEO.getActionCost();
        showToast('Crawl complete: ' + crawled + ' pages — ' + ac.calls + ' calls, cost: ' + SEO.fmtCost(ac.cost), 'success', 8000);

        // Fetch detailed results (all 4 are FREE — use the existing taskId)
        var pagesRes = null, dupRes = null, nonIndexRes = null, resourcesRes = null, linksRes = null;
        try {
          var [pr, dr, nr, rr, lr] = await Promise.all([
            SEO.dfs('on_page/pages/' + taskId, {}, 'GET').catch(function() { return null; }),
            SEO.dfs('on_page/duplicate_tags/' + taskId, {}, 'GET').catch(function() { return null; }),
            SEO.dfs('on_page/non_indexable/' + taskId, {}, 'GET').catch(function() { return null; }),
            SEO.dfs('on_page/resources/' + taskId, {}, 'GET').catch(function() { return null; }),
            SEO.dfs('on_page/links/' + taskId, {}, 'GET').catch(function() { return null; })
          ]);
          pagesRes = pr; dupRes = dr; nonIndexRes = nr; resourcesRes = rr; linksRes = lr;
          renderAuditResults(summary, pagesRes, dupRes, nonIndexRes, resourcesRes, linksRes);
        } catch(e2) {
          // Fall back to summary only
          renderAuditResults(summary, null, null, null, null, null);
        }
      }
    } catch (e) {
      console.warn('Audit poll error:', e);
    }
  }, 10000);
}

/**
 * Render audit results: health gauge, crawl overview, issues.
 * dupRes = duplicate_tags result, nonIndexRes = non_indexable result,
 * resourcesRes = resources result, linksRes = links result (all FREE after crawl).
 */
function renderAuditResults(summary, pagesRes, dupRes, nonIndexRes, resourcesRes, linksRes) {
  if (!summary) return;

  // Extract crawl statistics
  // DataForSEO structure: crawl_status has {pages_crawled, max_crawl_pages}, crawl_progress is just "finished" string
  var crawlInfo = summary.crawl_status || summary.crawl_progress || summary;
  var totalPages = (typeof crawlInfo === 'object' ? crawlInfo.pages_crawled : 0) || summary.pages_count || summary.pages_crawled || 0;
  var onPageLinks = summary.page_metrics || summary;

  // Count issues by severity
  var criticalIssues = 0;
  var warningIssues = 0;
  var noticeIssues = 0;
  var healthy = 0;
  var broken = 0;
  var redirected = 0;
  var blocked = 0;

  // Try to extract from page metrics
  var metrics = summary.page_metrics || {};
  broken = (metrics.checks?.is_broken || 0) + (metrics.checks?.is_4xx_code || 0) + (metrics.checks?.is_5xx_code || 0);
  redirected = metrics.checks?.is_redirect || 0;
  blocked = metrics.checks?.is_blocked || 0;
  healthy = totalPages - broken - redirected - blocked;
  if (healthy < 0) healthy = totalPages;

  // Categorize issues
  var issueList = [];

  // Critical: broken links, server errors
  var brokenLinks = metrics.checks?.is_4xx_code || 0;
  var serverErrors = metrics.checks?.is_5xx_code || 0;
  if (brokenLinks > 0) { issueList.push({ severity: 'critical', title: 'Broken links (4xx)', desc: 'Links pointing to non-existent pages', count: brokenLinks }); criticalIssues += brokenLinks; }
  if (serverErrors > 0) { issueList.push({ severity: 'critical', title: 'Server errors (5xx)', desc: 'Internal server response failures', count: serverErrors }); criticalIssues += serverErrors; }

  // Warnings: redirects, duplicate titles, missing meta
  var redirectCount = metrics.checks?.is_redirect || 0;
  var dupTitles = metrics.checks?.duplicate_title || 0;
  var dupDescriptions = metrics.checks?.duplicate_description || 0;
  var noDescription = metrics.checks?.no_description || 0;
  if (redirectCount > 0) { issueList.push({ severity: 'warning', title: 'Redirect chains', desc: 'Multiple hops before destination', count: redirectCount }); warningIssues += redirectCount; }
  if (dupTitles > 0) { issueList.push({ severity: 'warning', title: 'Duplicate title tags', desc: 'Multiple pages sharing the same title', count: dupTitles }); warningIssues += dupTitles; }
  if (dupDescriptions > 0) { issueList.push({ severity: 'warning', title: 'Duplicate meta descriptions', desc: 'Multiple pages sharing the same description', count: dupDescriptions }); warningIssues += dupDescriptions; }
  if (noDescription > 0) { issueList.push({ severity: 'warning', title: 'Missing meta description', desc: 'Pages without meta description tag', count: noDescription }); warningIssues += noDescription; }

  // Notices: missing alt, missing H1, large images, orphan pages
  var noAlt = metrics.checks?.no_image_alt || 0;
  var noH1 = metrics.checks?.no_h1_tag || 0;
  var tooLarge = metrics.checks?.high_loading_time || 0;
  var noTitle = metrics.checks?.no_title || 0;
  if (noAlt > 0) { issueList.push({ severity: 'notice', title: 'Missing alt text', desc: 'Images without descriptive accessibility text', count: noAlt }); noticeIssues += noAlt; }
  if (noH1 > 0) { issueList.push({ severity: 'notice', title: 'Missing H1', desc: 'Pages without a primary header tag', count: noH1 }); noticeIssues += noH1; }
  if (tooLarge > 0) { issueList.push({ severity: 'notice', title: 'Slow-loading pages', desc: 'Pages with high load time', count: tooLarge }); noticeIssues += tooLarge; }
  if (noTitle > 0) { issueList.push({ severity: 'notice', title: 'Missing title tag', desc: 'Pages without a title element', count: noTitle }); noticeIssues += noTitle; }

  // Use DataForSEO's real onpage_score if available (lives at page_metrics.onpage_score), fallback to computed estimate
  var realScore = summary.onpage_score || (summary.page_metrics && summary.page_metrics.onpage_score) || null;
  var healthScore = realScore
    ? Math.round(realScore)
    : Math.max(0, Math.min(100, Math.round(100 - (criticalIssues * 5) - (warningIssues * 2) - (noticeIssues * 0.5))));

  // Render health gauge
  drawRingGauge('gauge-health', healthScore, 100, { lineWidth: 18, colorHigh: '#4ae176', colorMid: '#f59e0b', colorLow: '#ffb3ad' });

  // Fill crawl overview stats
  setHtml('audit-total-pages', totalPages + ' Total Pages');
  setHtml('audit-healthy', healthy);
  setHtml('audit-broken', broken);
  setHtml('audit-redirected', redirected);
  setHtml('audit-blocked', blocked);

  // Update the stacked bar
  var stackedBar = document.querySelector('#view-audit .w-full.h-2.bg-surface-container-highest');
  if (stackedBar && totalPages > 0) {
    var healthyPct = (healthy / totalPages * 100).toFixed(1);
    var redirectPct = (redirected / totalPages * 100).toFixed(1);
    var brokenPct = ((broken + blocked) / totalPages * 100).toFixed(1);
    stackedBar.innerHTML = '<div class="h-full bg-secondary" style="width:' + healthyPct + '%"></div>'
      + '<div class="h-full bg-[#ffb347]" style="width:' + redirectPct + '%"></div>'
      + '<div class="h-full bg-tertiary-container" style="width:' + brokenPct + '%"></div>';
  }

  // Issue severity counts
  setHtml('audit-critical-count', criticalIssues);
  setHtml('audit-warning-count', warningIssues);
  setHtml('audit-notice-count', noticeIssues);

  // Build page-level data from pagesRes items for expandable detail views
  var pageItems = null;
  var pagesByCheck = {}; // keyed by check type, each = {url: count} map
  if (pagesRes?.tasks?.[0]?.result?.[0]?.items) {
    pageItems = pagesRes.tasks[0].result[0].items;
    // Build a map: check_type -> {page_url: true} to know which pages have which issues
    pagesByCheck = {
      'is_4xx_code': {}, 'is_5xx_code': {}, 'is_redirect': {},
      'duplicate_title': {}, 'duplicate_description': {}, 'no_description': {},
      'no_image_alt': {}, 'no_h1_tag': {}, 'no_title': {}, 'high_loading_time': {}
    };
    pageItems.forEach(function(page) {
      var checks = page.checks || {};
      Object.keys(pagesByCheck).forEach(function(chk) {
        if (checks[chk]) pagesByCheck[chk][page.url] = page;
      });
    });
  }

  // Helper: build expandable detail HTML for a check type
  function buildIssueDetail(checkType, getLabel) {
    var pagesMap = pagesByCheck[checkType] || {};
    var pageUrls = Object.keys(pagesMap);
    if (pageUrls.length === 0) return '';
    var limit = 15;
    var shown = pageUrls.slice(0, limit);
    var more = pageUrls.length - limit;
    var rows = shown.map(function(url) {
      var p = pagesMap[url];
      var status = p.status_code ? ' <span style="color:#8c909f;font-size:10px">(' + p.status_code + ')</span>' : '';
      var h1 = p.h1 ? ' <span style="color:#8c909f;font-size:10px">H1: ' + escHtml(p.h1.substring(0, 60)) + '</span>' : '';
      return '<div style="padding:6px 12px;border-bottom:1px solid rgba(66,71,84,0.1);font-size:11px;color:#c2c6d6;word-break:break-all" class="hover:bg-surface-container">'
        + '<span style="color:#adc6ff;font-weight:600">' + escHtml(url.substring(0, 80)) + (url.length > 80 ? '...' : '') + '</span>'
        + status + h1
        + '</div>';
    }).join('');
    var moreRow = more > 0 ? '<div style="padding:6px 12px;font-size:11px;color:#8c909f;text-align:center">' + more + ' more pages</div>' : '';
    return '<div style="max-height:300px;overflow-y:auto;background:#0e0e13;border-top:1px solid rgba(66,71,84,0.2);display:none" id="audit-detail-' + checkType + '">'
      + rows + moreRow + '</div>';
  }

  // Map issue types to check types for detail expansion
  var issueToCheck = {
    'Broken links (4xx)': 'is_4xx_code',
    'Server errors (5xx)': 'is_5xx_code',
    'Redirect chains': 'is_redirect',
    'Duplicate title tags': 'duplicate_title',
    'Duplicate meta descriptions': 'duplicate_description',
    'Missing meta description': 'no_description',
    'Missing alt text': 'no_image_alt',
    'Missing H1': 'no_h1_tag',
    'Slow-loading pages': 'high_loading_time',
    'Missing title tag': 'no_title'
  };

  // Render issue list with expandable rows
  var findingsEl = document.getElementById('audit-findings-list');
  if (findingsEl) {
    if (issueList.length === 0) {
      findingsEl.innerHTML = '<div style="padding:40px;text-align:center;color:#4ae176">'
        + '<div style="font-size:18px;margin-bottom:8px;font-weight:700">No issues found</div>'
        + '<div style="font-size:14px;color:#8c909f">Your site looks healthy. Great work.</div>'
        + '</div>';
    } else {
      var issuesHtml = '';
      issueList.forEach(function(issue) {
        var dotColor = issue.severity === 'critical' ? 'bg-tertiary-container' : issue.severity === 'warning' ? 'bg-[#ffb347]' : 'bg-primary-container';
        var countColor = issue.severity === 'critical' ? 'text-tertiary-container' : issue.severity === 'warning' ? 'text-[#ffb347]' : 'text-primary-container';
        var chk = issueToCheck[issue.title];
        var hasDetail = chk && (pagesByCheck[chk] && Object.keys(pagesByCheck[chk]).length > 0);
        var chevron = hasDetail ? 'expand_more' : '';
        issuesHtml += '<div class="audit-issue-row" data-check="' + (chk || '') + '">'
          + '<div class="p-4 flex items-center hover:bg-surface-container transition-colors group cursor-pointer" onclick="toggleAuditDetail(this)">'
          + '<span class="w-2 h-2 rounded-full ' + dotColor + ' mr-4"></span>'
          + '<div class="flex-1">'
          + '<h5 class="text-sm font-bold text-on-surface">' + escHtml(issue.title) + '</h5>'
          + '<p class="text-[10px] text-on-surface-variant font-medium">' + escHtml(issue.desc) + '</p>'
          + '</div>'
          + '<span class="tabular-nums text-sm font-black ' + countColor + ' mr-2">' + issue.count + '</span>'
          + '<span class="material-symbols-outlined text-on-surface-variant text-base" style="transition:transform 0.2s">' + chevron + '</span>'
          + '</div>'
          + (chk ? buildIssueDetail(chk, issue.title) : '')
          + '</div>';
      });
      findingsEl.innerHTML = issuesHtml;
    }
  }

  // Update "View all X findings" button
  var viewAllBtn = findingsEl?.parentElement?.querySelector('.p-4.bg-surface-container-lowest\\/50 button');
  if (viewAllBtn) {
    viewAllBtn.textContent = 'View all ' + issueList.length + ' findings';
  }

  // ---- NEW: Non-Indexable Pages card ----
  var nonIndexItems = nonIndexRes?.tasks?.[0]?.result?.[0]?.items || [];
  _renderNonIndexableCard(nonIndexItems);

  // ---- NEW: Resource Issues card ----
  var resourceItems = resourcesRes?.tasks?.[0]?.result?.[0]?.items || [];
  _renderResourceIssuesCard(resourceItems);

  // ---- NEW: Link Analysis summary ----
  var linkItems = linksRes?.tasks?.[0]?.result?.[0]?.items || [];
  _renderLinkAnalysisCard(linkItems);

  // Status code donut chart
  if (totalPages > 0) {
    var okPct = Math.round(healthy / totalPages * 100);
    var redirPct = Math.round(redirected / totalPages * 100);
    var errPct = Math.round((broken + blocked) / totalPages * 100);
    // Update donut segments (stroke-dasharray = segment%, 100-segment%)
    var d200 = document.getElementById('audit-donut-200');
    var d301 = document.getElementById('audit-donut-301');
    var d4xx = document.getElementById('audit-donut-4xx');
    if (d200) d200.setAttribute('stroke-dasharray', okPct + ' ' + (100 - okPct));
    if (d301) { d301.setAttribute('stroke-dasharray', redirPct + ' ' + (100 - redirPct)); d301.setAttribute('stroke-dashoffset', '-' + okPct); }
    if (d4xx) { d4xx.setAttribute('stroke-dasharray', errPct + ' ' + (100 - errPct)); d4xx.setAttribute('stroke-dashoffset', '-' + (okPct + redirPct)); }
    setHtml('audit-status-code-label', totalPages);
    setHtml('audit-pct-200', okPct + '%');
    setHtml('audit-pct-301', redirPct + '%');
    setHtml('audit-pct-4xx', errPct + '%');
  }
}

/**
 * Toggle expandable detail section for an audit issue row.
 */
function toggleAuditDetail(row) {
  var issueRow = row.closest('.audit-issue-row');
  if (!issueRow) return;
  var check = issueRow.getAttribute('data-check');
  if (!check) return;
  var detail = document.getElementById('audit-detail-' + check);
  if (!detail) return;
  var isOpen = detail.style.display !== 'none';
  // Close all open detail rows across all issue rows
  document.querySelectorAll('.audit-issue-row .audit-detail-row').forEach(function(el) {
    el.style.display = 'none';
  });
  // Reset all chevrons to expand_more
  document.querySelectorAll('.audit-issue-row .material-symbols-outlined').forEach(function(el) {
    el.textContent = 'expand_more';
  });
  if (!isOpen) {
    detail.style.display = '';
    detail.classList.add('audit-detail-row');
    row.querySelector('.material-symbols-outlined').textContent = 'expand_less';
  }
}

/**
 * Render Non-Indexable Pages card in the sidebar.
 */
function _renderNonIndexableCard(items) {
  // Find the sidebar "Charts Column" and inject a card after Crawler Settings
  var chartCol = document.querySelector('#view-audit .md\\:col-span-4.space-y-4');
  if (!chartCol) return;

  // Remove old card if present
  var oldCard = document.getElementById('audit-card-nonindex');
  if (oldCard) oldCard.remove();

  if (!items || items.length === 0) return;

  // Group by reason
  var byReason = {};
  items.slice(0, 20).forEach(function(item) {
    var reason = item.reason || 'Blocked';
    if (!byReason[reason]) byReason[reason] = [];
    byReason[reason].push(item);
  });

  var reasonColors = {
    'x-robots-tag-header': '#ffb3ad',
    'noindex': '#ffb3ad',
    'canonical': '#ffb347',
    'robots.txt': '#ffb347',
    '404': '#f59e0b',
    '401': '#f59e0b',
    '403': '#f59e0b'
  };

  var html = '<div id="audit-card-nonindex" class="bg-surface-container-low p-4 md:p-6 rounded-xl" style="margin-top:16px">'
    + '<h3 class="text-[10px] uppercase tracking-[0.2em] font-bold text-on-surface-variant mb-3">Non-Indexable Pages</h3>'
    + '<div style="max-height:220px;overflow-y:auto">';

  Object.keys(byReason).slice(0, 5).forEach(function(reason) {
    var pct = byReason[reason].length;
    var color = reasonColors[reason.toLowerCase()] || '#adc6ff';
    html += '<div style="margin-bottom:10px">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">'
      + '<span style="font-size:11px;font-weight:600;color:' + color + '">' + escHtml(reason) + '</span>'
      + '<span style="font-size:11px;font-weight:700;color:#8c909f">' + pct + '</span></div>'
      + '<div style="height:3px;background:#1f1f25;border-radius:2px;overflow:hidden">'
      + '<div style="height:100%;width:' + Math.min(100, pct / items.length * 100) + '%;background:' + color + ';border-radius:2px"></div></div>'
      + '<div style="margin-top:4px">';
    byReason[reason].slice(0, 3).forEach(function(item) {
      html += '<div style="font-size:10px;color:#8c909f;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:1px 0">' + escHtml(item.url || '') + '</div>';
    });
    if (byReason[reason].length > 3) {
      html += '<div style="font-size:10px;color:#adc6ff;padding:1px 0">+' + (byReason[reason].length - 3) + ' more</div>';
    }
    html += '</div></div>';
  });

  html += '</div></div>';
  chartCol.insertAdjacentHTML('beforeend', html);
}

/**
 * Render Resource Issues card in the sidebar.
 */
function _renderResourceIssuesCard(items) {
  var chartCol = document.querySelector('#view-audit .md\\:col-span-4.space-y-4');
  if (!chartCol) return;

  var oldCard = document.getElementById('audit-card-resources');
  if (oldCard) oldCard.remove();

  if (!items || items.length === 0) return;

  // Aggregate by resource type and status
  var broken = items.filter(function(i) { return i.status_code >= 400; });
  var oversized = items.filter(function(i) { return i.size && i.size > 100000; }); // >100KB
  var byType = {};
  items.forEach(function(i) { byType[i.type] = (byType[i.type] || 0) + 1; });

  var totalIssues = broken.length + oversized.length;
  if (totalIssues === 0) return;

  var html = '<div id="audit-card-resources" class="bg-surface-container-low p-4 md:p-6 rounded-xl" style="margin-top:16px">'
    + '<h3 class="text-[10px] uppercase tracking-[0.2em] font-bold text-on-surface-variant mb-3">Resource Issues</h3>'
    + '<div class="space-y-3">';

  if (broken.length > 0) {
    html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;background:rgba(255,179,173,0.1);border-radius:6px;border-left:3px solid #ffb3ad">'
      + '<span style="font-size:11px;font-weight:600;color:#ffb3ad">Failed to load</span>'
      + '<span style="font-size:12px;font-weight:800;color:#ffb3ad">' + broken.length + '</span></div>';
  }
  if (oversized.length > 0) {
    html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;background:rgba(255,179,71,0.1);border-radius:6px;border-left:3px solid #ffb347">'
      + '<span style="font-size:11px;font-weight:600;color:#ffb347">Oversized (>100KB)</span>'
      + '<span style="font-size:12px;font-weight:800;color:#ffb347">' + oversized.length + '</span></div>';
  }

  // Show top resource types
  var topTypes = Object.keys(byType).sort(function(a, b) { return byType[b] - byType[a]; }).slice(0, 4);
  topTypes.forEach(function(type) {
    var count = byType[type];
    if (count <= 1) return; // skip single-occurrence types
    html += '<div style="display:flex;justify-content:space-between;align-items:center">'
      + '<span style="font-size:11px;color:#8c909f">' + escHtml(type) + '</span>'
      + '<span style="font-size:11px;font-weight:700;color:#c2c6d6">' + count + '</span></div>';
  });

  html += '</div></div>';
  chartCol.insertAdjacentHTML('beforeend', html);
}

/**
 * Render Link Analysis summary card in sidebar.
 */
function _renderLinkAnalysisCard(items) {
  var chartCol = document.querySelector('#view-audit .md\\:col-span-4.space-y-4');
  if (!chartCol) return;

  var oldCard = document.getElementById('audit-card-links');
  if (oldCard) oldCard.remove();

  if (!items || items.length === 0) return;

  // Summarize: total internal/external links found
  var totalInternal = 0, totalExternal = 0, brokenExt = 0;
  items.slice(0, 200).forEach(function(item) {
    var intLinks = item.internal_links_count || 0;
    var extLinks = item.external_links_count || 0;
    var broken = item.broken_external_links_count || 0;
    totalInternal += intLinks;
    totalExternal += extLinks;
    brokenExt += broken;
  });

  var html = '<div id="audit-card-links" class="bg-surface-container-low p-4 md:p-6 rounded-xl" style="margin-top:16px">'
    + '<h3 class="text-[10px] uppercase tracking-[0.2em] font-bold text-on-surface-variant mb-3">Link Analysis</h3>'
    + '<div class="space-y-3">'
    + '<div style="display:flex;justify-content:space-between;align-items:center">'
    + '<span style="font-size:11px;color:#8c909f">Internal Links</span>'
    + '<span style="font-size:12px;font-weight:800;color:#4ae176">' + fmtNum(totalInternal) + '</span></div>'
    + '<div style="display:flex;justify-content:space-between;align-items:center">'
    + '<span style="font-size:11px;color:#8c909f">External Links</span>'
    + '<span style="font-size:12px;font-weight:800;color:#adc6ff">' + fmtNum(totalExternal) + '</span></div>';
  if (brokenExt > 0) {
    html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 6px;background:rgba(255,179,173,0.1);border-radius:4px">'
      + '<span style="font-size:11px;color:#ffb3ad">Broken Outbound</span>'
      + '<span style="font-size:12px;font-weight:800;color:#ffb3ad">' + brokenExt + '</span></div>';
  }
  html += '</div></div>';
  chartCol.insertAdjacentHTML('beforeend', html);
}

/**
 * Run Lighthouse analysis (~$0.004).
 */
async function runLighthouse(btn) {
  var domain = SEO.activeProject;
  if (!domain) { showToast('Select a project first', 'warning'); return; }

  if (btn) {
    btn.disabled = true;
    var origHtml = btn.innerHTML;
    btn.innerHTML = '<span style="display:inline-block;width:14px;height:14px;border:2px solid #35343a;border-top-color:#adc6ff;border-radius:50%;animation:spin 0.8s linear infinite;margin-right:6px"></span>Running Lighthouse...';
  }

  SEO.startAction();
  try {
    // Lighthouse is task-based: task_post -> poll tasks_ready -> fetch result
    var postRes = await SEO.dfs('on_page/lighthouse/task_post', {
      url: 'https://' + domain,
      for_mobile: true
    });

    var taskId = postRes?.tasks?.[0]?.id;
    if (!taskId) {
      showToast('Lighthouse task failed to create', 'error');
      return;
    }

    showToast('Lighthouse analysis started. Waiting for results...', 'info');

    // Poll for completion (check every 5 seconds, max 2 minutes)
    var attempts = 0;
    var maxAttempts = 24;
    var lhPoll = setInterval(async function() {
      attempts++;
      try {
        var readyRes = await SEO.dfs('on_page/lighthouse/tasks_ready', {}, 'GET');
        var readyTasks = readyRes?.tasks?.[0]?.result || [];
        var ourTask = readyTasks.find(function(t) { return t.id === taskId; });

        if (ourTask) {
          clearInterval(lhPoll);
          // Fetch the actual result
          var resultRes = await SEO.dfs('on_page/lighthouse/task_get/' + taskId, {}, 'GET');
          var lhResult = resultRes?.tasks?.[0]?.result?.[0] || null;
          if (lhResult) {
            renderLighthouseResults(lhResult);
            var ac = SEO.getActionCost();
            showToast('Lighthouse complete — cost: ' + SEO.fmtCost(ac.cost), 'success', 6000);
          } else {
            showToast('Lighthouse returned no results', 'warning');
          }
          if (btn) { btn.disabled = false; btn.innerHTML = origHtml || 'Run Lighthouse'; }
        } else if (attempts >= maxAttempts) {
          clearInterval(lhPoll);
          showToast('Lighthouse timed out. Results may appear on next page load.', 'warning');
          if (btn) { btn.disabled = false; btn.innerHTML = origHtml || 'Run Lighthouse'; }
        }
      } catch (pollErr) {
        console.warn('Lighthouse poll error:', pollErr);
      }
    }, 5000);

  } catch (e) {
    showToast('Lighthouse failed: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = origHtml || 'Run Lighthouse'; }
  }
}

/**
 * Render 4 Lighthouse score circles.
 * Injects into the Quick Action card area (repurposes it when Lighthouse is run).
 */
function renderLighthouseResults(lhResult) {
  var categories = lhResult.categories || {};
  var scores = {
    performance: Math.round((categories.performance?.score || 0) * 100),
    accessibility: Math.round((categories.accessibility?.score || 0) * 100),
    'best-practices': Math.round((categories['best-practices']?.score || 0) * 100),
    seo: Math.round((categories.seo?.score || 0) * 100)
  };

  var container = document.getElementById('audit-lighthouse-scores');
  if (!container) return;

  var labels = [
    { key: 'performance', label: 'Performance' },
    { key: 'accessibility', label: 'Accessibility' },
    { key: 'best-practices', label: 'Best Practices' },
    { key: 'seo', label: 'SEO' }
  ];

  var html = '<div class="grid grid-cols-2 gap-4">';

  labels.forEach(function(l) {
    var score = scores[l.key] || 0;
    var color = score >= 90 ? '#4ae176' : score >= 50 ? '#f59e0b' : '#ffb3ad';
    var circumference = 2 * Math.PI * 30;
    var dashOffset = circumference - (score / 100) * circumference;

    html += '<div class="flex flex-col items-center">'
      + '<div class="relative" style="width:70px;height:70px">'
      + '<svg viewBox="0 0 70 70" style="transform:rotate(-90deg)">'
      + '<circle cx="35" cy="35" r="30" fill="transparent" stroke="#1f1f25" stroke-width="5"/>'
      + '<circle cx="35" cy="35" r="30" fill="transparent" stroke="' + color + '" stroke-width="5" stroke-linecap="round" stroke-dasharray="' + circumference.toFixed(1) + '" stroke-dashoffset="' + dashOffset.toFixed(1) + '"/>'
      + '</svg>'
      + '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">'
      + '<span style="font-size:18px;font-weight:900;color:' + color + ';font-variant-numeric:tabular-nums">' + score + '</span>'
      + '</div></div>'
      + '<span class="text-[10px] font-bold text-on-surface-variant mt-2 text-center">' + l.label + '</span>'
      + '</div>';
  });

  html += '</div>'
    + '<button onclick="runLighthouse(this)" class="mt-4 w-full text-xs font-bold text-primary-fixed-dim hover:underline uppercase tracking-widest text-center py-2">Re-run Lighthouse</button>';

  container.innerHTML = html;
}

/**
 * Render crawl history sparkline from past audit results.
 */
function _renderCrawlHistory(historyResults) {
  var container = document.querySelector('#view-audit .flex-1.flex.items-end.justify-between');
  if (!container) return;

  var dateRow = container.parentElement?.querySelector('.flex.justify-between.mt-4');

  if (!historyResults || historyResults.length === 0) return;

  // Compute health scores for each historical result
  // History queries have summary (from DB) but NOT items — use summary fields directly
  var scores = historyResults.map(function(r) {
    var s = r?.summary || {};
    // Prefer the real onpage_score if available in summary
    if (s.onpage_score) {
      return { score: Math.round(s.onpage_score), date: r.created_at };
    }
    // Fallback: compute from summary error/warning/notice counts
    var critical = s.errors || 0;
    var warnings = s.warnings || 0;
    var notices = s.notices || 0;
    var score = Math.max(0, Math.min(100, 100 - (critical * 5) - (warnings * 2) - (notices * 0.5)));
    return { score: score, date: r.created_at };
  }).reverse(); // oldest first

  var maxScore = 100;
  var html = '';
  scores.forEach(function(s) {
    var pct = Math.max(10, s.score);
    var barColor = s.score >= 80 ? '#4ae176' : s.score >= 50 ? '#f59e0b' : '#ffb3ad';
    html += '<div class="flex-1 bg-secondary/10 rounded-t-sm relative group" style="height:100%">'
      + '<div class="absolute bottom-0 w-full rounded-t-sm" style="background:' + barColor + ';height:' + pct + '%"></div>'
      + '</div>';
  });
  container.innerHTML = html;

  // Update date labels
  if (dateRow && scores.length >= 2) {
    var oldest = new Date(scores[0].date);
    var newest = new Date(scores[scores.length - 1].date);
    dateRow.innerHTML = '<span>' + oldest.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase() + '</span>'
      + '<span>' + newest.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase() + '</span>';
  }
}


/* =======================================================
   SHARED HELPERS FOR PHASE 3
   ======================================================= */

function _showNoProjectNotice(viewId, viewName) {
  var el = document.getElementById(viewId);
  if (!el) return;
  var existing = el.querySelector('.no-project-notice');
  if (existing) return;
  var notice = document.createElement('div');
  notice.className = 'no-project-notice';
  notice.style.cssText = 'padding:60px 24px;text-align:center;color:#8c909f';
  notice.innerHTML = '<div style="font-size:40px;margin-bottom:16px;opacity:0.4">&#9776;</div>'
    + '<div style="font-size:18px;margin-bottom:8px;color:#e4e1e9">No website selected</div>'
    + '<div style="font-size:14px;margin-bottom:20px">Go to <a href="#" onclick="nav(\'projects\');return false" style="color:#adc6ff;text-decoration:underline">Projects</a> to add or select a website.</div>';
  el.insertBefore(notice, el.firstChild);
}

function _removeNotice(viewId) {
  var el = document.getElementById(viewId);
  if (!el) return;
  var notice = el.querySelector('.no-project-notice');
  if (notice) notice.remove();
}


/* =======================================================
   AUDIT VIEW TAB SWITCHING
   ======================================================= */
function auditTab(tab) {
  // Scroll to the section anchor
  var anchor = document.getElementById('audit-sec-' + tab);
  if (anchor) anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // Update tab button styles
  document.querySelectorAll('#view-audit .audit-tab').forEach(function(btn) {
    if (btn.getAttribute('data-tab') === tab) {
      btn.className = 'audit-tab px-3 py-1.5 text-xs font-bold text-on-surface bg-surface-container-high rounded shadow-sm whitespace-nowrap';
    } else {
      btn.className = 'audit-tab px-3 py-1.5 text-xs font-bold text-on-surface-variant hover:text-on-surface transition-colors whitespace-nowrap';
    }
  });
}

/* =======================================================
   AUDIT HISTORY PANEL
   Full table of all past crawls with health score, pages,
   errors/warnings/notices, and cost
   ======================================================= */
function loadAuditHistory(crawlQueries) {
  var container = document.getElementById('audit-history-panel');
  if (!container) return;
  if (!crawlQueries || crawlQueries.length === 0) {
    container.innerHTML = '<div style="background:#131318;border:1px solid rgba(66,71,84,0.2);border-radius:12px;padding:40px;text-align:center;color:#8c909f;font-size:13px">No audit history yet. Run a site crawl to start tracking.</div>';
    return;
  }

  var html = '<div style="background:#131318;border:1px solid rgba(66,71,84,0.2);border-radius:12px;overflow:hidden">'
    + '<div style="padding:16px 20px;border-bottom:1px solid rgba(66,71,84,0.1);display:flex;align-items:center">'
    + '<h3 style="font-size:14px;font-weight:700;color:#e4e1e9">Audit History</h3>'
    + '<span style="margin-left:auto;font-size:10px;color:#64687a;text-transform:uppercase;letter-spacing:0.05em">' + crawlQueries.length + ' crawls</span>'
    + '</div>'
    + '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse"><thead>'
    + '<tr style="background:rgba(30,30,38,0.5)">'
    + '<th style="padding:10px 16px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#8c909f;font-weight:600">Date</th>'
    + '<th style="padding:10px 16px;text-align:center;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#8c909f;font-weight:600">Health</th>'
    + '<th style="padding:10px 16px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#8c909f;font-weight:600">Pages</th>'
    + '<th style="padding:10px 16px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#8c909f;font-weight:600">Errors</th>'
    + '<th style="padding:10px 16px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#8c909f;font-weight:600">Warnings</th>'
    + '<th style="padding:10px 16px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#8c909f;font-weight:600">Notices</th>'
    + '<th style="padding:10px 16px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#8c909f;font-weight:600">Cost</th>'
    + '</tr></thead><tbody>';

  crawlQueries.forEach(function(q) {
    var date = new Date(q.created_at);
    var dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    var timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    var s = q.summary || {};
    var pages = s.pages_count || s.pages_crawled || q.result_count || 0;
    var health = s.onpage_score != null ? Math.round(s.onpage_score) : '--';
    var errors = s.errors || 0;
    var warnings = s.warnings || 0;
    var notices = s.notices || 0;
    var cost = parseFloat(q.cost) || 0;

    var healthColor = typeof health === 'number' ? (health >= 80 ? '#4ae176' : health >= 50 ? '#f59e0b' : '#ffb3ad') : '#8c909f';

    html += '<tr style="border-bottom:1px solid rgba(66,71,84,0.08);transition:background 150ms" onmouseover="this.style.background=\'rgba(30,30,38,0.5)\'" onmouseout="this.style.background=\'none\'">'
      + '<td style="padding:10px 16px;font-size:12px;color:#8c909f">' + dateStr + ' ' + timeStr + '</td>'
      + '<td style="padding:10px 16px;text-align:center"><span style="display:inline-block;min-width:36px;padding:2px 8px;border-radius:6px;font-size:12px;font-weight:800;color:' + healthColor + ';background:' + healthColor + '15;font-variant-numeric:tabular-nums">' + health + (typeof health === 'number' ? '%' : '') + '</span></td>'
      + '<td style="padding:10px 16px;text-align:right;font-size:12px;color:#e4e1e9;font-weight:700;font-variant-numeric:tabular-nums">' + fmtNum(pages) + '</td>'
      + '<td style="padding:10px 16px;text-align:right;font-size:12px;font-weight:700;font-variant-numeric:tabular-nums;color:' + (errors > 0 ? '#ffb3ad' : '#8c909f') + '">' + errors + '</td>'
      + '<td style="padding:10px 16px;text-align:right;font-size:12px;font-weight:700;font-variant-numeric:tabular-nums;color:' + (warnings > 0 ? '#f59e0b' : '#8c909f') + '">' + warnings + '</td>'
      + '<td style="padding:10px 16px;text-align:right;font-size:12px;font-variant-numeric:tabular-nums;color:#adc6ff">' + notices + '</td>'
      + '<td style="padding:10px 16px;text-align:right;font-size:11px;color:#64687a;font-variant-numeric:tabular-nums">' + (cost > 0 ? '$' + cost.toFixed(3) : 'cached') + '</td>'
      + '</tr>';
  });

  html += '</tbody></table></div></div>';
  container.innerHTML = html;
}

/* =======================================================
   PAGE DEEP-DIVE — Analyze a single page's on-page elements
   ======================================================= */

async function fetchPageDeepDive(btn) {
  var urlInput = document.getElementById('deepdive-url-input');
  var pageUrl = urlInput ? urlInput.value.trim() : '';
  if (!pageUrl) { showToast('Enter a URL to analyze', 'warning'); return; }
  // Auto-add protocol if missing
  if (pageUrl.indexOf('http') !== 0) pageUrl = 'https://' + pageUrl;
  if (!checkBalanceWarning(0.02)) return;

  if (btn) {
    btn.disabled = true;
    var origHtml = btn.innerHTML;
    btn.innerHTML = '<span style="display:inline-block;width:14px;height:14px;border:2px solid #35343a;border-top-color:#adc6ff;border-radius:50%;animation:spin 0.8s linear infinite;margin-right:6px"></span>Analyzing...';
  }

  try {
    // Check cache first
    var cached = await SEO.history({ tool: 'content_parsing', target: pageUrl, limit: 1 }).catch(function() { return {}; });
    if (cached?.queries?.length > 0) {
      var age = Date.now() - new Date(cached.queries[0].created_at || 0).getTime();
      if (age < 86400000 && cached.queries[0].id) {
        var full = await SEO.historyById(cached.queries[0].id).catch(function() { return null; });
        if (full) {
          _renderPageDeepDive(full.items?.[0] || full);
          showToast('Page analysis loaded from cache', 'info');
          if (btn) { btn.disabled = false; btn.innerHTML = origHtml || 'Analyze Page (~$0.01)'; }
          return;
        }
      }
    }

    SEO.startAction();
    var res = await SEO.dfs('on_page/content_parsing/live', {
      url: pageUrl
    });

    var result = res?.tasks?.[0]?.result?.[0] || null;
    if (result) {
      _renderPageDeepDive(result);
      var ac = SEO.getActionCost();
      showToast('Page analyzed — cost: ' + SEO.fmtCost(ac.cost), 'success', 5000);
    } else {
      showToast('No results returned for this page', 'warning');
    }
  } catch(e) {
    showToast('Page analysis failed: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = origHtml || 'Analyze Page (~$0.01)'; }
  }
}

function _renderPageDeepDive(result) {
  var container = document.getElementById('deepdive-results');
  if (!container) return;

  if (!result) {
    container.innerHTML = '<div style="text-align:center;padding:30px;color:#8c909f;font-size:12px">No data returned</div>';
    return;
  }

  // Extract fields
  var title = result.page_title || result.title || '';
  var metaDesc = result.meta_description || result.description || '';
  var wordCount = result.page_content_word_count || result.word_count || 0;
  var textLen = result.page_content_plain_text_length || result.plain_text_length || 0;

  // Heading tags
  var headings = result.headings || {};
  var h1s = headings.h1 || [];
  var h2s = headings.h2 || [];
  var h3s = headings.h3 || [];

  // Links
  var internalLinks = result.internal_links_count || 0;
  var externalLinks = result.external_links_count || 0;

  // Images
  var images = result.images || [];
  var totalImages = images.length;
  var imagesWithAlt = images.filter(function(img) { return img.alt && img.alt.trim() !== ''; }).length;
  var imagesNoAlt = totalImages - imagesWithAlt;

  var html = '<div style="display:grid;grid-template-columns:1fr;gap:16px">';

  // Title and Meta
  html += '<div style="background:#131318;border:1px solid rgba(66,71,84,0.15);border-radius:8px;padding:16px">'
    + '<h4 style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#8c909f;margin-bottom:10px;font-weight:700">Page Title</h4>'
    + '<p style="font-size:14px;color:#e4e1e9;font-weight:600;margin-bottom:4px">' + escHtml(title || 'No title found') + '</p>'
    + '<p style="font-size:10px;color:' + (title.length > 60 ? '#f59e0b' : '#4ae176') + ';font-weight:600">' + title.length + ' chars ' + (title.length > 60 ? '(over 60 recommended)' : '(good length)') + '</p>'
    + '</div>';

  html += '<div style="background:#131318;border:1px solid rgba(66,71,84,0.15);border-radius:8px;padding:16px">'
    + '<h4 style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#8c909f;margin-bottom:10px;font-weight:700">Meta Description</h4>'
    + '<p style="font-size:13px;color:#e4e1e9;line-height:1.4;margin-bottom:4px">' + escHtml(metaDesc || 'No meta description found') + '</p>'
    + '<p style="font-size:10px;color:' + (metaDesc.length > 160 ? '#f59e0b' : metaDesc.length === 0 ? '#ffb3ad' : '#4ae176') + ';font-weight:600">'
    + metaDesc.length + ' chars ' + (metaDesc.length === 0 ? '(MISSING)' : metaDesc.length > 160 ? '(over 160 recommended)' : '(good length)') + '</p>'
    + '</div>';

  // Stats row
  html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px">';

  var statItems = [
    { label: 'Word Count', value: fmtNum(wordCount), color: '#adc6ff' },
    { label: 'Text Length', value: fmtNum(textLen), color: '#adc6ff' },
    { label: 'Internal Links', value: fmtNum(internalLinks), color: '#4ae176' },
    { label: 'External Links', value: fmtNum(externalLinks), color: '#3b82f6' },
    { label: 'Images', value: totalImages, color: '#adc6ff' },
    { label: 'Images w/o Alt', value: imagesNoAlt, color: imagesNoAlt > 0 ? '#f59e0b' : '#4ae176' }
  ];

  statItems.forEach(function(s) {
    html += '<div style="background:#1a1a22;border-radius:8px;padding:12px;text-align:center">'
      + '<p style="font-size:9px;text-transform:uppercase;letter-spacing:0.1em;color:#8c909f;margin-bottom:4px;font-weight:600">' + s.label + '</p>'
      + '<p style="font-size:20px;font-weight:800;color:' + s.color + ';font-variant-numeric:tabular-nums">' + s.value + '</p>'
      + '</div>';
  });
  html += '</div>';

  // Headings
  html += '<div style="background:#131318;border:1px solid rgba(66,71,84,0.15);border-radius:8px;padding:16px">'
    + '<h4 style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#8c909f;margin-bottom:10px;font-weight:700">Heading Structure</h4>';

  if (h1s.length === 0 && h2s.length === 0 && h3s.length === 0) {
    html += '<p style="font-size:12px;color:#ffb3ad;font-weight:600">No heading tags found</p>';
  } else {
    var renderHeadings = function(tag, list, color) {
      if (list.length === 0) return '';
      var out = '';
      list.slice(0, 8).forEach(function(h) {
        var text = typeof h === 'string' ? h : (h.text || h.content || String(h));
        out += '<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:4px">'
          + '<span style="font-size:10px;font-weight:800;color:' + color + ';min-width:24px">' + tag + '</span>'
          + '<span style="font-size:12px;color:#c2c6d6">' + escHtml(text.substring(0, 100)) + '</span>'
          + '</div>';
      });
      if (list.length > 8) out += '<div style="font-size:10px;color:#8c909f;margin-left:32px">+' + (list.length - 8) + ' more</div>';
      return out;
    };
    html += renderHeadings('H1', h1s, '#4ae176');
    html += renderHeadings('H2', h2s, '#adc6ff');
    html += renderHeadings('H3', h3s, '#8c909f');
  }
  html += '</div>';

  html += '</div>';
  container.innerHTML = html;
}

/* =======================================================
   PAGE SCREENSHOT — capture page screenshot via DataForSEO
   ======================================================= */

async function fetchPageScreenshot(btn) {
  var urlInput = document.getElementById('deepdive-url-input');
  var pageUrl = urlInput ? urlInput.value.trim() : '';
  if (!pageUrl) { showToast('Enter a URL to screenshot', 'warning'); return; }
  if (pageUrl.indexOf('http') !== 0) pageUrl = 'https://' + pageUrl;
  if (!checkBalanceWarning(0.02)) return;

  if (btn) {
    btn.disabled = true;
    var origHtml = btn.innerHTML;
    btn.innerHTML = '<span style="display:inline-block;width:14px;height:14px;border:2px solid #35343a;border-top-color:#adc6ff;border-radius:50%;animation:spin 0.8s linear infinite;margin-right:6px"></span>Capturing...';
  }

  try {
    // Check cache first
    var cached = await SEO.history({ tool: 'page_screenshot', target: pageUrl, limit: 1 }).catch(function() { return {}; });
    if (cached?.queries?.length > 0) {
      var age = Date.now() - new Date(cached.queries[0].created_at || 0).getTime();
      if (age < 86400000 && cached.queries[0].id) {
        var full = await SEO.historyById(cached.queries[0].id).catch(function() { return null; });
        if (full) {
          var imgData = full.items?.[0] || full;
          _renderPageScreenshot(imgData);
          showToast('Screenshot loaded from cache', 'info');
          if (btn) { btn.disabled = false; btn.innerHTML = origHtml || 'Screenshot (~$0.01)'; }
          return;
        }
      }
    }

    SEO.startAction();
    var res = await SEO.dfs('on_page/page_screenshot', {
      url: pageUrl,
      full_page_screenshot: false
    });

    var result = res?.tasks?.[0]?.result?.[0] || null;
    if (result) {
      _renderPageScreenshot(result);
      var ac = SEO.getActionCost();
      showToast('Screenshot captured — cost: ' + SEO.fmtCost(ac.cost), 'success', 5000);
    } else {
      showToast('No screenshot returned', 'warning');
    }
  } catch(e) {
    showToast('Screenshot failed: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = origHtml || '<span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;margin-right:4px">photo_camera</span>Screenshot (~$0.01)'; }
  }
}

function _renderPageScreenshot(result) {
  var container = document.getElementById('deepdive-screenshot');
  if (!container) return;

  // DataForSEO returns either a base64 image or a URL
  var imageUrl = result.image || result.screenshot || result.url || '';
  var base64 = result.encoded_image || '';

  if (!imageUrl && !base64) {
    container.innerHTML = '<div style="text-align:center;padding:16px;color:#8c909f;font-size:12px">No screenshot image returned</div>';
    return;
  }

  var src = base64 ? 'data:image/png;base64,' + base64 : imageUrl;

  container.innerHTML = '<div style="background:#131318;border:1px solid rgba(66,71,84,0.15);border-radius:8px;padding:16px;overflow:hidden">'
    + '<h4 style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#8c909f;margin-bottom:10px;font-weight:700">Page Screenshot</h4>'
    + '<div style="border-radius:6px;overflow:hidden;border:1px solid rgba(66,71,84,0.2)">'
    + '<img src="' + escHtml(src) + '" style="width:100%;height:auto;display:block" alt="Page screenshot">'
    + '</div></div>';
}
// SEO Platform — Domain Analysis Module
'use strict';

async function loadDomainAnalysis() {
  showViewLoading('domain');
  var domain = SEO.activeProject;
  if (!domain) { showToast('Select a project first', 'warning'); hideViewLoading('domain'); return; }

  // Update domain name display
  setHtml('domain-name', escHtml(domain));

  try {
    // First try FREE from history
    var [histRanked, histTraffic, histWhois, histCategories, histTech, histCompetitors, histBacklinksD] = await Promise.all([
      SEO.history({ tool: 'ranked_keywords', target: domain, limit: 1 }).catch(function() { return {}; }),
      SEO.history({ tool: 'traffic_estimate', target: domain, limit: 1 }).catch(function() { return {}; }),
      SEO.history({ tool: 'whois', target: domain, limit: 1 }).catch(function() { return {}; }),
      SEO.history({ tool: 'categories', target: domain, limit: 1 }).catch(function() { return {}; }),
      SEO.history({ tool: 'technologies', target: domain, limit: 1 }).catch(function() { return {}; }),
      SEO.history({ tool: 'competitors', target: domain, limit: 1 }).catch(function() { return {}; }),
      SEO.history({ tool: 'backlinks_summary', target: domain, limit: 1 }).catch(function() { return {}; })
    ]);

    var hasData = false;

    // Set last-updated from most recent query
    var _domTs = [histRanked, histTraffic, histWhois, histCategories, histTech, histCompetitors, histBacklinksD]
      .map(function(h) { return h?.queries?.[0]?.created_at; }).filter(Boolean).sort().reverse();
    if (_domTs.length) {
      setLastUpdated('domain', _domTs[0]);
      var domUpdEl = document.getElementById('last-updated-domain');
      if (domUpdEl) domUpdEl.textContent = 'Last Crawl: ' + timeAgo(_domTs[0]);
    }

    // Ranked keywords -> Authority + Total Keywords + Table with pagination
    if (histRanked?.queries?.length > 0) {
      hasData = true;
      var rData = histRanked.queries[0].summary;
      if (rData) {
        var totalKw = rData.total_count || rData.metrics?.organic?.count || 0;
        setHtml('domain-authority-change', fmtNum(totalKw) + ' keywords ranked');
      }
      if (histRanked.queries[0].id) {
        try {
          var fullRanked = await SEO.historyById(histRanked.queries[0].id);
          var kwItems = fullRanked?.items || [];
          if (kwItems.length > 0) {
            _domainKwItems = kwItems;
            _domainKwPage = 0;
            renderDomainKeywordsTable(kwItems.slice(0, 20));
            renderDomainKwPagination();
            renderKeywordUrlMapping(kwItems);
          }
        } catch(e) { /* no items available */ }
      }
    }

    // Traffic
    if (histTraffic?.queries?.length > 0) {
      hasData = true;
      var tData = histTraffic.queries[0].summary;
      if (tData) {
        var etv = tData.etv || tData.estimated_monthly_traffic || tData.items?.[0]?.metrics?.organic?.etv || tData.metrics?.organic?.etv || 0;
        setHtml('domain-organic-val', fmtNum(Math.round(etv)));
      }
      // Also try loading full items for additional traffic metrics
      if (histTraffic.queries[0].id) {
        try {
          var tFull = await SEO.historyById(histTraffic.queries[0].id);
          var tItems = tFull?.items || [];
          if (tItems.length > 0) {
            var tItem = tItems[0];
            var orgEtv = tItem?.metrics?.organic?.etv || 0;
            var paidEtv = tItem?.metrics?.paid?.etv || 0;
            if (orgEtv > 0) setHtml('domain-organic-val', fmtNum(Math.round(orgEtv)));
            if (paidEtv > 0) {
              var paidEl = document.getElementById('domain-paid-val');
              if (paidEl) paidEl.textContent = fmtNum(Math.round(paidEtv));
            }
          }
        } catch(e) { /* full traffic data unavailable */ }
      }
    }

    // Competitors
    if (histCompetitors?.queries?.length > 0) {
      hasData = true;
      if (histCompetitors.queries[0].id) {
        try {
          var fullComp = await SEO.historyById(histCompetitors.queries[0].id);
          var compItems = fullComp?.items || [];
          if (compItems.length > 0) renderDomainCompetitors(compItems.slice(0, 20));
        } catch(e) { /* no competitor items */ }
      }
    }

    // Backlinks -> Authority Score (uses rank from backlinks/summary)
    if (histBacklinksD?.queries?.length > 0) {
      hasData = true;
      if (histBacklinksD.queries[0].id) {
        try {
          var blFull = await SEO.historyById(histBacklinksD.queries[0].id);
          var blItem = blFull?.items?.[0] || blFull || {};
          var blRank = blItem.rank || blFull?.rank || 0;
          if (blRank > 0) {
            var authScore = Math.min(99, Math.max(1, Math.round(100 - Math.log10(blRank + 1) * 14)));
            setHtml('domain-authority-val', authScore);
          }
          if (blItem.backlinks || blFull?.backlinks) {
            setHtml('domain-backlinks-val', fmtNum(blItem.backlinks || blFull?.backlinks || 0));
            setHtml('domain-backlinks-sub', 'From ' + fmtNum(blItem.referring_domains || blFull?.referring_domains || 0) + ' Referring Domains');
          }
        } catch(e) { /* no backlinks data */ }
      }
    }

    // Categories — load full items and render with name lookup
    if (histCategories?.queries?.length > 0) {
      hasData = true;
      if (histCategories.queries[0].id) {
        try {
          var fullCats = await SEO.historyById(histCategories.queries[0].id);
          var catItems = fullCats?.items || [];
          if (catItems.length > 0) renderDomainCategories(catItems);
        } catch(e) { /* no category items */ }
      }
    }

    // Technology Stack — load full items and render
    if (histTech?.queries?.length > 0) {
      hasData = true;
      if (histTech.queries[0].id) {
        try {
          var fullTech = await SEO.historyById(histTech.queries[0].id);
          var techItem = fullTech?.items?.[0] || fullTech || {};
          if (techItem.technologies) renderDomainTechStack(techItem);
        } catch(e) { /* no tech items */ }
      }
    }

    // WHOIS / Domain Registration — only show if we have whois/live data for our domain
    if (histWhois?.queries?.length > 0) {
      hasData = true;
      var whoisQ = histWhois.queries[0];
      var endpoint = whoisQ.endpoint || '';
      if (endpoint.indexOf('whois/live') >= 0 || endpoint.indexOf('whois_overview') >= 0) {
        // Direct WHOIS lookup — render the result
        if (whoisQ.id) {
          try {
            var fullWhois = await SEO.historyById(whoisQ.id);
            var whoisItems = fullWhois?.items || [];
            if (whoisItems.length === 1) {
              renderDomainWhois(whoisItems[0]);
            } else {
              var ourWhois = whoisItems.find(function(w) {
                return (w.domain || '').replace('www.','') === domain.replace('www.','');
              });
              if (ourWhois) renderDomainWhois(ourWhois);
            }
          } catch(e) { /* no whois items */ }
        }
      } else {
        // whois/overview returns competitor domains, not our domain's registration
        // Show fetch button instead
        var whoisEl = document.querySelector('#view-domain [data-whois]');
        if (whoisEl) {
          whoisEl.innerHTML = '<div class="text-center py-4">'
            + '<p class="text-xs text-on-surface-variant mb-3">WHOIS lookup costs ~$0.20</p>'
            + '<button onclick="fetchDomainWhois(this)" class="px-4 py-2 bg-primary/10 text-primary-fixed-dim rounded text-xs font-bold uppercase tracking-widest hover:bg-primary/20 transition-colors">Fetch WHOIS Data</button>'
            + '</div>';
        }
      }
    }

    // Subdomains from history (FREE)
    var histSubdomains = await SEO.history({ tool: 'subdomains', target: domain, limit: 1 }).catch(function() { return {}; });
    if (histSubdomains?.queries?.length > 0 && histSubdomains.queries[0].id) {
      try {
        var fullSubs = await SEO.historyById(histSubdomains.queries[0].id);
        var subItems = fullSubs?.items || [];
        if (subItems.length > 0) _renderSubdomains(subItems);
      } catch(e) { /* no subdomains data */ }
    }

    // Top Pages from history (FREE)
    var histTopPages = await SEO.history({ tool: 'domain_pages', target: domain, limit: 1 }).catch(function() { return {}; });
    if (histTopPages?.queries?.length > 0 && histTopPages.queries[0].id) {
      try {
        var fullPages = await SEO.historyById(histTopPages.queries[0].id);
        var pageItems = fullPages?.items || [];
        if (pageItems.length > 0) renderTopPages(pageItems);
      } catch(e) { /* no top pages data */ }
    }

    // Render traffic trend chart
    renderDomainTrafficTrend();

    if (!hasData) {
      showToast('No cached data for ' + domain + '. Use Refresh to fetch live data.', 'info');
    }
  } catch (e) {
    console.warn('Domain analysis load error:', e);
  } finally {
    hideViewLoading('domain');
  }
}

/**
 * refreshDomainAnalysis - fetch live data (~$0.08)
 */
async function refreshDomainAnalysis(btn) {
  var domain = SEO.activeProject;
  if (!domain) { showToast('Select a project first', 'warning'); return; }
  if (!checkBalanceWarning(0.08)) return;
  if (_debounceTimers['refreshDomain']) return;
  _debounceTimers['refreshDomain'] = true;
  setTimeout(function() { _debounceTimers['refreshDomain'] = false; }, 3000);

  if (btn) { btn.disabled = true; btn.innerHTML = '<span style="display:inline-block;width:14px;height:14px;border:2px solid #35343a;border-top-color:#adc6ff;border-radius:50%;animation:spin 0.8s linear infinite;margin-right:6px"></span>Analyzing...'; }

  setHtml('domain-name', escHtml(domain));
  SEO.startAction();

  try {
    // WHOIS excluded from default refresh — costs $0.20 per call. Use separate WHOIS button.
    var whoisRes = { error: 'skipped' };
    var [rankedRes, trafficRes, categoriesRes, techRes, competitorsRes, topPagesRes] = await Promise.all([
      SEO.dfs('dataforseo_labs/google/ranked_keywords/live', { target: domain, location_name: getProjectLocLang().location_name, language_name: getProjectLocLang().language_name, limit: 100 }).catch(function(e) { return { error: e.message }; }),
      SEO.dfs('dataforseo_labs/google/bulk_traffic_estimation/live', { targets: [domain] }).catch(function(e) { return { error: e.message }; }),
      SEO.dfs('dataforseo_labs/google/categories_for_domain/live', { target: domain, location_name: getProjectLocLang().location_name, language_name: getProjectLocLang().language_name }).catch(function(e) { return { error: e.message }; }),
      SEO.dfs('domain_analytics/technologies/domain_technologies/live', { target: domain }).catch(function(e) { return { error: e.message }; }),
      SEO.dfs('dataforseo_labs/google/competitors_domain/live', { target: domain, location_name: getProjectLocLang().location_name, language_name: getProjectLocLang().language_name, limit: 20 }).catch(function(e) { return { error: e.message }; }),
      SEO.dfs('dataforseo_labs/google/relevant_pages/live', { target: domain, location_name: getProjectLocLang().location_name, language_name: getProjectLocLang().language_name, limit: 30 }).catch(function(e) { return { error: e.message }; })
    ]);

    // Ranked Keywords -> Authority + Keywords count + table with pagination
    if (!rankedRes.error) {
      var rResult = rankedRes?.tasks?.[0]?.result?.[0];
      if (rResult) {
        var totalKw = rResult.total_count || 0;
        var items = rResult.items || [];
        setHtml('domain-authority-change', fmtNum(totalKw) + ' keywords ranked');
        if (items.length > 0) {
          _domainKwItems = items;
          _domainKwPage = 0;
          renderDomainKeywordsTable(items.slice(0, 20));
          renderDomainKwPagination();
          renderKeywordUrlMapping(items);
        }
      }
    }

    // Traffic
    if (!trafficRes.error) {
      var tResult = trafficRes?.tasks?.[0]?.result?.[0];
      if (tResult) {
        var item0 = tResult.items?.[0];
        var etv = item0?.metrics?.organic?.etv || 0;
        var paidEtv = item0?.metrics?.paid?.etv || 0;
        setHtml('domain-organic-val', fmtNum(Math.round(etv)));
        setHtml('domain-paid-val', fmtNum(Math.round(paidEtv)));
      }
    }

    // Categories
    if (!categoriesRes.error) {
      var catResult = categoriesRes?.tasks?.[0]?.result?.[0];
      if (catResult?.categories || catResult?.items) {
        renderDomainCategories(catResult.categories || catResult.items || []);
      }
    }

    // Technologies
    if (!techRes.error) {
      var techResult = techRes?.tasks?.[0]?.result?.[0];
      if (techResult) {
        renderDomainTechStack(techResult);
      }
    }

    // WHOIS
    if (!whoisRes.error) {
      var whoisResult = whoisRes?.tasks?.[0]?.result?.[0];
      if (whoisResult) {
        renderDomainWhois(whoisResult);
      }
    }

    // Competitors
    if (!competitorsRes.error) {
      var compResult = competitorsRes?.tasks?.[0]?.result?.[0];
      if (compResult?.items) {
        renderDomainCompetitors(compResult.items.slice(0, 20));
      }
    }

    // Top Pages
    if (!topPagesRes.error) {
      var tpResult = topPagesRes?.tasks?.[0]?.result?.[0];
      if (tpResult?.items?.length > 0) renderTopPages(tpResult.items);
    }

    // Backlinks summary (quick fetch)
    try {
      var blRes = await SEO.dfs('backlinks/summary/live', { target: domain, backlinks_status_type: 'live' });
      var blResult = blRes?.tasks?.[0]?.result?.[0];
      if (blResult) {
        setHtml('domain-backlinks-val', fmtNum(blResult.backlinks || 0));
        setHtml('domain-backlinks-sub', 'From ' + fmtNum(blResult.referring_domains || 0) + ' Referring Domains');
        // Authority Score from backlinks rank (lower rank = higher authority)
        var blRank = blResult.rank || 0;
        if (blRank > 0) {
          var authScore = Math.min(99, Math.max(1, Math.round(100 - Math.log10(blRank + 1) * 14)));
          setHtml('domain-authority-val', authScore);
        }
      }
    } catch(e) { /* backlinks optional */ }

    var ac = SEO.getActionCost();
    showToast('Domain analysis complete — ' + ac.calls + ' calls, cost: ' + SEO.fmtCost(ac.cost), 'success', 6000);
    // Reload from history to populate all fields
    loadDomainAnalysis();
  } catch (e) {
    showToast('Domain analysis failed: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = 'Refresh Data (~$0.09)'; }
  }
}

function renderDomainKeywordsTable(items) {
  var tbody = document.getElementById('domain-keywords-body');
  if (!tbody) return;
  var html = '';
  items.forEach(function(item) {
    var kw = item?.keyword_data?.keyword || item?.keyword || '';
    var pos = item?.ranked_serp_element?.serp_item?.rank_group || item?.position || '--';
    var vol = item?.keyword_data?.keyword_info?.search_volume || item?.search_volume || 0;
    var kd = item?.keyword_data?.keyword_properties?.keyword_difficulty || item?.keyword_difficulty || 0;
    var cpc = item?.keyword_data?.keyword_info?.cpc || item?.cpc || 0;
    var intent = item?.keyword_data?.search_intent_info?.main_intent || item?.intent || '';
    var kdCol = kdColor(kd);

    html += '<tr class="hover:bg-surface-container-high transition-colors cursor-pointer group">'
      + '<td class="py-5 px-4 md:px-8"><div class="flex items-center font-bold text-sm text-on-surface">' + escHtml(kw) + '</div></td>'
      + '<td class="py-5 px-4 md:px-8">' + intentBadge(intent) + '</td>'
      + '<td class="py-5 px-4 md:px-8 text-center tabular-nums font-bold">' + (pos !== '--' ? pos : '--') + '</td>'
      + '<td class="py-5 px-4 md:px-8 text-right tabular-nums text-on-surface-variant">' + fmtNum(vol) + '</td>'
      + '<td class="py-5 px-4 md:px-8 text-right tabular-nums">'
      + '<div class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold" style="background:' + kdCol + '15;color:' + kdCol + '">' + Math.round(kd) + '</div></td>'
      + '<td class="py-5 px-4 md:px-8 text-right tabular-nums text-on-surface-variant">' + fmtMoney(cpc) + '</td>'
      + '</tr>';
  });
  tbody.innerHTML = html;
}

function renderDomainKwPagination() {
  var total = _domainKwItems.length;
  var perPage = 20;
  var totalPages = Math.ceil(total / perPage);
  var infoEl = document.getElementById('domain-kw-page-info');
  var prevBtn = document.getElementById('domain-kw-prev');
  var nextBtn = document.getElementById('domain-kw-next');
  if (infoEl) infoEl.textContent = 'Showing ' + (_domainKwPage * perPage + 1) + '-' + Math.min((_domainKwPage + 1) * perPage, total) + ' of ' + total + ' keywords';
  if (prevBtn) prevBtn.disabled = _domainKwPage <= 0;
  if (nextBtn) nextBtn.disabled = _domainKwPage >= totalPages - 1;
}
function domainKwPagePrev() {
  if (_domainKwPage > 0) {
    _domainKwPage--;
    renderDomainKeywordsTable(_domainKwItems.slice(_domainKwPage * 20, (_domainKwPage + 1) * 20));
    renderDomainKwPagination();
  }
}
function domainKwPageNext() {
  var totalPages = Math.ceil(_domainKwItems.length / 20);
  if (_domainKwPage < totalPages - 1) {
    _domainKwPage++;
    renderDomainKeywordsTable(_domainKwItems.slice(_domainKwPage * 20, (_domainKwPage + 1) * 20));
    renderDomainKwPagination();
  }
}

function renderDomainCompetitors(items) {
  var list = document.getElementById('domain-competitors-list');
  if (!list) return;
  var ownDomain = (SEO.activeProject || '').toLowerCase().replace(/^www\./, '');
  // Filter out own domain and generic/social/marketplace domains
  var filtered = items.filter(function(item) {
    var d = (item.domain || '').toLowerCase().replace(/^www\./, '');
    if (d === ownDomain) return false;
    return !_genericDomains.some(function(g) { return d === g || d.endsWith('.' + g); });
  }).slice(0, 10);
  var html = '';
  if (filtered.length === 0) {
    html = '<div class="text-center text-xs text-on-surface-variant py-8">No direct competitors found. Try refreshing with more data.</div>';
    list.innerHTML = html;
    return;
  }
  // Calculate overlap relative to the competitor with the most common keywords
  var maxKw = Math.max.apply(null, filtered.map(function(i) { return i.metrics?.organic?.count || 0; })) || 1;
  filtered.forEach(function(item) {
    var compDomain = item.domain || '';
    var commonKw = item.metrics?.organic?.count || 0;
    var overlap = Math.round(commonKw / maxKw * 100);
    var barColor = overlap > 40 ? '#4ae176' : '#adc6ff';

    html += '<div class="flex items-center justify-between group">'
      + '<div class="flex items-center space-x-3">'
      + '<div class="w-8 h-8 rounded bg-surface-container-high border border-outline-variant/10 flex items-center justify-center overflow-hidden">'
      + '<img src="https://www.google.com/s2/favicons?domain=' + encodeURIComponent(compDomain) + '&sz=32" width="20" height="20" style="border-radius:2px" onerror="this.style.display=\'none\';this.parentElement.innerHTML=\'<span style=font-size:14px;color:#8c909f>&#127760;</span>\'"/></div>'
      + '<div><div class="text-sm font-bold">' + escHtml(compDomain) + '</div>'
      + '<div class="text-[10px] text-on-surface-variant uppercase tracking-widest">Common Keywords: ' + fmtNum(commonKw) + '</div></div></div>'
      + '<div class="text-right"><div class="text-sm font-black tabular-nums">' + overlap + '%</div>'
      + '<div class="w-16 h-1 bg-surface-container-high rounded-full overflow-hidden mt-1">'
      + '<div class="h-full" style="width:' + overlap + '%;background:' + barColor + '"></div></div></div></div>';
  });
  list.innerHTML = html;
}

function renderDomainCategories(categories) {
  var el = document.getElementById('domain-categories');
  if (!el) {
    // Create a categories section in the domain view if it doesn't exist
    var domainView = document.getElementById('view-domain');
    if (!domainView) return;
    var section = document.createElement('div');
    section.id = 'domain-categories';
    section.className = 'mt-4 md:mt-6 bg-[#131318] rounded-xl border border-[#424754]/20 overflow-hidden';
    section.innerHTML = '<div style="padding:16px 20px;border-bottom:1px solid rgba(66,71,84,0.1)"><h3 style="font-size:14px;font-weight:700;color:#e4e1e9">Topic Categories</h3><p style="font-size:10px;color:#8c909f;margin-top:2px">Content verticals this domain covers</p></div><div id="domain-categories-list" class="p-4"></div>';
    // Insert before the tech stack or at the end
    var techSection = domainView.querySelector('#domain-tech-stack');
    if (techSection) domainView.insertBefore(section, techSection);
    else domainView.appendChild(section);
    el = section;
  }
  var listEl = document.getElementById('domain-categories-list') || el.querySelector('.p-4');
  if (!listEl) return;

  // categories can be array of items or object keyed by code
  var cats = Array.isArray(categories) ? categories : Object.values(categories);
  if (cats.length === 0) { listEl.innerHTML = '<div style="padding:12px;text-align:center;color:#8c909f;font-size:12px">No category data</div>'; return; }

  // Sort by keyword count descending
  cats.sort(function(a, b) { return ((b.metrics?.organic?.count || 0) - (a.metrics?.organic?.count || 0)); });
  var maxCount = cats[0]?.metrics?.organic?.count || 1;

  var html = '';
  cats.slice(0, 12).forEach(function(cat) {
    // Resolve category name from code lookup
    var name = cat.category || cat.name || '';
    if (!name && cat.categories && Array.isArray(cat.categories) && cat.categories.length > 0) {
      name = DFS_CATEGORY_NAMES[cat.categories[0]] || ('Category ' + cat.categories[0]);
    }
    if (!name) name = 'Unknown';
    var kwCount = cat.metrics?.organic?.count || 0;
    var etv = cat.metrics?.organic?.etv || 0;
    var pct = Math.round(kwCount / maxCount * 100);
    html += '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(66,71,84,0.08)">'
      + '<div style="flex:1;min-width:0">'
      + '<div style="font-size:12px;font-weight:600;color:#e4e1e9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(name) + '</div>'
      + '<div style="font-size:10px;color:#8c909f;margin-top:2px">' + fmtNum(kwCount) + ' keywords &middot; ETV: ' + fmtNum(Math.round(etv)) + '</div>'
      + '</div>'
      + '<div style="width:80px;height:6px;background:#2a292f;border-radius:3px;overflow:hidden;flex-shrink:0">'
      + '<div style="height:100%;width:' + pct + '%;background:#adc6ff;border-radius:3px"></div></div>'
      + '</div>';
  });
  listEl.innerHTML = html;
}

function renderDomainTechStack(techData) {
  var existing = document.querySelector('#view-domain [data-tech-stack]');
  if (!existing) return;
  var techs = techData?.technologies;
  if (!techs) return;

  var html = '';
  // Handle both array format [{name, version}] and dict format {category: {subcategory: [names]}}
  if (Array.isArray(techs)) {
    if (!techs.length) return;
    techs.slice(0, 12).forEach(function(t) {
      html += '<div class="flex justify-between py-2 border-b border-outline-variant/5">'
        + '<span class="text-xs text-on-surface-variant">' + escHtml(t.name || t.category || '') + '</span>'
        + '<span class="text-xs font-bold text-on-surface">' + escHtml(t.version || 'Detected') + '</span></div>';
    });
  } else if (typeof techs === 'object') {
    // Dict format: {servers: {cdn: ["Netlify"], paas: ["Netlify"]}, security: {security: ["HSTS"]}}
    Object.keys(techs).forEach(function(group) {
      var subs = techs[group];
      if (typeof subs === 'object' && subs !== null) {
        Object.keys(subs).forEach(function(subcat) {
          var tools = subs[subcat];
          if (Array.isArray(tools)) {
            tools.forEach(function(toolName) {
              html += '<div class="flex justify-between py-2 border-b border-outline-variant/5">'
                + '<div><span class="text-xs font-bold text-on-surface">' + escHtml(toolName) + '</span>'
                + '<span class="text-[10px] text-on-surface-variant ml-2">' + escHtml(subcat) + '</span></div>'
                + '<span class="text-[10px] font-medium text-primary-fixed-dim uppercase tracking-wider">' + escHtml(group) + '</span></div>';
            });
          }
        });
      }
    });
  }
  if (!html) { html = '<div class="text-center text-xs text-on-surface-variant py-4">No technology data found</div>'; }
  existing.innerHTML = html;
}

function renderDomainWhois(whoisData) {
  var existing = document.querySelector('#view-domain [data-whois]');
  if (!existing) return;
  // Handle both whois/live format (creation_date) and whois/overview format (created_datetime)
  var created = whoisData?.creation_date || whoisData?.created_datetime || whoisData?.registrar_info?.creation_date || '--';
  var expires = whoisData?.expiration_date || whoisData?.expiration_datetime || whoisData?.registrar_info?.expiration_date || '--';
  var updated = whoisData?.updated_date || whoisData?.updated_datetime || '';
  var registrar = whoisData?.registrar || whoisData?.registrar_info?.registrar || '--';
  var domainName = whoisData?.domain || '';

  var html = '';
  if (domainName) {
    html += '<div class="flex justify-between py-2 border-b border-outline-variant/5">'
      + '<span class="text-xs text-on-surface-variant">Domain</span>'
      + '<span class="text-xs font-bold text-on-surface">' + escHtml(domainName) + '</span></div>';
  }
  html += '<div class="flex justify-between py-2 border-b border-outline-variant/5">'
    + '<span class="text-xs text-on-surface-variant">Registrar</span>'
    + '<span class="text-xs font-bold text-on-surface">' + escHtml(String(registrar || '--')) + '</span></div>'
    + '<div class="flex justify-between py-2 border-b border-outline-variant/5">'
    + '<span class="text-xs text-on-surface-variant">Created</span>'
    + '<span class="text-xs font-bold text-on-surface">' + escHtml(String(created).substring(0, 10)) + '</span></div>';
  if (updated) {
    html += '<div class="flex justify-between py-2 border-b border-outline-variant/5">'
      + '<span class="text-xs text-on-surface-variant">Updated</span>'
      + '<span class="text-xs font-bold text-on-surface">' + escHtml(String(updated).substring(0, 10)) + '</span></div>';
  }
  html += '<div class="flex justify-between py-2">'
    + '<span class="text-xs text-on-surface-variant">Expires</span>'
    + '<span class="text-xs font-bold text-on-surface">' + escHtml(String(expires).substring(0, 10)) + '</span></div>';
  existing.innerHTML = html;
}

/* =======================================================
   TOP PAGES BY TRAFFIC — relevant_pages/live
   ======================================================= */

async function fetchTopPages(btn) {
  var domain = SEO.activeProject;
  if (!domain) { showToast('Select a project first', 'warning'); return; }
  if (!checkBalanceWarning(0.02)) return;
  if (_debounceTimers['fetchTopPages']) return;
  _debounceTimers['fetchTopPages'] = true;
  setTimeout(function() { _debounceTimers['fetchTopPages'] = false; }, 3000);

  if (btn) { btn.disabled = true; btn.innerHTML = '<span style="display:inline-block;width:14px;height:14px;border:2px solid #35343a;border-top-color:#adc6ff;border-radius:50%;animation:spin 0.8s linear infinite;margin-right:4px"></span>Loading...'; }
  SEO.startAction();

  try {
    var res = await SEO.dfs('dataforseo_labs/google/relevant_pages/live', {
      target: domain,
      location_name: getProjectLocLang().location_name,
      language_name: getProjectLocLang().language_name,
      limit: 30
    });
    var items = res?.tasks?.[0]?.result?.[0]?.items || [];
    if (items.length > 0) {
      renderTopPages(items);
    } else {
      var tbody = document.getElementById('domain-top-pages-body');
      if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="padding:40px;text-align:center;color:#8c909f;font-size:13px">No top pages data found for this domain.</td></tr>';
    }
    var ac = SEO.getActionCost();
    showToast('Loaded ' + items.length + ' top pages — cost: ' + SEO.fmtCost(ac.cost), 'success');
  } catch(e) {
    showToast('Top pages failed: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<span class="material-symbols-outlined text-sm">refresh</span> Fetch (~$0.01)'; }
  }
}

function renderTopPages(items) {
  var tbody = document.getElementById('domain-top-pages-body');
  if (!tbody) return;

  // Sort by ETV descending
  items.sort(function(a, b) {
    var aEtv = a.metrics?.organic?.etv || 0;
    var bEtv = b.metrics?.organic?.etv || 0;
    return bEtv - aEtv;
  });

  var html = '';
  items.slice(0, 20).forEach(function(item) {
    var page = item.page_address || '';
    var kwCount = item.metrics?.organic?.count || 0;
    var etv = Math.round(item.metrics?.organic?.etv || 0);
    var etvCost = item.metrics?.organic?.estimated_paid_traffic_cost || 0;
    var backlinks = item.backlinks_info?.backlinks || 0;

    // Shorten URL for display
    var displayUrl = page.replace(/^https?:\/\//, '').replace(/^www\./, '');
    if (displayUrl.length > 60) displayUrl = displayUrl.substring(0, 57) + '...';

    html += '<tr class="hover:bg-surface-container-high transition-colors">'
      + '<td class="py-4 px-4 md:px-8">'
      + '<a href="' + escHtml(page) + '" target="_blank" rel="noopener" class="text-xs md:text-sm font-medium text-primary hover:underline">' + escHtml(displayUrl) + '</a>'
      + '</td>'
      + '<td class="py-4 px-4 md:px-8 text-right tabular-nums text-xs md:text-sm font-semibold">' + fmtNum(kwCount) + '</td>'
      + '<td class="py-4 px-4 md:px-8 text-right tabular-nums text-xs md:text-sm font-bold">' + fmtNum(etv) + '</td>'
      + '<td class="py-4 px-4 md:px-8 text-right tabular-nums text-xs text-on-surface-variant hidden md:table-cell">' + fmtMoney(etvCost) + '</td>'
      + '<td class="py-4 px-4 md:px-8 text-right tabular-nums text-xs text-on-surface-variant hidden md:table-cell">' + fmtNum(backlinks) + '</td>'
      + '</tr>';
  });

  if (!html) {
    html = '<tr><td colspan="5" style="padding:40px;text-align:center;color:#8c909f">No pages with traffic found</td></tr>';
  }
  tbody.innerHTML = html;
}

/* =======================================================
   KEYWORD-TO-URL MAPPING — derived from ranked_keywords data (FREE)
   Groups keywords by URL, showing which page targets which keywords
   ======================================================= */

function renderKeywordUrlMapping(items) {
  // Find or create container
  var container = document.getElementById('domain-kw-url-mapping');
  if (!container) {
    var domainView = document.getElementById('view-domain');
    if (!domainView) return;
    var section = document.createElement('div');
    section.id = 'domain-kw-url-mapping';
    section.className = 'col-span-12 bg-surface-container-low rounded-xl overflow-hidden';
    // Insert before the keywords table
    var kwTable = domainView.querySelector('#domain-top-pages-body')?.closest('.col-span-12');
    if (kwTable) kwTable.parentElement.insertBefore(section, kwTable);
    else {
      var grid = domainView.querySelector('.grid.grid-cols-12');
      if (grid) grid.appendChild(section);
    }
    container = section;
  }

  // Group keywords by URL
  var urlMap = {};
  (items || []).forEach(function(item) {
    var url = item?.ranked_serp_element?.serp_item?.relative_url || item?.ranked_serp_element?.serp_item?.url || '';
    if (!url) return;
    var kw = item?.keyword_data?.keyword || '';
    var vol = item?.keyword_data?.keyword_info?.search_volume || 0;
    var rank = item?.ranked_serp_element?.serp_item?.rank_group || 999;
    var etv = item?.ranked_serp_element?.serp_item?.etv || 0;

    if (!urlMap[url]) urlMap[url] = { url: url, keywords: [], totalTraffic: 0, totalVolume: 0, bestRank: 999 };
    urlMap[url].keywords.push({ keyword: kw, rank: rank, volume: vol, etv: etv });
    urlMap[url].totalTraffic += etv;
    urlMap[url].totalVolume += vol;
    if (rank < urlMap[url].bestRank) urlMap[url].bestRank = rank;
  });

  // Sort pages by total traffic descending
  var pages = Object.values(urlMap).sort(function(a, b) { return b.totalTraffic - a.totalTraffic; });
  if (pages.length === 0) { container.innerHTML = ''; return; }

  // Sort keywords within each page by rank ascending
  pages.forEach(function(p) { p.keywords.sort(function(a, b) { return a.rank - b.rank; }); });

  var html = '<div class="p-4 md:p-8 pb-4 flex justify-between items-end">'
    + '<div><h3 class="text-lg font-bold tracking-tight">Page-Keyword Map</h3>'
    + '<p class="text-xs text-on-surface-variant mt-1">Which page ranks for which keywords — ' + pages.length + ' pages found</p></div>'
    + '</div>';

  html += '<div class="px-4 md:px-8 pb-6 space-y-3">';
  pages.slice(0, 15).forEach(function(page, idx) {
    var displayUrl = page.url.replace(/^https?:\/\//, '').replace(/^www\./, '');
    if (displayUrl.length > 60) displayUrl = displayUrl.substring(0, 57) + '...';
    var expandId = 'kwurl-exp-' + idx;
    var kwCount = page.keywords.length;
    var topKw = page.keywords[0];

    html += '<div style="background:#1a1a22;border-radius:10px;overflow:hidden;border:1px solid rgba(66,71,84,0.1)">'
      + '<div onclick="toggleKwUrlPanel(\'' + expandId + '\',this)" style="padding:12px 16px;cursor:pointer;display:flex;align-items:center;gap:10px" onmouseover="this.style.background=\'rgba(30,30,38,0.4)\'" onmouseout="this.style.background=\'none\'">'
      + '<span class="material-symbols-outlined kwurl-chevron" style="font-size:14px;color:#64687a;transition:transform 200ms;flex-shrink:0">chevron_right</span>'
      + '<div style="flex:1;min-width:0">'
      + '<div style="font-size:12px;font-weight:600;color:#adc6ff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(displayUrl) + '</div>'
      + '<div style="font-size:10px;color:#8c909f;margin-top:2px">' + kwCount + ' keyword' + (kwCount === 1 ? '' : 's') + ' &middot; Best: #' + page.bestRank + ' &middot; Traffic: ' + fmtNum(Math.round(page.totalTraffic)) + '/mo</div>'
      + '</div>'
      + '<div style="text-align:right;flex-shrink:0">'
      + '<div style="font-size:14px;font-weight:800;color:#e4e1e9;font-variant-numeric:tabular-nums">' + fmtNum(Math.round(page.totalTraffic)) + '</div>'
      + '<div style="font-size:9px;color:#8c909f;text-transform:uppercase">est. traffic</div>'
      + '</div></div>'
      + '<div id="' + expandId + '" style="display:none;padding:0 16px 12px 40px">'
      + '<table style="width:100%;border-collapse:collapse;font-size:12px"><thead>'
      + '<tr style="border-bottom:1px solid rgba(66,71,84,0.15)">'
      + '<th style="text-align:left;padding:6px 8px;color:#8c909f;font-size:10px;font-weight:600">Keyword</th>'
      + '<th style="text-align:center;padding:6px 8px;color:#8c909f;font-size:10px;font-weight:600">Pos</th>'
      + '<th style="text-align:right;padding:6px 8px;color:#8c909f;font-size:10px;font-weight:600">Volume</th>'
      + '<th style="text-align:right;padding:6px 8px;color:#8c909f;font-size:10px;font-weight:600">Traffic</th>'
      + '</tr></thead><tbody>';

    page.keywords.slice(0, 20).forEach(function(kw) {
      var posColor = kw.rank <= 3 ? '#f59e0b' : kw.rank <= 10 ? '#4ae176' : kw.rank <= 20 ? '#adc6ff' : '#8c909f';
      html += '<tr style="border-bottom:1px solid rgba(66,71,84,0.06)">'
        + '<td style="padding:5px 8px;color:#e4e1e9;font-weight:500">' + escHtml(kw.keyword) + '</td>'
        + '<td style="padding:5px 8px;text-align:center;color:' + posColor + ';font-weight:700;font-variant-numeric:tabular-nums">#' + kw.rank + '</td>'
        + '<td style="padding:5px 8px;text-align:right;color:#8c909f;font-variant-numeric:tabular-nums">' + fmtNum(kw.volume) + '</td>'
        + '<td style="padding:5px 8px;text-align:right;color:#e4e1e9;font-weight:600;font-variant-numeric:tabular-nums">' + fmtNum(Math.round(kw.etv)) + '</td>'
        + '</tr>';
    });
    if (page.keywords.length > 20) {
      html += '<tr><td colspan="4" style="padding:6px 8px;text-align:center;color:#64687a;font-size:11px">+' + (page.keywords.length - 20) + ' more keywords</td></tr>';
    }
    html += '</tbody></table></div></div>';
  });

  if (pages.length > 15) {
    html += '<div style="text-align:center;padding:12px;color:#64687a;font-size:11px">' + (pages.length - 15) + ' more pages not shown</div>';
  }
  html += '</div>';
  container.innerHTML = html;
}

function toggleKwUrlPanel(expandId, headerEl) {
  var el = document.getElementById(expandId);
  if (!el) return;
  var isOpen = el.style.display !== 'none';
  el.style.display = isOpen ? 'none' : '';
  var chevron = headerEl.querySelector('.kwurl-chevron');
  if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(90deg)';
}

/* =======================================================
   SUBDOMAINS — dataforseo_labs/google/subdomains/live
   Collapsible section showing subdomains with keywords + traffic
   ======================================================= */

async function fetchSubdomains(btn) {
  var domain = SEO.activeProject;
  if (!domain) { showToast('Select a project first', 'warning'); return; }
  if (!checkBalanceWarning(0.01)) return;
  if (_debounceTimers['fetchSubdomains']) return;
  _debounceTimers['fetchSubdomains'] = true;
  setTimeout(function() { _debounceTimers['fetchSubdomains'] = false; }, 3000);

  if (btn) { btn.disabled = true; btn.textContent = 'Fetching...'; }
  SEO.startAction();

  try {
    var loc = getProjectLocLang();
    var res = await SEO.dfs('dataforseo_labs/google/subdomains/live', {
      target: domain,
      location_name: loc.location_name,
      language_name: loc.language_name,
      limit: 20
    });

    var items = res?.tasks?.[0]?.result?.[0]?.items || [];
    _renderSubdomains(items);

    var ac = SEO.getActionCost();
    showToast('Found ' + items.length + ' subdomains -- cost: ' + SEO.fmtCost(ac.cost), 'success', 6000);
  } catch (e) {
    showToast('Subdomains fetch failed: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Fetch Subdomains (~$0.01)'; }
  }
}

function _renderSubdomains(items) {
  // Create the section if it doesn't exist
  var section = document.getElementById('domain-subdomains');
  if (!section) {
    var domainView = document.getElementById('view-domain');
    if (!domainView) return;
    section = document.createElement('div');
    section.id = 'domain-subdomains';
    section.className = 'col-span-12 lg:col-span-6';
    section.innerHTML = '<div class="bg-surface-container rounded-xl p-4 md:p-8">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;cursor:pointer" onclick="toggleSubdomainsPanel()">'
      + '<div><h3 class="text-lg font-bold tracking-tight">Subdomains</h3>'
      + '<p class="text-xs text-on-surface-variant mt-1">Subdomains with organic visibility</p></div>'
      + '<span id="domain-subdomains-chevron" class="material-symbols-outlined text-on-surface-variant" style="transition:transform 200ms">expand_more</span>'
      + '</div>'
      + '<div id="domain-subdomains-list" style="margin-top:12px"></div>'
      + '</div>';
    // Insert in the bento grid — find it via col-span-12 parent grid
    var bentoGrid = domainView.querySelector('.grid.grid-cols-12');
    if (bentoGrid) {
      // Insert before the top pages section
      var topPagesSection = bentoGrid.querySelector('.col-span-12.bg-surface-container-low');
      if (topPagesSection) bentoGrid.insertBefore(section, topPagesSection);
      else bentoGrid.appendChild(section);
    } else {
      domainView.querySelector('.space-y-4')?.appendChild(section);
    }
  }

  var listEl = document.getElementById('domain-subdomains-list');
  if (!listEl) return;

  if (!items || items.length === 0) {
    listEl.innerHTML = '<div style="padding:16px;text-align:center;color:#8c909f;font-size:12px">No subdomains found for this domain.</div>';
    return;
  }

  // Normalize and sort by traffic
  var subs = items.map(function(item) {
    return {
      subdomain: item.subdomain || item.domain || '',
      keywords: item.metrics?.organic?.count || 0,
      traffic: item.metrics?.organic?.etv || 0
    };
  }).sort(function(a, b) { return b.traffic - a.traffic; });

  var maxTraffic = subs[0]?.traffic || 1;

  var html = '';
  subs.forEach(function(s) {
    var pct = Math.round(s.traffic / maxTraffic * 100);
    html += '<div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid rgba(66,71,84,0.08)">'
      + '<div style="flex:1;min-width:0">'
      + '<div style="font-size:12px;font-weight:600;color:#e4e1e9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(s.subdomain) + '</div>'
      + '<div style="font-size:10px;color:#8c909f;margin-top:2px">' + fmtNum(s.keywords) + ' keywords &middot; Est. traffic: ' + fmtNum(Math.round(s.traffic)) + '</div>'
      + '</div>'
      + '<div style="width:80px;height:6px;background:#2a292f;border-radius:3px;overflow:hidden;flex-shrink:0">'
      + '<div style="height:100%;width:' + pct + '%;background:#adc6ff;border-radius:3px"></div></div>'
      + '</div>';
  });
  listEl.innerHTML = html;
}

function toggleSubdomainsPanel() {
  var list = document.getElementById('domain-subdomains-list');
  var chevron = document.getElementById('domain-subdomains-chevron');
  if (!list) return;
  var isHidden = list.style.display === 'none';
  list.style.display = isHidden ? '' : 'none';
  if (chevron) chevron.style.transform = isHidden ? '' : 'rotate(180deg)';
}

async function fetchDomainWhois(btn) {
  var domain = SEO.activeProject;
  if (!domain) return;
  if (!checkBalanceWarning(0.20)) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Fetching...'; }
  SEO.startAction();
  try {
    var res = await SEO.dfs('domain_analytics/whois/live', [{ target: domain }]);
    var item = res?.tasks?.[0]?.result?.[0];
    if (item) renderDomainWhois(item);
    var ac = SEO.getActionCost();
    showToast('WHOIS fetched — cost: ' + SEO.fmtCost(ac.cost), 'success');
  } catch(e) {
    showToast('WHOIS lookup failed: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Fetch WHOIS Data'; }
  }
}
// SEO Platform — Backlinks Module
'use strict';

/* =======================================================
   PHASE 4.3 - BACKLINKS
   ======================================================= */

/**
 * loadBacklinksData - on view open (FREE from history)
 */
async function loadBacklinksData() {
  showViewLoading('backlinks');
  var domain = SEO.activeProject;
  if (!domain) { showToast('Select a project first', 'warning'); hideViewLoading('backlinks'); return; }

  try {
    // Load backlinks KPIs — try specific summary tool first, fall back to generic
    var blData = null;
    var hist = await SEO.history({ tool: 'backlinks_summary', target: domain, limit: 1 }).catch(function() { return {}; });
    var summaryQuery = (hist?.queries || [])[0];
    if (!summaryQuery) {
      // Fall back to generic backlinks tool (legacy data)
      hist = await SEO.history({ tool: 'backlinks', target: domain, limit: 5 }).catch(function() { return {}; });
      summaryQuery = (hist?.queries || []).find(function(q) { return (q.endpoint || '').indexOf('summary') !== -1; });
    }
    if (summaryQuery) {
      blData = summaryQuery.summary || {};
      // Load full item for complete data
      if (summaryQuery.id) {
        try {
          var full = await SEO.historyById(summaryQuery.id);
          var item = (full?.items || [])[0];
          if (item) blData = item;
        } catch(e) { /* use summary */ }
      }
    }
    // Fallback to accumulated
    if (!blData || (!blData.backlinks && !blData.total_backlinks)) {
      var accumulated = await SEO.accumulatedBacklinks(domain).catch(function() { return {}; });
      if (accumulated?.summary) blData = accumulated.summary;
    }

    if (blData) {
      renderBacklinksKPIs(blData);
    }

    // Load referring domains — try specific tool first, fall back to generic
    var refDomHist = await SEO.history({ tool: 'backlinks_referring_domains', target: domain, limit: 1 }).catch(function() { return {}; });
    var refDomQuery = (refDomHist?.queries || [])[0];
    if (!refDomQuery) {
      var blHist = await SEO.history({ tool: 'backlinks', target: domain, limit: 10 }).catch(function() { return {}; });
      refDomQuery = (blHist?.queries || []).find(function(q) { return (q.endpoint || '').indexOf('referring_domains') !== -1; });
    }
    if (refDomQuery && refDomQuery.id) {
      try {
        var fullDomains = await SEO.historyById(refDomQuery.id);
        var domainItems = fullDomains?.items || [];
        if (domainItems.length > 0) renderBacklinksDomainsTable(domainItems);
      } catch(e) { /* no detailed domain data */ }
    }

    // Render backlink growth chart from history
    renderBacklinkGrowthChart(domain);

    // Load history panel
    loadBacklinksHistory();

  } catch (e) {
    console.warn('Backlinks load error:', e);
  } finally {
    hideViewLoading('backlinks');
  }
}

async function renderBacklinkGrowthChart(domain) {
  try {
    var hist = await SEO.history({ tool: 'backlinks', target: domain, limit: 15 }).catch(function() { return {}; });
    var queries = (hist?.queries || []).reverse();
    if (queries.length > 1) {
      var series = queries.map(function(q) { return q.summary?.backlinks || q.summary?.total_count || q.result_count || 0; });
      var cats = queries.map(function(q) {
        var d = new Date(q.created_at || q.timestamp);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      });
      renderAreaChart('chart-backlink-growth', series, cats, { height: 200, name: 'Backlinks', colors: ['#4ae176'] });

      // New/Lost comparison (latest vs previous)
      var latest = queries[queries.length - 1];
      var prev = queries[queries.length - 2];
      var lBl = latest.summary?.backlinks || 0;
      var pBl = prev.summary?.backlinks || 0;
      var lRd = latest.summary?.referring_domains || 0;
      var pRd = prev.summary?.referring_domains || 0;
      var newBl = Math.max(0, lBl - pBl);
      var lostBl = Math.max(0, pBl - lBl);
      var newRd = Math.max(0, lRd - pRd);
      var lostRd = Math.max(0, pRd - lRd);
      var nlPanel = document.getElementById('bl-new-lost');
      if (nlPanel) {
        nlPanel.style.display = '';
        setHtml('bl-new-count', '+' + fmtNum(newBl));
        setHtml('bl-lost-count', '-' + fmtNum(lostBl));
        setHtml('bl-new-domains', '+' + fmtNum(newRd));
        setHtml('bl-lost-domains', '-' + fmtNum(lostRd));
      }
    } else {
      renderAreaChart('chart-backlink-growth', [0], ['No history yet'], { height: 200, name: 'Backlinks', colors: ['#4ae176'] });
    }
  } catch(e) { console.warn('Backlink growth chart error:', e); }
}

/**
 * fetchBacklinkHistory — proper time-series from backlinks/history/live ($0.02)
 * Returns monthly backlink + referring domain counts going back months/years.
 */
async function fetchBacklinkHistory(btn) {
  var domain = SEO.activeProject;
  if (!domain) { showToast('Select a project first', 'warning'); return; }
  if (!checkBalanceWarning(0.03)) return;
  if (_debounceTimers['fetchBlHistory']) return;
  _debounceTimers['fetchBlHistory'] = true;
  setTimeout(function() { _debounceTimers['fetchBlHistory'] = false; }, 3000);

  if (btn) { btn.disabled = true; btn.innerHTML = '<span style="display:inline-block;width:14px;height:14px;border:2px solid #35343a;border-top-color:#adc6ff;border-radius:50%;animation:spin 0.8s linear infinite;margin-right:4px"></span>Loading...'; }
  SEO.startAction();

  try {
    var res = await SEO.dfs('backlinks/history/live', {
      target: domain,
      date_from: new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10)
    });
    var items = res?.tasks?.[0]?.result?.[0]?.items || [];

    if (items.length > 0) {
      // Sort by date ascending
      items.sort(function(a, b) { return new Date(a.date || 0) - new Date(b.date || 0); });

      var dates = [];
      var blSeries = [];
      var rdSeries = [];

      items.forEach(function(item) {
        var d = new Date(item.date);
        dates.push(d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }));
        blSeries.push(item.backlinks || 0);
        rdSeries.push(item.referring_domains || 0);
      });

      _renderBacklinkHistoryChart(dates, blSeries, rdSeries);

      // Update new/lost from history endpoints
      if (items.length >= 2) {
        var latest = items[items.length - 1];
        var prev = items[items.length - 2];
        var nlPanel = document.getElementById('bl-new-lost');
        if (nlPanel) {
          nlPanel.style.display = '';
          setHtml('bl-new-count', '+' + fmtNum(Math.max(0, (latest.backlinks || 0) - (prev.backlinks || 0))));
          setHtml('bl-lost-count', '-' + fmtNum(Math.max(0, (prev.backlinks || 0) - (latest.backlinks || 0))));
          setHtml('bl-new-domains', '+' + fmtNum(Math.max(0, (latest.referring_domains || 0) - (prev.referring_domains || 0))));
          setHtml('bl-lost-domains', '-' + fmtNum(Math.max(0, (prev.referring_domains || 0) - (latest.referring_domains || 0))));
        }
      }

      var ac = SEO.getActionCost();
      showToast('Loaded ' + items.length + ' months of backlink history — cost: ' + SEO.fmtCost(ac.cost), 'success');
    } else {
      showToast('No historical backlink data available. Try the summary-based chart instead.', 'info');
    }
  } catch(e) {
    showToast('Backlink history failed: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<span class="material-symbols-outlined text-sm">history</span> Full History (~$0.02)'; }
  }
}

function _renderBacklinkHistoryChart(dates, blSeries, rdSeries) {
  var el = document.getElementById('chart-backlink-growth');
  if (!el) return;

  if (_charts['chart-backlink-growth']) {
    _charts['chart-backlink-growth'].destroy();
  }

  var options = {
    chart: { type: 'area', height: 200, background: 'transparent', toolbar: { show: false },
      fontFamily: 'Inter, sans-serif' },
    series: [
      { name: 'Backlinks', data: blSeries },
      { name: 'Referring Domains', data: rdSeries }
    ],
    colors: ['#4ae176', '#adc6ff'],
    xaxis: { categories: dates, labels: { style: { colors: '#8c909f', fontSize: '10px' } },
      axisBorder: { show: false }, axisTicks: { show: false } },
    yaxis: [
      { labels: { style: { colors: '#4ae176', fontSize: '10px' }, formatter: function(v) { return v >= 1000 ? (v/1000).toFixed(1) + 'k' : v; } }, title: { text: 'Backlinks', style: { color: '#4ae176', fontSize: '10px' } } },
      { opposite: true, labels: { style: { colors: '#adc6ff', fontSize: '10px' } }, title: { text: 'Ref Domains', style: { color: '#adc6ff', fontSize: '10px' } } }
    ],
    grid: { borderColor: 'rgba(66,71,84,0.15)', strokeDashArray: 3 },
    stroke: { curve: 'smooth', width: [2, 2] },
    fill: { type: 'solid', opacity: [0.15, 0.1] },
    dataLabels: { enabled: false },
    legend: { position: 'top', horizontalAlign: 'right', fontSize: '11px',
      labels: { colors: '#8c909f' }, markers: { width: 8, height: 8, radius: 2 } },
    tooltip: { theme: 'dark', shared: true, intersect: false },
    theme: { mode: 'dark' }
  };

  var chart = new ApexCharts(el, options);
  chart.render();
  _charts['chart-backlink-growth'] = chart;
}

function renderBacklinksKPIs(data) {
  // Handle multiple data shapes: accumulated summary, history summary, or full item
  var total = data.backlinks || data.total_backlinks || data.summary?.backlinks || data.summary?.total_backlinks || 0;
  var refDomains = data.referring_domains || data.summary?.referring_domains || 0;
  var nofollow = data.backlinks_nofollow || data.summary?.backlinks_nofollow || 0;
  var dofollow = total - nofollow;
  var dofollowPct = total > 0 ? Math.round(dofollow / total * 100) : 0;
  var rank = data.rank || data.domain_rank || data.summary?.rank || data.summary?.domain_rank || 0;

  setHtml('bl-total', fmtNum(total));
  setHtml('bl-total-change', total > 0 ? 'Live data' : '');
  setHtml('bl-referring-domains', fmtNum(refDomains));
  setHtml('bl-referring-domains-change', refDomains > 0 ? fmtNum(refDomains) + ' unique' : '');
  setHtml('bl-dofollow-ratio', dofollowPct + '%');
  setHtml('bl-dofollow-count', fmtNum(dofollow) + ' dofollow');
  setHtml('bl-domain-rating', rank > 0 ? fmtNum(rank) : '--');
  setHtml('bl-domain-rating-sub', rank > 0 ? 'DataForSEO Rank' : 'Run analysis to check');
}

var _blDomainsAllItems = [];
var _blDomainsPage = 0;
var _blDomainsPerPage = 20;

function renderBacklinksDomainsTable(items) {
  _blDomainsAllItems = items || [];
  _blDomainsPage = 0;
  _renderBlDomainsPage();
}

function _renderBlDomainsPage() {
  var tbody = document.getElementById('bl-domains-body');
  if (!tbody) return;
  var start = _blDomainsPage * _blDomainsPerPage;
  var pageItems = _blDomainsAllItems.slice(start, start + _blDomainsPerPage);
  var html = '';
  pageItems.forEach(function(item) {
    var domain = item.domain || item.target || '';
    var dr = item.rank || item.domain_rank || '--';
    var bl = item.backlinks || item.external_backlinks || 0;
    var isDofollow = item.backlinks_nofollow ? (item.backlinks - item.backlinks_nofollow > item.backlinks_nofollow) : true;
    var typeLabel = isDofollow ? 'Dofollow' : 'Nofollow';
    var typeColor = isDofollow ? '#4ae176' : '#ffb3ad';
    var firstSeen = item.first_seen ? new Date(item.first_seen).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '--';

    html += '<tr class="border-b border-[#424754]/10 hover:bg-[#1f1f25]/50">'
      + '<td class="px-6 py-3 font-medium text-[#e4e1e9]">' + escHtml(domain) + '</td>'
      + '<td class="px-4 py-3 text-[#adc6ff] font-bold" style="font-variant-numeric:tabular-nums">' + dr + '</td>'
      + '<td class="px-4 py-3" style="font-variant-numeric:tabular-nums">' + fmtNum(bl) + '</td>'
      + '<td class="px-4 py-3"><span class="text-[10px] font-bold px-2 py-0.5 rounded border" style="background:' + typeColor + '15;color:' + typeColor + ';border-color:' + typeColor + '30">' + typeLabel + '</span></td>'
      + '<td class="px-4 py-3 text-[#8c909f]">' + firstSeen + '</td></tr>';
  });
  tbody.innerHTML = html;

  // Pagination controls
  var total = _blDomainsAllItems.length;
  var totalPages = Math.ceil(total / _blDomainsPerPage);
  var pagEl = document.getElementById('bl-domains-pagination');
  if (!pagEl) {
    pagEl = document.createElement('div');
    pagEl.id = 'bl-domains-pagination';
    var tableParent = tbody.closest('.overflow-x-auto')?.parentElement;
    if (tableParent) tableParent.appendChild(pagEl);
  }
  if (totalPages <= 1) { pagEl.innerHTML = ''; return; }
  var showing = Math.min(start + _blDomainsPerPage, total);
  pagEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 20px;border-top:1px solid rgba(66,71,84,0.15)">'
    + '<span style="font-size:11px;color:#8c909f">Showing ' + (start + 1) + '-' + showing + ' of ' + total + '</span>'
    + '<div style="display:flex;gap:8px">'
    + '<button onclick="_blDomainsPage--;_renderBlDomainsPage()" style="padding:6px 14px;font-size:11px;font-weight:600;border-radius:6px;border:1px solid rgba(66,71,84,0.3);background:transparent;color:#adc6ff;cursor:pointer' + (_blDomainsPage === 0 ? ';opacity:0.3;pointer-events:none' : '') + '">Prev</button>'
    + '<button onclick="_blDomainsPage++;_renderBlDomainsPage()" style="padding:6px 14px;font-size:11px;font-weight:600;border-radius:6px;border:1px solid rgba(66,71,84,0.3);background:transparent;color:#adc6ff;cursor:pointer' + (_blDomainsPage >= totalPages - 1 ? ';opacity:0.3;pointer-events:none' : '') + '">Next</button>'
    + '</div></div>';
}

/**
 * refreshBacklinks - on refresh click (~$0.06 for summary + domains + anchors)
 */
async function refreshBacklinks(btn) {
  var domain = SEO.activeProject;
  if (!domain) { showToast('Select a project first', 'warning'); return; }
  if (!checkBalanceWarning(0.06)) return;  // ~$0.06: summary + referring_domains + anchors
  if (_debounceTimers['refreshBacklinks']) return;
  _debounceTimers['refreshBacklinks'] = true;
  setTimeout(function() { _debounceTimers['refreshBacklinks'] = false; }, 3000);

  if (btn) { btn.disabled = true; btn.textContent = 'Checking...'; }
  SEO.startAction();

  try {
    // Summary (always works)
    var summaryRes = await SEO.dfs('backlinks/summary/live', { target: domain, backlinks_status_type: 'live' });
    var summaryData = summaryRes?.tasks?.[0]?.result?.[0];
    if (summaryData) {
      renderBacklinksKPIs(summaryData);
    }

    // Referring domains — get top 100 by rank
    try {
      var domainsRes = await SEO.dfs('backlinks/referring_domains/live', { target: domain, backlinks_status_type: 'live', limit: 100, order_by: ['rank,desc'] });
      var domainItems = domainsRes?.tasks?.[0]?.result?.[0]?.items || [];
      if (domainItems.length > 0) renderBacklinksDomainsTable(domainItems);
    } catch(e) {
      console.warn('Detailed backlink data not available:', e.message);
      showToast('Summary loaded. Detailed backlink data available with full DataForSEO package.', 'info');
    }

    // Individual backlinks — actual linking URLs (not just domains)
    try {
      var backlinksRes = await SEO.dfs('backlinks/backlinks/live', { target: domain, backlinks_status_type: 'live', limit: 100, order_by: ['rank,desc'] });
      var backlinkItems = backlinksRes?.tasks?.[0]?.result?.[0]?.items || [];
      if (backlinkItems.length > 0) renderIndividualBacklinks(backlinkItems);
    } catch(e) {
      console.warn('Individual backlinks data not available:', e.message);
    }

    // Anchor text breakdown — top 50
    try {
      var anchorsRes = await SEO.dfs('backlinks/anchors/live', { target: domain, backlinks_status_type: 'live', limit: 50, order_by: ['backlinks,desc'] });
      var anchorItems = anchorsRes?.tasks?.[0]?.result?.[0]?.items || [];
      if (anchorItems.length > 0) renderAnchorTextBreakdown(anchorItems);
    } catch(e) {
      console.warn('Anchor text data not available:', e.message);
    }

    var ac = SEO.getActionCost();
    showToast('Backlinks refreshed — ' + ac.calls + ' calls, cost: ' + SEO.fmtCost(ac.cost), 'success', 6000);
    loadBacklinksHistory();
  } catch (e) {
    showToast('Backlink analysis failed: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Check Backlinks'; }
  }
}

function renderAnchorTextBreakdown(items) {
  var container = document.getElementById('anchor-text-breakdown');
  var listEl = document.getElementById('anchor-text-list');
  if (!container || !listEl) return;
  container.style.display = '';
  var maxBl = items[0]?.backlinks || 1;
  var html = '';
  items.forEach(function(item) {
    var pct = Math.round((item.backlinks / maxBl) * 100);
    html += '<div class="flex items-center gap-3 py-2 border-b border-[#424754]/10 last:border-0">'
      + '<div class="flex-1 min-w-0">'
      + '<div class="text-xs text-on-surface font-medium truncate">' + escHtml(item.anchor || '(empty)') + '</div>'
      + '<div class="text-[10px] text-on-surface-variant mt-0.5">' + fmtNum(item.backlinks || 0) + ' backlinks / ' + fmtNum(item.referring_domains || 0) + ' domains</div>'
      + '</div>'
      + '<div class="w-24 md:w-32 h-2 bg-surface-container-highest rounded-full overflow-hidden">'
      + '<div class="h-full rounded-full bg-primary/70" style="width:' + pct + '%"></div></div>'
      + '</div>';
  });
  listEl.innerHTML = html || '<div class="text-xs text-on-surface-variant text-center py-4">No anchor text data</div>';
}

/**
 * Wire backlinks refresh button
 */
function wireBacklinksControls() {
  var checkBtn = document.querySelector('#view-backlinks button');
  if (checkBtn && checkBtn.textContent.trim().indexOf('Check Backlinks') !== -1) {
    checkBtn.addEventListener('click', function(e) {
      e.preventDefault();
      refreshBacklinks(this);
    });
  }
}

/* =======================================================
   INDIVIDUAL BACKLINKS — backlinks/backlinks/live
   Shows actual linking URLs, not just domains
   ======================================================= */

var _blIndividualAll = [];
var _blIndividualPage = 0;
var _blIndividualPerPage = 20;

function renderIndividualBacklinks(items) {
  _blIndividualAll = items || [];
  _blIndividualPage = 0;
  _renderBlIndividualPage();
}

async function fetchIndividualBacklinks(btn) {
  var domain = SEO.activeProject;
  if (!domain) { showToast('Select a project first', 'warning'); return; }
  if (!checkBalanceWarning(0.03)) return;
  if (_debounceTimers['fetchIndBacklinks']) return;
  _debounceTimers['fetchIndBacklinks'] = true;
  setTimeout(function() { _debounceTimers['fetchIndBacklinks'] = false; }, 3000);

  if (btn) { btn.disabled = true; btn.textContent = 'Loading...'; }
  SEO.startAction();

  try {
    var res = await SEO.dfs('backlinks/backlinks/live', {
      target: domain,
      backlinks_status_type: 'live',
      limit: 100,
      order_by: ['rank,desc']
    });
    var items = res?.tasks?.[0]?.result?.[0]?.items || [];
    if (items.length > 0) {
      _blIndividualAll = items;
      _blIndividualPage = 0;
      _renderBlIndividualPage();
    } else {
      var tbody = document.getElementById('bl-individual-body');
      if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="padding:40px;text-align:center;color:#8c909f;font-size:13px">No individual backlink data found. This endpoint may require the $100/mo Backlinks package.</td></tr>';
    }
    var ac = SEO.getActionCost();
    showToast('Loaded ' + items.length + ' individual backlinks — cost: ' + SEO.fmtCost(ac.cost), 'success');
  } catch(e) {
    showToast('Individual backlinks failed: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Fetch Links (~$0.02)'; }
  }
}

function _renderBlIndividualPage() {
  var tbody = document.getElementById('bl-individual-body');
  if (!tbody) return;
  var start = _blIndividualPage * _blIndividualPerPage;
  var pageItems = _blIndividualAll.slice(start, start + _blIndividualPerPage);
  var html = '';

  pageItems.forEach(function(item) {
    var fromUrl = item.url_from || '';
    var toUrl = item.url_to || '';
    var anchor = item.anchor || '(empty)';
    var isDofollow = !item.dofollow ? true : item.dofollow;
    if (item.is_nofollow) isDofollow = false;
    var typeLabel = isDofollow ? 'Dofollow' : 'Nofollow';
    var typeColor = isDofollow ? '#4ae176' : '#ffb3ad';
    var dr = item.domain_from_rank || item.rank || '--';
    var firstSeen = item.first_seen ? new Date(item.first_seen).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '--';

    // Shorten URLs for display
    var fromDisplay = fromUrl.replace(/^https?:\/\//, '').replace(/^www\./, '');
    if (fromDisplay.length > 50) fromDisplay = fromDisplay.substring(0, 47) + '...';
    var toDisplay = toUrl.replace(/^https?:\/\//, '').replace(/^www\./, '');
    if (toDisplay.length > 35) toDisplay = toDisplay.substring(0, 32) + '...';
    var anchorDisplay = anchor.length > 30 ? anchor.substring(0, 27) + '...' : anchor;

    html += '<tr class="border-b border-[#424754]/10 hover:bg-[#1f1f25]/50">'
      + '<td class="px-4 md:px-6 py-3"><a href="' + escHtml(fromUrl) + '" target="_blank" rel="noopener" class="text-xs text-[#adc6ff] hover:underline">' + escHtml(fromDisplay) + '</a></td>'
      + '<td class="px-4 py-3 text-xs text-[#8c909f] hidden md:table-cell">' + escHtml(toDisplay) + '</td>'
      + '<td class="px-4 py-3 text-xs text-[#e4e1e9] font-medium">' + escHtml(anchorDisplay) + '</td>'
      + '<td class="px-4 py-3"><span class="text-[10px] font-bold px-2 py-0.5 rounded border" style="background:' + typeColor + '15;color:' + typeColor + ';border-color:' + typeColor + '30">' + typeLabel + '</span></td>'
      + '<td class="px-4 py-3 text-xs text-[#adc6ff] font-bold hidden md:table-cell" style="font-variant-numeric:tabular-nums">' + dr + '</td>'
      + '<td class="px-4 py-3 text-xs text-[#8c909f] hidden md:table-cell">' + firstSeen + '</td>'
      + '</tr>';
  });

  tbody.innerHTML = html || '<tr><td colspan="6" style="padding:40px;text-align:center;color:#8c909f">No backlinks found</td></tr>';

  // Pagination
  var total = _blIndividualAll.length;
  var totalPages = Math.ceil(total / _blIndividualPerPage);
  var pagEl = document.getElementById('bl-individual-pagination');
  if (!pagEl) return;
  if (totalPages <= 1) { pagEl.innerHTML = ''; return; }
  var showing = Math.min(start + _blIndividualPerPage, total);
  pagEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 20px;border-top:1px solid rgba(66,71,84,0.15)">'
    + '<span style="font-size:11px;color:#8c909f">Showing ' + (start + 1) + '-' + showing + ' of ' + total + ' backlinks</span>'
    + '<div style="display:flex;gap:8px">'
    + '<button onclick="_blIndividualPage--;_renderBlIndividualPage()" style="padding:6px 14px;font-size:11px;font-weight:600;border-radius:6px;border:1px solid rgba(66,71,84,0.3);background:transparent;color:#adc6ff;cursor:pointer' + (_blIndividualPage === 0 ? ';opacity:0.3;pointer-events:none' : '') + '">Prev</button>'
    + '<button onclick="_blIndividualPage++;_renderBlIndividualPage()" style="padding:6px 14px;font-size:11px;font-weight:600;border-radius:6px;border:1px solid rgba(66,71,84,0.3);background:transparent;color:#adc6ff;cursor:pointer' + (_blIndividualPage >= totalPages - 1 ? ';opacity:0.3;pointer-events:none' : '') + '">Next</button>'
    + '</div></div>';
}

/* =======================================================
   BACKLINK COMPETITORS — backlinks/competitors/live
   Shows domains competing for same backlinks (link building opportunities)
   ======================================================= */

async function fetchBacklinkCompetitors(btn) {
  var domain = SEO.activeProject;
  if (!domain) { showToast('Select a project first', 'warning'); return; }
  if (!checkBalanceWarning(0.03)) return;
  if (_debounceTimers['fetchBlComp']) return;
  _debounceTimers['fetchBlComp'] = true;
  setTimeout(function() { _debounceTimers['fetchBlComp'] = false; }, 3000);

  if (btn) { btn.disabled = true; btn.textContent = 'Loading...'; }
  SEO.startAction();

  try {
    var res = await SEO.dfs('backlinks/competitors/live', {
      target: domain,
      limit: 20
    });
    var items = res?.tasks?.[0]?.result?.[0]?.items || [];
    renderBacklinkCompetitors(items, domain);
    var ac = SEO.getActionCost();
    showToast('Found ' + items.length + ' backlink competitors — cost: ' + SEO.fmtCost(ac.cost), 'success');
  } catch(e) {
    showToast('Backlink competitors failed: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Find Link Opportunities (~$0.02)'; }
  }
}

function renderBacklinkCompetitors(items, ownDomain) {
  var container = document.getElementById('bl-competitors-body');
  if (!container) return;

  if (!items || items.length === 0) {
    container.innerHTML = '<div style="padding:32px;text-align:center;color:#8c909f;font-size:13px">No backlink competitors found.</div>';
    return;
  }

  // Filter out own domain
  var filtered = items.filter(function(item) {
    var d = (item.target || '').replace(/^www\./, '');
    return d !== (ownDomain || '').replace(/^www\./, '');
  });

  var html = '<table style="width:100%;border-collapse:collapse"><thead>'
    + '<tr style="background:rgba(30,30,38,0.5)">'
    + '<th style="padding:10px 16px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#8c909f;font-weight:600">Competitor Domain</th>'
    + '<th style="padding:10px 16px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#8c909f;font-weight:600">Their Backlinks</th>'
    + '<th style="padding:10px 16px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#8c909f;font-weight:600">Common</th>'
    + '<th style="padding:10px 16px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#8c909f;font-weight:600;color:#4ae176">Opportunities</th>'
    + '<th style="padding:10px 16px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#8c909f;font-weight:600" class="hidden md:table-cell">Their Rank</th>'
    + '</tr></thead><tbody>';

  filtered.slice(0, 15).forEach(function(item) {
    var compDomain = item.target || '';
    var compBacklinks = item.backlinks || 0;
    var commonBacklinks = item.intersections || item.common_refdomains || 0;
    var opportunities = Math.max(0, compBacklinks - commonBacklinks);
    var rank = item.rank || '--';

    html += '<tr style="border-bottom:1px solid rgba(66,71,84,0.08);transition:background 150ms" onmouseover="this.style.background=\'rgba(30,30,38,0.4)\'" onmouseout="this.style.background=\'none\'">'
      + '<td style="padding:10px 16px"><div style="display:flex;align-items:center;gap:8px">'
      + '<img src="https://www.google.com/s2/favicons?domain=' + encodeURIComponent(compDomain) + '&sz=16" width="14" height="14" style="border-radius:2px" onerror="this.style.display=\'none\'"/>'
      + '<span style="font-size:12px;font-weight:600;color:#e4e1e9">' + escHtml(compDomain) + '</span></div></td>'
      + '<td style="padding:10px 16px;text-align:right;font-size:12px;color:#8c909f;font-variant-numeric:tabular-nums">' + fmtNum(compBacklinks) + '</td>'
      + '<td style="padding:10px 16px;text-align:right;font-size:12px;color:#adc6ff;font-weight:600;font-variant-numeric:tabular-nums">' + fmtNum(commonBacklinks) + '</td>'
      + '<td style="padding:10px 16px;text-align:right;font-size:12px;color:#4ae176;font-weight:700;font-variant-numeric:tabular-nums">' + fmtNum(opportunities) + '</td>'
      + '<td style="padding:10px 16px;text-align:right;font-size:12px;color:#adc6ff;font-variant-numeric:tabular-nums" class="hidden md:table-cell">' + rank + '</td>'
      + '</tr>';
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

/* =======================================================
   BACKLINKS HISTORY PANEL
   Shows all past backlink analyses with key metrics
   ======================================================= */
async function loadBacklinksHistory() {
  var container = document.getElementById('bl-history-panel');
  if (!container) return;
  var domain = SEO.activeProject;
  if (!domain) return;

  try {
    var hist = await SEO.history({ tool: 'backlinks', target: domain, limit: 30 });
    var queries = hist?.queries || [];
    if (queries.length === 0) { container.innerHTML = ''; return; }

    var html = '<div style="background:#131318;border:1px solid rgba(66,71,84,0.2);border-radius:12px;overflow:hidden">'
      + '<div style="padding:16px 20px;border-bottom:1px solid rgba(66,71,84,0.1);display:flex;align-items:center">'
      + '<h3 style="font-size:14px;font-weight:700;color:#e4e1e9">Backlink Analysis History</h3>'
      + '<span style="margin-left:auto;font-size:10px;color:#64687a;text-transform:uppercase;letter-spacing:0.05em">' + queries.length + ' checks</span>'
      + '</div>'
      + '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse"><thead>'
      + '<tr style="background:rgba(30,30,38,0.5)">'
      + '<th style="padding:10px 16px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#8c909f;font-weight:600">Date</th>'
      + '<th style="padding:10px 16px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#8c909f;font-weight:600">Endpoint</th>'
      + '<th style="padding:10px 16px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#8c909f;font-weight:600">Backlinks</th>'
      + '<th style="padding:10px 16px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#8c909f;font-weight:600">Ref Domains</th>'
      + '<th style="padding:10px 16px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#8c909f;font-weight:600">Rank</th>'
      + '<th style="padding:10px 16px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#8c909f;font-weight:600">Cost</th>'
      + '</tr></thead><tbody>';

    queries.forEach(function(q) {
      var date = new Date(q.created_at);
      var dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      var timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      var endpoint = (q.endpoint || '').split('/').pop() || 'backlinks';
      var s = q.summary || {};
      var bl = s.backlinks || s.total_backlinks || q.result_count || '--';
      var rd = s.referring_domains || '--';
      var rank = s.rank || s.domain_rank || '--';
      var cost = parseFloat(q.cost) || 0;

      html += '<tr style="border-bottom:1px solid rgba(66,71,84,0.08);transition:background 150ms" onmouseover="this.style.background=\'rgba(30,30,38,0.5)\'" onmouseout="this.style.background=\'none\'">'
        + '<td style="padding:10px 16px;font-size:12px;color:#8c909f">' + dateStr + ' ' + timeStr + '</td>'
        + '<td style="padding:10px 16px"><span style="font-size:10px;font-weight:600;color:#adc6ff;background:rgba(173,198,255,0.08);padding:2px 8px;border-radius:4px">' + escHtml(endpoint) + '</span></td>'
        + '<td style="padding:10px 16px;text-align:right;font-size:12px;color:#e4e1e9;font-weight:700;font-variant-numeric:tabular-nums">' + (typeof bl === 'number' ? fmtNum(bl) : bl) + '</td>'
        + '<td style="padding:10px 16px;text-align:right;font-size:12px;color:#8c909f;font-variant-numeric:tabular-nums">' + (typeof rd === 'number' ? fmtNum(rd) : rd) + '</td>'
        + '<td style="padding:10px 16px;text-align:right;font-size:12px;color:#adc6ff;font-weight:600;font-variant-numeric:tabular-nums">' + (typeof rank === 'number' ? fmtNum(rank) : rank) + '</td>'
        + '<td style="padding:10px 16px;text-align:right;font-size:11px;color:#64687a;font-variant-numeric:tabular-nums">' + (cost > 0 ? '$' + cost.toFixed(3) : 'cached') + '</td>'
        + '</tr>';
    });

    html += '</tbody></table></div></div>';
    container.innerHTML = html;
  } catch(e) {
    console.warn('Backlinks history load error:', e);
  }
}
// SEO Platform — Brand & Content Intelligence Module
'use strict';

/* =======================================================
   ACCUMULATED BRAND MENTIONS (web + AI)
   Each scan adds NEW items. Full list persisted across searches.
   ======================================================= */

var _avisMentions = []; // accumulated web mentions, deduplicated
var _avisPage = 0;
var _avisPageSize = 30;
var _avisSortCol = 'date';
var _avisSortAsc = false;
var _avisFilterText = '';

var _aiLlmMentions = []; // AI model mentions from ai_optimization subscription

/**
 * loadAIVisibility - on view open, load all accumulated data (FREE)
 */
async function loadAIVisibility() {
  showViewLoading('ai-visibility');
  var domain = SEO.activeProject;
  if (!domain) { hideViewLoading('ai-visibility'); return; }

  try {
    // --- Load AI Model Mentions from history (FREE) ---
    var aiHist = await SEO.history({ tool: 'ai_visibility', target: domain, limit: 5 }).catch(function() { return {}; });
    var aiQueries = aiHist?.queries || [];
    _aiLlmMentions = [];
    var aiSeen = {};

    for (var a = 0; a < Math.min(aiQueries.length, 3); a++) {
      if (!aiQueries[a]?.id) continue;
      try {
        var aiFull = await SEO.historyById(aiQueries[a].id);
        var aiItems = aiFull?.items || [];
        aiItems.forEach(function(item) {
          var question = item.question || item.prompt || item.keyword || '';
          var key = (item.platform || '') + '|' + question.slice(0, 50);
          if (!key || aiSeen[key]) return;
          aiSeen[key] = true;
          // Extract cited sources
          var sources = (item.sources || []).map(function(s) { return s.url || s.domain || s; }).filter(Boolean);
          _aiLlmMentions.push({
            platform: item.platform || item.se || 'unknown',
            prompt: question,
            text: item.answer || item.text || item.description || '',
            url: sources[0] || '',
            domain: sources[0] ? sources[0].replace(/^https?:\/\//, '').replace(/\/.*$/, '') : '',
            date: item.last_response_at || item.first_response_at || item.date || '',
            sources: sources,
            ai_search_volume: item.ai_search_volume || 0
          });
        });
      } catch(e) { /* skip */ }
    }
    if (_aiLlmMentions.length > 0) {
      _renderAiLlmMentions();
      _updateAiLlmKPIs();
    }
    if (aiQueries.length > 0 && aiQueries[0]?.created_at) {
      setHtml('ai-llm-last-scan', new Date(aiQueries[0].created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    }

    // --- Load Web Mentions from history (FREE) ---
    var hist = await SEO.history({ tool: 'content_analysis_search', target: getProjectBrand(), limit: 20 }).catch(function() { return {}; });
    var queries = hist?.queries || [];

    var hist2 = await SEO.history({ tool: 'content_analysis_search', target: domain, limit: 20 }).catch(function() { return {}; });
    queries = queries.concat(hist2?.queries || []);

    var seen = {};
    _avisMentions = [];

    for (var i = 0; i < Math.min(queries.length, 5); i++) {
      if (!queries[i]?.id) continue;
      try {
        var full = await SEO.historyById(queries[i].id);
        var items = full?.items || [];
        items.forEach(function(item) {
          var key = (item.url || item.title || '') + '|' + (item.domain || '');
          if (!key || seen[key]) return;
          seen[key] = true;
          _avisMentions.push(_normalizeItem(item));
        });
      } catch(e) { /* skip */ }
    }

    // Load sentiment data
    var sentHist = await SEO.history({ tool: 'content_analysis_summary', target: domain, limit: 1 }).catch(function() { return {}; });
    if (sentHist?.queries?.length > 0) {
      renderAIVisibilitySentiment(sentHist.queries[0].summary || {});
    }

    // Render what we have
    if (_avisMentions.length > 0) {
      renderAvisMentionsTable();
      _updateAvisKPIs();
      _renderAvisSources();
    }
  } catch (e) {
    console.warn('AI Visibility load error:', e);
  }
  hideViewLoading('ai-visibility');
}

function _normalizeItem(item) {
  return {
    title: item.title || item.main_title || '',
    url: item.url || item.page_url || '',
    domain: item.domain || '',
    snippet: item.description || item.text || item.snippet || item.content || '',
    date: item.date_published || item.date || item.last_response_at || '',
    sentiment: item.connotation_type || item.sentiment || 'neutral',
    language: item.language || '',
    type: item.content_type || item.type || 'web'
  };
}

/**
 * refreshAIVisibility - scan for new mentions, merge into accumulated list
 */
async function refreshAIVisibility(btn) {
  var domain = SEO.activeProject;
  if (!domain) { showToast('Select a project first', 'warning'); return; }
  if (!checkBalanceWarning(0.07)) return;
  if (_debounceTimers['refreshAIVis']) return;
  _debounceTimers['refreshAIVis'] = true;
  setTimeout(function() { _debounceTimers['refreshAIVis'] = false; }, 3000);

  if (btn) { btn.disabled = true; btn.textContent = 'Scanning...'; }
  SEO.startAction();

  try {
    var brand = getProjectBrand();
    // Use domain as primary keyword — pages mentioning "seattleroofingco.com" are
    // definitively about this business. Brand names (e.g. "The Seattle Company") are
    // often too generic and return irrelevant results.
    var searchKeyword = domain;
    var [searchRes, brandSearchRes, summaryRes, sentimentRes] = await Promise.all([
      SEO.dfs('content_analysis/search/live', {
        keyword: searchKeyword,
        search_mode: 'as_is',
        limit: 100
      }).catch(function(e) { console.warn('Content search (domain):', e.message); return null; }),
      // Secondary brand search — title-only to reduce noise
      (brand && brand !== searchKeyword && brand.split(' ').length >= 2) ?
        SEO.dfs('content_analysis/search/live', {
          keyword: brand,
          search_mode: 'as_is',
          keyword_fields: { title: 1, main_title: 1 },
          internal_list_limit: 3,
          limit: 50
        }).catch(function(e) { console.warn('Content search (brand):', e.message); return null; })
      : Promise.resolve(null),
      SEO.dfs('content_analysis/summary/live', {
        keyword: searchKeyword
      }).catch(function(e) { console.warn('Content summary:', e.message); return null; }),
      SEO.dfs('content_analysis/sentiment_analysis/live', {
        keyword: searchKeyword
      }).catch(function(e) { console.warn('Sentiment:', e.message); return null; })
    ]);

    var newCount = 0;

    // Merge search results into accumulated list (domain search + brand search)
    var allSearchItems = (searchRes?.tasks?.[0]?.result?.[0]?.items || [])
      .concat(brandSearchRes?.tasks?.[0]?.result?.[0]?.items || []);

    if (allSearchItems.length > 0) {
      var existing = {};
      _avisMentions.forEach(function(m) { existing[(m.url || m.title) + '|' + m.domain] = true; });

      allSearchItems.forEach(function(item) {
        var norm = _normalizeItem(item);
        var key = (norm.url || norm.title) + '|' + norm.domain;
        if (!key || existing[key]) return;
        existing[key] = true;
        _avisMentions.push(norm);
        newCount++;
      });
    }

    // Sentiment
    if (summaryRes) {
      var sumResult = summaryRes?.tasks?.[0]?.result?.[0];
      if (sumResult) renderAIVisibilitySentiment(sumResult);
    }
    if (sentimentRes) {
      var sentResult = sentimentRes?.tasks?.[0]?.result?.[0];
      if (sentResult) renderAIVisibilitySentimentBreakdown(sentResult);
    }

    renderAvisMentionsTable();
    _updateAvisKPIs();
    _renderAvisSources();

    var ac = SEO.getActionCost();
    showToast('Found ' + newCount + ' new mentions (' + _avisMentions.length + ' total) — cost: ' + SEO.fmtCost(ac.cost), 'success', 6000);

  } catch (e) {
    showToast('Scan failed: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Scan for Mentions (~$0.07)'; }
  }
}

/* =======================================================
   AI MODEL MENTIONS — ai_optimization subscription ($100/mo)
   Uses: ai_optimization/llm_mentions/search/live
   Request format: target: [{domain: "example.com"}]
   ======================================================= */

/**
 * refreshAIModelMentions - scan AI models for brand mentions
 * Costs ~$0.10 per call — cache aggressively
 */
async function refreshAIModelMentions(btn) {
  var domain = SEO.activeProject;
  if (!domain) { showToast('Select a project first', 'warning'); return; }
  if (!checkBalanceWarning(0.12)) return;
  if (_debounceTimers['refreshAILlm']) return;
  _debounceTimers['refreshAILlm'] = true;
  setTimeout(function() { _debounceTimers['refreshAILlm'] = false; }, 5000);

  if (btn) { btn.disabled = true; btn.textContent = 'Scanning AI models...'; }
  SEO.startAction();

  try {
    var info = getProjectInfo();
    // Run LLM mentions search + top domains in parallel
    var [llmRes, topDomainsRes] = await Promise.all([
      // ai_optimization/llm_mentions/search/live — correct format: target is array of objects
      SEO.dfs('ai_optimization/llm_mentions/search/live', {
        target: [{ domain: domain }],
        location_name: info.location || 'United States',
        language_name: info.language || 'English',
        limit: 50
      }).catch(function(e) { console.warn('LLM mentions search:', e.message); return null; }),
      // ai_optimization/llm_mentions/top_domains/live — top citing domains
      SEO.dfs('ai_optimization/llm_mentions/top_domains/live', {
        target: [{ domain: domain }],
        location_name: info.location || 'United States',
        language_name: info.language || 'English'
      }).catch(function(e) { console.warn('LLM top domains:', e.message); return null; })
    ]);

    // Render top domains if we got data
    if (topDomainsRes) {
      var topDomItems = topDomainsRes?.tasks?.[0]?.result?.[0]?.items || [];
      _renderTopAiDomains(topDomItems);
    }

    var newCount = 0;

    if (llmRes) {
      var llmItems = llmRes?.tasks?.[0]?.result?.[0]?.items || [];
      var totalCount = llmRes?.tasks?.[0]?.result?.[0]?.total_count || 0;
      var existing = {};
      _aiLlmMentions.forEach(function(m) {
        existing[(m.url || m.domain) + '|' + (m.platform || '') + '|' + (m.prompt || '').slice(0, 50)] = true;
      });

      llmItems.forEach(function(item) {
        var question = item.question || item.prompt || item.keyword || '';
        var sources = (item.sources || []).map(function(s) { return s.url || s.domain || s; }).filter(Boolean);
        var mention = {
          platform: item.platform || item.se || 'unknown',
          prompt: question,
          text: item.answer || item.text || item.description || '',
          url: sources[0] || '',
          domain: sources[0] ? sources[0].replace(/^https?:\/\//, '').replace(/\/.*$/, '') : '',
          date: item.last_response_at || item.first_response_at || item.date || '',
          sources: sources,
          ai_search_volume: item.ai_search_volume || 0
        };
        var key = mention.platform + '|' + mention.prompt.slice(0, 50);
        if (!existing[key]) {
          existing[key] = true;
          _aiLlmMentions.push(mention);
          newCount++;
        }
      });

      _renderAiLlmMentions();
      _updateAiLlmKPIs();
      setHtml('ai-llm-last-scan', new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));

      var ac = SEO.getActionCost();
      if (totalCount === 0 && _aiLlmMentions.length === 0) {
        showToast('No AI model mentions found for ' + domain + ' yet. This is normal for local businesses — track over time. Cost: ' + SEO.fmtCost(ac.cost), 'info', 8000);
      } else {
        showToast('Found ' + newCount + ' new AI mentions (' + _aiLlmMentions.length + ' total, ' + totalCount + ' in DataForSEO index) — cost: ' + SEO.fmtCost(ac.cost), 'success', 6000);
      }
    }
  } catch (e) {
    showToast('AI model scan failed: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Scan AI Models (~$0.10)'; }
  }
}

function _updateAiLlmKPIs() {
  setHtml('ai-llm-total', fmtNum(_aiLlmMentions.length));
  var platforms = {};
  var allSources = {};
  _aiLlmMentions.forEach(function(m) {
    if (m.platform) platforms[m.platform] = true;
    // Count unique source domains across all mentions
    (m.sources || []).forEach(function(s) {
      var d = (typeof s === 'string' ? s : (s.url || s.domain || '')).replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
      if (d) allSources[d] = true;
    });
  });
  setHtml('ai-llm-platforms', Object.keys(platforms).length || '0');
  setHtml('ai-llm-top-domains', Object.keys(allSources).length || '0');
}

function _renderAiLlmMentions() {
  var container = document.getElementById('ai-llm-mentions-container');
  if (!container) return;

  if (_aiLlmMentions.length === 0) {
    container.innerHTML = '<div style="padding:30px;text-align:center;color:#8c909f;font-size:13px">'
      + 'No AI model mentions found yet.<br/>'
      + '<span class="text-[10px]">Small local businesses may have 0 AI mentions — this is normal. Track over time to see growth.</span>'
      + '</div>';
    return;
  }

  // Group by platform
  var byPlatform = {};
  _aiLlmMentions.forEach(function(m) {
    var p = m.platform || 'unknown';
    if (!byPlatform[p]) byPlatform[p] = [];
    byPlatform[p].push(m);
  });

  var platformIcons = {
    google: 'search', chatgpt: 'chat', openai: 'chat',
    claude: 'psychology', anthropic: 'psychology',
    gemini: 'auto_awesome', perplexity: 'explore',
    bing: 'language', copilot: 'computer'
  };
  var platformLabels = {
    google: 'Google AI', chatgpt: 'ChatGPT', openai: 'OpenAI',
    claude: 'Claude', anthropic: 'Anthropic',
    gemini: 'Gemini', perplexity: 'Perplexity',
    bing: 'Bing AI', copilot: 'Copilot'
  };

  var html = '<div style="display:flex;flex-direction:column;gap:12px">';

  Object.keys(byPlatform).forEach(function(platform) {
    var mentions = byPlatform[platform];
    var icon = platformIcons[platform.toLowerCase()] || 'smart_toy';
    var label = platformLabels[platform.toLowerCase()] || platform.charAt(0).toUpperCase() + platform.slice(1);

    html += '<div style="background:#1a1a22;border-radius:10px;overflow:hidden">'
      + '<div style="padding:12px 16px;display:flex;align-items:center;gap:8px;border-bottom:1px solid rgba(66,71,84,0.15)">'
      + '<span class="material-symbols-outlined" style="font-size:16px;color:#adc6ff">' + icon + '</span>'
      + '<span style="font-size:12px;font-weight:700;color:#e4e1e9">' + escHtml(label) + '</span>'
      + '<span style="font-size:10px;font-weight:600;color:#8c909f;background:rgba(66,71,84,0.3);padding:1px 8px;border-radius:4px">' + mentions.length + ' mention' + (mentions.length === 1 ? '' : 's') + '</span>'
      + '</div>';

    mentions.forEach(function(m, idx) {
      var expandId = 'ai-llm-exp-' + platform + '-' + idx;
      var promptPreview = m.prompt ? escHtml(m.prompt.length > 80 ? m.prompt.slice(0, 80) + '...' : m.prompt) : '<span style="color:#64687a">Unknown query</span>';
      var dateStr = m.date ? new Date(m.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '--';
      var volBadge = m.ai_search_volume ? '<span style="font-size:9px;font-weight:600;color:#adc6ff;background:rgba(173,198,255,0.1);padding:1px 6px;border-radius:4px;margin-left:6px">' + fmtNum(m.ai_search_volume) + ' AI vol</span>' : '';

      // Clean answer text — strip markdown link syntax for display
      var answerText = (m.text || '').replace(/\[\[\d+\]\]\([^)]+\)/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
      var answerPreview = answerText.length > 400 ? answerText.slice(0, 400) + '...' : answerText;

      // Build sources list
      var sourcesHtml = '';
      if (m.sources && m.sources.length > 0) {
        sourcesHtml = '<div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(66,71,84,0.15)">'
          + '<div style="font-size:10px;font-weight:600;color:#8c909f;margin-bottom:4px">Cited Sources (' + m.sources.length + '):</div>';
        m.sources.slice(0, 5).forEach(function(src) {
          var srcUrl = typeof src === 'string' ? src : (src.url || src.domain || '');
          var srcDisplay = srcUrl.replace(/^https?:\/\//, '').replace(/^www\./, '');
          if (srcDisplay.length > 60) srcDisplay = srcDisplay.substring(0, 57) + '...';
          sourcesHtml += '<a href="' + escHtml(srcUrl) + '" target="_blank" rel="noopener" style="display:block;font-size:10px;color:#3b82f6;text-decoration:none;padding:2px 0;word-break:break-all">' + escHtml(srcDisplay) + '</a>';
        });
        if (m.sources.length > 5) sourcesHtml += '<div style="font-size:10px;color:#64687a">+' + (m.sources.length - 5) + ' more sources</div>';
        sourcesHtml += '</div>';
      }

      html += '<div style="border-bottom:1px solid rgba(66,71,84,0.08)">'
        + '<div style="padding:10px 16px;cursor:pointer;display:flex;align-items:center;gap:8px" onclick="toggleAiLlmRow(\'' + expandId + '\',this)" onmouseover="this.style.background=\'rgba(30,30,38,0.4)\'" onmouseout="this.style.background=\'none\'">'
        + '<span class="material-symbols-outlined ai-llm-chevron" style="font-size:14px;color:#64687a;transition:transform 200ms;flex-shrink:0">chevron_right</span>'
        + '<div style="flex:1;min-width:0">'
        + '<div style="font-size:12px;font-weight:600;color:#e4e1e9">"' + promptPreview + '"' + volBadge + '</div>'
        + '</div>'
        + '<span style="font-size:10px;color:#8c909f;flex-shrink:0">' + dateStr + '</span>'
        + '</div>'
        + '<div id="' + expandId + '" style="display:none;padding:0 16px 12px 38px">'
        + '<div style="padding:12px 16px;background:#131318;border-radius:8px;border-left:3px solid #3b82f6">'
        + (answerPreview ? '<div style="font-size:12px;color:#c2c6d6;line-height:1.7;margin-bottom:8px">' + escHtml(answerPreview) + '</div>' : '<div style="font-size:12px;color:#64687a;margin-bottom:8px">Response not captured</div>')
        + sourcesHtml
        + '</div></div>'
        + '</div>';
    });

    html += '</div>';
  });

  html += '</div>';
  container.innerHTML = html;
}

function toggleAiLlmRow(expandId, headerEl) {
  var expandEl = document.getElementById(expandId);
  if (!expandEl) return;
  var isOpen = expandEl.style.display !== 'none';
  expandEl.style.display = isOpen ? 'none' : '';
  var chevron = headerEl.querySelector('.ai-llm-chevron');
  if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(90deg)';
}

/* =======================================================
   WEB MENTIONS TABLE — full list, sortable, paginated
   ======================================================= */

function sortAvisTable(col) {
  if (_avisSortCol === col) _avisSortAsc = !_avisSortAsc;
  else { _avisSortCol = col; _avisSortAsc = (col === 'title' || col === 'domain'); }
  _avisPage = 0;
  renderAvisMentionsTable();
}

function avisTablePage(dir) {
  var total = _getFilteredAvis().length;
  var maxPage = Math.max(0, Math.ceil(total / _avisPageSize) - 1);
  _avisPage = Math.max(0, Math.min(maxPage, _avisPage + dir));
  renderAvisMentionsTable();
}

function filterAvisMentions(q) {
  _avisFilterText = (q || '').trim().toLowerCase();
  _avisPage = 0;
  renderAvisMentionsTable();
}

function _getFilteredAvis() {
  var data = _avisMentions;
  if (_avisFilterText) {
    data = data.filter(function(m) {
      return (m.title + ' ' + m.domain + ' ' + m.snippet).toLowerCase().indexOf(_avisFilterText) !== -1;
    });
  }
  return data;
}

function _sortArrowAvis(col) {
  if (_avisSortCol !== col) return '';
  return ' ' + (_avisSortAsc ? '&#9650;' : '&#9660;');
}

function renderAvisMentionsTable() {
  var container = document.getElementById('avis-mentions-table');
  if (!container) return;

  var data = _getFilteredAvis().slice();

  // Sort
  var col = _avisSortCol, asc = _avisSortAsc;
  data.sort(function(a, b) {
    var va = a[col] || '', vb = b[col] || '';
    if (typeof va === 'string') {
      va = va.toLowerCase(); vb = vb.toLowerCase();
      return asc ? va.localeCompare(vb) : vb.localeCompare(va);
    }
    return asc ? va - vb : vb - va;
  });

  setHtml('avis-table-count', data.length + ' mentions');

  if (data.length === 0) {
    container.innerHTML = '<div style="padding:40px;text-align:center;color:#8c909f;font-size:13px">No mentions found yet. Run a scan.</div>';
    var pagEl = document.getElementById('avis-mentions-pagination');
    if (pagEl) pagEl.innerHTML = '';
    return;
  }

  var start = _avisPage * _avisPageSize;
  var shown = data.slice(start, start + _avisPageSize);
  var sentColors = { positive: '#4ae176', negative: '#ffb3ad', neutral: '#8c909f' };

  var th = 'padding:8px 16px;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#8c909f;font-weight:600;cursor:pointer;user-select:none;white-space:nowrap';
  var html = '<table style="width:100%;border-collapse:collapse"><thead><tr style="background:rgba(30,30,38,0.5)">'
    + '<th style="' + th + ';text-align:left" onclick="sortAvisTable(\'title\')">Title' + _sortArrowAvis('title') + '</th>'
    + '<th style="' + th + ';text-align:left" onclick="sortAvisTable(\'domain\')">Source' + _sortArrowAvis('domain') + '</th>'
    + '<th style="' + th + ';text-align:center" onclick="sortAvisTable(\'sentiment\')">Sentiment' + _sortArrowAvis('sentiment') + '</th>'
    + '<th style="' + th + ';text-align:left" onclick="sortAvisTable(\'date\')">Date' + _sortArrowAvis('date') + '</th>'
    + '</tr></thead><tbody>';

  shown.forEach(function(m) {
    var dateStr = m.date ? new Date(m.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '--';
    var sentCol = sentColors[m.sentiment] || '#8c909f';
    var sentLabel = (m.sentiment || 'neutral').charAt(0).toUpperCase() + (m.sentiment || 'neutral').slice(1);
    var title = m.title || m.domain || '(untitled)';
    var snippet = m.snippet || '';
    var urlAttr = m.url ? ' onclick="window.open(\'' + m.url.replace(/'/g, "\\'") + '\',\'_blank\')" style="cursor:pointer"' : '';

    var rowId = 'avis-row-' + (start + shown.indexOf(m));
    var expandId = 'avis-expand-' + (start + shown.indexOf(m));

    html += '<tr style="border-bottom:1px solid rgba(66,71,84,0.08);transition:background 150ms;cursor:pointer" onmouseover="this.style.background=\'rgba(30,30,38,0.4)\'" onmouseout="this.style.background=\'none\'" onclick="toggleAvisRow(\'' + expandId + '\',this)">'
      + '<td style="padding:10px 16px"><div style="display:flex;align-items:center;gap:8px"><span class="material-symbols-outlined avis-chevron" style="font-size:16px;color:#64687a;transition:transform 200ms;flex-shrink:0">chevron_right</span>'
      + '<div style="font-size:13px;font-weight:600;color:#e4e1e9">' + escHtml(title) + '</div></div></td>'
      + '<td style="padding:10px 16px"><div style="display:flex;align-items:center;gap:6px">'
      + '<img src="https://www.google.com/s2/favicons?domain=' + encodeURIComponent(m.domain) + '&sz=16" width="14" height="14" style="border-radius:2px" onerror="this.style.display=\'none\'"/>'
      + '<span style="font-size:11px;color:#adc6ff;font-weight:500">' + escHtml(m.domain || '--') + '</span></div></td>'
      + '<td style="padding:10px 16px;text-align:center"><span style="font-size:9px;font-weight:700;padding:2px 8px;border-radius:4px;color:' + sentCol + ';background:' + sentCol + '15">' + sentLabel + '</span></td>'
      + '<td style="padding:10px 16px;font-size:11px;color:#8c909f;white-space:nowrap">' + dateStr + '</td>'
      + '</tr>'
      + '<tr id="' + expandId + '" style="display:none"><td colspan="4" style="padding:0 16px 16px 46px;background:rgba(20,20,26,0.5)">'
      + '<div style="padding:12px 16px;background:#1a1a22;border-radius:8px;border-left:3px solid #3b82f6">'
      + (snippet ? '<div style="font-size:12px;color:#c2c6d6;line-height:1.7;margin-bottom:10px">' + escHtml(snippet) + '</div>' : '<div style="font-size:12px;color:#64687a;margin-bottom:10px">No excerpt available</div>')
      + (m.url ? '<a href="' + escHtml(m.url) + '" target="_blank" rel="noopener" style="font-size:11px;color:#3b82f6;text-decoration:none;word-break:break-all">' + escHtml(m.url) + '</a>' : '')
      + '</div></td></tr>';
  });

  html += '</tbody></table>';
  container.innerHTML = html;

  // Pagination
  var pagEl = document.getElementById('avis-mentions-pagination');
  if (pagEl) {
    var totalPages = Math.ceil(data.length / _avisPageSize);
    if (totalPages <= 1) { pagEl.innerHTML = ''; return; }
    var end = Math.min(start + _avisPageSize, data.length);
    pagEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 20px;border-top:1px solid rgba(66,71,84,0.15)">'
      + '<span style="font-size:11px;color:#8c909f">Showing ' + (start + 1) + '-' + end + ' of ' + data.length + ' (page ' + (_avisPage + 1) + '/' + totalPages + ')</span>'
      + '<div style="display:flex;gap:8px">'
      + '<button onclick="avisTablePage(-1)" style="padding:6px 14px;font-size:11px;font-weight:600;border-radius:6px;border:1px solid rgba(66,71,84,0.3);background:transparent;color:#adc6ff;cursor:pointer' + (_avisPage === 0 ? ';opacity:0.3;pointer-events:none' : '') + '">Prev</button>'
      + '<button onclick="avisTablePage(1)" style="padding:6px 14px;font-size:11px;font-weight:600;border-radius:6px;border:1px solid rgba(66,71,84,0.3);background:transparent;color:#adc6ff;cursor:pointer' + (_avisPage >= totalPages - 1 ? ';opacity:0.3;pointer-events:none' : '') + '">Next</button>'
      + '</div></div>';
  }
}

/* =======================================================
   KPIs + SOURCES
   ======================================================= */

function _updateAvisKPIs() {
  setHtml('avis-total-mentions', fmtNum(_avisMentions.length));
  var pos = 0, neu = 0, neg = 0;
  _avisMentions.forEach(function(m) {
    if (m.sentiment === 'positive') pos++;
    else if (m.sentiment === 'negative') neg++;
    else neu++;
  });
  setHtml('avis-positive-count', fmtNum(pos));
  setHtml('avis-neutral-count', fmtNum(neu));
  setHtml('avis-negative-count', fmtNum(neg));
}

function _renderAvisSources() {
  var container = document.getElementById('avis-leading-sources');
  if (!container) return;
  var domainCounts = {};
  _avisMentions.forEach(function(m) {
    var d = m.domain;
    if (d) domainCounts[d] = (domainCounts[d] || 0) + 1;
  });
  var sources = Object.keys(domainCounts).map(function(d) { return { domain: d, count: domainCounts[d] }; });
  sources.sort(function(a, b) { return b.count - a.count; });

  if (sources.length === 0) {
    container.innerHTML = '<div class="text-xs text-on-surface-variant text-center py-4">No sources yet</div>';
    return;
  }

  var maxCount = sources[0].count || 1;
  var html = '<div style="display:flex;flex-direction:column;gap:8px">';
  sources.slice(0, 15).forEach(function(s) {
    var pct = Math.round(s.count / maxCount * 100);
    html += '<div style="display:flex;align-items:center;gap:10px">'
      + '<img src="https://www.google.com/s2/favicons?domain=' + encodeURIComponent(s.domain) + '&sz=16" width="14" height="14" style="border-radius:2px;flex-shrink:0" onerror="this.style.display=\'none\'"/>'
      + '<div style="flex:1;min-width:0">'
      + '<div style="display:flex;justify-content:space-between;margin-bottom:2px">'
      + '<span style="font-size:11px;font-weight:600;color:#e4e1e9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(s.domain) + '</span>'
      + '<span style="font-size:10px;font-weight:700;color:#adc6ff;flex-shrink:0;margin-left:8px;font-variant-numeric:tabular-nums">' + s.count + '</span></div>'
      + '<div style="width:100%;height:3px;background:rgba(30,30,38,0.6);border-radius:2px;overflow:hidden">'
      + '<div style="height:100%;width:' + pct + '%;background:#adc6ff;border-radius:2px"></div></div>'
      + '</div></div>';
  });
  html += '</div>';
  container.innerHTML = html;
}

/* =======================================================
   SENTIMENT
   ======================================================= */

function renderAIVisibilitySentiment(summaryData) {
  if (!summaryData) return;
  var totalMentions = summaryData.total_count || 0;

  if (summaryData.connotation_types) {
    var pos = summaryData.connotation_types.positive?.count || 0;
    var neu = summaryData.connotation_types.neutral?.count || 0;
    var neg = summaryData.connotation_types.negative?.count || 0;
    totalMentions = totalMentions || (pos + neu + neg);
    var total = pos + neu + neg || 1;
    var posPct = Math.round(pos / total * 100);

    var label = posPct >= 70 ? 'Strongly Positive' : posPct >= 50 ? 'Positive' : posPct >= 30 ? 'Mixed' : 'Negative';
    var color = posPct >= 70 ? '#4ae176' : posPct >= 50 ? '#adc6ff' : posPct >= 30 ? '#fbbf24' : '#ef4444';
    renderRadialChart('chart-avis-sentiment', posPct, {
      height: 140, label: label, suffix: '%', colorByValue: false
    });
    if (_charts['chart-avis-sentiment']) {
      _charts['chart-avis-sentiment'].updateOptions({ colors: [color] });
    }
    setHtml('avis-sentiment-label', label);
  }
}

function renderAIVisibilitySentimentBreakdown(sentimentData) {
  if (sentimentData?.sentiment_connotations) {
    var pos = sentimentData.sentiment_connotations.positive || 0;
    var neu = sentimentData.sentiment_connotations.neutral || 0;
    var neg = sentimentData.sentiment_connotations.negative || 0;
    setHtml('avis-positive-count', fmtNum(pos));
    setHtml('avis-neutral-count', fmtNum(neu));
    setHtml('avis-negative-count', fmtNum(neg));
  }
}

/* =======================================================
   TOP AI-CITING DOMAINS — ai_optimization/llm_mentions/top_domains/live
   Bar chart of domains most cited by AI models
   ======================================================= */

async function fetchTopAiDomains(btn) {
  var domain = SEO.activeProject;
  if (!domain) { showToast('Select a project first', 'warning'); return; }
  if (!checkBalanceWarning(0.10)) return;
  if (_debounceTimers['fetchTopAiDomains']) return;
  _debounceTimers['fetchTopAiDomains'] = true;
  setTimeout(function() { _debounceTimers['fetchTopAiDomains'] = false; }, 5000);

  if (btn) { btn.disabled = true; btn.textContent = 'Fetching...'; }
  SEO.startAction();

  try {
    var info = getProjectInfo();
    var res = await SEO.dfs('ai_optimization/llm_mentions/top_domains/live', {
      target: [{ domain: domain }],
      location_name: info.location || 'United States',
      language_name: info.language || 'English'
    });

    var items = res?.tasks?.[0]?.result?.[0]?.items || [];
    _renderTopAiDomains(items);

    var ac = SEO.getActionCost();
    showToast('Fetched ' + items.length + ' top AI-citing domains -- cost: ' + SEO.fmtCost(ac.cost), 'success', 6000);
  } catch (e) {
    showToast('Top AI domains failed: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Fetch Top Domains (~$0.10)'; }
  }
}

function _renderTopAiDomains(items) {
  var container = document.getElementById('ai-top-domains-container');
  if (!container) return;

  if (!items || items.length === 0) {
    container.innerHTML = '<div style="padding:20px;text-align:center;color:#8c909f;font-size:12px">No top AI-citing domains found for this domain.</div>';
    return;
  }

  // Normalize: items may be {domain, count} or {domain, mentions_count} etc.
  var domains = items.map(function(item) {
    return {
      domain: item.domain || item.url || item.target || '',
      count: item.mentions_count || item.count || item.value || 0
    };
  }).filter(function(d) { return d.domain; }).sort(function(a, b) { return b.count - a.count; });

  var maxCount = domains[0]?.count || 1;

  var html = '<div style="display:flex;flex-direction:column;gap:6px">';
  domains.slice(0, 20).forEach(function(d) {
    var pct = Math.round(d.count / maxCount * 100);
    html += '<div style="display:flex;align-items:center;gap:10px;padding:6px 0">'
      + '<img src="https://www.google.com/s2/favicons?domain=' + encodeURIComponent(d.domain) + '&sz=16" width="14" height="14" style="border-radius:2px;flex-shrink:0" onerror="this.style.display=\'none\'"/>'
      + '<div style="flex:1;min-width:0">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">'
      + '<span style="font-size:12px;font-weight:600;color:#e4e1e9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(d.domain) + '</span>'
      + '<span style="font-size:11px;font-weight:700;color:#adc6ff;flex-shrink:0;margin-left:8px;font-variant-numeric:tabular-nums">' + fmtNum(d.count) + '</span></div>'
      + '<div style="width:100%;height:4px;background:#2a292f;border-radius:2px;overflow:hidden">'
      + '<div style="height:100%;width:' + pct + '%;background:linear-gradient(90deg,#3b82f6,#adc6ff);border-radius:2px;transition:width 300ms"></div></div>'
      + '</div></div>';
  });
  html += '</div>';
  container.innerHTML = html;
}

/* Toggle expand/collapse for mention rows */
function toggleAvisRow(expandId, headerRow) {
  var expandRow = document.getElementById(expandId);
  if (!expandRow) return;
  var isOpen = expandRow.style.display !== 'none';
  expandRow.style.display = isOpen ? 'none' : '';
  var chevron = headerRow.querySelector('.avis-chevron');
  if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(90deg)';
}
// SEO Platform — Local SEO Module
'use strict';

/* =======================================================
   PHASE 4.5 - LOCAL SEO
   ======================================================= */

/**
 * loadLocalSEO - on view open (FREE from history)
 */
async function loadLocalSEO() {
  showViewLoading('local');
  var domain = SEO.activeProject;
  if (!domain) {
    showToast('Select a project first to view local SEO data', 'info');
    hideViewLoading('local');
    return;
  }

  try {
    // Try loading from history (FREE) — search by domain first, then fallback to any data
    var [mapsHist, bizHist, reviewsHist] = await Promise.all([
      SEO.history({ tool: 'serp_maps', target: domain, limit: 1 }).catch(function() { return {}; }),
      SEO.history({ tool: 'my_business_info', target: domain, limit: 1 }).catch(function() { return {}; }),
      SEO.history({ tool: 'google_reviews', target: domain, limit: 1 }).catch(function() { return {}; })
    ]);
    var _localTs = [mapsHist, bizHist, reviewsHist].map(function(h) { return h?.queries?.[0]?.created_at; }).filter(Boolean).sort().reverse();
    if (_localTs.length) setLastUpdated('local', _localTs[0]);
    // Fallback: if no results by domain, try without target (GMB queries often use business name, not domain)
    if (!(bizHist?.queries?.length > 0) && !(mapsHist?.queries?.length > 0)) {
      var fb = await Promise.all([
        SEO.history({ tool: 'serp_maps', limit: 1 }).catch(function() { return {}; }),
        SEO.history({ tool: 'my_business_info', limit: 1 }).catch(function() { return {}; }),
        SEO.history({ tool: 'google_reviews', limit: 1 }).catch(function() { return {}; })
      ]);
      mapsHist = fb[0]; bizHist = fb[1]; reviewsHist = fb[2];
    }

    var hasData = false;

    // Business info + rating/reviews from GMB data
    if (bizHist?.queries?.length > 0) {
      hasData = true;
      // Always load full item — summary may be broken from old saves
      if (bizHist.queries[0].id) {
        try {
          var fullBiz = await SEO.historyById(bizHist.queries[0].id).catch(function() { return {}; });
          var bizItem = (fullBiz?.items || [])[0];
          if (bizItem) {
            renderLocalBusinessProfile(bizItem);
            // Real star distribution from cached GMB data
            if (bizItem.rating_distribution) renderLocalRatingDist_fromGMB(bizItem.rating_distribution, bizItem.rating);
            // People Also Search = competitors
            if (bizItem.people_also_search && bizItem.people_also_search.length > 0) renderLocalCompetitors(bizItem.people_also_search);
            // Business details
            renderLocalBizDetails(bizItem);
          }
        } catch(e) { /* silent */ }
      }
    }

    // Reviews from history (if we ever have async review data)
    if (reviewsHist?.queries?.length > 0) {
      hasData = true;
      if (reviewsHist.queries[0].id) {
        try {
          var fullReviews = await SEO.historyById(reviewsHist.queries[0].id);
          var reviewItems = fullReviews?.items || [];
          if (reviewItems.length > 0) renderLocalReviews(reviewItems);
        } catch(e) { /* no detailed reviews */ }
      }
    }

    // Maps rankings
    if (mapsHist?.queries?.length > 0) {
      hasData = true;
      if (mapsHist.queries[0].id) {
        try {
          var fullMaps = await SEO.historyById(mapsHist.queries[0].id);
          var mapItems = fullMaps?.items || [];
          if (mapItems.length > 0) renderLocalMapRankings(mapItems);
        } catch(e) { /* no maps items */ }
      }
    }

    // Load competitors from history (saved as serp_maps or local_finder depending on backend version)
    try {
      var lfHist = await SEO.history({ tool: 'local_finder', limit: 1 }).catch(function() { return {}; });
      // Fallback: old code saved local_finder as serp_maps — check by loading maps history and filtering by endpoint
      if (!(lfHist?.queries?.length > 0)) {
        var mapsAll = await SEO.history({ tool: 'serp_maps', limit: 10 }).catch(function() { return {}; });
        var lfQuery = (mapsAll?.queries || []).find(function(q) { return (q.endpoint || '').indexOf('local_finder') !== -1; });
        if (lfQuery) lfHist = { queries: [lfQuery] };
      }
      if (lfHist?.queries?.length > 0 && lfHist.queries[0].id) {
        var lfFull = await SEO.historyById(lfHist.queries[0].id).catch(function() { return {}; });
        if (lfFull?.items?.length > 0) { hasData = true; renderLocalCompetitors(lfFull.items); }
      }
    } catch(e) { /* silent */ }

    // Load autocomplete from history
    try {
      var acHist = await SEO.history({ tool: 'serp_autocomplete', limit: 1 }).catch(function() { return {}; });
      if (acHist?.queries?.length > 0 && acHist.queries[0].id) {
        var acFull = await SEO.historyById(acHist.queries[0].id).catch(function() { return {}; });
        if (acFull?.items?.length > 0) { hasData = true; renderLocalAutocomplete(acFull.items); }
      }
    } catch(e) { /* silent */ }

    // Load cached Google Q&A from history (FREE)
    try {
      var gmbPostsHist = await SEO.history({ tool: 'google_qna', limit: 1 }).catch(function() { return {}; });
      if (!(gmbPostsHist?.queries?.length > 0)) {
        gmbPostsHist = await SEO.history({ tool: 'gmb_posts', limit: 1 }).catch(function() { return {}; });
      }
      if (gmbPostsHist?.queries?.length > 0 && gmbPostsHist.queries[0].id) {
        var gmbPostsFull = await SEO.historyById(gmbPostsHist.queries[0].id).catch(function() { return {}; });
        if (gmbPostsFull?.items?.length > 0) { hasData = true; renderGMBPosts(gmbPostsFull.items); }
      }
    } catch(e) { /* silent */ }

    // Render trend charts from history
    renderLocalReviewTrend();
    renderLocalMapTrend();

    // Update history count
    var localHistCount = document.getElementById('local-history-count');
    if (localHistCount) {
      var total = 0;
      await Promise.all(['serp_maps','my_business_info','google_reviews','local_finder','google_qna'].map(function(t) {
        return SEO.history({ tool: t, limit: 1 }).then(function(d) { total += (d?.queries || []).length; }).catch(function(){});
      }));
      localHistCount.textContent = total;
    }

    if (!hasData) {
      showToast('No cached Local SEO data. Use Refresh to fetch live data.', 'info');
    }

  } catch (e) {
    console.warn('Local SEO load error:', e);
  } finally {
    hideViewLoading('local');
  }
}

/**
 * refreshLocalSEO - on refresh click (~$0.02)
 */
async function refreshLocalSEO(btn) {
  var domain = SEO.activeProject;
  if (!domain) { showToast('Select a project first', 'warning'); return; }
  if (!checkBalanceWarning(0.03)) return;  // ~$0.03: biz_info + maps + autocomplete + local_finder + reviews_task
  if (_debounceTimers['refreshLocal']) return;
  _debounceTimers['refreshLocal'] = true;
  setTimeout(function() { _debounceTimers['refreshLocal'] = false; }, 3000);

  if (btn) { btn.disabled = true; btn.textContent = 'Refreshing...'; }
  SEO.startAction();

  // Get GMB query - try project settings, brand name, or domain name
  var gmbQuery = getProjectBrand();
  // Check if the project has a specific gmb_query configured (overrides brand name)
  try {
    var projects = await SEO.projects();
    var proj = (projects?.projects || []).find(function(p) { return p.domain === domain; });
    if (proj?.gmb_search_query) gmbQuery = proj.gmb_search_query;
  } catch(e) { /* use default */ }

  try {
    var results = await Promise.all([
      // Business info
      SEO.dfs('business_data/google/my_business_info/live', {
        keyword: gmbQuery,
        location_name: getProjectLocLang().location_name,
        language_name: getProjectLocLang().language_name
      }).catch(function(e) { console.warn('Business info failed:', e.message); return null; }),

      // Maps rankings
      SEO.dfs('serp/google/maps/live/advanced', {
        keyword: gmbQuery,
        location_name: getProjectLocLang().location_name,
        language_name: getProjectLocLang().language_name
      }).catch(function(e) { console.warn('Maps failed:', e.message); return null; }),

      // Autocomplete suggestions
      SEO.dfs('serp/google/autocomplete/live/advanced', {
        keyword: gmbQuery,
        location_name: getProjectLocLang().location_name,
        language_name: getProjectLocLang().language_name
      }).catch(function(e) { console.warn('Autocomplete failed:', e.message); return null; }),

      // Local Finder — search by business CATEGORY to find competitors (not brand name)
      (function() {
        var info = getProjectInfo();
        var catKeyword = (info.category || 'business') + ' ' + (info.address || info.location || '').split(',').slice(-2).join(',').trim();
        return SEO.dfs('serp/google/local_finder/live/advanced', {
          keyword: catKeyword || gmbQuery,
          location_name: getProjectLocLang().location_name,
          language_name: getProjectLocLang().language_name,
          depth: 20
        });
      })().catch(function(e) { console.warn('Local finder failed:', e.message); return null; }),

    ]);

    var [bizRes, mapsRes, autocompleteRes, localFinderRes] = results;

    // Render business info + rating distribution + people_also_search competitors
    if (bizRes) {
      var bizItems = bizRes?.tasks?.[0]?.result?.[0]?.items || [];
      if (bizItems.length > 0) {
        var biz = bizItems[0];
        renderLocalBusinessProfile(biz);

        // Real star distribution from GMB data
        var ratDist = biz.rating_distribution;
        if (ratDist) renderLocalRatingDist_fromGMB(ratDist, biz.rating);

        // People Also Search = free competitor data from GMB
        var alsoSearch = biz.people_also_search || [];
        if (alsoSearch.length > 0) renderLocalCompetitors(alsoSearch);

        // Business details (hours, attributes, photos)
        renderLocalBizDetails(biz);
      }
    }

    // Render maps rankings
    if (mapsRes) {
      var mapItems = mapsRes?.tasks?.[0]?.result?.[0]?.items || [];
      if (mapItems.length > 0) renderLocalMapRankings(mapItems);
    }

    // Render autocomplete suggestions
    if (autocompleteRes) {
      var acItems = autocompleteRes?.tasks?.[0]?.result?.[0]?.items || [];
      if (acItems.length > 0) renderLocalAutocomplete(acItems);
    }

    // Render local competitors from local_finder
    if (localFinderRes) {
      var lfItems = localFinderRes?.tasks?.[0]?.result?.[0]?.items || [];
      if (lfItems.length > 0) renderLocalCompetitors(lfItems);
    }

    // Render trend charts from history
    renderLocalReviewTrend();
    renderLocalMapTrend();

    // Start async Google Reviews fetch
    fetchGoogleReviews(gmbQuery);

    var ac = SEO.getActionCost();
    showToast('Local SEO refreshed — ' + ac.calls + ' calls, cost: ' + SEO.fmtCost(ac.cost), 'success', 6000);
  } catch (e) {
    showToast('Local SEO refresh failed: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Refresh Data (~$0.03)'; }
  }
}

function renderLocalBusinessProfile(data) {
  var el = document.getElementById('local-business-profile');
  if (!el) return;

  var name = data.title || data.name || '--';
  var address = data.address || data.address_info?.address || '--';
  var phone = data.phone || data.contact_info?.phone || '--';
  var rating = (typeof data.rating === 'object' ? data.rating?.value : data.rating) || data.total_score || '--';
  var reviewCount = (typeof data.rating === 'object' ? data.rating?.votes_count : null) || data.reviews_count || 0;
  var category = data.category || data.main_category || '--';
  var website = data.url || data.website || '';
  var isVerified = data.is_claimed || data.is_verified || false;

  el.innerHTML = '<div style="display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap">'
    + '<div style="flex:1;min-width:200px">'
    + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">'
    + '<span style="font-size:20px;font-weight:800;color:#e4e1e9">' + escHtml(name) + '</span>'
    + (isVerified ? '<span style="display:inline-flex;align-items:center;gap:4px;background:#4ae17615;color:#4ae176;font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;border:1px solid #4ae17630">Verified</span>' : '')
    + '</div>'
    + '<div style="display:flex;flex-direction:column;gap:6px">'
    + '<div style="display:flex;align-items:center;gap:8px"><span class="material-symbols-outlined" style="font-size:16px;color:#8c909f">location_on</span><span style="font-size:13px;color:#c2c6d6">' + escHtml(address) + '</span></div>'
    + '<div style="display:flex;align-items:center;gap:8px"><span class="material-symbols-outlined" style="font-size:16px;color:#8c909f">phone</span><span style="font-size:13px;color:#c2c6d6">' + escHtml(phone) + '</span></div>'
    + '<div style="display:flex;align-items:center;gap:8px"><span class="material-symbols-outlined" style="font-size:16px;color:#8c909f">category</span><span style="font-size:13px;color:#c2c6d6">' + escHtml(category) + '</span></div>'
    + (website ? '<div style="display:flex;align-items:center;gap:8px"><span class="material-symbols-outlined" style="font-size:16px;color:#8c909f">language</span><span style="font-size:13px;color:#adc6ff">' + escHtml(website) + '</span></div>' : '')
    + '</div></div>'
    + '<div style="text-align:center;padding:16px 24px;background:#131318;border-radius:12px;min-width:120px">'
    + '<div style="font-size:36px;font-weight:900;color:#f59e0b;font-variant-numeric:tabular-nums">' + rating + '</div>'
    + '<div style="display:flex;align-items:center;justify-content:center;gap:2px;margin:4px 0">' + renderStars(Number(rating)) + '</div>'
    + '<div style="font-size:11px;color:#8c909f">' + fmtNum(reviewCount) + ' reviews</div>'
    + '</div></div>';
}

function renderStars(rating) {
  var html = '';
  for (var i = 1; i <= 5; i++) {
    if (i <= Math.floor(rating)) {
      html += '<span class="material-symbols-outlined" style="font-size:16px;color:#f59e0b;font-variation-settings:\'FILL\' 1">star</span>';
    } else if (i - 0.5 <= rating) {
      html += '<span class="material-symbols-outlined" style="font-size:16px;color:#f59e0b;font-variation-settings:\'FILL\' 1">star_half</span>';
    } else {
      html += '<span class="material-symbols-outlined" style="font-size:16px;color:#35343a">star</span>';
    }
  }
  return html;
}

function renderLocalRatingDist(reviews) {
  var el = document.getElementById('local-rating-dist');
  if (!el) return;

  var dist = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  reviews.forEach(function(r) {
    var score = Math.round(r.rating?.value || r.review_rating || 0);
    if (score >= 1 && score <= 5) dist[score]++;
  });

  var total = reviews.length || 1;
  var html = '';
  for (var s = 5; s >= 1; s--) {
    var pct = Math.round(dist[s] / total * 100);
    var barColor = s >= 4 ? '#4ae176' : s >= 3 ? '#f59e0b' : '#ffb3ad';
    html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">'
      + '<span style="font-size:12px;font-weight:700;color:#e4e1e9;width:12px;text-align:right">' + s + '</span>'
      + '<span class="material-symbols-outlined" style="font-size:14px;color:#f59e0b;font-variation-settings:\'FILL\' 1">star</span>'
      + '<div style="flex:1;height:8px;background:#2a292f;border-radius:4px;overflow:hidden">'
      + '<div style="height:100%;width:' + pct + '%;background:' + barColor + ';border-radius:4px;transition:width 0.3s"></div></div>'
      + '<span style="font-size:11px;font-weight:600;color:#8c909f;width:40px;text-align:right">' + dist[s] + ' (' + pct + '%)</span>'
      + '</div>';
  }
  el.innerHTML = html;
}

function renderLocalReviews(reviews) {
  var el = document.getElementById('local-reviews-feed');
  if (!el) return;

  // Also build rating distribution
  renderLocalRatingDist(reviews);

  var html = '';
  reviews.slice(0, 10).forEach(function(r) {
    var author = r.profile_name || r.author_title || 'Anonymous';
    var rating = r.rating?.value || r.review_rating || 0;
    var text = r.review_text || r.snippet || '';
    var date = r.time_ago || (r.timestamp ? new Date(r.timestamp).toLocaleDateString() : '--');

    html += '<div style="padding:12px 0;border-bottom:1px solid rgba(66,71,84,0.15)">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">'
      + '<div style="display:flex;align-items:center;gap:8px">'
      + '<div style="width:32px;height:32px;border-radius:50%;background:#2a292f;display:grid;place-items:center"><span class="material-symbols-outlined" style="font-size:16px;color:#8c909f">person</span></div>'
      + '<div><div style="font-size:13px;font-weight:600;color:#e4e1e9">' + escHtml(author) + '</div>'
      + '<div style="font-size:10px;color:#8c909f">' + escHtml(date) + '</div></div></div>'
      + '<div>' + renderStars(rating) + '</div></div>'
      + (text ? '<p style="font-size:13px;color:#c2c6d6;line-height:1.5;margin:0">' + escHtml(text.substring(0, 200)) + (text.length > 200 ? '...' : '') + '</p>' : '')
      + '</div>';
  });

  el.innerHTML = html || '<div style="padding:20px;text-align:center;color:#8c909f;font-size:13px">No reviews found</div>';
}

function renderLocalMapRankings(items) {
  var el = document.getElementById('local-map-rankings');
  if (!el) return;

  var html = '<table style="width:100%;border-collapse:collapse">'
    + '<thead><tr style="border-bottom:1px solid rgba(66,71,84,0.2)">'
    + '<th style="text-align:left;padding:8px 12px;font-size:10px;font-weight:700;color:#8c909f;text-transform:uppercase;letter-spacing:0.05em">Rank</th>'
    + '<th style="text-align:left;padding:8px 12px;font-size:10px;font-weight:700;color:#8c909f;text-transform:uppercase;letter-spacing:0.05em">Business</th>'
    + '<th style="text-align:left;padding:8px 12px;font-size:10px;font-weight:700;color:#8c909f;text-transform:uppercase;letter-spacing:0.05em">Rating</th>'
    + '<th style="text-align:right;padding:8px 12px;font-size:10px;font-weight:700;color:#8c909f;text-transform:uppercase;letter-spacing:0.05em">Reviews</th>'
    + '</tr></thead><tbody>';

  items.slice(0, 10).forEach(function(item, idx) {
    var title = item.title || item.domain || '--';
    var rating = item.rating?.value || item.total_score || '--';
    var reviews = item.rating?.votes_count || item.reviews_count || 0;
    var rank = item.rank_group || item.position || (idx + 1);
    var isYou = title.toLowerCase().indexOf(SEO.activeProject.replace(/\.(com|net|org|io|co)$/i, '').toLowerCase()) !== -1
      || title.toLowerCase().indexOf(getProjectBrand().toLowerCase()) !== -1;
    var rowBg = isYou ? 'background:rgba(173,198,255,0.06)' : '';
    var nameFontColor = isYou ? 'color:#adc6ff;font-weight:800' : 'color:#e4e1e9;font-weight:600';

    html += '<tr style="border-bottom:1px solid rgba(66,71,84,0.1);' + rowBg + '">'
      + '<td style="padding:10px 12px;font-variant-numeric:tabular-nums">' + positionBadge(rank) + '</td>'
      + '<td style="padding:10px 12px;font-size:13px;' + nameFontColor + '">' + escHtml(title) + '</td>'
      + '<td style="padding:10px 12px;font-size:13px;font-weight:700;color:#f59e0b;font-variant-numeric:tabular-nums">' + rating + '</td>'
      + '<td style="padding:10px 12px;text-align:right;font-size:12px;color:#8c909f;font-variant-numeric:tabular-nums">' + fmtNum(reviews) + '</td>'
      + '</tr>';
  });

  html += '</tbody></table>';
  el.innerHTML = html;
}

function renderLocalAutocomplete(items) {
  var el = document.getElementById('local-autocomplete');
  if (!el) return;

  var html = '';
  items.slice(0, 8).forEach(function(item) {
    var suggestion = item.suggestion || item.keyword || '';
    var type = item.type || 'suggestion';
    html += '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(66,71,84,0.1)">'
      + '<span class="material-symbols-outlined" style="font-size:16px;color:#8c909f">search</span>'
      + '<span style="font-size:13px;color:#e4e1e9">' + escHtml(suggestion) + '</span>'
      + '<span style="font-size:10px;color:#8c909f;margin-left:auto;text-transform:uppercase;letter-spacing:0.05em">' + escHtml(type) + '</span>'
      + '</div>';
  });

  el.innerHTML = html || '<div style="padding:16px;text-align:center;color:#8c909f;font-size:13px">No suggestions found</div>';
}

/**
 * renderLocalRatingDist_fromGMB — real star breakdown from business_info rating_distribution
 */
function renderLocalRatingDist_fromGMB(dist, ratingObj) {
  var el = document.getElementById('local-rating-dist');
  if (!el) return;
  var ratingVal = (typeof ratingObj === 'object' ? ratingObj?.value : ratingObj) || 0;
  var reviewCount = (typeof ratingObj === 'object' ? ratingObj?.votes_count : 0) || 0;
  var total = 0;
  for (var s = 1; s <= 5; s++) total += (dist[String(s)] || 0);
  if (total === 0) total = reviewCount || 1;

  var html = '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">'
    + '<span style="font-size:36px;font-weight:900;color:#f59e0b">' + Number(ratingVal).toFixed(1) + '</span>'
    + '<div>' + renderStars(ratingVal) + '<div style="font-size:11px;color:#8c909f;margin-top:2px">' + fmtNum(reviewCount) + ' Google reviews</div></div></div>';
  for (var star = 5; star >= 1; star--) {
    var count = dist[String(star)] || 0;
    var pct = total > 0 ? Math.round(count / total * 100) : 0;
    var barColor = star >= 4 ? '#4ae176' : star >= 3 ? '#f59e0b' : '#ffb3ad';
    html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">'
      + '<span style="font-size:12px;font-weight:700;color:#e4e1e9;width:12px;text-align:right">' + star + '</span>'
      + '<span class="material-symbols-outlined" style="font-size:14px;color:#f59e0b;font-variation-settings:\'FILL\' 1">star</span>'
      + '<div style="flex:1;height:8px;background:#2a292f;border-radius:4px;overflow:hidden">'
      + '<div style="height:100%;width:' + pct + '%;background:' + barColor + ';border-radius:4px;transition:width 0.3s"></div></div>'
      + '<span style="font-size:11px;font-weight:600;color:#8c909f;width:50px;text-align:right">' + count + ' (' + pct + '%)</span>'
      + '</div>';
  }
  el.innerHTML = html;
}

/**
 * renderLocalBizDetails — work hours, attributes, photos from business_info
 */
function renderLocalBizDetails(biz) {
  var el = document.getElementById('local-biz-details');
  if (!el) return;
  var html = '';
  // Work hours — handle both DataForSEO formats
  var hours = biz.work_time || biz.work_hours;
  if (hours) {
    html += '<div style="margin-bottom:16px"><div style="font-size:11px;font-weight:700;color:#e4e1e9;margin-bottom:8px">Business Hours</div>';
    var wh = hours.work_hours || hours;
    // Format 1: timetable keyed by day name {timetable: {monday: [{open, close}], ...}}
    var timetable = wh.timetable || wh;
    if (typeof timetable === 'object' && !Array.isArray(timetable)) {
      var dayOrder = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
      var dayLabels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
      dayOrder.forEach(function(dayKey, idx) {
        var slots = timetable[dayKey];
        if (!slots) return;
        var times = (Array.isArray(slots) ? slots : []).map(function(t) {
          var oh = t.open?.hour != null ? t.open.hour : 0;
          var om = t.open?.minute != null ? t.open.minute : 0;
          var ch = t.close?.hour != null ? t.close.hour : 0;
          var cm = t.close?.minute != null ? t.close.minute : 0;
          if (oh === 0 && om === 0 && ch === 24 && cm === 0) return 'Open 24h';
          return oh + ':' + String(om).padStart(2, '0') + ' - ' + ch + ':' + String(cm).padStart(2, '0');
        }).join(', ') || 'Closed';
        html += '<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:12px"><span style="color:#8c909f">' + dayLabels[idx] + '</span><span style="color:#e4e1e9">' + times + '</span></div>';
      });
    }
    // Format 2: array with day_of_week [{day_of_week: 1, time: [...]}]
    else if (Array.isArray(wh)) {
      var days2 = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
      wh.forEach(function(d) {
        var day = days2[(d.day_of_week || 1) - 1] || '?';
        var times = (d.time || []).map(function(t) {
          return (t.open?.hour || 0) + ':' + String(t.open?.minute || 0).padStart(2, '0') + ' - ' + (t.close?.hour || 0) + ':' + String(t.close?.minute || 0).padStart(2, '0');
        }).join(', ') || 'Closed';
        html += '<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:12px"><span style="color:#8c909f">' + day + '</span><span style="color:#e4e1e9">' + times + '</span></div>';
      });
    } else if (typeof hours === 'string') {
      html += '<div style="font-size:12px;color:#c2c6d6">' + escHtml(hours) + '</div>';
    }
    html += '</div>';
  }
  // Attributes — handle nested {available_attributes: {category: [items]}} format
  var attrs = biz.attributes || {};
  var attrItems = [];
  if (Array.isArray(attrs)) {
    attrs.forEach(function(a) { if (a.attribute) attrItems.push(a.attribute); });
  } else if (typeof attrs === 'object') {
    var avail = attrs.available_attributes || attrs;
    if (typeof avail === 'object') {
      for (var cat in avail) {
        var items = avail[cat];
        if (Array.isArray(items)) {
          items.forEach(function(a) { attrItems.push(String(a).replace(/^has_/, '').replace(/_/g, ' ')); });
        } else if (items && typeof items !== 'object') {
          attrItems.push(String(cat).replace(/_/g, ' '));
        }
      }
    }
  }
  if (attrItems.length > 0) {
    html += '<div style="margin-bottom:16px"><div style="font-size:11px;font-weight:700;color:#e4e1e9;margin-bottom:8px">Attributes</div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:6px">';
    attrItems.forEach(function(a) {
      html += '<span style="font-size:11px;padding:4px 10px;background:#1f1f25;border-radius:6px;color:#c2c6d6">' + escHtml(a) + '</span>';
    });
    html += '</div></div>';
  }
  // Photos + description
  if (biz.total_photos) html += '<div style="font-size:12px;color:#8c909f;margin-bottom:8px">' + biz.total_photos + ' photos on Google</div>';
  if (biz.description) html += '<div style="font-size:12px;color:#c2c6d6;line-height:1.5">' + escHtml(biz.description.substring(0, 300)) + '</div>';
  el.innerHTML = html || '<div style="padding:12px;text-align:center;color:#8c909f;font-size:12px">No additional business details available.</div>';
}

/**
 * renderLocalCompetitors — from local_finder or people_also_search
 */
function renderLocalCompetitors(items) {
  var el = document.getElementById('local-competitors');
  if (!el) return;
  var brand = getProjectBrand().toLowerCase();
  // Filter out the user's own business
  var competitors = items.filter(function(item) {
    return (item.title || '').toLowerCase().indexOf(brand) === -1;
  }).slice(0, 15);
  if (competitors.length === 0) {
    el.innerHTML = '<div style="padding:16px;text-align:center;color:#8c909f;font-size:12px">No local competitors found.</div>';
    return;
  }
  var html = '';
  competitors.forEach(function(item, idx) {
    var name = item.title || '--';
    var rating = item.rating?.value || item.total_score || '--';
    var reviews = item.rating?.votes_count || item.reviews_count || 0;
    var addr = item.address || '';
    var rank = item.rank_group || item.position || (idx + 1);
    html += '<div style="padding:10px 0;border-bottom:1px solid rgba(66,71,84,0.1);display:flex;align-items:flex-start;gap:10px">'
      + '<span style="font-size:12px;font-weight:800;color:#8c909f;min-width:20px">#' + rank + '</span>'
      + '<div style="flex:1;min-width:0">'
      + '<div style="font-size:13px;font-weight:600;color:#e4e1e9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(name) + '</div>'
      + '<div style="font-size:11px;color:#8c909f;margin-top:2px">'
      + '<span style="color:#f59e0b;font-weight:700">' + rating + '</span> (' + fmtNum(reviews) + ' reviews)'
      + (addr ? ' &middot; ' + escHtml(addr.substring(0, 40)) : '')
      + '</div></div></div>';
  });
  el.innerHTML = html;
}

/**
 * renderLocalGMBPosts — Google Business posts
 */
function renderLocalGMBPosts(items) {
  var el = document.getElementById('local-gmb-posts');
  if (!el) return;
  if (!items || items.length === 0) {
    el.innerHTML = '<div style="padding:16px;text-align:center;color:#8c909f;font-size:12px">No Google Business posts found. Posting on GMB helps local SEO and engagement.</div>';
    return;
  }
  var html = '';
  items.slice(0, 10).forEach(function(post) {
    var title = post.title || '';
    var text = post.snippet || post.post_text || post.description || '';
    var images = post.images || [];
    var date = post.timestamp ? new Date(post.timestamp * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : (post.date_published || '--');
    html += '<div style="padding:12px 0;border-bottom:1px solid rgba(66,71,84,0.15)">'
      + (title ? '<div style="font-size:14px;font-weight:700;color:#e4e1e9;margin-bottom:4px">' + escHtml(title) + '</div>' : '')
      + '<div style="font-size:13px;color:#c2c6d6;line-height:1.5">' + escHtml(text.substring(0, 300)) + (text.length > 300 ? '...' : '') + '</div>'
      + (images.length > 0 ? '<div style="margin-top:8px;font-size:10px;color:#8c909f">' + images.length + ' image(s)</div>' : '')
      + '<div style="font-size:10px;color:#8c909f;margin-top:6px">' + date + '</div>'
      + '</div>';
  });
  el.innerHTML = html;
}

/**
 * renderLocalReviewTrend — rating + review count over time from historical my_business_info queries
 */
async function renderLocalReviewTrend() {
  var el = document.getElementById('local-review-trend');
  if (!el) return;
  try {
    var hist = await SEO.history({ tool: 'my_business_info', limit: 30 }).catch(function() { return {}; });
    var allQueries = (hist?.queries || []).reverse();
    if (allQueries.length < 2) {
      el.innerHTML = '<div style="padding:20px;text-align:center;color:#8c909f;font-size:12px">Need at least 2 data points. Refresh periodically to build trend data.</div>';
      return;
    }
    // Load full items for each query to get rating (summary may be missing it for old queries)
    var dates = [], ratings = [], reviewCounts = [];
    for (var qi = 0; qi < allQueries.length; qi++) {
      var q = allQueries[qi];
      var rating = q.summary?.rating || 0;
      var revCount = q.summary?.reviews_count || 0;
      // If summary is missing rating, load full item
      if (!rating && q.id) {
        try {
          var full = await SEO.historyById(q.id).catch(function() { return {}; });
          var item = (full?.items || [])[0];
          if (item) {
            rating = (typeof item.rating === 'object' ? item.rating?.value : item.rating) || 0;
            revCount = (typeof item.rating === 'object' ? item.rating?.votes_count : null) || item.reviews_count || 0;
          }
        } catch(e) { /* skip */ }
      }
      if (rating > 0) {
        dates.push(new Date(q.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
        ratings.push(rating);
        reviewCounts.push(revCount);
      }
    }
    if (dates.length < 2) {
      el.innerHTML = '<div style="padding:20px;text-align:center;color:#8c909f;font-size:12px">Need at least 2 data points with rating data. Refresh periodically to build trend.</div>';
      return;
    }
    el.innerHTML = '';
    new ApexCharts(el, {
      chart: { type: 'line', height: 200, background: 'transparent', toolbar: { show: false } },
      series: [
        { name: 'Rating', data: ratings },
        { name: 'Reviews', data: reviewCounts }
      ],
      xaxis: { categories: dates, labels: { style: { colors: '#8c909f', fontSize: '9px' }, rotate: -45 } },
      yaxis: [
        { title: { text: 'Rating', style: { color: '#f59e0b', fontSize: '10px' } }, min: 0, max: 5, labels: { style: { colors: '#f59e0b', fontSize: '10px' } } },
        { opposite: true, title: { text: 'Reviews', style: { color: '#adc6ff', fontSize: '10px' } }, labels: { style: { colors: '#adc6ff', fontSize: '10px' } } }
      ],
      stroke: { width: [3, 2], curve: 'smooth' },
      colors: ['#f59e0b', '#adc6ff'],
      theme: { mode: 'dark' },
      grid: { borderColor: '#2a292f', strokeDashArray: 4 },
      tooltip: { theme: 'dark' },
      legend: { labels: { colors: '#8c909f' } }
    }).render();
  } catch(e) { console.warn('Review trend error:', e); }
}

/**
 * renderLocalMapTrend — map pack position over time from historical serp_maps queries
 */
async function renderLocalMapTrend() {
  var el = document.getElementById('local-map-trend');
  if (!el) return;
  var brand = getProjectBrand().toLowerCase();
  try {
    var hist = await SEO.history({ tool: 'serp_maps', limit: 20 }).catch(function() { return {}; });
    var queries = (hist?.queries || []).reverse();
    if (queries.length < 2) {
      el.innerHTML = '<div style="padding:20px;text-align:center;color:#8c909f;font-size:12px">Need at least 2 data points. Refresh periodically to build position tracking.</div>';
      return;
    }
    // For each query, load full items and find our business's rank
    var dates = [];
    var positions = [];
    for (var qi = 0; qi < queries.length; qi++) {
      var q = queries[qi];
      if (!q.id) continue;
      try {
        var full = await SEO.historyById(q.id).catch(function() { return {}; });
        var items = full?.items || [];
        var myRank = null;
        items.forEach(function(item) {
          if ((item.title || '').toLowerCase().indexOf(brand) !== -1) {
            myRank = item.rank_group || item.position || null;
          }
        });
        dates.push(new Date(q.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
        positions.push(myRank || null);
      } catch(e) { /* skip */ }
    }
    if (positions.filter(function(p) { return p !== null; }).length < 1) {
      el.innerHTML = '<div style="padding:20px;text-align:center;color:#8c909f;font-size:12px">Business not found in map results. Check that your GMB business name matches.</div>';
      return;
    }
    el.innerHTML = '';
    new ApexCharts(el, {
      chart: { type: 'line', height: 200, background: 'transparent', toolbar: { show: false } },
      series: [{ name: 'Map Position', data: positions }],
      xaxis: { categories: dates, labels: { style: { colors: '#8c909f', fontSize: '9px' }, rotate: -45 } },
      yaxis: { reversed: true, min: 1, labels: { style: { colors: '#8c909f', fontSize: '10px' } }, title: { text: 'Position (lower = better)', style: { color: '#8c909f', fontSize: '10px' } } },
      stroke: { width: 3, curve: 'smooth' },
      markers: { size: 4 },
      colors: ['#4ae176'],
      theme: { mode: 'dark' },
      grid: { borderColor: '#2a292f', strokeDashArray: 4 },
      tooltip: { theme: 'dark' }
    }).render();
  } catch(e) { console.warn('Map trend error:', e); }
}

/**
 * fetchGoogleReviews — async review fetch (task_post → poll task_get)
 */
async function fetchGoogleReviews(gmbQuery) {
  var statusEl = document.getElementById('local-reviews-status');
  if (statusEl) statusEl.textContent = 'Fetching reviews...';
  try {
    // Post the task
    var taskRes = await SEO.dfs('business_data/google/reviews/task_post', [{
      keyword: gmbQuery,
      depth: 50,
      location_name: getProjectLocLang().location_name,
      language_name: getProjectLocLang().language_name
    }]);
    var taskId = taskRes?.tasks?.[0]?.id;
    if (!taskId) {
      if (statusEl) statusEl.textContent = 'No task ID returned';
      return;
    }
    // Poll for results (max 6 attempts, 8s apart)
    var attempts = 0;
    var maxAttempts = 6;
    function pollReviews() {
      attempts++;
      if (statusEl) statusEl.textContent = 'Waiting for reviews... (' + attempts + '/' + maxAttempts + ')';
      SEO.dfs('business_data/google/reviews/task_get/' + taskId, {}, 'GET').then(function(res) {
        var items = res?.tasks?.[0]?.result?.[0]?.items || [];
        if (items.length > 0) {
          if (statusEl) statusEl.textContent = items.length + ' reviews loaded';
          renderLocalReviews(items);
        } else if (attempts < maxAttempts) {
          setTimeout(pollReviews, 8000);
        } else {
          if (statusEl) statusEl.textContent = 'Reviews not ready yet — try again later';
        }
      }).catch(function(e) {
        if (attempts < maxAttempts) {
          setTimeout(pollReviews, 8000);
        } else {
          if (statusEl) statusEl.textContent = 'Review fetch failed';
        }
      });
    }
    setTimeout(pollReviews, 10000); // First poll after 10s
  } catch(e) {
    console.warn('Review task post failed:', e);
    if (statusEl) statusEl.textContent = 'Review fetch failed: ' + e.message;
  }
}

/**
 * fetchFullReviewHistory — Fetch ALL Google reviews via async task_post → poll → task_get
 * Uses the same endpoint as fetchGoogleReviews but with higher depth and renders into
 * the dedicated full review history section
 */
async function fetchFullReviewHistory(btn) {
  var domain = SEO.activeProject;
  if (!domain) { showToast('Select a project first', 'warning'); return; }
  if (!checkBalanceWarning(0.02)) return;
  if (_debounceTimers['fetchFullReviews']) return;
  _debounceTimers['fetchFullReviews'] = true;
  setTimeout(function() { _debounceTimers['fetchFullReviews'] = false; }, 5000);

  var gmbQuery = getProjectBrand();
  try {
    var projects = await SEO.projects();
    var proj = (projects?.projects || []).find(function(p) { return p.domain === domain; });
    if (proj?.gmb_search_query) gmbQuery = proj.gmb_search_query;
  } catch(e) { /* use default */ }

  var statusEl = document.getElementById('local-full-reviews-status');
  var feedEl = document.getElementById('local-full-reviews-feed');
  if (btn) { btn.disabled = true; btn.textContent = 'Fetching...'; }
  if (statusEl) statusEl.textContent = 'Posting task...';
  SEO.startAction();

  try {
    var taskRes = await SEO.dfs('business_data/google/reviews/task_post', [{
      keyword: gmbQuery,
      depth: 700,
      sort_by: 'newest',
      location_name: getProjectLocLang().location_name,
      language_name: getProjectLocLang().language_name
    }]);
    var taskId = taskRes?.tasks?.[0]?.id;
    if (!taskId) {
      if (statusEl) statusEl.textContent = 'No task ID returned';
      if (btn) { btn.disabled = false; btn.textContent = 'Fetch Full Review History'; }
      return;
    }

    // Poll for results (max 10 attempts, 8s apart — can take up to 60s+ for large review sets)
    var attempts = 0;
    var maxAttempts = 10;
    function pollFullReviews() {
      attempts++;
      if (statusEl) statusEl.textContent = 'Waiting for results... (' + attempts + '/' + maxAttempts + ')';
      SEO.dfs('business_data/google/reviews/task_get/' + taskId, {}, 'GET').then(function(res) {
        var items = res?.tasks?.[0]?.result?.[0]?.items || [];
        if (items.length > 0) {
          if (statusEl) statusEl.textContent = items.length + ' reviews loaded';
          renderFullReviewHistory(items);
          if (btn) { btn.disabled = false; btn.textContent = 'Fetch Full Review History'; }
          var ac = SEO.getActionCost();
          showToast('Full review history — ' + items.length + ' reviews, cost: ' + SEO.fmtCost(ac.cost), 'success', 6000);
        } else if (attempts < maxAttempts) {
          setTimeout(pollFullReviews, 8000);
        } else {
          if (statusEl) statusEl.textContent = 'Reviews not ready yet — try again later';
          if (btn) { btn.disabled = false; btn.textContent = 'Fetch Full Review History'; }
        }
      }).catch(function(e) {
        if (attempts < maxAttempts) {
          setTimeout(pollFullReviews, 8000);
        } else {
          if (statusEl) statusEl.textContent = 'Review fetch failed';
          if (btn) { btn.disabled = false; btn.textContent = 'Fetch Full Review History'; }
        }
      });
    }
    setTimeout(pollFullReviews, 10000);
  } catch(e) {
    showToast('Full review fetch failed: ' + e.message, 'error');
    if (statusEl) statusEl.textContent = 'Error: ' + e.message;
    if (btn) { btn.disabled = false; btn.textContent = 'Fetch Full Review History'; }
  }
}

/**
 * renderFullReviewHistory — scrollable review feed with star ratings, author, text, date, owner replies
 */
function renderFullReviewHistory(reviews) {
  var el = document.getElementById('local-full-reviews-feed');
  if (!el) return;

  // Sort newest first
  var sorted = reviews.slice().sort(function(a, b) {
    var da = a.timestamp ? new Date(a.timestamp) : new Date(0);
    var db = b.timestamp ? new Date(b.timestamp) : new Date(0);
    return db - da;
  });

  var html = '<div style="margin-bottom:12px;font-size:12px;color:#8c909f">' + fmtNum(sorted.length) + ' reviews total</div>';

  sorted.forEach(function(r) {
    var author = r.profile_name || r.author_title || 'Anonymous';
    var rating = r.rating?.value || r.review_rating || 0;
    var text = r.review_text || r.snippet || '';
    var date = '';
    if (r.timestamp) {
      try { date = new Date(r.timestamp).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); } catch(e) { date = r.time_ago || '--'; }
    } else {
      date = r.time_ago || '--';
    }
    var ownerReply = r.owner_answer || r.owner_response || '';
    var profileUrl = r.profile_url || r.review_url || '';
    var profileImg = r.profile_image_url || '';

    html += '<div style="padding:14px 0;border-bottom:1px solid rgba(66,71,84,0.15)">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'
      + '<div style="display:flex;align-items:center;gap:10px">';

    // Avatar
    if (profileImg) {
      html += '<img src="' + escHtml(profileImg) + '" style="width:36px;height:36px;border-radius:50%;object-fit:cover" onerror="this.style.display=\'none\'">';
    } else {
      html += '<div style="width:36px;height:36px;border-radius:50%;background:#2a292f;display:grid;place-items:center"><span class="material-symbols-outlined" style="font-size:18px;color:#8c909f">person</span></div>';
    }

    html += '<div>'
      + '<div style="font-size:13px;font-weight:600;color:#e4e1e9">' + escHtml(author) + '</div>'
      + '<div style="font-size:10px;color:#8c909f">' + escHtml(date) + '</div>'
      + '</div></div>'
      + '<div>' + renderStars(rating) + '</div></div>';

    // Review text
    if (text) {
      var truncated = text.length > 400;
      var displayText = truncated ? text.substring(0, 400) + '...' : text;
      html += '<p style="font-size:13px;color:#c2c6d6;line-height:1.6;margin:0 0 0 46px">' + escHtml(displayText) + '</p>';
    }

    // Owner reply
    if (ownerReply) {
      html += '<div style="margin:10px 0 0 46px;padding:10px 14px;background:#1a1a22;border-left:3px solid #adc6ff;border-radius:0 8px 8px 0">'
        + '<div style="font-size:10px;font-weight:700;color:#adc6ff;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px">Owner Response</div>'
        + '<p style="font-size:12px;color:#c2c6d6;line-height:1.5;margin:0">' + escHtml(ownerReply.length > 300 ? ownerReply.substring(0, 300) + '...' : ownerReply) + '</p>'
        + '</div>';
    }

    html += '</div>';
  });

  el.innerHTML = html || '<div style="padding:20px;text-align:center;color:#8c909f;font-size:13px">No reviews found</div>';
}

/**
 * fetchGMBPosts — Fetch Google Business Q&A (~$0.01)
 * Uses business_data/google/questions_and_answers/live
 * Note: DataForSEO has no GMB posts endpoint — Q&A is the closest available feature.
 */
async function fetchGMBPosts(btn) {
  var domain = SEO.activeProject;
  if (!domain) { showToast('Select a project first', 'warning'); return; }
  if (!checkBalanceWarning(0.01)) return;
  if (_debounceTimers['fetchGMBPosts']) return;
  _debounceTimers['fetchGMBPosts'] = true;
  setTimeout(function() { _debounceTimers['fetchGMBPosts'] = false; }, 3000);

  var info = getProjectInfo();
  var gmbQuery = info.brand_name;
  try {
    var projects = await SEO.projects();
    var proj = (projects?.projects || []).find(function(p) { return p.domain === domain; });
    if (proj?.gmb_search_query) gmbQuery = proj.gmb_search_query;
  } catch(e) { /* use default */ }

  if (btn) { btn.disabled = true; btn.textContent = 'Fetching...'; }
  SEO.startAction();

  try {
    var res = await SEO.dfs('business_data/google/questions_and_answers/live', {
      keyword: gmbQuery,
      location_name: getProjectLocLang().location_name,
      language_name: getProjectLocLang().language_name
    });

    var items = res?.tasks?.[0]?.result?.[0]?.items || [];
    if (items.length > 0) {
      renderGMBPosts(items);
    } else {
      var el = document.getElementById('local-gmb-posts');
      if (el) el.innerHTML = '<div style="padding:20px;text-align:center;color:#8c909f;font-size:13px">No Google Q&A found for "' + escHtml(gmbQuery) + '". Businesses gain Q&A once customers start asking questions on their Google listing.</div>';
    }

    var ac = SEO.getActionCost();
    showToast('Google Q&A loaded — ' + items.length + ' items, cost: ' + SEO.fmtCost(ac.cost), 'success', 5000);
  } catch(e) {
    showToast('Google Q&A fetch failed: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Fetch Google Q&A (~$0.01)'; }
  }
}

/**
 * renderGMBPosts — Renders Q&A or post items as card list
 * Handles both Google Q&A format and legacy post format
 */
function renderGMBPosts(posts) {
  var el = document.getElementById('local-gmb-posts');
  if (!el) return;

  var html = '';
  posts.forEach(function(post) {
    // Handle Q&A format (question_text, answer_text)
    var isQA = post.question_text || post.question;
    if (isQA) {
      var question = post.question_text || post.question || '';
      var answer = post.answer_text || post.answer || '';
      var votes = post.votes || post.question_votes || 0;
      var answerCount = post.answers_count || (answer ? 1 : 0);
      var qaDate = '';
      if (post.time_ago || post.original_question_text) {
        qaDate = post.time_ago || '';
      }

      html += '<div style="padding:16px;background:#1a1a22;border:1px solid rgba(66,71,84,0.15);border-radius:10px;margin-bottom:10px">'
        + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:6px">'
        + '<span style="display:inline-block;font-size:10px;font-weight:700;color:#adc6ff;text-transform:uppercase;letter-spacing:0.06em;padding:3px 10px;border:1px solid #adc6ff30;border-radius:4px;background:#adc6ff10">Q&A</span>'
        + (qaDate ? '<span style="font-size:11px;color:#8c909f">' + escHtml(qaDate) + '</span>' : '')
        + '</div>'
        + '<div style="margin-bottom:8px"><span style="font-size:11px;font-weight:700;color:#f59e0b;margin-right:6px">Q:</span>'
        + '<span style="font-size:13px;color:#e4e1e9">' + escHtml(question) + '</span></div>';

      if (answer) {
        html += '<div style="padding-left:16px;border-left:2px solid #424754"><span style="font-size:11px;font-weight:700;color:#4ae176;margin-right:6px">A:</span>'
          + '<span style="font-size:13px;color:#c2c6d6">' + escHtml(answer.length > 300 ? answer.substring(0, 300) + '...' : answer) + '</span></div>';
      } else {
        html += '<div style="font-size:12px;color:#8c909f;font-style:italic">No answers yet</div>';
      }

      if (votes > 0) {
        html += '<div style="margin-top:8px;font-size:11px;color:#8c909f">' + votes + ' votes</div>';
      }
      html += '</div>';
      return;
    }

    // Legacy post format
    var postType = post.post_type || post.type || 'update';
    var text = post.snippet || post.text || post.description || '';
    var images = post.images || [];
    var ctaUrl = post.cta_url || post.url || '';
    var published = '';
    if (post.timestamp || post.published_date) {
      try {
        published = new Date(post.timestamp || post.published_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
      } catch(e) { published = post.time_ago || '--'; }
    } else {
      published = post.time_ago || '--';
    }

    // Type badge color
    var badgeColor = '#adc6ff';
    var typeLower = postType.toLowerCase();
    if (typeLower.indexOf('offer') !== -1 || typeLower.indexOf('promo') !== -1) badgeColor = '#4ae176';
    else if (typeLower.indexOf('event') !== -1) badgeColor = '#f59e0b';
    else if (typeLower.indexOf('product') !== -1) badgeColor = '#ffb3ad';

    html += '<div style="padding:16px;background:#1a1a22;border:1px solid rgba(66,71,84,0.15);border-radius:10px;margin-bottom:10px">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:6px">'
      + '<span style="display:inline-block;font-size:10px;font-weight:700;color:' + badgeColor + ';text-transform:uppercase;letter-spacing:0.06em;padding:3px 10px;border:1px solid ' + badgeColor + '30;border-radius:4px;background:' + badgeColor + '10">' + escHtml(postType.replace(/_/g, ' ')) + '</span>'
      + '<span style="font-size:11px;color:#8c909f">' + escHtml(published) + '</span>'
      + '</div>';

    // Image + text side by side on desktop
    if (images.length > 0 || text) {
      html += '<div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap">';

      // Image thumbnail
      if (images.length > 0) {
        var imgUrl = typeof images[0] === 'string' ? images[0] : (images[0]?.url || images[0]?.image_url || '');
        if (imgUrl) {
          html += '<img src="' + escHtml(imgUrl) + '" style="width:80px;height:80px;border-radius:8px;object-fit:cover;flex-shrink:0" onerror="this.style.display=\'none\'">';
        }
      }

      // Text
      if (text) {
        var truncatedText = text.length > 250 ? text.substring(0, 250) + '...' : text;
        html += '<p style="font-size:13px;color:#c2c6d6;line-height:1.5;margin:0;flex:1;min-width:180px">' + escHtml(truncatedText) + '</p>';
      }

      html += '</div>';
    }

    // CTA link
    if (ctaUrl) {
      html += '<div style="margin-top:10px">'
        + '<a href="' + escHtml(ctaUrl) + '" target="_blank" rel="noopener" style="font-size:12px;color:#adc6ff;text-decoration:none;display:inline-flex;align-items:center;gap:4px">'
        + '<span class="material-symbols-outlined" style="font-size:14px">open_in_new</span> View post</a></div>';
    }

    html += '</div>';
  });

  el.innerHTML = html || '<div style="padding:20px;text-align:center;color:#8c909f;font-size:13px">No posts found</div>';
}

function toggleLocalHistory() {
  var body = document.getElementById('local-history-body');
  var toggle = document.getElementById('local-history-toggle');
  if (!body) return;
  var isHidden = body.style.display === 'none';
  body.style.display = isHidden ? 'block' : 'none';
  if (toggle) toggle.style.transform = isHidden ? 'rotate(180deg)' : '';
  if (isHidden && !body.innerHTML.trim()) loadLocalHistory();
}

async function loadLocalHistory() {
  var body = document.getElementById('local-history-body');
  var countEl = document.getElementById('local-history-count');
  if (!body) return;
  body.innerHTML = '<div style="padding:16px;text-align:center;color:#8c909f;font-size:12px">Loading...</div>';
  try {
    var tools = ['serp_maps', 'my_business_info', 'google_reviews', 'serp_autocomplete'];
    var allQueries = [];
    await Promise.all(tools.map(function(tool) {
      return SEO.history({ tool: tool, limit: 20 })
        .then(function(data) { (data?.queries || []).forEach(function(q) { q._tool = tool; allQueries.push(q); }); })
        .catch(function() {});
    }));
    allQueries.sort(function(a,b) { return new Date(b.created_at || 0) - new Date(a.created_at || 0); });
    if (countEl) countEl.textContent = allQueries.length;
    if (allQueries.length === 0) { body.innerHTML = '<div style="padding:16px;text-align:center;color:#8c909f;font-size:12px">No reports yet.</div>'; return; }
    var html = '';
    allQueries.forEach(function(q, idx) {
      var dateStr = q.created_at ? new Date(q.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '--';
      var tool = (q._tool || '').replace(/_/g, ' ');
      var target = q.query_target || '--';
      var count = q.result_count || 0;
      var cost = q.cost ? '$' + Number(q.cost).toFixed(4) : 'FREE';
      html += '<div style="padding:10px 16px;border-bottom:1px solid rgba(66,71,84,0.1);display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:pointer" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display===\'none\'?\'block\':\'none\'">'
        + '<div style="display:flex;align-items:center;gap:8px"><span class="material-symbols-outlined" style="font-size:14px;color:#adc6ff">description</span>'
        + '<span style="font-size:12px;font-weight:600;color:#e4e1e9">' + escHtml(tool) + '</span>'
        + '<span style="font-size:11px;color:#8c909f">' + escHtml(target) + '</span></div>'
        + '<div style="display:flex;align-items:center;gap:12px;flex-shrink:0">'
        + '<span style="font-size:10px;color:#8c909f">' + count + ' results</span>'
        + '<span style="font-size:10px;font-weight:600;color:#4ae176">' + cost + '</span>'
        + '<span style="font-size:10px;color:#8c909f">' + dateStr + '</span></div></div>'
        + '<div style="display:none;padding:8px 16px 16px" id="local-hist-' + idx + '"></div>';
    });
    body.innerHTML = html;
  } catch(e) { body.innerHTML = '<div style="padding:16px;text-align:center;color:#8c909f;font-size:12px">Error loading history</div>'; }
}


// SEO Platform — Content Monitor Module
'use strict';

/* =======================================================
   PHASE 4.6 - CONTENT & BRAND MONITOR
   ======================================================= */

/**
 * loadContentMonitor - on view open (FREE from history)
 */
async function loadContentMonitor() {
  // Restore saved brand name from preferences
  try {
    var prefs = await SEO.preferences();
    var brandInput = document.getElementById('content-brand-input');
    if (brandInput && prefs?.brand_name) brandInput.value = prefs.brand_name;
  } catch(e) { /* silent */ }

  var domain = SEO.activeProject;
  if (!domain) {
    // Don't overwrite the whole view — just show a notice
    showToast('Select a project first to view content data', 'info');
    return;
  }

  // Brand name: check input field first, then prefs, then derive from domain
  var brandInput = document.getElementById('content-brand-input');
  var brandName = (brandInput?.value || '').trim();
  if (!brandName) {
    try {
      var prefs2 = await SEO.preferences().catch(function() { return {}; });
      var p = prefs2?.preferences || prefs2 || {};
      var dc = p.dashboard_config || {};
      brandName = dc.brand_name || p.brand_name || '';
    } catch(e) {}
  }
  if (!brandName) brandName = getProjectBrand();

  try {
    var hasData = false;

    // ===== SEARCH RESULTS = SINGLE SOURCE OF TRUTH (same as refresh) =====
    // Load multiple history entries and use the first one with actual items (skip empty results)
    var searchHist = await SEO.history({ tool: 'content_analysis_search', target: brandName, limit: 5 }).catch(function() { return {}; });
    if (!(searchHist?.queries?.length > 0)) {
      searchHist = await SEO.history({ tool: 'content_analysis_search', limit: 5 }).catch(function() { return {}; });
    }
    // Find the first query with real items (result_count > 1 means actual mentions, not empty wrapper)
    var bestSearchQuery = null;
    var searchQueries = searchHist?.queries || [];
    for (var sq = 0; sq < searchQueries.length; sq++) {
      if (searchQueries[sq].result_count > 1) { bestSearchQuery = searchQueries[sq]; break; }
    }
    if (!bestSearchQuery && searchQueries.length > 0) bestSearchQuery = searchQueries[0];

    if (bestSearchQuery) {
      hasData = true;
      setLastUpdated('content', bestSearchQuery.created_at);

      if (bestSearchQuery.id) {
        try {
          var fullSearch = await SEO.historyById(bestSearchQuery.id);
          var searchItems = fullSearch?.items || [];
          // Handle case where items[0] is a wrapper object (total_count, items_count fields)
          if (searchItems.length === 1 && searchItems[0]?.total_count != null && searchItems[0]?.items_count != null) {
            searchItems = searchItems[0]?.items || [];
          }
          // Filter own-domain
          var ownDomain = domain.replace(/^www\./, '');
          searchItems = searchItems.filter(function(item) {
            return (item.main_domain || '').replace(/^www\./, '') !== ownDomain;
          });

          // Compute ALL KPIs from search items — single source of truth
          var posCt = 0, neuCt = 0, negCt = 0;
          searchItems.forEach(function(item) {
            var ct = (item.content_info || {}).connotation_types || {};
            if ((ct.positive || 0) > 0.45) posCt++;
            else if ((ct.negative || 0) > 0.60) negCt++;
            else neuCt++;
          });
          var n = searchItems.length || 1;
          var sentData = { positive: posCt/n, neutral: neuCt/n, negative: negCt/n };
          renderContentSummary({ total_count: fullSearch?.total_count || searchItems.length, analyzed_count: searchItems.length, connotation_types: sentData });
          renderContentSentiment({ connotation_types: sentData });
          if (searchItems.length > 0) renderContentMentionsFeed(searchItems);
          renderTopSources(searchItems, domain);
          renderMentionInsights(searchItems);
          renderSourceTypes(searchItems);

          // Top Phrases from snippets
          var wordFreq = {};
          var stopWords = new Set(['the','a','an','and','or','but','in','on','at','to','for','of','with','by','from','is','are','was','were','be','been','being','have','has','had','do','does','did','will','would','could','should','may','might','shall','can','not','no','this','that','these','those','it','its','i','you','he','she','we','they','my','your','our','their','me','him','her','us','them','what','which','who','whom','how','when','where','why','all','each','every','both','few','more','most','other','some','such','than','too','very','just','about','above','after','before','between','into','through','during','out','up','down','over','under','again','further','then','once','here','there','also','as','if','so','only','own','same','amp','https','http','www','com','accessed','html','need','make','like','many','much','well','even','back','know','work','first','time','year','years','good','best','find','take','help','come','give','look','want','use','used','using','new','way','one','two','three']);
          (fullSearch?.items || []).forEach(function(item) {
            var text = ((item.content_info || {}).snippet || '') + ' ' + ((item.content_info || {}).title || '');
            text.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).forEach(function(w) {
              if (w.length > 3 && !stopWords.has(w)) wordFreq[w] = (wordFreq[w] || 0) + 1;
            });
          });
          var extractedPhrases = Object.entries(wordFreq).sort(function(a, b) { return b[1] - a[1]; }).slice(0, 20);
          if (extractedPhrases.length > 0) {
            var phrasesEl = document.getElementById('content-phrase-trends');
            if (phrasesEl) {
              var phHtml = '';
              extractedPhrases.forEach(function(p) {
                var maxF = extractedPhrases[0][1];
                var pct = Math.round(p[1] / maxF * 100);
                phHtml += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">'
                  + '<span style="font-size:12px;color:#e4e1e9;min-width:100px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(p[0]) + '</span>'
                  + '<div style="flex:1;background:#1f1f25;border-radius:3px;height:8px;overflow:hidden">'
                  + '<div style="background:#adc6ff;height:100%;width:' + pct + '%;border-radius:3px"></div></div>'
                  + '<span style="font-size:11px;color:#8c909f;min-width:24px;text-align:right">' + p[1] + '</span></div>';
              });
              phrasesEl.innerHTML = phHtml;
            }
          }
        } catch(e) { console.warn('Search cache load error:', e); }
      }
    }

    // Load news from history — filter to relevant articles only
    try {
      var newsHist = await SEO.history({ tool: 'serp_news', target: brandName, limit: 1 }).catch(function() { return {}; });
      if (!(newsHist?.queries?.length > 0)) {
        newsHist = await SEO.history({ tool: 'serp_news', limit: 1 }).catch(function() { return {}; });
      }
      if (newsHist?.queries?.length > 0 && newsHist.queries[0].id) {
        var newsFull = await SEO.historyById(newsHist.queries[0].id).catch(function() { return {}; });
        var rawNews = newsFull?.items || [];
        var bLower = brandName.toLowerCase();
        var bWords = bLower.split(/\s+/).filter(function(w) { return w.length > 3; });
        var newsItems = rawNews.filter(function(item) {
          var text = ((item.title || '') + ' ' + (item.snippet || '')).toLowerCase();
          var mc = bWords.filter(function(w) { return text.indexOf(w) !== -1; }).length;
          return mc >= Math.min(bWords.length, 2);
        });
        if (newsItems.length > 0) {
          hasData = true;
          renderContentNewsFeed(newsItems, 0);
        } else {
          var newsEl = document.getElementById('content-news-feed');
          if (newsEl) newsEl.innerHTML = '<div style="padding:16px;text-align:center;color:#8c909f;font-size:12px">No relevant news found for "' + escHtml(brandName) + '". Most local businesses won\'t have news coverage — this is normal.</div>';
        }
      }
    } catch(e) { /* silent */ }

    // Render content trends chart from history
    renderContentTrendsChart(brandName);

    // Load cached rating distribution from history (FREE)
    try {
      var ratingHist = await SEO.history({ tool: 'content_analysis_rating', target: brandName, limit: 1 }).catch(function() { return {}; });
      if (!(ratingHist?.queries?.length > 0)) {
        ratingHist = await SEO.history({ tool: 'content_analysis_rating', limit: 1 }).catch(function() { return {}; });
      }
      if (ratingHist?.queries?.length > 0 && ratingHist.queries[0].id) {
        var fullRating = await SEO.historyById(ratingHist.queries[0].id).catch(function() { return {}; });
        var ratingItems = fullRating?.items || [];
        if (ratingItems.length > 0) {
          hasData = true;
          renderContentRatings(ratingItems, brandName);
        }
      }
    } catch(e) { /* silent */ }

    // Update history count badge
    (async function() {
      var tools = ['content_analysis_search', 'content_analysis_summary', 'content_analysis_sentiment', 'content_analysis_rating'];
      var total = 0;
      await Promise.all(tools.map(function(t) {
        return SEO.history({ tool: t, target: brandName || domain, limit: 1 })
          .then(function(d) { total += (d?.queries || []).length; }).catch(function(){});
      }));
      var c = document.getElementById('content-history-count');
      if (c) c.textContent = total;
    })();

    if (!hasData) {
      showToast('No cached content data. Use Refresh to fetch live data.', 'info');
    }
  } catch (e) {
    console.warn('Content monitor load error:', e);
  }
}

async function renderContentTrendsChart(domain) {
  try {
    // Use search results (not summary) — those have actual mention counts
    var hist = await SEO.history({ tool: 'content_analysis_search', target: domain, limit: 15 }).catch(function() { return {}; });
    // Show queries that have results — use item count or total_count
    var queries = (hist?.queries || []).filter(function(q) {
      return (q.summary?.total_count && q.summary.total_count > 0) || (q.result_count && q.result_count > 0);
    }).reverse();
    if (queries.length > 0) {
      var series = queries.map(function(q) { return q.summary?.total_count || q.result_count || 0; });
      var cats = queries.map(function(q) {
        var d = new Date(q.created_at || q.timestamp);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      });
      renderAreaChart('chart-content-trends', series, cats, { height: 200, name: 'Mentions Found', colors: ['#adc6ff'] });
    } else {
      renderAreaChart('chart-content-trends', [0], ['Run analysis to see trends'], { height: 200, name: 'Mentions Found', colors: ['#adc6ff'] });
    }
  } catch(e) { console.warn('Content trends chart error:', e); }
}

function toggleContentHistory() {
  var body = document.getElementById('content-history-body');
  var toggle = document.getElementById('content-history-toggle');
  if (!body) return;
  var isHidden = body.style.display === 'none';
  body.style.display = isHidden ? 'block' : 'none';
  if (toggle) toggle.style.transform = isHidden ? 'rotate(180deg)' : '';
  if (isHidden && !body.innerHTML.trim()) loadContentHistory();
}

async function loadContentHistory() {
  var body = document.getElementById('content-history-body');
  var countEl = document.getElementById('content-history-count');
  if (!body) return;
  body.innerHTML = '<div style="padding:20px;text-align:center;color:#8c909f;font-size:12px">Loading...</div>';
  var domain = SEO.activeProject;
  var brandName = domain ? getProjectBrand() : '';
  try {
    var prefs = await SEO.preferences().catch(function() { return {}; });
    if (prefs?.brand_name) brandName = prefs.brand_name;
  } catch(e) {}
  try {
    var tools = ['content_analysis_search', 'content_analysis_summary', 'content_analysis_sentiment'];
    var allQueries = [];
    await Promise.all(tools.map(function(tool) {
      return SEO.history({ tool: tool, target: brandName || domain || undefined, limit: 30 })
        .then(function(data) { (data?.queries || []).forEach(function(q) { q._tool = tool; allQueries.push(q); }); })
        .catch(function() {});
    }));
    allQueries.sort(function(a,b) { return new Date(b.created_at || 0) - new Date(a.created_at || 0); });
    if (countEl) countEl.textContent = allQueries.length;
    if (allQueries.length === 0) {
      body.innerHTML = '<div style="padding:20px;text-align:center;color:#8c909f;font-size:12px">No reports yet. Click Refresh to run content analysis.</div>';
      return;
    }
    var html = '';
    allQueries.forEach(function(q, idx) {
      var date = (q.created_at || '');
      var dateStr = date ? new Date(date).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '--';
      var tool = (q._tool || q.tool || '').replace('content_analysis_', '').replace(/_/g, ' ');
      var target = q.query_target || '--';
      var count = q.result_count || 0;
      var cost = q.cost ? '$' + Number(q.cost).toFixed(4) : 'FREE';
      html += '<div style="padding:10px 16px;border-bottom:1px solid rgba(66,71,84,0.1);cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:8px" onclick="expandContentHistoryEntry(this,' + (q.id || 0) + ')">'
        + '<div style="display:flex;align-items:center;gap:8px;min-width:0">'
        + '<span class="material-symbols-outlined" style="font-size:14px;color:#adc6ff">description</span>'
        + '<span style="font-size:12px;font-weight:600;color:#e4e1e9">' + escHtml(tool) + '</span>'
        + '<span style="font-size:11px;color:#8c909f">' + escHtml(target) + '</span></div>'
        + '<div style="display:flex;align-items:center;gap:12px;flex-shrink:0">'
        + '<span style="font-size:10px;color:#8c909f">' + count + ' results</span>'
        + '<span style="font-size:10px;font-weight:600;color:#4ae176">' + cost + '</span>'
        + '<span style="font-size:10px;color:#8c909f">' + dateStr + '</span>'
        + '<span class="material-symbols-outlined" style="font-size:14px;color:#8c909f">chevron_right</span>'
        + '</div></div>'
        + '<div id="content-hist-' + idx + '" style="display:none;padding:8px 16px 16px"></div>';
    });
    body.innerHTML = html;
  } catch(e) {
    body.innerHTML = '<div style="padding:20px;text-align:center;color:#8c909f;font-size:12px">Error: ' + escHtml(e.message) + '</div>';
  }
}

var _contentHistExpanded = {};
async function expandContentHistoryEntry(el, queryId) {
  var next = el.nextElementSibling;
  if (!next) return;
  if (next.style.display !== 'none') { next.style.display = 'none'; return; }
  next.style.display = 'block';
  if (_contentHistExpanded[queryId]) return;
  _contentHistExpanded[queryId] = true;
  if (!queryId) { next.innerHTML = '<span style="font-size:11px;color:#8c909f">No details available</span>'; return; }
  next.innerHTML = '<span style="font-size:11px;color:#8c909f">Loading...</span>';
  try {
    var full = await SEO.historyById(queryId);
    var items = full?.items || [];
    if (items.length === 0) { next.innerHTML = '<span style="font-size:11px;color:#8c909f">No detailed data for this query.</span>'; return; }
    var first = items[0];
    var html = '';

    // Type 1: Search results (have content_info with title, snippet, etc.)
    if (first.content_info || first.main_domain) {
      html = '<div style="max-height:300px;overflow-y:auto"><table style="width:100%;font-size:11px;border-collapse:collapse">'
        + '<thead><tr style="border-bottom:1px solid rgba(66,71,84,0.2);position:sticky;top:0;background:#131318">'
        + '<th style="text-align:left;padding:6px 8px;color:#8c909f;font-weight:700">Title</th>'
        + '<th style="text-align:left;padding:6px 8px;color:#8c909f;font-weight:700">Source</th>'
        + '<th style="text-align:left;padding:6px 8px;color:#8c909f;font-weight:700">Sentiment</th>'
        + '<th style="text-align:right;padding:6px 8px;color:#8c909f;font-weight:700">Score</th>'
        + '</tr></thead><tbody>';
      items.slice(0, 50).forEach(function(item) {
        var ci = item.content_info || {};
        var title = (ci.title || ci.main_title || '--').replace(/\n/g, ' ').substring(0, 50);
        var dom = item.main_domain || item.domain || '--';
        var url = item.url || '';
        var ct = ci.connotation_types || {};
        var sent = 'neutral'; var sv = ct.neutral || 0;
        if ((ct.positive||0) > sv) { sent = 'positive'; sv = ct.positive; }
        if ((ct.negative||0) > sv) sent = 'negative';
        var sentColor = sent === 'positive' ? '#4ae176' : sent === 'negative' ? '#ffb3ad' : '#8c909f';
        html += '<tr style="border-bottom:1px solid rgba(66,71,84,0.05)">'
          + '<td style="padding:6px 8px;color:#e4e1e9;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(title) + '</td>'
          + '<td style="padding:6px 8px">' + (url ? '<a href="' + escHtml(url) + '" target="_blank" style="color:#adc6ff;text-decoration:none;font-size:10px">' + escHtml(dom) + '</a>' : escHtml(dom)) + '</td>'
          + '<td style="padding:6px 8px;color:' + sentColor + ';font-weight:600;font-size:10px;text-transform:uppercase">' + sent + '</td>'
          + '<td style="padding:6px 8px;text-align:right;color:#8c909f">' + Math.round(item.score || 0) + '</td>'
          + '</tr>';
      });
      if (items.length > 50) html += '<tr><td colspan="4" style="padding:8px;text-align:center;color:#8c909f;font-size:10px">Showing 50 of ' + items.length + '</td></tr>';
      html += '</tbody></table></div>';
    }
    // Type 2: Summary/sentiment (single object with connotation_types, total_count, etc.)
    else if (first.connotation_types || first.total_count !== undefined || first.sentiment_connotations) {
      var ct = first.connotation_types || {};
      var sc = first.sentiment_connotations || {};
      html = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;padding:8px 0">';
      if (first.total_count !== undefined) html += '<div style="background:#1f1f25;padding:10px;border-radius:8px"><div style="font-size:10px;color:#8c909f;text-transform:uppercase;margin-bottom:4px">Total Mentions</div><div style="font-size:18px;font-weight:800;color:#e4e1e9">' + fmtNum(first.total_count) + '</div></div>';
      if (ct.positive !== undefined) html += '<div style="background:#1f1f25;padding:10px;border-radius:8px"><div style="font-size:10px;color:#8c909f;text-transform:uppercase;margin-bottom:4px">Positive</div><div style="font-size:18px;font-weight:800;color:#4ae176">' + (ct.positive < 1 ? Math.round(ct.positive * 100) + '%' : fmtNum(ct.positive)) + '</div></div>';
      if (ct.neutral !== undefined) html += '<div style="background:#1f1f25;padding:10px;border-radius:8px"><div style="font-size:10px;color:#8c909f;text-transform:uppercase;margin-bottom:4px">Neutral</div><div style="font-size:18px;font-weight:800;color:#adc6ff">' + (ct.neutral < 1 ? Math.round(ct.neutral * 100) + '%' : fmtNum(ct.neutral)) + '</div></div>';
      if (ct.negative !== undefined) html += '<div style="background:#1f1f25;padding:10px;border-radius:8px"><div style="font-size:10px;color:#8c909f;text-transform:uppercase;margin-bottom:4px">Negative</div><div style="font-size:18px;font-weight:800;color:#ffb3ad">' + (ct.negative < 1 ? Math.round(ct.negative * 100) + '%' : fmtNum(ct.negative)) + '</div></div>';
      // Sentiment emotions
      for (var emo in sc) { if (sc[emo]) html += '<div style="background:#1f1f25;padding:10px;border-radius:8px"><div style="font-size:10px;color:#8c909f;text-transform:uppercase;margin-bottom:4px">' + escHtml(emo) + '</div><div style="font-size:18px;font-weight:800;color:#c2c6d6">' + (sc[emo] < 1 ? Math.round(sc[emo] * 100) + '%' : sc[emo]) + '</div></div>'; }
      html += '</div>';
    }
    // Type 3: Unknown — show key-value pairs
    else {
      html = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;padding:4px 0">';
      for (var k in first) {
        if (first[k] !== null && typeof first[k] !== 'object') {
          html += '<div style="font-size:11px"><span style="color:#8c909f">' + escHtml(k) + ':</span> <span style="color:#e4e1e9;font-weight:600">' + escHtml(String(first[k]).substring(0, 60)) + '</span></div>';
        }
      }
      html += '</div>';
    }
    next.innerHTML = html;
  } catch(e) {
    next.innerHTML = '<span style="font-size:11px;color:#ffb3ad">Failed: ' + escHtml(e.message) + '</span>';
  }
}

/**
 * refreshContentMonitor - on refresh click (~$0.06)
 */
async function refreshContentMonitor(btn) {
  var domain = SEO.activeProject;
  if (!domain) { showToast('Select a project first', 'warning'); return; }
  if (!checkBalanceWarning(0.10)) return;  // ~$0.10: search + summary + sentiment + phrase_trends + news
  if (_debounceTimers['refreshContent']) return;
  _debounceTimers['refreshContent'] = true;
  setTimeout(function() { _debounceTimers['refreshContent'] = false; }, 3000);

  // Get brand name from input or default to domain
  var brandInput = document.getElementById('content-brand-input');
  var brandName = (brandInput?.value || '').trim() || getProjectBrand();

  // Persist brand name to preferences so it survives page reloads
  if (brandInput?.value?.trim()) {
    SEO.savePreferences({ brand_name: brandName }).catch(function(e) { /* silent */ });
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Searching...'; }
  SEO.startAction();

  try {
    // Use brand name for content analysis
    var contentKeyword = brandName || domain;
    var results = await Promise.all([
      SEO.dfs('content_analysis/search/live', {
        keyword: contentKeyword,
        search_mode: 'as_is',
        limit: parseInt(document.getElementById('content-page-size')?.value || '100')
      }).catch(function(e) { console.warn('Content search failed:', e.message); return null; }),

      SEO.dfs('content_analysis/summary/live', {
        keyword: contentKeyword,
        search_mode: 'as_is'
      }).catch(function(e) { console.warn('Content summary failed:', e.message); return null; }),

      SEO.dfs('content_analysis/sentiment_analysis/live', {
        keyword: contentKeyword
      }).catch(function(e) { console.warn('Sentiment failed:', e.message); return null; }),

      SEO.dfs('content_analysis/phrase_trends/live', {
        keyword: contentKeyword,
        date_from: new Date(Date.now() - 365*86400000).toISOString().slice(0,10)
      }).catch(function(e) { console.warn('Phrase trends failed:', e.message); return null; }),

      // Google News SERP — quotes for Google search exact phrase
      SEO.dfs('serp/google/news/live/advanced', {
        keyword: '"' + (brandName || contentKeyword) + '"',
        location_name: getProjectLocLang().location_name,
        language_name: getProjectLocLang().language_name,
        depth: 20
      }).catch(function(e) { console.warn('News SERP failed:', e.message); return null; }),

    ]);

    var searchRes = results[0], summaryRes = results[1], sentimentRes = results[2], phraseTrendsRes = results[3], newsRes = results[4];

    // ===== SEARCH RESULTS = SINGLE SOURCE OF TRUTH =====
    // All KPIs, sentiment, phrases, sources derived from search results — no conflicting data
    if (searchRes) {
      var searchResult = searchRes?.tasks?.[0]?.result?.[0] || {};
      var searchItems = searchResult?.items || [];
      // Filter out own-domain results
      var ownDomain = domain.replace(/^www\./, '');
      searchItems = searchItems.filter(function(item) {
        var itemDomain = (item.main_domain || '').replace(/^www\./, '');
        return itemDomain !== ownDomain;
      });

      // 1. Mention Overview — total from search result, sentiment from items
      var posCt = 0, neuCt = 0, negCt = 0;
      searchItems.forEach(function(item) {
        var ct = (item.content_info || {}).connotation_types || {};
        if ((ct.positive || 0) > 0.45) posCt++;
        else if ((ct.negative || 0) > 0.60) negCt++;
        else neuCt++;
      });
      var n = searchItems.length || 1;
      var sentimentData = { positive: posCt/n, neutral: neuCt/n, negative: negCt/n };
      renderContentSummary({
        total_count: searchResult.total_count || searchItems.length,
        analyzed_count: searchItems.length,
        connotation_types: sentimentData
      });

      // 2. Sentiment pie chart — same data
      renderContentSentiment({ connotation_types: sentimentData });

      // 3. Mentions feed
      if (searchItems.length > 0) renderContentMentionsFeed(searchItems);

      // 4. Top Sources — from search items
      renderTopSources(searchItems, domain);

      // 4b. Mention Insights + Source Types — from search items
      renderMentionInsights(searchItems);
      renderSourceTypes(searchItems);

      // 5. Top Phrases — extracted from search result snippets
      var wordFreq = {};
      var stopWords = new Set(['the','a','an','and','or','but','in','on','at','to','for','of','with','by','from','is','are','was','were','be','been','being','have','has','had','do','does','did','will','would','could','should','may','might','shall','can','not','no','this','that','these','those','it','its','i','you','he','she','we','they','my','your','our','their','me','him','her','us','them','what','which','who','whom','how','when','where','why','all','each','every','both','few','more','most','other','some','such','than','too','very','just','about','above','after','before','between','into','through','during','out','up','down','over','under','again','further','then','once','here','there','also','as','if','so','only','own','same','amp','https','http','www','com','accessed','html','need','make','like','many','much','also','well','even','back','know','work','first','time','year','years','good','best','find','take','help','come','give','look','want','use','used','using','new','way','one','two','three']);
      (searchResult.items || []).forEach(function(item) {
        var text = ((item.content_info || {}).snippet || '') + ' ' + ((item.content_info || {}).title || '');
        text.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).forEach(function(w) {
          if (w.length > 3 && !stopWords.has(w)) wordFreq[w] = (wordFreq[w] || 0) + 1;
        });
      });
      var extractedPhrases = Object.entries(wordFreq).sort(function(a, b) { return b[1] - a[1]; }).slice(0, 20);
      if (extractedPhrases.length > 0) {
        var phrasesEl = document.getElementById('content-phrase-trends');
        if (phrasesEl) {
          var phHtml = '';
          extractedPhrases.forEach(function(p) {
            var maxF = extractedPhrases[0][1];
            var pct = Math.round(p[1] / maxF * 100);
            phHtml += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">'
              + '<span style="font-size:12px;color:#e4e1e9;min-width:100px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(p[0]) + '</span>'
              + '<div style="flex:1;background:#1f1f25;border-radius:3px;height:8px;overflow:hidden">'
              + '<div style="background:#adc6ff;height:100%;width:' + pct + '%;border-radius:3px"></div></div>'
              + '<span style="font-size:11px;color:#8c909f;min-width:24px;text-align:right">' + p[1] + '</span>'
              + '</div>';
          });
          phrasesEl.innerHTML = phHtml;
        }
      }
    }

    // Mention Trends chart from phrase_trends time-series
    if (phraseTrendsRes) {
      var ptResult = phraseTrendsRes?.tasks?.[0]?.result;
      if (ptResult && ptResult.length > 0) {
        var chartEl = document.getElementById('chart-content-trends');
        if (chartEl) {
          try {
            var tLabels = ptResult.map(function(t) {
              var d = t.date || t.date_from || '';
              return d ? new Date(d).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }) : '';
            });
            var tValues = ptResult.map(function(t) {
              var tc = t.total_count || (t.metrics && t.metrics.total_count) || 0;
              if (!tc) { var countries = t.countries || {}; for (var c in countries) tc += (countries[c] || 0); }
              return tc;
            });
            chartEl.innerHTML = '';
            new ApexCharts(chartEl, {
              chart: { type: 'area', height: 200, background: 'transparent', toolbar: { show: false } },
              series: [{ name: 'Mentions', data: tValues }],
              xaxis: { categories: tLabels, labels: { style: { colors: '#8c909f', fontSize: '10px' } } },
              yaxis: { labels: { style: { colors: '#8c909f', fontSize: '10px' } } },
              stroke: { curve: 'smooth', width: 2 },
              fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0.05 } },
              colors: ['#adc6ff'],
              theme: { mode: 'dark' },
              grid: { borderColor: '#2a292f', strokeDashArray: 4 },
              tooltip: { theme: 'dark' }
            }).render();
          } catch(e) { console.warn('Mention trends chart error:', e); }
        }
      }
    }

    // Render news feed — filter to only articles that actually mention the brand in the title or snippet
    if (newsRes) {
      var rawNewsItems = newsRes?.tasks?.[0]?.result?.[0]?.items || [];
      var brandLower = contentKeyword.toLowerCase();
      var brandWords = brandLower.split(/\s+/).filter(function(w) { return w.length > 3; });
      var newsItems = rawNewsItems.filter(function(item) {
        var title = (item.title || '').toLowerCase();
        var snippet = (item.snippet || item.description || '').toLowerCase();
        var text = title + ' ' + snippet;
        // Must contain at least 2 of the brand words together (not just "agency" or "contractor" alone)
        var matchCount = brandWords.filter(function(w) { return text.indexOf(w) !== -1; }).length;
        return matchCount >= Math.min(brandWords.length, 2);
      });
      if (newsItems.length > 0) {
        renderContentNewsFeed(newsItems, 0);
      } else {
        var newsEl = document.getElementById('content-news-feed');
        if (newsEl) newsEl.innerHTML = '<div style="padding:16px;text-align:center;color:#8c909f;font-size:12px">No relevant news found for "' + escHtml(contentKeyword) + '".<br><span style="font-size:10px;margin-top:4px;display:block">Google News is searched for your brand name. Most local businesses won\'t have news coverage — this is normal.</span></div>';
      }
    }




    var ac = SEO.getActionCost();
    showToast('Content analysis — ' + ac.calls + ' calls, cost: ' + SEO.fmtCost(ac.cost), 'success', 6000);
  } catch (e) {
    showToast('Content analysis failed: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Refresh (~$0.10)'; }
  }
}

/**
 * scanContentRatings — Fetch review rating distribution across the web (~$0.02)
 * Uses content_analysis/rating_distribution/live with the brand name as keyword
 */
async function scanContentRatings(btn) {
  var domain = SEO.activeProject;
  if (!domain) { showToast('Select a project first', 'warning'); return; }
  if (!checkBalanceWarning(0.02)) return;
  if (_debounceTimers['scanRatings']) return;
  _debounceTimers['scanRatings'] = true;
  setTimeout(function() { _debounceTimers['scanRatings'] = false; }, 3000);

  var brandName = getProjectBrand();
  if (btn) { btn.disabled = true; btn.textContent = 'Scanning...'; }
  SEO.startAction();

  try {
    var res = await SEO.dfs('content_analysis/rating_distribution/live', {
      keyword: brandName,
      search_mode: 'as_is'
    });

    var result = res?.tasks?.[0]?.result;
    var hasWebRatings = result && result.some(function(r) { return (r.metrics?.total_count || 0) > 0; });
    if (hasWebRatings) {
      renderContentRatings(result, brandName);
    } else {
      // Fallback: show GMB reviews if available
      var proj = _projectsCache[domain] || {};
      var gmb = proj.gmb_data || {};
      var gmbRating = parseFloat(gmb.rating || proj.gmb_rating || 0);
      var gmbReviews = parseInt(gmb.reviews || proj.gmb_reviews || 0);
      var el = document.getElementById('content-ratings-body');
      if (el && gmbRating > 0) {
        el.innerHTML = '<div style="padding:16px">'
          + '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">'
          + '<div style="font-size:40px;font-weight:900;color:#f59e0b">' + gmbRating.toFixed(1) + '</div>'
          + '<div><div style="display:flex;gap:2px;margin-bottom:4px">' + renderStarsContent(gmbRating) + '</div>'
          + '<div style="font-size:13px;color:#e4e1e9;font-weight:600">' + gmbReviews + ' Google reviews</div></div></div>'
          + '<div style="padding:10px 14px;background:rgba(173,198,255,0.06);border:1px solid rgba(173,198,255,0.2);border-radius:8px;font-size:12px;color:#8c909f">'
          + 'No third-party review sites found for "' + escHtml(brandName) + '". Showing Google Business Profile reviews. '
          + 'To build web presence, consider listing on Yelp, BBB, Angi, HomeAdvisor, and industry directories.</div></div>';
      } else if (el) {
        el.innerHTML = '<div style="padding:20px;text-align:center;color:#8c909f;font-size:13px">No rating data found for "' + escHtml(brandName) + '". Connect a Google Business Profile to see GMB reviews.</div>';
      }
    }

    var ac = SEO.getActionCost();
    showToast('Rating scan complete — cost: ' + SEO.fmtCost(ac.cost), 'success', 5000);
  } catch(e) {
    showToast('Rating scan failed: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Scan Ratings (~$0.02)'; }
  }
}

/**
 * renderContentRatings — 5-star horizontal bar chart (Amazon-style)
 * Handles two DataForSEO formats:
 *   1) rating_distribution: 10 buckets on 0-1 scale ({min, max, metrics.total_count})
 *   2) Legacy: flat array of {rating (1-5), count}
 */
function renderContentRatings(result, brandName) {
  var el = document.getElementById('content-ratings-body');
  if (!el) return;

  var dist = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  var totalReviews = 0;
  var weightedSum = 0;

  if (Array.isArray(result)) {
    // Detect format: DataForSEO rating_distribution has min/max/metrics
    var isDistFormat = result.length > 0 && result[0].type === 'content_analysis_rating_distribution';
    if (isDistFormat) {
      // Map 10 sentiment buckets (0-1 scale) to 5 stars:
      // 0.0-0.2 → 1 star, 0.2-0.4 → 2, 0.4-0.6 → 3, 0.6-0.8 → 4, 0.8-1.0 → 5
      result.forEach(function(item) {
        var midpoint = ((item.min || 0) + (item.max || 0)) / 2;
        var star = midpoint < 0.2 ? 1 : midpoint < 0.4 ? 2 : midpoint < 0.6 ? 3 : midpoint < 0.8 ? 4 : 5;
        var c = item.metrics?.total_count || 0;
        if (c > 0) {
          dist[star] += c;
          totalReviews += c;
          weightedSum += star * c;
        }
      });
    } else {
      // Legacy format: {rating, count}
      result.forEach(function(item) {
        var r = Math.round(item.rating || 0);
        var c = item.count || 0;
        if (r >= 1 && r <= 5) {
          dist[r] += c;
          totalReviews += c;
          weightedSum += r * c;
        }
      });
    }
  }

  var avgRating = totalReviews > 0 ? (weightedSum / totalReviews) : 0;

  // Header: average + total
  var html = '<div style="display:flex;align-items:center;gap:16px;margin-bottom:16px;flex-wrap:wrap">'
    + '<div style="text-align:center">'
    + '<div style="font-size:40px;font-weight:900;color:#f59e0b;font-variant-numeric:tabular-nums">' + avgRating.toFixed(1) + '</div>'
    + '<div style="display:flex;align-items:center;justify-content:center;gap:2px;margin:4px 0">' + renderStarsContent(avgRating) + '</div>'
    + '<div style="font-size:11px;color:#8c909f">' + fmtNum(totalReviews) + ' ratings across the web</div>'
    + '</div>'
    + '<div style="flex:1;min-width:200px">';

  // 5-star bar breakdown
  for (var star = 5; star >= 1; star--) {
    var count = dist[star];
    var pct = totalReviews > 0 ? Math.round(count / totalReviews * 100) : 0;
    var barColor = star >= 4 ? '#4ae176' : star >= 3 ? '#f59e0b' : '#ffb3ad';
    html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">'
      + '<span style="font-size:12px;font-weight:700;color:#e4e1e9;width:12px;text-align:right">' + star + '</span>'
      + '<span class="material-symbols-outlined" style="font-size:14px;color:#f59e0b;font-variation-settings:\'FILL\' 1">star</span>'
      + '<div style="flex:1;height:10px;background:#2a292f;border-radius:5px;overflow:hidden">'
      + '<div style="height:100%;width:' + pct + '%;background:' + barColor + ';border-radius:5px;transition:width 0.3s"></div></div>'
      + '<span style="font-size:11px;font-weight:600;color:#8c909f;min-width:60px;text-align:right">' + fmtNum(count) + ' (' + pct + '%)</span>'
      + '</div>';
  }

  html += '</div></div>';

  // Source note
  html += '<div style="font-size:10px;color:#64687a;margin-top:8px">Rating distribution for "' + escHtml(brandName || '') + '" aggregated from web sources found by DataForSEO Content Analysis.</div>';

  el.innerHTML = html;
}

/**
 * renderStarsContent — star icons for content module (avoids dependency on local.js renderStars)
 */
function renderStarsContent(rating) {
  var html = '';
  for (var i = 1; i <= 5; i++) {
    if (i <= Math.floor(rating)) {
      html += '<span class="material-symbols-outlined" style="font-size:16px;color:#f59e0b;font-variation-settings:\'FILL\' 1">star</span>';
    } else if (i - 0.5 <= rating) {
      html += '<span class="material-symbols-outlined" style="font-size:16px;color:#f59e0b;font-variation-settings:\'FILL\' 1">star_half</span>';
    } else {
      html += '<span class="material-symbols-outlined" style="font-size:16px;color:#35343a">star</span>';
    }
  }
  return html;
}

function renderContentSummary(data) {
  var el = document.getElementById('content-mention-count');
  if (!el) return;

  var totalFound = data.total_count || data.items_count || 0;
  var connotations = data.connotation_types || {};
  var posRatio = connotations.positive || 0;
  var negRatio = connotations.negative || 0;
  var neuRatio = connotations.neutral || 0;
  // Ratios are 0-1 floats (from summary API) or counts (from item classification)
  var isRatio = posRatio > 0 && posRatio <= 1 && negRatio <= 1;
  var posCount = isRatio ? Math.round(posRatio * totalFound) : Math.round(posRatio);
  var negCount = isRatio ? Math.round(negRatio * totalFound) : Math.round(negRatio);
  var neuCount = isRatio ? Math.round(neuRatio * totalFound) : Math.round(neuRatio);

  el.innerHTML = '<div style="display:flex;align-items:baseline;gap:8px">'
    + '<span style="font-size:36px;font-weight:900;color:#e4e1e9;font-variant-numeric:tabular-nums">' + fmtNum(totalFound) + '</span>'
    + '<span style="font-size:12px;font-weight:600;color:#8c909f">total mentions</span></div>'
    + '<div style="display:flex;gap:16px;margin-top:12px">'
    + '<div style="font-size:11px"><span style="color:#4ae176;font-weight:700">' + fmtNum(posCount) + '</span> <span style="color:#8c909f">positive (' + Math.round((isRatio ? posRatio : posCount/totalFound) * 100) + '%)</span></div>'
    + '<div style="font-size:11px"><span style="color:#adc6ff;font-weight:700">' + fmtNum(neuCount) + '</span> <span style="color:#8c909f">neutral</span></div>'
    + '<div style="font-size:11px"><span style="color:#ffb3ad;font-weight:700">' + fmtNum(negCount) + '</span> <span style="color:#8c909f">negative (' + Math.round((isRatio ? negRatio : negCount/totalFound) * 100) + '%)</span></div>'
    + '</div>';
}

function renderContentSentiment(data) {
  var el = document.getElementById('content-sentiment');
  if (!el) return;

  var connotations = data.connotation_types || data.sentiment_connotations || {};
  var posR = connotations.positive?.count ?? connotations.positive ?? 0;
  var neuR = connotations.neutral?.count ?? connotations.neutral ?? 0;
  var negR = connotations.negative?.count ?? connotations.negative ?? 0;
  // If values are floats (0-1), they're already percentages
  var isFloat = (posR > 0 && posR < 1) || (neuR > 0 && neuR < 1) || (negR > 0 && negR < 1);
  var total = posR + neuR + negR;
  // Default to 100% neutral when no sentiment data
  var posPct = total > 0 ? (isFloat ? Math.round(posR * 100) : Math.round(posR / total * 100)) : 0;
  var negPct = total > 0 ? (isFloat ? Math.round(negR * 100) : Math.round(negR / total * 100)) : 0;
  var neuPct = total > 0 ? (isFloat ? Math.round(neuR * 100) : Math.round(neuR / total * 100)) : 100;

  // CSS-based pie approximation using conic-gradient
  el.innerHTML = '<div style="display:flex;align-items:center;gap:20px">'
    + '<div style="width:80px;height:80px;border-radius:50%;background:conic-gradient(#4ae176 0% ' + posPct + '%, #adc6ff ' + posPct + '% ' + (posPct + neuPct) + '%, #ffb3ad ' + (posPct + neuPct) + '% 100%);flex-shrink:0"></div>'
    + '<div style="flex:1">'
    + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">'
    + '<span style="width:10px;height:10px;border-radius:2px;background:#4ae176"></span>'
    + '<span style="font-size:12px;color:#e4e1e9">Positive</span>'
    + '<span style="font-size:12px;font-weight:700;color:#4ae176;margin-left:auto;font-variant-numeric:tabular-nums">' + posPct + '%</span></div>'
    + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">'
    + '<span style="width:10px;height:10px;border-radius:2px;background:#adc6ff"></span>'
    + '<span style="font-size:12px;color:#e4e1e9">Neutral</span>'
    + '<span style="font-size:12px;font-weight:700;color:#adc6ff;margin-left:auto;font-variant-numeric:tabular-nums">' + neuPct + '%</span></div>'
    + '<div style="display:flex;align-items:center;gap:8px">'
    + '<span style="width:10px;height:10px;border-radius:2px;background:#ffb3ad"></span>'
    + '<span style="font-size:12px;color:#e4e1e9">Negative</span>'
    + '<span style="font-size:12px;font-weight:700;color:#ffb3ad;margin-left:auto;font-variant-numeric:tabular-nums">' + negPct + '%</span></div>'
    + '</div></div>'
    + '<div style="font-size:9px;color:#6b6f7b;margin-top:8px;text-align:center">Sentiment reflects page tone (insurance/legal content often reads as "negative" due to risk/claims language)</div>';
}

var _mentionsPage = 0;
var _mentionsPerPage = 20;
var _mentionsData = [];

function renderContentMentionsFeed(items, page) {
  // Deduplicate by URL
  var seen = {};
  items = items.filter(function(item) {
    var url = (item.url || '').toLowerCase();
    if (!url || seen[url]) return false;
    seen[url] = true;
    return true;
  });
  _mentionsData = items;
  if (typeof page === 'number') _mentionsPage = page;
  var el = document.getElementById('content-mentions-feed');
  if (!el) return;

  var start = _mentionsPage * _mentionsPerPage;
  var shown = items.slice(start, start + _mentionsPerPage);

  var html = '';
  shown.forEach(function(item, idx) {
    var ci = item.content_info || {};
    var title = ci.title || ci.main_title || item.title || item.page_title || 'Untitled';
    title = title.replace(/\n/g, ' ').trim();
    var url = item.url || item.page_url || '';
    var domain = item.main_domain || item.domain || (url ? url.replace(/https?:\/\//, '').split('/')[0] : '--');
    var snippet = ci.snippet || ci.highlighted_text || item.excerpt || item.description || '';
    var connotations = ci.connotation_types || item.connotation_types || {};
    var posV = connotations.positive || 0;
    var neuV = connotations.neutral || 0;
    var negV = connotations.negative || 0;
    // Brand mentions: only label negative if overwhelmingly so (>60%).
    // DataForSEO word-level sentiment flags normal business language (lawsuits, claims, insurance) as negative.
    var sentiment = 'neutral';
    if (posV > 0.45) sentiment = 'positive';
    else if (negV > 0.60) sentiment = 'negative';
    var sentColor = sentiment === 'positive' ? '#4ae176' : sentiment === 'negative' ? '#ffb3ad' : '#8c909f';
    var date = ci.date_published || ci.group_date || item.date_published || item.datetime || item.fetch_time || '';
    var dateStr = date ? new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '--';

    var mentionId = 'mention-' + start + '-' + idx;
    html += '<div style="padding:12px 0;border-bottom:1px solid rgba(66,71,84,0.15)">'
      + '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;cursor:pointer" onclick="var e=document.getElementById(\'' + mentionId + '\');e.style.display=e.style.display===\'none\'?\'block\':\'none\'">'
      + '<div style="flex:1;min-width:0">'
      + '<div style="font-size:13px;font-weight:600;color:#e4e1e9">' + escHtml(title) + '</div>'
      + (url ? '<a href="' + escHtml(url) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="font-size:11px;color:#adc6ff;margin-top:2px;display:block;text-decoration:none">' + escHtml(domain) + ' <span class="material-symbols-outlined" style="font-size:10px;vertical-align:middle">open_in_new</span></a>'
             : '<div style="font-size:11px;color:#adc6ff;margin-top:2px">' + escHtml(domain) + '</div>')
      + '<p style="font-size:12px;color:#c2c6d6;margin:6px 0 0;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' + escHtml((snippet || '').substring(0, 200)) + '</p>'
      + '</div>'
      + '<div style="text-align:right;flex-shrink:0">'
      + '<div style="font-size:10px;font-weight:700;color:' + sentColor + ';text-transform:uppercase;letter-spacing:0.05em;padding:2px 6px;border-radius:4px;background:' + sentColor + '15;border:1px solid ' + sentColor + '30">' + escHtml(sentiment) + '</div>'
      + '<div style="font-size:10px;color:#8c909f;margin-top:4px">' + dateStr + '</div>'
      + '<div style="font-size:9px;color:#8c909f;margin-top:2px">click to expand</div>'
      + '</div></div>'
      // Expandable full content
      + '<div id="' + mentionId + '" style="display:none;padding:8px 0 12px">'
      + '<div style="font-size:12px;color:#c2c6d6;line-height:1.6;padding:12px;background:#1f1f25;border-radius:8px;border-left:3px solid ' + sentColor + '">' + escHtml(snippet || 'No content available') + '</div>'
      + '<div style="display:flex;gap:16px;margin-top:8px;font-size:10px;color:#8c909f">'
      + '<span>Score: ' + Math.round(item.score || 0) + '</span>'
      + '<span>Domain Rank: ' + (item.domain_rank || '--') + '</span>'
      + '<span>Pos: ' + Math.round(posV * 100) + '% Neu: ' + Math.round(neuV * 100) + '% Neg: ' + Math.round(negV * 100) + '%</span>'
      + '</div></div>'
      + '</div>';
  });

  // Pagination controls
  if (items.length > _mentionsPerPage) {
    var totalPages = Math.ceil(items.length / _mentionsPerPage);
    html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0">'
      + '<span style="font-size:11px;color:#8c909f">Showing ' + (start + 1) + '-' + Math.min(start + _mentionsPerPage, items.length) + ' of ' + items.length + '</span>'
      + '<div style="display:flex;gap:6px">';
    if (_mentionsPage > 0) html += '<button onclick="renderContentMentionsFeed(_mentionsData,' + (_mentionsPage - 1) + ')" style="padding:4px 10px;font-size:11px;border:1px solid #35343a;background:transparent;color:#adc6ff;border-radius:6px;cursor:pointer;min-height:32px">Prev</button>';
    if (_mentionsPage < totalPages - 1) html += '<button onclick="renderContentMentionsFeed(_mentionsData,' + (_mentionsPage + 1) + ')" style="padding:4px 10px;font-size:11px;border:1px solid #35343a;background:transparent;color:#adc6ff;border-radius:6px;cursor:pointer;min-height:32px">Next</button>';
    html += '</div></div>';
  }

  el.innerHTML = html || '<div style="padding:20px;text-align:center;color:#8c909f;font-size:13px">No mentions found</div>';
}

var _newsPage = 0;
var _newsPerPage = 15;
var _newsData = [];
var _newsSort = 'date'; // 'date', 'source', 'relevance'

function renderContentNewsFeed(items, page) {
  _newsData = items;
  if (typeof page === 'number') _newsPage = page;
  var el = document.getElementById('content-news-feed');
  if (!el) return;

  // Sort
  var sorted = items.slice();
  if (_newsSort === 'source') {
    sorted.sort(function(a, b) {
      var sa = (a.url || '').replace(/https?:\/\//, '').split('/')[0];
      var sb = (b.url || '').replace(/https?:\/\//, '').split('/')[0];
      return sa.localeCompare(sb);
    });
  } else if (_newsSort === 'relevance') {
    sorted.sort(function(a, b) { return (b.score || b.domain_rank || 0) - (a.score || a.domain_rank || 0); });
  }
  // default: date order (API returns chronological)

  var start = _newsPage * _newsPerPage;
  var shown = sorted.slice(start, start + _newsPerPage);

  // Sort controls
  var html = '<div style="display:flex;gap:6px;margin-bottom:8px">'
    + '<select onchange="newsSort(this.value)" style="background:#1f1f25;border:1px solid rgba(66,71,84,0.3);border-radius:6px;padding:4px 8px;color:#e4e1e9;font-size:11px;outline:none">'
    + '<option value="date"' + (_newsSort === 'date' ? ' selected' : '') + '>Newest</option>'
    + '<option value="source"' + (_newsSort === 'source' ? ' selected' : '') + '>By Source</option>'
    + '<option value="relevance"' + (_newsSort === 'relevance' ? ' selected' : '') + '>By Relevance</option>'
    + '</select>'
    + '<span style="font-size:11px;color:#8c909f;line-height:28px">' + items.length + ' articles</span>'
    + '</div>';

  shown.forEach(function(item) {
    var title = item.title || 'Untitled';
    var url = item.url || '';
    var source = url ? url.replace(/https?:\/\//, '').split('/')[0] : '--';
    var date = item.date_published || item.time_published || item.datetime || item.timestamp || '';
    var dateObj = date ? new Date(date) : null;
    var dateStr = (dateObj && !isNaN(dateObj.getTime())) ? dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '--';

    html += '<a href="' + escHtml(url) + '" target="_blank" rel="noopener" style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid rgba(66,71,84,0.1);text-decoration:none;color:inherit">'
      + '<span class="material-symbols-outlined" style="font-size:18px;color:#8c909f;margin-top:2px">newspaper</span>'
      + '<div style="flex:1;min-width:0">'
      + '<div style="font-size:13px;font-weight:600;color:#e4e1e9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(title) + '</div>'
      + '<div style="font-size:10px;color:#8c909f;margin-top:2px">' + escHtml(source) + ' &middot; ' + dateStr + '</div>'
      + '</div></a>';
  });

  // Pagination
  if (items.length > _newsPerPage) {
    var totalPages = Math.ceil(items.length / _newsPerPage);
    html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0">'
      + '<span style="font-size:11px;color:#8c909f">' + (start + 1) + '-' + Math.min(start + _newsPerPage, items.length) + ' of ' + items.length + '</span>'
      + '<div style="display:flex;gap:6px">';
    if (_newsPage > 0) html += '<button onclick="renderContentNewsFeed(_newsData,' + (_newsPage - 1) + ')" style="padding:4px 10px;font-size:11px;border:1px solid #35343a;background:transparent;color:#adc6ff;border-radius:6px;cursor:pointer;min-height:32px">Prev</button>';
    if (_newsPage < totalPages - 1) html += '<button onclick="renderContentNewsFeed(_newsData,' + (_newsPage + 1) + ')" style="padding:4px 10px;font-size:11px;border:1px solid #35343a;background:transparent;color:#adc6ff;border-radius:6px;cursor:pointer;min-height:32px">Next</button>';
    html += '</div></div>';
  }

  el.innerHTML = html || '<div style="padding:16px;text-align:center;color:#8c909f;font-size:13px">No news articles found</div>';
}

function newsSort(val) {
  _newsSort = val;
  _newsPage = 0;
  renderContentNewsFeed(_newsData, 0);
}

/**
 * renderMentionInsights — key metrics derived from search results (no extra API cost)
 */
function renderMentionInsights(items) {
  var el = document.getElementById('content-mention-insights');
  if (!el || !items || items.length === 0) {
    if (el) el.innerHTML = '<div style="padding:12px;text-align:center;color:#8c909f;font-size:12px">No mention data available.</div>';
    return;
  }
  // Unique domains
  var domains = {};
  items.forEach(function(item) { var d = item.main_domain || item.domain || ''; if (d) domains[d] = true; });
  var uniqueDomains = Object.keys(domains).length;

  // Average domain authority (domain_rank)
  var ranks = items.map(function(item) { return item.domain_rank || 0; }).filter(function(r) { return r > 0; });
  var avgRank = ranks.length > 0 ? Math.round(ranks.reduce(function(a, b) { return a + b; }, 0) / ranks.length) : 0;
  var highAuthority = ranks.filter(function(r) { return r > 500; }).length;

  // Date range
  var dates = items.map(function(item) {
    var d = (item.content_info || {}).date_published || item.fetch_time || '';
    return d ? new Date(d) : null;
  }).filter(function(d) { return d && !isNaN(d.getTime()); }).sort(function(a, b) { return a - b; });
  var oldestStr = dates.length > 0 ? dates[0].toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '--';
  var newestStr = dates.length > 0 ? dates[dates.length - 1].toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '--';

  // Recent mentions (last 6 months)
  var sixMonthsAgo = new Date(); sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  var recentCount = dates.filter(function(d) { return d >= sixMonthsAgo; }).length;

  var html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">';
  html += '<div style="background:#1f1f25;padding:12px;border-radius:8px">'
    + '<div style="font-size:24px;font-weight:900;color:#e4e1e9">' + uniqueDomains + '</div>'
    + '<div style="font-size:10px;color:#8c909f;margin-top:2px">Unique Sites</div></div>';
  html += '<div style="background:#1f1f25;padding:12px;border-radius:8px">'
    + '<div style="font-size:24px;font-weight:900;color:#' + (avgRank > 300 ? '4ae176' : avgRank > 100 ? 'f59e0b' : '8c909f') + '">' + fmtNum(avgRank) + '</div>'
    + '<div style="font-size:10px;color:#8c909f;margin-top:2px">Avg Site Authority</div></div>';
  html += '<div style="background:#1f1f25;padding:12px;border-radius:8px">'
    + '<div style="font-size:24px;font-weight:900;color:#adc6ff">' + highAuthority + '</div>'
    + '<div style="font-size:10px;color:#8c909f;margin-top:2px">High-Authority Sites</div></div>';
  html += '<div style="background:#1f1f25;padding:12px;border-radius:8px">'
    + '<div style="font-size:24px;font-weight:900;color:#' + (recentCount > 0 ? '4ae176' : '8c909f') + '">' + recentCount + '</div>'
    + '<div style="font-size:10px;color:#8c909f;margin-top:2px">Last 6 Months</div></div>';
  html += '</div>';
  html += '<div style="font-size:10px;color:#6b6f7b;margin-top:8px">Mentions span ' + oldestStr + ' to ' + newestStr + '</div>';
  el.innerHTML = html;
}

/**
 * renderSourceTypes — breakdown by page type (blogs, news, organizations, etc.)
 */
function renderSourceTypes(items) {
  var el = document.getElementById('content-source-types');
  if (!el || !items || items.length === 0) {
    if (el) el.innerHTML = '<div style="padding:12px;text-align:center;color:#8c909f;font-size:12px">No source data available.</div>';
    return;
  }
  var typeCounts = {};
  var typeColors = { 'blogs': '#adc6ff', 'news': '#f59e0b', 'organization': '#4ae176', 'ecommerce': '#c084fc', 'message-boards': '#fb923c', 'cms': '#8c909f' };
  items.forEach(function(item) {
    var types = item.page_types || [];
    if (types.length === 0) types = ['other'];
    types.forEach(function(t) { typeCounts[t] = (typeCounts[t] || 0) + 1; });
  });
  var sorted = Object.entries(typeCounts).sort(function(a, b) { return b[1] - a[1]; });
  if (sorted.length === 0) {
    el.innerHTML = '<div style="padding:12px;text-align:center;color:#8c909f;font-size:12px">No source type data.</div>';
    return;
  }
  var total = items.length;
  var html = '';
  sorted.forEach(function(entry) {
    var type = entry[0], count = entry[1];
    var pct = Math.round(count / total * 100);
    var color = typeColors[type] || '#8c909f';
    var label = type.charAt(0).toUpperCase() + type.slice(1).replace(/-/g, ' ');
    html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">'
      + '<span style="width:10px;height:10px;border-radius:2px;background:' + color + ';flex-shrink:0"></span>'
      + '<span style="font-size:12px;color:#e4e1e9;min-width:100px">' + escHtml(label) + '</span>'
      + '<div style="flex:1;background:#1f1f25;border-radius:3px;height:10px;overflow:hidden">'
      + '<div style="background:' + color + ';height:100%;width:' + pct + '%;border-radius:3px"></div></div>'
      + '<span style="font-size:11px;color:#8c909f;min-width:50px;text-align:right">' + count + ' (' + pct + '%)</span>'
      + '</div>';
  });
  el.innerHTML = html;
}

/**
 * renderTopSourcesFromSummary — uses top_domains from content_analysis/summary (complete data, not limited to 100 items)
 */
function renderTopSourcesFromSummary(topDomains, ownDomain) {
  var el = document.getElementById('content-top-sources');
  if (!el) return;
  var ownStripped = (ownDomain || '').replace(/^www\./, '');
  var filtered = topDomains.filter(function(d) {
    return (d.domain || '').replace(/^www\./, '') !== ownStripped;
  }).slice(0, 15);
  if (filtered.length === 0) {
    el.innerHTML = '<div style="padding:12px;text-align:center;color:#8c909f;font-size:12px">No external sources found.</div>';
    return;
  }
  var maxCount = filtered[0].count || 1;
  var html = '';
  filtered.forEach(function(entry) {
    var pct = Math.round((entry.count || 0) / maxCount * 100);
    html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">'
      + '<span style="font-size:12px;color:#e4e1e9;min-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(entry.domain || '') + '</span>'
      + '<div style="flex:1;background:#1f1f25;border-radius:3px;height:10px;overflow:hidden">'
      + '<div style="background:#adc6ff;height:100%;width:' + pct + '%;border-radius:3px"></div></div>'
      + '<span style="font-size:11px;color:#8c909f;min-width:40px;text-align:right">' + fmtNum(entry.count || 0) + '</span>'
      + '</div>';
  });
  el.innerHTML = html;
}

/**
 * renderTopSources — domains that mention the brand most, extracted from search results
 */
function renderTopSources(items, ownDomain) {
  var el = document.getElementById('content-top-sources');
  if (!el) return;
  if (!items || items.length === 0) {
    el.innerHTML = '<div style="padding:12px;text-align:center;color:#8c909f;font-size:12px">No source data available yet.</div>';
    return;
  }
  // Count mentions per domain, excluding own domain
  var domainCounts = {};
  var ownStripped = (ownDomain || '').replace(/^www\./, '');
  items.forEach(function(item) {
    var d = (item.main_domain || item.domain || '').replace(/^www\./, '');
    if (!d || d === ownStripped) return;
    domainCounts[d] = (domainCounts[d] || 0) + 1;
  });
  var sorted = Object.entries(domainCounts).sort(function(a, b) { return b[1] - a[1]; }).slice(0, 15);
  if (sorted.length === 0) {
    el.innerHTML = '<div style="padding:12px;text-align:center;color:#8c909f;font-size:12px">No external sources found mentioning your brand.</div>';
    return;
  }
  var maxCount = sorted[0][1];
  var html = '';
  sorted.forEach(function(entry) {
    var domain = entry[0], count = entry[1];
    var pct = Math.round(count / maxCount * 100);
    html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">'
      + '<span style="font-size:12px;color:#e4e1e9;min-width:140px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(domain) + '</span>'
      + '<div style="flex:1;background:#1f1f25;border-radius:3px;height:10px;overflow:hidden">'
      + '<div style="background:#adc6ff;height:100%;width:' + pct + '%;border-radius:3px"></div></div>'
      + '<span style="font-size:11px;color:#8c909f;min-width:24px;text-align:right">' + count + '</span>'
      + '</div>';
  });
  el.innerHTML = html;
}
// SEO Platform — Charts Module
'use strict';

// Helper: get nested object value by dot path
function getNestedVal(obj, path) {
  return path.split('.').reduce(function(o, k) { return o && o[k] !== undefined ? o[k] : undefined; }, obj);
}


/* =======================================================
   PHASE 4.5 - APEXCHARTS SHARED CONFIG & RENDERERS
   ======================================================= */

var _charts = {}; // chart instance cache — destroy before re-render

var APEX_DARK = {
  chart: { background: 'transparent', foreColor: '#c2c6d6', fontFamily: 'Inter, sans-serif',
           toolbar: { show: false }, animations: { enabled: true, easing: 'easeinout', speed: 600 } },
  grid: { borderColor: '#35343a', strokeDashArray: 4 },
  tooltip: { theme: 'dark', style: { fontSize: '11px' } },
  xaxis: { labels: { style: { colors: '#8c909f', fontSize: '10px', fontWeight: 600 } },
           axisBorder: { color: '#35343a' }, axisTicks: { color: '#35343a' } },
  yaxis: { labels: { style: { colors: '#8c909f', fontSize: '10px' },
           formatter: function(v) { return v >= 1000 ? (v/1000).toFixed(1)+'k' : Math.round(v); } } },
  stroke: { curve: 'smooth', width: 2.5 },
  fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.25, opacityTo: 0.02, stops: [0, 100] } },
  colors: ['#adc6ff'],
};

function renderAreaChart(elId, series, categories, opts) {
  if (_charts[elId]) { _charts[elId].destroy(); }
  var el = document.getElementById(elId);
  if (!el) return;
  var cfg = JSON.parse(JSON.stringify(APEX_DARK));
  cfg.chart.type = 'area';
  cfg.chart.height = opts?.height || 200;
  cfg.series = [{ name: opts?.name || 'Value', data: series }];
  cfg.xaxis.categories = categories;
  if (opts?.colors) cfg.colors = opts.colors;
  if (opts?.yFormatter) cfg.yaxis.labels.formatter = opts.yFormatter;
  var chart = new ApexCharts(el, cfg);
  chart.render();
  _charts[elId] = chart;
  return chart;
}

function renderRadialChart(elId, value, opts) {
  if (_charts[elId]) { _charts[elId].destroy(); }
  var el = document.getElementById(elId);
  if (!el) return;
  var color = '#adc6ff';
  if (opts?.colorByValue) {
    color = value <= 30 ? '#4ae176' : value <= 60 ? '#fbbf24' : '#ef4444';
  }
  var cfg = {
    chart: { type: 'radialBar', height: opts?.height || 180, background: 'transparent', fontFamily: 'Inter, sans-serif' },
    series: [Math.min(100, Math.max(0, Math.round(value)))],
    plotOptions: { radialBar: {
      hollow: { size: '60%', background: 'transparent' },
      track: { background: '#1f1f25', strokeWidth: '100%' },
      dataLabels: {
        name: { show: !!opts?.label, fontSize: '11px', color: '#8c909f', offsetY: -8 },
        value: { show: true, fontSize: '24px', fontWeight: 800, color: '#e4e1e9', offsetY: 4,
                 formatter: function(v) { return opts?.suffix ? Math.round(v) + opts.suffix : Math.round(v); } }
      }
    }},
    colors: [color],
    labels: opts?.label ? [opts.label] : [''],
    stroke: { lineCap: 'round' },
  };
  var chart = new ApexCharts(el, cfg);
  chart.render();
  _charts[elId] = chart;
  return chart;
}

// Render overview trend from snapshot history or accumulated data
async function renderOverviewTrend() {
  var domain = SEO.activeProject;
  if (!domain) return;
  try {
    var snaps = await SEO.snapshots(domain, 180).catch(function() { return { snapshots: [] }; });
    var data = (snaps?.snapshots || []).sort(function(a,b) { return new Date(a.snapshot_date || a.date) - new Date(b.snapshot_date || b.date); });
    if (data.length < 2) {
      // Fallback: try accumulated keywords history
      var hist = await SEO.history({ tool: 'ranked_keywords', target: domain, limit: 10 }).catch(function() { return {}; });
      var queries = (hist?.queries || []).reverse();
      if (queries.length > 0) {
        var series = queries.map(function(q) { return q.summary?.total_count || q.result_count || q.summary?.count || 0; });
        var cats = queries.map(function(q) {
          var d = new Date(q.created_at || q.timestamp);
          return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        });
        renderAreaChart('chart-overview-trend', series, cats, { height: 200, name: 'Organic Keywords' });
      } else {
        renderAreaChart('chart-overview-trend', [0], ['No data'], { height: 200, name: 'Organic Keywords' });
      }
      return;
    }
    var series = data.map(function(s) { return s.total_keywords || s.organic_keywords || 0; });
    var cats = data.map(function(s) {
      var d = new Date(s.snapshot_date || s.date);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });
    renderAreaChart('chart-overview-trend', series, cats, { height: 200, name: 'Organic Keywords' });
  } catch(e) { console.warn('Overview trend chart error:', e); }
}

// Render domain analysis traffic trend
async function renderDomainTrafficTrend() {
  var domain = SEO.activeProject;
  if (!domain) return;
  try {
    var snaps = await SEO.snapshots(domain, 180).catch(function() { return { snapshots: [] }; });
    var data = (snaps?.snapshots || []).sort(function(a,b) { return new Date(a.snapshot_date || a.date) - new Date(b.snapshot_date || b.date); });
    if (data.length < 2) {
      var hist = await SEO.history({ tool: 'traffic_estimate', target: domain, limit: 10 }).catch(function() { return {}; });
      var queries = (hist?.queries || []).reverse();
      if (queries.length > 0) {
        var series = queries.map(function(q) { return Math.round(q.summary?.etv || 0); });
        var cats = queries.map(function(q) {
          var d = new Date(q.created_at || q.timestamp);
          return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        });
        renderAreaChart('chart-domain-traffic', series, cats, { height: 300, name: 'Est. Traffic' });
      } else {
        renderAreaChart('chart-domain-traffic', [0], ['No data'], { height: 300, name: 'Est. Traffic' });
      }
      return;
    }
    var series = data.map(function(s) { return Math.round(s.organic_traffic || s.etv || 0); });
    var cats = data.map(function(s) {
      var d = new Date(s.date);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });
    renderAreaChart('chart-domain-traffic', series, cats, { height: 300, name: 'Est. Traffic' });
  } catch(e) { console.warn('Domain traffic trend error:', e); }
}

// Render AI visibility trend
async function renderAIVisibilityTrend() {
  var domain = SEO.activeProject;
  if (!domain) return;
  try {
    var hist = await SEO.history({ tool: 'ai_visibility', target: domain, limit: 15 }).catch(function() { return {}; });
    var queries = (hist?.queries || []).reverse();
    if (queries.length > 0) {
      var series = queries.map(function(q) { return q.summary?.mention_count || q.summary?.total_count || q.result_count || 0; });
      var cats = queries.map(function(q) {
        var d = new Date(q.created_at || q.timestamp);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      });
      renderAreaChart('chart-ai-visibility-trend', series, cats, { height: 256, name: 'AI Mentions' });
    } else {
      renderAreaChart('chart-ai-visibility-trend', [0], ['No data yet'], { height: 256, name: 'AI Mentions' });
    }
  } catch(e) { console.warn('AI visibility trend error:', e); }
}
// SEO Platform — Wiring Module
'use strict';

/* =======================================================
   PHASE 4 - NAVIGATION WIRING (extends loadViewData)
   ======================================================= */

// Override loadViewData to dispatch ALL views (Phase 2 + 3 + 4)
function loadViewData(view) {
  if (view === 'projects') loadProjectsData();
  else if (view === 'dashboard') { loadDashboardData(); loadReportHistory(); loadAlerts().then(renderAlertPanel); }
  else if (view === 'keywords') loadKeywordsData();
  else if (view === 'position') loadPositionData();
  else if (view === 'keyword-overview') { loadKeywordOverviewView(); }
  else if (view === 'keyword-gap') loadKeywordGapView();
  else if (view === 'domain') loadDomainAnalysis();
  else if (view === 'audit') loadAuditData();
  else if (view === 'backlinks') loadBacklinksData();
  else if (view === 'ai-visibility') loadAIVisibility();
  else if (view === 'local') loadLocalSEO();
  else if (view === 'content') loadContentMonitor();
}

// loadKeywordGapView is defined in keywords.js

/* =======================================================
   PHASE 4.4 - REPORT HISTORY PANELS (ADDITIVE DATA)
   Every paid API call is saved. Every view shows full history.
   ======================================================= */

// View → tool mapping for history queries
// Tool names MUST match seoToolCategory() in server.js exactly
var VIEW_HISTORY_TOOLS = {
  'dashboard':        ['ranked_keywords', 'traffic_estimate', 'backlinks', 'competitors'],
  'domain':           ['ranked_keywords', 'traffic_estimate', 'competitors', 'technologies', 'backlinks', 'whois', 'categories', 'domain_pages'],
  'position':         ['ranked_keywords', 'rank_history'],
  'keywords':         ['keyword_suggestions', 'search_intent'],
  'keyword-overview': ['search_volume', 'keyword_difficulty', 'serp_organic', 'keyword_suggestions', 'search_intent'],
  'keyword-gap':      ['domain_intersection', 'competitors'],
  'audit':            ['on_page'],
  'ai-visibility':    ['ai_visibility', 'content_analysis_search', 'content_analysis_summary', 'content_analysis_sentiment'],
  'backlinks':        ['backlinks'],
  'local':            ['serp_maps', 'my_business_info', 'google_reviews', 'serp_autocomplete'],
  'content':          ['content_analysis_search', 'content_analysis_summary', 'content_analysis_sentiment'],
};

// History panel functions removed 2026-04-05 — will be rebuilt as dedicated History view


/* =======================================================
   PHASE 4 - DOMContentLoaded WIRING
   ======================================================= */

/* =======================================================
   PAGE INIT - Load from server (NO localStorage)
   ======================================================= */
document.addEventListener('DOMContentLoaded', async function() {
  try {
    const prefs = await SEO.preferences().catch(function() { return {}; });
    SEO._activeProject = prefs?.active_project || null;

    if (SEO._activeProject) {
      setProject(SEO._activeProject);
    }

    try {
      const projectsData = await SEO.projects();
      const projects = projectsData?.projects || [];
      if (projects.length > 0) {
        renderProjectDropdown(projects);
      }
    } catch(e) { console.warn('Projects load failed:', e); }

    SEO.refreshCosts();
    loadAlerts();
    renderGauges(0, 0);

    const currentView = getCurrentView();
    if (SEO._activeProject && currentView === 'projects') {
      nav('dashboard');
    } else {
      nav(currentView);
    }
  } catch(e) {
    console.error('Init failed:', e);
    nav('projects');
    renderGauges(0, 0);
  }
});

/* =======================================================
   DOM WIRING
   ======================================================= */
document.addEventListener('DOMContentLoaded', function() {
  // Init view-specific button wiring
  initKeywordOverviewSearch();
  initPositionButtons();
  initAuditButtons();

  // Wire keyword magic search (tabs are wired via onclick="switchKwTab()" in HTML — no duplicate handlers)
  var kwSearchBtn = document.querySelector('#view-keywords button.bg-primary');
  if (kwSearchBtn) {
    kwSearchBtn.onclick = function(e) { e.preventDefault(); kwSearch(); };
  }
  var kwInput = document.querySelector('#view-keywords input[type="text"]');
  if (kwInput) {
    kwInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') kwSearch(); });
    kwInput.value = '';
  }

  wireKwGapControls();
  wireBacklinksControls();

  // Wire the "Live Intelligence" / domain analysis refresh button if present
  var domainRefreshBtn = document.querySelector('#view-domain .px-3.py-1.bg-secondary\\/10');
  if (domainRefreshBtn) {
    domainRefreshBtn.style.cursor = 'pointer';
    domainRefreshBtn.addEventListener('click', function() { refreshDomainAnalysis(this); });
  }

  // --- Wire dead buttons ---

  // "View Full SERP" in keyword overview
  wireButtonByText('#view-keyword-overview', 'View Full SERP', function() {
    var kw = document.getElementById('kwov-keyword')?.textContent;
    if (kw && kw !== '--') { nav('dashboard'); showToast('Full SERP view for "' + kw + '" — check ranked results in Position Tracking', 'info'); }
  });

  // "Load More Variations" in keyword overview
  wireButtonByText('#view-keyword-overview', 'Load More Variations', function() {
    showToast('Loading additional keyword variations is included in the next keyword search', 'info');
  });

  // "Load more keyword data" in domain analysis
  wireButtonByText('#view-domain', 'Load more keyword data', function() {
    showToast('Full keyword list available via Refresh Data above', 'info');
  });

  // "View Details" on competitor cards
  document.querySelectorAll('#domain-competitors-list [data-domain], #dash-competitors-list [data-domain]').forEach(function(el) {
    el.style.cursor = 'pointer';
    el.addEventListener('click', function() {
      var d = this.getAttribute('data-domain');
      if (d) { SEO._activeProject = d; nav('domain'); }
    });
  });

  // "View All Competitors" button
  wireButtonByText('#view-domain', 'View All Competitors', function() { nav('keyword-gap'); });

  // "Export CSV" — generic CSV export for visible table
  wireButtonByText(null, 'Export CSV', function() { exportVisibleTableCSV(); });

  // "Add Keywords" in position tracking
  wireButtonByText('#view-position', 'Add Keywords', function() {
    var kw = prompt('Enter keywords to track (comma-separated):');
    if (kw && kw.trim()) {
      var domain = SEO.activeProject;
      if (!domain) { showToast('Select a project first', 'warning'); return; }
      SEO.trackKeyword(domain, kw.split(',').map(function(k) { return k.trim(); })).then(function() {
        showToast('Keywords added to tracking', 'success');
        loadPositionData();
      }).catch(function(e) { showToast('Failed to add keywords: ' + e.message, 'error'); });
    }
  });

  // Time range toggles (6M/1Y/All) — visual only for now, switch active state
  document.querySelectorAll('.flex.bg-surface-container-high button').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var siblings = this.parentElement.querySelectorAll('button');
      siblings.forEach(function(b) {
        b.classList.remove('bg-primary', 'text-on-primary');
        b.classList.add('text-on-surface-variant');
      });
      this.classList.add('bg-primary', 'text-on-primary');
      this.classList.remove('text-on-surface-variant');
    });
  });
});

// Helper: find a button by text content within a container
function wireButtonByText(containerSel, text, handler) {
  var root = containerSel ? document.querySelector(containerSel) : document;
  if (!root) root = document;
  var buttons = root.querySelectorAll('button');
  for (var i = 0; i < buttons.length; i++) {
    if (buttons[i].textContent.trim().indexOf(text) !== -1) {
      buttons[i].style.cursor = 'pointer';
      buttons[i].addEventListener('click', handler);
      break;
    }
  }
}

// CSV export from the currently visible view's first table
function exportVisibleTableCSV() {
  var activeView = document.querySelector('.view-panel:not([style*="display: none"]):not([style*="display:none"])');
  if (!activeView) { activeView = document.querySelector('.view-panel.active'); }
  if (!activeView) { showToast('No active view found', 'warning'); return; }
  var table = activeView.querySelector('table');
  if (!table) { showToast('No table data to export', 'warning'); return; }
  var rows = table.querySelectorAll('tr');
  var csv = [];
  rows.forEach(function(row) {
    var cells = row.querySelectorAll('th, td');
    var line = [];
    cells.forEach(function(cell) { line.push('"' + cell.textContent.trim().replace(/"/g, '""') + '"'); });
    csv.push(line.join(','));
  });
  var blob = new Blob([csv.join('\n')], { type: 'text/csv' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'seo-export-' + new Date().toISOString().slice(0,10) + '.csv';
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV exported', 'success');
}
