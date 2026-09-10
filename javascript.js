/* =========================================================================
 * Core application JS - shared across all pages in the SPA shell.
 * Handles: session storage, backend API calls, routing between pages,
 * toasts, loading overlay, sidebar/mobile nav, and (for static hosting)
 * fetching each screen's HTML fragment.
 *
 * NOTE FOR STATIC / VERCEL DEPLOYMENT:
 * This file is functionally identical to the Apps Script version, except:
 *   1. callServer() uses fetch() against API_BASE_URL (see config.js)
 *      instead of google.script.run, since google.script.run only exists
 *      when a page is served directly by Apps Script's HtmlService.
 *   2. loadAllFragments() fetches Login.html/Dashboard.html/etc. as plain
 *      files and injects them into the page, replacing the GAS
 *      <?!= include(...) ?> server-side templating (which a static host
 *      cannot process).
 * ========================================================================= */

const APP = {
  token: null,
  sessionType: null,   // 'client' or 'admin'
  businessName: null,
  username: null
};

/* ---------------- BACKEND API CALL (fetch-based) ---------------- */
/**
 * Calls a whitelisted backend function by name, exactly like the old
 * google.script.run wrapper did - same call signature, same return shape
 * ({ success, data } or { success:false, message }), so no other file in
 * the project needs to change.
 *
 * Uses Content-Type: text/plain on purpose - this keeps the request a
 * CORS "simple request" and avoids a preflight OPTIONS call, which Apps
 * Script Web Apps cannot handle.
 */
async function callServer(fnName, ...args) {
  if (!API_BASE_URL || API_BASE_URL.indexOf('PASTE_YOUR') !== -1) {
    throw new Error('API_BASE_URL is not configured. Edit config.js and paste your Apps Script Web App URL.');
  }

  const response = await fetch(API_BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: fnName, params: args })
  });

  if (!response.ok) {
    throw new Error('Network error (' + response.status + '). Please try again.');
  }
  return response.json();
}

/* ---------------- FRAGMENT LOADER (replaces GAS include()) ---------------- */
/**
 * Each screen still lives in its own HTML file (Login.html, Dashboard.html,
 * etc.) exactly as before. On a static host we fetch() each file's raw
 * text, pull out any <script> blocks (browsers don't execute scripts
 * inserted via innerHTML), inject the remaining markup into its slot, then
 * manually run the extracted scripts so each page's functions become
 * available globally - same end result as the server-side include().
 */
const PAGE_FRAGMENTS = [
  { file: 'Login.html', slot: 'slot-login' },
  { file: 'Dashboard.html', slot: 'slot-dashboard' },
  { file: 'AdminDashboard.html', slot: 'slot-admindashboard' },
  { file: 'Orders.html', slot: 'slot-orders' },
  { file: 'CreateOrder.html', slot: 'slot-createorder' },
  { file: 'EditOrder.html', slot: 'slot-editorder' },
  { file: 'Settings.html', slot: 'slot-settings' },
  { file: 'Profile.html', slot: 'slot-profile' }
];

async function loadFragment(file, slotId) {
  const slot = document.getElementById(slotId);
  if (!slot) return;

  const res = await fetch(file);
  if (!res.ok) {
    slot.innerHTML = '<div class="empty-state">Failed to load ' + file + '</div>';
    return;
  }
  const html = await res.text();

  const scripts = [];
  const markup = html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, function (match, code) {
    scripts.push(code);
    return '';
  });

  slot.innerHTML = markup;

  scripts.forEach(function (code) {
    const scriptEl = document.createElement('script');
    scriptEl.textContent = code;
    document.body.appendChild(scriptEl);
  });
}

async function loadAllFragments() {
  await Promise.all(PAGE_FRAGMENTS.map(function (f) { return loadFragment(f.file, f.slot); }));
}

/* ---------------- TOAST / LOADING ---------------- */
function showToast(message, type) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function showLoading() { document.getElementById('globalLoading').classList.remove('hidden'); }
function hideLoading() { document.getElementById('globalLoading').classList.add('hidden'); }

/* ---------------- SESSION HANDLING ---------------- */
function saveSession(token, type, businessName, username) {
  APP.token = token;
  APP.sessionType = type;
  APP.businessName = businessName;
  APP.username = username;
  sessionStorage.setItem('oms_token', token);
  sessionStorage.setItem('oms_type', type);
  sessionStorage.setItem('oms_business', businessName || '');
  sessionStorage.setItem('oms_username', username || '');
}

function clearSession() {
  APP.token = null; APP.sessionType = null; APP.businessName = null; APP.username = null;
  sessionStorage.clear();
}

function restoreSession() {
  APP.token = sessionStorage.getItem('oms_token');
  APP.sessionType = sessionStorage.getItem('oms_type');
  APP.businessName = sessionStorage.getItem('oms_business');
  APP.username = sessionStorage.getItem('oms_username');
  return !!APP.token;
}

async function bootstrapApp() {
  if (restoreSession()) {
    try {
      showLoading();
      const res = await callServer('validateSession', APP.token);
      hideLoading();
      if (res.success) {
        enterApp();
        return;
      }
    } catch (e) { hideLoading(); }
    clearSession();
  }
  showLoginScreen();
}

function logoutUser() {
  if (APP.token) callServer('logout', APP.token).catch(() => {});
  clearSession();
  showLoginScreen();
}

/* ---------------- SCREEN / ROUTING ---------------- */
function showLoginScreen() {
  document.getElementById('shellApp').classList.add('hidden');
  document.getElementById('page-login').classList.remove('hidden');
}

function enterApp() {
  document.getElementById('page-login').classList.add('hidden');
  document.getElementById('shellApp').classList.remove('hidden');

  document.getElementById('sidebarBusinessName').textContent = APP.businessName || APP.username || 'Account';

  // Show correct nav set depending on account type
  const isAdmin = APP.sessionType === 'admin';
  document.querySelectorAll('[data-role="client"]').forEach(el => el.classList.toggle('hidden', isAdmin));
  document.querySelectorAll('[data-role="admin"]').forEach(el => el.classList.toggle('hidden', !isAdmin));

  navigateTo(isAdmin ? 'admindashboard' : 'dashboard');
}

function navigateTo(pageKey, params) {
  params = params || {};
  document.querySelectorAll('.page-section').forEach(el => el.classList.add('hidden'));
  const target = document.getElementById('page-' + pageKey);
  if (target) target.classList.remove('hidden');

  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const navEl = document.querySelector('.nav-item[data-page="' + pageKey + '"]');
  if (navEl) navEl.classList.add('active');

  closeMobileSidebar();

  // Fire page-specific load function if it exists
  const loaderName = 'load_' + pageKey;
  if (typeof window[loaderName] === 'function') {
    window[loaderName](params);
  }
}

function toggleMobileSidebar() {
  document.querySelector('.sidebar').classList.toggle('open');
}
function closeMobileSidebar() {
  document.querySelector('.sidebar').classList.remove('open');
}

/* ---------------- INIT ---------------- */
document.addEventListener('DOMContentLoaded', async () => {
  // Load every screen's HTML fragment first (replaces GAS include()),
  // THEN bootstrap - otherwise elements like #page-dashboard don't exist yet.
  await loadAllFragments();
  bootstrapApp();

  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    el.addEventListener('click', () => navigateTo(el.getAttribute('data-page')));
  });

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', logoutUser);

  const menuToggle = document.getElementById('menuToggle');
  if (menuToggle) menuToggle.addEventListener('click', toggleMobileSidebar);
});
