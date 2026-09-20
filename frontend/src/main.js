import './style.css';

import {
  AuthInfo,
  Login,
  Logout,
  Search,
  Download,
  ListVersions,
  ListInstalledApps,
  LookupArtwork,
  SignedInDSID,
  DeviceConnected,
  PickOutputDir,
  DefaultOutputDir,
  PickIPAPath,
  InstallIPA,
  ListAccounts,
  SwitchAccount,
  RemoveAccount,
} from '../wailsjs/go/main/App';
import { EventsOn } from '../wailsjs/runtime/runtime';

const app = document.querySelector('#app');
app.innerHTML = `
  <header class="topbar">
    <h1>PullApps</h1>
    <div class="topbar-actions">
      <button id="accountSwitch" class="account-switch hidden" title="Switch Apple ID account">…</button>
      <button id="auth" class="auth-pill auth-unknown" title="Click to sign in">checking…</button>
    </div>
  </header>

  <section id="signinPanel" class="signin hidden">
    <div id="currentAccountRow" class="signin-row signin-current hidden">
      <span class="signin-current-label">Signed in as <strong id="currentAccountText"></strong></span>
      <button id="signoutBtn" class="ghost">Sign out</button>
    </div>
    <div class="signin-row">
      <input id="signinEmail" type="email" placeholder="Apple ID email" autocomplete="username" />
      <input id="signinPassword" type="password" placeholder="Password" autocomplete="current-password" />
    </div>
    <div class="signin-row signin-2fa hidden">
      <input id="signin2fa" type="text" placeholder="2FA code from a trusted device" inputmode="numeric" autocomplete="one-time-code" />
    </div>
    <div class="signin-row">
      <div id="signinMsg" class="signin-msg"></div>
      <button id="signinSubmit">Sign in</button>
      <button id="signinCancel" class="ghost">Close</button>
    </div>
  </section>

  <section class="search-row">
    <input id="q" type="text" placeholder="Search the App Store…" autocomplete="off" />
    <input id="limit" type="number" min="1" max="50" value="10" title="Result limit" />
    <button id="searchBtn">Search</button>
  </section>

  <section class="manual-row">
    <label>Direct:</label>
    <input id="manualId" type="text" placeholder="Bundle ID, App Store ID, or App Store URL (paste any)" autocomplete="off" />
    <button id="manualBtn">Download</button>
    <button id="iphoneBtn" class="ghost" title="List apps installed on a USB-connected iPhone">From iPhone</button>
  </section>

  <section class="folder-row">
    <label>Save to:</label>
    <input id="outdir" type="text" readonly />
    <button id="pickDirBtn">Choose…</button>
  </section>

  <section class="folder-row install-row">
    <label>Install:</label>
    <input id="installIpa" type="text" readonly placeholder="Choose a downloaded .ipa, then install it on the connected iPhone" />
    <button id="pickIpaBtn" class="ghost" title="Pick a local .ipa file">Choose…</button>
    <button id="installBtn" class="ghost" title="Install the selected .ipa on a USB-connected iPhone">Install to iPhone</button>
  </section>

  <section id="results" class="results"></section>

  <footer id="status" class="status"></footer>
`;

const $ = (id) => document.getElementById(id);
const authEl = $('auth');
const qEl = $('q');
const limitEl = $('limit');
const resultsEl = $('results');
const statusEl = $('status');
const outdirEl = $('outdir');

function setStatus(msg, kind = 'info') {
  statusEl.textContent = msg;
  statusEl.className = `status status-${kind}`;
}

async function refreshAuth() {
  try {
    const info = await AuthInfo();
    if (info.authenticated) {
      authEl.textContent = `${info.name || info.email} ✓`;
      authEl.className = 'auth-pill auth-ok';
      authEl.title = info.email;
    } else {
      authEl.textContent = 'not signed in';
      authEl.className = 'auth-pill auth-bad';
      authEl.title = 'Run `ipatool auth login --email you@example.com` in a terminal first';
    }
  } catch (e) {
    authEl.textContent = 'auth error';
    authEl.className = 'auth-pill auth-bad';
    authEl.title = String(e);
  }
}

async function initOutdir() {
  try {
    outdirEl.value = await DefaultOutputDir();
  } catch {}
}

// --- Multi-account switcher ---
const accountSwitchEl = $('accountSwitch');
let accountMenu = null;

function closeAccountMenu() {
  if (accountMenu) {
    accountMenu.remove();
    accountMenu = null;
  }
}

function accountLabel(a) {
  return [a.name, a.email].filter(Boolean).join(' · ') || 'Account';
}

async function refreshAccounts() {
  let list;
  try {
    list = await ListAccounts();
  } catch (e) {
    accountSwitchEl.classList.add('hidden');
    return;
  }
  const accounts = list?.accounts || [];
  if (accounts.length === 0) {
    accountSwitchEl.classList.add('hidden');
    return;
  }
  accountSwitchEl.classList.remove('hidden');
  const total = accounts.length;
  const active = accounts[list.activeIndex >= 0 ? list.activeIndex : 0];
  accountSwitchEl.textContent = `${total} account${total === 1 ? '' : 's'} · ${(active && accountLabel(active)) || 'none'} ▾`;
  accountSwitchEl.title = 'Click to switch Apple ID account';
}

async function openAccountMenu(anchorEl) {
  closeAccountMenu();
  const menu = document.createElement('div');
  menu.className = 'account-menu';
  document.body.appendChild(menu);
  accountMenu = menu;

  const rect = anchorEl.getBoundingClientRect();
  menu.style.right = `${Math.max(8, window.innerWidth - rect.right - 4)}px`;
  menu.style.top = `${rect.bottom + 4}px`;

  let list;
  try {
    list = await ListAccounts();
  } catch (e) {
    menu.innerHTML = `<div class="version-error">${escapeHtml(String(e))}</div>`;
    return;
  }
  const accounts = list?.accounts || [];
  const activeIdx = list.activeIndex ?? -1;
  const activeKey = (accounts[activeIdx] && accounts[activeIdx].dsid) || '';

  menu.innerHTML = `
    <div class="account-menu-header">Apple ID accounts</div>
    <div class="account-menu-list">
      ${accounts.length
        ? accounts.map((a, i) => {
            const label = accountLabel(a);
            const isActive = i === activeIdx;
            const removeBtn = !isActive
              ? `<button class="account-remove" title="Forget ${escapeHtml(label)}">✕</button>`
              : '';
            return `<div class="account-item${isActive ? ' active' : ''}" data-dsid="${escapeHtml(a.dsid)}">
              <span class="account-item-label">${escapeHtml(label)}${isActive ? ' <span class="account-check">✓</span>' : ''}</span>
              ${removeBtn}
            </div>`;
          }).join('')
        : '<div class="account-item muted">No saved accounts yet — sign in to create one.</div>'}
    </div>
    <div class="account-menu-footer">
      <button class="account-add">＋ Sign in with another Apple ID…</button>
    </div>`;

  menu.querySelectorAll('.account-item').forEach((item) => {
    item.addEventListener('click', async () => {
      const dsid = item.dataset.dsid;
      if (!dsid || dsid === activeKey) {
        closeAccountMenu();
        return;
      }
      closeAccountMenu();
      anchorEl.disabled = true;
      anchorEl.textContent = 'Switching…';
      setStatus('Switching Apple ID account…');
      try {
        await SwitchAccount(dsid);
        await refreshAuthAndCache();
        closeVersionMenu();
        setStatus('Switched Apple ID account.', 'ok');
      } catch (e) {
        setStatus(`Switch failed: ${e}`, 'error');
      } finally {
        anchorEl.disabled = false;
        refreshAccounts();
      }
    });
  });
  menu.querySelectorAll('.account-remove').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = btn.closest('.account-item');
      if (item) removeAccountFlow(item.dataset.dsid, accountLabel(accounts.find((a) => a.dsid === item.dataset.dsid) || {}));
    });
  });
  menu.querySelector('.account-add')?.addEventListener('click', () => {
    closeAccountMenu();
    showSignin();
  });
}

async function removeAccountFlow(dsid, label) {
  if (!window.confirm(`Forget "${label}" from the switcher?\n\nThe session stays valid on this Mac until you sign out of it.`)) return;
  closeAccountMenu();
  try {
    await RemoveAccount(dsid);
    setStatus(`Forgot "${label}".`, 'ok');
  } catch (e) {
    setStatus(`Remove failed: ${e}`, 'error');
  }
  refreshAccounts();
}

accountSwitchEl.addEventListener('click', (e) => {
  e.stopPropagation();
  if (accountMenu) closeAccountMenu();
  else openAccountMenu(accountSwitchEl);
});

function priceLabel(p) {
  if (!p || p === 0) return 'Free';
  return `$${Number(p).toFixed(2)}`;
}

function renderResults(apps) {
  if (!apps || apps.length === 0) {
    resultsEl.innerHTML = '<div class="empty">No results</div>';
    return;
  }
  resultsEl.innerHTML = apps
    .map(
      (a) => `
    <div class="row" data-bundle="${a.bundleID}" data-name="${escapeHtml(a.name)}" data-latest-version="${escapeHtml(a.version || '')}" style="--progress: 0%">
      <div class="row-main">
        <div class="row-title">${escapeHtml(a.name)}</div>
        <div class="row-sub">
          <span class="bundle">${escapeHtml(a.bundleID)}</span>
          <button class="version-chip" data-bundle="${a.bundleID}" title="Click to choose a different version">v${escapeHtml(a.version || '?')} ▾</button>
          <span class="price">${priceLabel(a.price)}</span>
          <span class="row-progress"></span>
        </div>
      </div>
      <button class="dl-btn" data-bundle="${a.bundleID}">Download</button>
    </div>`
    )
    .join('');

  resultsEl.querySelectorAll('.version-chip').forEach((chip) => {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      openVersionMenu(chip);
    });
  });

  resultsEl.querySelectorAll('.dl-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.row');
      const versionID = row?.dataset.versionId || '';
      download(btn.dataset.bundle, btn, versionID);
    });
  });
}

// --- Version dropdown ---
const versionCache = new Map(); // bundleID -> Version[]
let openMenu = null;

function closeVersionMenu() {
  if (openMenu) {
    openMenu.remove();
    openMenu = null;
  }
}

document.addEventListener('click', (e) => {
  if (openMenu && !openMenu.contains(e.target)) closeVersionMenu();
  if (accountMenu && !accountMenu.contains(e.target) && e.target !== accountSwitchEl) closeAccountMenu();
});

// Cmd/Ctrl+F focuses the iPhone filter when the list is loaded, else the
// main search bar. Standard macOS "find" muscle memory.
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
    const filter = document.getElementById('iphoneFilter');
    e.preventDefault();
    (filter || qEl).focus();
    (filter || qEl).select?.();
  }
});

async function openVersionMenu(chipEl) {
  closeVersionMenu();
  const bundleID = chipEl.dataset.bundle;
  const row = chipEl.closest('.row');

  const menu = document.createElement('div');
  menu.className = 'version-menu';
  menu.innerHTML = '<div class="version-loading">Loading versions…</div>';
  document.body.appendChild(menu);
  openMenu = menu;

  // Position below the chip
  const rect = chipEl.getBoundingClientRect();
  menu.style.left = `${rect.left}px`;
  menu.style.top = `${rect.bottom + 4}px`;

  let versions = versionCache.get(bundleID);
  if (!versions) {
    try {
      versions = await ListVersions(bundleID);
      versionCache.set(bundleID, versions);
    } catch (e) {
      menu.innerHTML = `<div class="version-error">${escapeHtml(String(e))}</div>`;
      return;
    }
  }
  if (openMenu !== menu) return; // user closed it while loading

  if (!versions || versions.length === 0) {
    menu.innerHTML = '<div class="version-loading">No versions found</div>';
    return;
  }

  const latest = row.dataset.latestVersion || '';
  const items = versions
    .map((v, i) => {
      const label = v.displayVersion || `(unknown) ${v.externalID.slice(-6)}`;
      const date = v.releaseDate ? new Date(v.releaseDate).toLocaleDateString() : '';
      const tag = i === 0 ? '<span class="ver-tag">latest</span>' : '';
      return `<button class="version-item" data-id="${v.externalID}" data-display="${escapeHtml(label)}">
        <span class="ver-num">v${escapeHtml(label)}</span>
        <span class="ver-date">${escapeHtml(date)}</span>
        ${tag}
      </button>`;
    })
    .join('');
  menu.innerHTML = `<button class="version-item version-item-latest" data-id="" data-display="${escapeHtml(latest)}">
      <span class="ver-num">Use latest (v${escapeHtml(latest || '?')})</span>
    </button>${items}`;

  menu.querySelectorAll('.version-item').forEach((item) => {
    item.addEventListener('click', () => {
      const id = item.dataset.id;
      const display = item.dataset.display;
      row.dataset.versionId = id;
      chipEl.textContent = `v${display || (latest || '?')} ▾`;
      closeVersionMenu();
    });
  });
}

// parseAppleAppID extracts a numeric App Store ID from a variety of inputs:
//   "918131840"                                 → "918131840"
//   "https://apps.apple.com/au/app/idos-2/id918131840"  → "918131840"
//   "apps.apple.com/us/app/idos/id918131840?mt=8"       → "918131840"
//   "MND402402F" / "iDOS 2" / "" / "abc"        → null
// Used to make the App ID input + Direct row tolerant of users pasting whatever
// link they copied out of the App Store / receipt / past purchases page.
function parseAppleAppID(s) {
  const v = String(s || '').trim();
  if (!v) return null;
  // Apple App Store URLs always carry the ID as `/id<digits>` somewhere in the path.
  const urlMatch = v.match(/\/id(\d{6,12})\b/);
  if (urlMatch) return urlMatch[1];
  // Standalone digits.
  if (/^\d{6,12}$/.test(v)) return v;
  return null;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

async function doSearch() {
  const term = qEl.value.trim();
  if (!term) return;
  const limit = Math.max(1, parseInt(limitEl.value, 10) || 10);
  setStatus('Searching…');
  resultsEl.innerHTML = '<div class="empty">Searching…</div>';
  try {
    const res = await Search(term, limit);
    renderResults(res.apps || []);
    setStatus(`${res.count || 0} result${res.count === 1 ? '' : 's'}`);
  } catch (e) {
    resultsEl.innerHTML = '';
    setStatus(String(e), 'error');
  }
}

async function download(bundleID, btn, versionID = '') {
  if (!bundleID) return;
  const outdir = outdirEl.value;
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = 'Downloading…';
  setStatus(`Downloading ${bundleID}${versionID ? ` (v${versionID})` : ''}…`);
  try {
    const res = await Download(bundleID, outdir, versionID, false);
    if (res.success) {
      btn.textContent = 'Done ✓';
      setStatus(`Saved to ${res.outputPath}`, 'ok');
      if (installIpaEl) {
        installIpaEl.value = res.outputPath;
        setStatus(`Saved to ${res.outputPath} — hit Install to phone to push it to the iPhone.`, 'ok');
      }
    } else {
      const err = res.error || 'unknown error';
      if (/password token.*expired|token.*expired|session.*expired/i.test(err)) {
        // ipatool auth has expired — re-login needed. Pop the sign-in panel
        // and remember which download to auto-resume after the user re-auths.
        btn.textContent = orig;
        btn.disabled = false;
        setStatus(
          'Your ipatool session has expired (this happens every few weeks). Sign in again — your download will resume automatically.',
          'error'
        );
        pendingRetryAfterLogin = { bundleID, versionID, btn };
        showSignin();
        return;
      }
      if (/license|purchase|not.+purchase/i.test(err)) {
        // No license — auto-retry with --purchase (free apps will succeed,
        // paid apps will fail again with a clearer error)
        await retryWithPurchase(bundleID, btn, orig);
        return;
      }
      // "app not found" from ipatool means the iTunes lookup endpoint can't
      // resolve the bundle ID — typically because Apple wiped the record when
      // the app was delisted. The purchase server still honours the license,
      // so the workaround is to download by numeric App Store ID instead.
      const row = btn.closest('.row');
      const originalBundle = row?.dataset.originalBundle || bundleID;
      // Show the App-ID prompt when:
      //   (a) ipatool says "app not found" for a bundle ID (the classic case), or
      //   (b) we're retrying with a user-supplied App ID and ipatool says the
      //       item doesn't exist (their ID was wrong — let them try again).
      const triedAppID = /^\d+$/.test(bundleID.trim()) && !!row?.dataset.originalBundle;
      if (/app not found|item.*not.*exist|invalid.*item/i.test(err) &&
          (!/^\d+$/.test(bundleID.trim()) || triedAppID)) {
        showAppIDRetry(row, btn, orig, originalBundle, versionID, err);
        return;
      }
      btn.textContent = orig;
      btn.disabled = false;
      // Account-mismatch hint: if the row carries a DSID and it differs from
      // the signed-in one, upgrade the error message to flag the mismatch.
      const rowDSID = row?.dataset.dsid || '';
      if (rowDSID && signedInDSID && rowDSID !== signedInDSID) {
        setStatus(
          `Download failed: this app is licensed to Apple ID dsid ${rowDSID}, but ipatool is signed in as dsid ${signedInDSID}. Sign in with the other account to download. (raw: ${err})`,
          'error'
        );
      } else {
        setStatus(`Download failed: ${err}`, 'error');
      }
    }
  } catch (e) {
    btn.textContent = orig;
    btn.disabled = false;
    setStatus(String(e), 'error');
  }
}

// Renders an inline retry input below the row when ipatool can't resolve a
// delisted app's bundle ID. User pastes the numeric App Store ID (findable in
// their Apple email receipt or at reportaproblem.apple.com), clicks Retry,
// and we re-issue the download with -i instead of -b.
function showAppIDRetry(row, btn, orig, bundleID, versionID, rawErr) {
  btn.textContent = orig;
  btn.disabled = false;
  // Preserve the original bundle ID so we can always come back to it.
  if (!row.dataset.originalBundle) row.dataset.originalBundle = bundleID;
  const previousAttempt = row.dataset.lastAppId || '';
  setStatus(
    previousAttempt
      ? `"${previousAttempt}" didn't work either. The App Store ID is a pure number, 9–10 digits long, like 1580768213. It is NOT the order number (e.g. MND402402F) or any document number — those are billing identifiers. Find it in your "Your receipt from Apple" email: click the app's link, the URL ends in /id1234567890.`
      : `"${bundleID}" appears delisted from Apple's lookup index. Enter its numeric App Store ID (9–10 digits, e.g. 1580768213) to download by ID. Find it in your "Your receipt from Apple" email — click the iDOS 2 link in the receipt and the URL will end in /idNNNNNNNNNN.`,
    'error'
  );
  // Avoid stacking multiple prompts on the same row
  row.querySelector('.app-id-retry')?.remove();
  const wrap = document.createElement('div');
  wrap.className = 'app-id-retry';
  wrap.innerHTML = `
    <input type="text" class="app-id-input" placeholder="App Store ID — 9–10 digit number only (e.g. 1580768213)" inputmode="numeric" autocomplete="off" value="${escapeHtml(previousAttempt)}" />
    <button class="app-id-retry-btn">Retry with App ID</button>
    <button class="app-id-cancel ghost">Cancel</button>
  `;
  row.appendChild(wrap);
  const input = wrap.querySelector('.app-id-input');
  const retryBtn = wrap.querySelector('.app-id-retry-btn');
  const cancelBtn = wrap.querySelector('.app-id-cancel');
  setTimeout(() => {
    input.focus();
    input.select();
  }, 0);

  // Auto-extract the App ID when the user pastes an App Store URL.
  input.addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text') || '';
    const extracted = parseAppleAppID(text);
    if (extracted && extracted !== text.trim()) {
      e.preventDefault();
      input.value = extracted;
      setStatus(`Extracted App Store ID ${extracted} from the link you pasted.`, 'ok');
    }
  });

  const submit = async () => {
    const id = parseAppleAppID(input.value);
    if (!id) {
      input.style.borderColor = '#ff7a7a';
      setStatus(
        `"${input.value.trim() || '(empty)'}" isn't an App Store ID. Paste either the raw number (9–10 digits, e.g. 1580768213) or the full App Store URL (e.g. https://apps.apple.com/au/app/idos-2/id918131840 — I'll grab the number after /id). Order numbers (MND...) and document numbers are different identifiers.`,
        'error'
      );
      return;
    }
    wrap.remove();
    row.dataset.lastAppId = id;
    // Remap row identity to the App ID so progress/done events land here.
    // We've already stashed originalBundle so future re-prompts can show it.
    row.dataset.bundle = id;
    btn.dataset.bundle = id;
    download(id, btn, versionID);
  };
  retryBtn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });
  cancelBtn.addEventListener('click', () => wrap.remove());
}

async function retryWithPurchase(bundleID, btn, orig) {
  btn.disabled = true;
  btn.textContent = 'Purchasing…';
  setStatus(`Acquiring license + downloading ${bundleID}…`);
  try {
    const row = btn.closest('.row');
    const versionID = row?.dataset.versionId || '';
    const res = await Download(bundleID, outdirEl.value, versionID, true);
    if (res.success) {
      btn.textContent = 'Done ✓';
      setStatus(`Saved to ${res.outputPath}`, 'ok');
    } else {
      btn.textContent = orig;
      btn.disabled = false;
      setStatus(`Failed: ${res.error || 'unknown error'}`, 'error');
    }
  } catch (e) {
    btn.textContent = orig;
    btn.disabled = false;
    setStatus(String(e), 'error');
  }
}

$('searchBtn').addEventListener('click', doSearch);
qEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doSearch();
});

// --- Manual download by bundle ID / App ID ---
const manualIdEl = $('manualId');
const manualBtn = $('manualBtn');

function manualRowHTML(idOrBundle) {
  return `
    <div class="row manual-result" data-bundle="${escapeHtml(idOrBundle)}" data-name="${escapeHtml(idOrBundle)}" data-latest-version="" style="--progress: 0%">
      <div class="row-main">
        <div class="row-title">${escapeHtml(idOrBundle)} <span class="row-badge">manual</span></div>
        <div class="row-sub">
          <span class="bundle">${escapeHtml(idOrBundle)}</span>
          <span class="row-progress"></span>
        </div>
      </div>
      <button class="dl-btn" data-bundle="${escapeHtml(idOrBundle)}">Download</button>
    </div>`;
}

function doManualDownload() {
  let id = manualIdEl.value.trim();
  if (!id) return;
  // Tolerate App Store URLs — extract the numeric ID before dispatching.
  const extracted = parseAppleAppID(id);
  if (extracted && extracted !== id) {
    id = extracted;
    manualIdEl.value = extracted;
    setStatus(`Extracted App Store ID ${extracted} from the link.`, 'ok');
  }
  // Insert (or reuse) a synthetic row at the top of results
  const existing = resultsEl.querySelector(`.row[data-bundle="${CSS.escape(id)}"]`);
  if (!existing) {
    resultsEl.insertAdjacentHTML('afterbegin', manualRowHTML(id));
    const newRow = resultsEl.querySelector(`.row[data-bundle="${CSS.escape(id)}"]`);
    newRow.querySelector('.dl-btn').addEventListener('click', () => {
      download(id, newRow.querySelector('.dl-btn'));
    });
  }
  const btn = resultsEl
    .querySelector(`.row[data-bundle="${CSS.escape(id)}"]`)
    .querySelector('.dl-btn');
  download(id, btn);
}

manualBtn.addEventListener('click', doManualDownload);
manualIdEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doManualDownload();
});
manualIdEl.addEventListener('paste', (e) => {
  const text = e.clipboardData?.getData('text') || '';
  const extracted = parseAppleAppID(text);
  if (extracted && extracted !== text.trim()) {
    e.preventDefault();
    manualIdEl.value = extracted;
    setStatus(`Extracted App Store ID ${extracted} from the App Store link.`, 'ok');
  }
});

// --- Install a local .ipa on the connected iPhone ---
const installIpaEl = $('installIpa');
const pickIpaBtn = $('pickIpaBtn');
const installBtn = $('installBtn');

let installing = false;

pickIpaBtn.addEventListener('click', async () => {
  try {
    const path = await PickIPAPath();
    if (path) {
      installIpaEl.value = path;
      setStatus('Choose Install to phone to push this .ipa.', 'ok');
    }
  } catch (e) {
    setStatus(String(e), 'error');
  }
});

installBtn.addEventListener('click', async () => {
  if (installing) return;
  const path = installIpaEl.value.trim();
  if (!path) {
    setStatus('Pick a .ipa file first (Choose…), or download one above.', 'error');
    return;
  }
  installing = true;
  installBtn.disabled = true;
  installBtn.textContent = 'Installing… 0%';
  setStatus(`Installing ${path.split('/').pop()}…`);
  try {
    const res = await InstallIPA(path);
    if (res.success) {
      installBtn.textContent = res.name ? `Installed ${res.name} ✓` : 'Installed ✓';
      setStatus(`Installed on iPhone: ${res.name || 'app'}`, 'ok');
    } else {
      installBtn.textContent = 'Install to iPhone';
      setStatus(`Install failed: ${res.error || 'unknown error'}`, 'error');
    }
  } catch (e) {
    installBtn.textContent = 'Install to iPhone';
    setStatus(String(e), 'error');
  } finally {
    installing = false;
    installBtn.disabled = false;
  }
});

EventsOn('install:start', () => {
  installing = true;
  installBtn.disabled = true;
  installBtn.textContent = 'Installing… 0%';
});

EventsOn('install:progress', (info) => {
  const pct = Math.round(Number(info?.pct) || 0);
  installBtn.textContent = `Installing… ${pct}%`;
  const step = info?.step || '';
  if (step) setStatus(`iPhone install: ${step.replace(/\s*\(\d+%\)/, '')}`);
});

EventsOn('install:done', (res) => {
  installing = false;
  installBtn.disabled = false;
  if (res?.success) {
    installBtn.textContent = res.name ? `Installed ${res.name} ✓` : 'Installed ✓';
    setStatus(`Installed on iPhone: ${res.name || 'app'}`, 'ok');
  } else {
    installBtn.textContent = 'Install to iPhone';
    setStatus(`Install failed: ${res?.error || 'unknown error'}`, 'error');
  }
});

// --- iPhone-installed apps ---
const iphoneBtn = $('iphoneBtn');
let signedInDSID = ''; // populated by refreshSignedInDSID(); '' = unknown
let pendingRetryAfterLogin = null; // {bundleID, versionID, btn} — resumed after sign-in
let pendingOwnerDSID = ''; // DSID we hoped the user would sign in as; '' if no expectation

async function refreshSignedInDSID() {
  try {
    signedInDSID = (await SignedInDSID()) || '';
  } catch {
    signedInDSID = '';
  }
}

function dsidClass(rowDSID) {
  if (!rowDSID) return '';
  if (!signedInDSID) return 'dsid-unknown';
  return rowDSID === signedInDSID ? 'dsid-match' : 'dsid-mismatch';
}

function dsidTitle(rowDSID) {
  if (!rowDSID) return '';
  if (!signedInDSID) return `Licensed to Apple ID dsid ${rowDSID}. Current ipatool sign-in is unknown.`;
  if (rowDSID === signedInDSID) return `Licensed to the Apple ID currently signed in to ipatool (dsid ${rowDSID}).`;
  return `Licensed to a DIFFERENT Apple ID (dsid ${rowDSID}) than the one signed in to ipatool (dsid ${signedInDSID}). Sign in with that account to download.`;
}

function filterIphoneRows(query) {
  const q = query.trim().toLowerCase();
  let shown = 0;
  resultsEl.querySelectorAll('.row').forEach((row) => {
    const hay = [
      row.dataset.name,
      row.dataset.bundle,
      row.dataset.originalBundle,
      row.dataset.appStoreId,
    ].filter(Boolean).join(' ').toLowerCase();
    const match = !q || hay.includes(q);
    row.style.display = match ? '' : 'none';
    if (match) shown++;
  });
  const counter = document.getElementById('iphoneFilterCount');
  if (counter) counter.textContent = q ? `${shown}/${resultsEl.querySelectorAll('.row').length}` : '';
}

function renderInstalledApps(apps) {
  if (!apps || apps.length === 0) {
    resultsEl.innerHTML = '<div class="empty">No user apps found on the connected iPhone.</div>';
    return;
  }
  // When iTunesMetadata gave us an App Store itemId, route the download through
  // the numeric -i path directly — that bypasses ipatool's bundle→ID lookup,
  // which is wiped by Apple for delisted apps. Bundle ID is still shown for
  // human-readable display and version-menu lookups (those use the public API
  // and would just fail silently for delisted apps; harmless).
  const filterBar = `
    <div class="filter-bar">
      <div class="filter-input-wrap">
        <input id="iphoneFilter" type="text" placeholder="Filter ${apps.length} apps — name, bundle ID, or App Store ID" autocomplete="off" />
        <button id="iphoneFilterClear" class="filter-clear" title="Clear (Esc)" aria-label="Clear filter">×</button>
      </div>
      <span id="iphoneFilterCount" class="filter-count"></span>
    </div>`;
  resultsEl.innerHTML = filterBar + apps
    .map((a) => {
      const downloadID = a.appStoreID || a.bundleID;
      const mismatched = a.dsid && signedInDSID && a.dsid !== signedInDSID;
      const ownerBtn = mismatched
        ? `<button class="signin-as-owner" data-target-dsid="${escapeHtml(a.dsid)}" title="Sign in as the Apple ID (dsid ${escapeHtml(a.dsid)}) that holds this app's license">Sign in as owner</button>`
        : '';
      return `
    <div class="row" data-bundle="${escapeHtml(downloadID)}" data-original-bundle="${escapeHtml(a.bundleID)}" data-app-store-id="${escapeHtml(a.appStoreID || '')}" data-name="${escapeHtml(a.name)}" data-latest-version="${escapeHtml(a.version || '')}" data-dsid="${escapeHtml(a.dsid || '')}" data-source="iphone" style="--progress: 0%">
      <img class="row-icon" data-app-store-id="${escapeHtml(a.appStoreID || '')}" alt="" />
      <div class="row-main">
        <div class="row-title">${escapeHtml(a.name)} <span class="row-badge row-badge-iphone">on iPhone</span></div>
        <div class="row-sub">
          <span class="bundle">${escapeHtml(a.bundleID)}</span>
          <button class="version-chip" data-bundle="${escapeHtml(a.bundleID)}" title="Click to choose a different version">v${escapeHtml(a.version || '?')} ▾</button>
          ${a.appStoreID ? `<span class="appid-chip" title="App Store itemId from this device's purchase metadata — used for download (works even for delisted apps)">id ${escapeHtml(a.appStoreID)}</span>` : ''}
          ${a.dsid ? `<span class="dsid-chip ${dsidClass(a.dsid)}" title="${escapeHtml(dsidTitle(a.dsid))}">dsid ${escapeHtml(a.dsid)}</span>` : ''}
          ${ownerBtn}
          ${a.appStoreID ? '' : '<button class="app-id-link" title="No App Store metadata on this app (sideloaded?) — click to enter the App Store ID manually">Use App ID</button>'}
          <span class="row-progress"></span>
        </div>
      </div>
      <button class="dl-btn" data-bundle="${escapeHtml(downloadID)}">Download</button>
    </div>`;
    })
    .join('');

  resultsEl.querySelectorAll('.version-chip').forEach((chip) => {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      openVersionMenu(chip);
    });
  });
  resultsEl.querySelectorAll('.app-id-link').forEach((link) => {
    link.addEventListener('click', () => {
      const row = link.closest('.row');
      const dlBtn = row.querySelector('.dl-btn');
      const versionID = row?.dataset.versionId || '';
      // Use the original bundle for context in the prompt copy, regardless of
      // whether the row already has an override applied.
      const originalBundle = row.dataset.originalBundle || row.dataset.bundle;
      showAppIDRetry(row, dlBtn, 'Download', originalBundle, versionID, '');
    });
  });
  resultsEl.querySelectorAll('.dl-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.row');
      const versionID = row?.dataset.versionId || '';
      download(btn.dataset.bundle, btn, versionID);
    });
  });
  const filterInput = document.getElementById('iphoneFilter');
  const filterClear = document.getElementById('iphoneFilterClear');
  if (filterInput) {
    const updateClearVisibility = () => {
      if (filterClear) filterClear.classList.toggle('visible', !!filterInput.value);
    };
    filterInput.addEventListener('input', (e) => {
      filterIphoneRows(e.target.value);
      updateClearVisibility();
    });
    filterInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        filterInput.value = '';
        filterIphoneRows('');
        updateClearVisibility();
      }
    });
    if (filterClear) {
      filterClear.addEventListener('click', () => {
        filterInput.value = '';
        filterIphoneRows('');
        updateClearVisibility();
        filterInput.focus();
      });
    }
    // Cmd+F (or /) jumps to the filter — standard "find" behaviour inside the list.
    setTimeout(() => filterInput.focus(), 0);
  }
  // "Sign in as owner" — opens the sign-in panel with the target DSID stashed
  // so we can confirm-or-warn after the user re-auths.
  resultsEl.querySelectorAll('.signin-as-owner').forEach((btn) => {
    btn.addEventListener('click', () => {
      pendingOwnerDSID = btn.dataset.targetDsid || '';
      const row = btn.closest('.row');
      // Stash the row's download params so we can auto-resume after sign-in.
      pendingRetryAfterLogin = {
        bundleID: row.dataset.bundle,
        versionID: row.dataset.versionId || '',
        btn: row.querySelector('.dl-btn'),
      };
      setStatus(
        `Sign in as the Apple ID with dsid ${pendingOwnerDSID} to download this app. The download will retry automatically once you've signed in.`,
        'info'
      );
      showSignin();
    });
  });
  // Fetch artwork in the background for every row with an App Store ID. Pass
  // the storefront so region-locked apps (e.g. Service NSW in the AU store)
  // resolve from the right catalog.
  const requests = apps
    .filter((a) => a.appStoreID)
    .map((a) => ({ id: a.appStoreID, storefront: a.storefront || '' }));
  if (requests.length) {
    LookupArtwork(requests)
      .then((map) => {
        if (!map) return;
        Object.entries(map).forEach(([id, url]) => {
          if (!url) return;
          resultsEl.querySelectorAll(`.row-icon[data-app-store-id="${CSS.escape(id)}"]`)
            .forEach((img) => {
              img.src = url;
              img.classList.add('loaded');
            });
        });
      })
      .catch(() => {});
  }
}

async function loadInstalledApps() {
  iphoneBtn.disabled = true;
  const orig = iphoneBtn.textContent;
  iphoneBtn.textContent = 'Reading device…';
  setStatus('Reading installed apps from iPhone…');
  resultsEl.innerHTML = '<div class="empty">Reading installed apps from iPhone…</div>';
  try {
    // Make sure we have the signed-in DSID before rendering so chips colour correctly.
    await refreshSignedInDSID();
    const apps = await ListInstalledApps();
    renderInstalledApps(apps);
    const mismatches = signedInDSID
      ? apps.filter((a) => a.dsid && a.dsid !== signedInDSID).length
      : 0;
    const msg = `${apps.length} app${apps.length === 1 ? '' : 's'} on iPhone` +
      (mismatches ? ` — ${mismatches} licensed to a different Apple ID` : '');
    setStatus(msg, mismatches ? 'info' : 'ok');
  } catch (e) {
    resultsEl.innerHTML = '';
    setStatus(String(e), 'error');
  } finally {
    iphoneBtn.disabled = false;
    iphoneBtn.textContent = orig;
  }
}

iphoneBtn.addEventListener('click', loadInstalledApps);

// Poll for iPhone presence. When a device is plugged in (and trusted), the
// button glows so the user knows the action is meaningful right now.
async function pollDeviceConnected() {
  try {
    const connected = await DeviceConnected();
    iphoneBtn.classList.toggle('connected', !!connected);
    iphoneBtn.title = connected
      ? 'iPhone detected — click to list installed apps'
      : 'List apps installed on a USB-connected iPhone';
    installBtn.classList.toggle('install-active', !!connected && !installing);
  } catch {}
}
pollDeviceConnected();
setInterval(pollDeviceConnected, 3000);
$('pickDirBtn').addEventListener('click', async () => {
  try {
    const dir = await PickOutputDir();
    if (dir) outdirEl.value = dir;
  } catch (e) {
    setStatus(String(e), 'error');
  }
});

// --- Sign in panel ---
const signinPanel = $('signinPanel');
const signinEmail = $('signinEmail');
const signinPassword = $('signinPassword');
const signin2fa = $('signin2fa');
const signin2faRow = document.querySelector('.signin-2fa');
const signinSubmit = $('signinSubmit');
const signinCancel = $('signinCancel');
const signinMsg = $('signinMsg');
const currentAccountRow = $('currentAccountRow');
const currentAccountText = $('currentAccountText');
const signoutBtn = $('signoutBtn');

let lastKnownEmail = '';
let lastKnownName = '';

function showSignin() {
  signinPanel.classList.remove('hidden');
  signin2faRow.classList.add('hidden');
  signin2fa.value = '';
  signinPassword.value = '';
  signinMsg.textContent = '';
  signinMsg.className = 'signin-msg';
  const isOk = authEl.classList.contains('auth-ok');
  if (isOk && (lastKnownName || lastKnownEmail)) {
    currentAccountText.textContent = lastKnownName ? `${lastKnownName} (${lastKnownEmail})` : lastKnownEmail;
    currentAccountRow.classList.remove('hidden');
  } else {
    currentAccountRow.classList.add('hidden');
  }
  if (!signinEmail.value && lastKnownEmail) signinEmail.value = lastKnownEmail;
  setTimeout(() => (signinEmail.value ? signinPassword : signinEmail).focus(), 0);
}
function hideSignin() {
  signinPanel.classList.add('hidden');
  signinPassword.value = '';
  signin2fa.value = '';
}

authEl.addEventListener('click', () => {
  if (signinPanel.classList.contains('hidden')) showSignin();
  else hideSignin();
});

signinCancel.addEventListener('click', hideSignin);

signoutBtn.addEventListener('click', async () => {
  signoutBtn.disabled = true;
  signoutBtn.textContent = 'Signing out…';
  try {
    await Logout();
    setStatus('Signed out', 'ok');
  } catch (e) {
    setStatus(String(e), 'error');
  }
  await refreshAuthAndCache();
  signoutBtn.disabled = false;
  signoutBtn.textContent = 'Sign out';
  currentAccountRow.classList.add('hidden');
  signinPassword.value = '';
  signin2fa.value = '';
  setTimeout(() => signinEmail.focus(), 0);
});

async function submitSignin() {
  const email = signinEmail.value.trim();
  const password = signinPassword.value;
  const code = signin2fa.value.trim();
  if (!email || !password) {
    signinMsg.textContent = 'Email and password required';
    signinMsg.className = 'signin-msg signin-msg-error';
    return;
  }
  signinSubmit.disabled = true;
  signinSubmit.textContent = 'Signing in…';
  signinMsg.textContent = '';
  try {
    const res = await Login(email, password, code);
    if (res.success) {
      hideSignin();
      setStatus('Signed in', 'ok');
      await refreshAuthAndCache();
      // If the user clicked "Sign in as owner", check the freshly-cached DSID
      // matches what we expected and warn them if they used the wrong Apple ID.
      if (pendingOwnerDSID) {
        if (signedInDSID && signedInDSID !== pendingOwnerDSID) {
          setStatus(
            `Signed in as dsid ${signedInDSID}, but the app you wanted is licensed to dsid ${pendingOwnerDSID}. Download will probably fail — sign out and try a different Apple ID.`,
            'error'
          );
        } else if (signedInDSID === pendingOwnerDSID) {
          setStatus(`Signed in as the owning account (dsid ${signedInDSID}). Retrying download…`, 'ok');
        }
        pendingOwnerDSID = '';
      }
      // If a download was paused because of a stale token (or the owner sign-in
      // flow), resume it.
      if (pendingRetryAfterLogin) {
        const { bundleID, versionID, btn } = pendingRetryAfterLogin;
        pendingRetryAfterLogin = null;
        download(bundleID, btn, versionID);
      }
    } else if (res.needs2FA) {
      signin2faRow.classList.remove('hidden');
      signinMsg.textContent = 'Check your trusted devices for a 2FA code. (A code only arrives if your password is correct.)';
      signinMsg.className = 'signin-msg signin-msg-info';
      setTimeout(() => signin2fa.focus(), 0);
    } else {
      signinMsg.textContent = res.error || 'Sign in failed';
      signinMsg.className = 'signin-msg signin-msg-error';
      // Clear the 2FA field so they can try a fresh code; password may also be wrong
      signin2fa.value = '';
    }
  } catch (e) {
    signinMsg.textContent = String(e);
    signinMsg.className = 'signin-msg signin-msg-error';
  } finally {
    signinSubmit.disabled = false;
    signinSubmit.textContent = 'Sign in';
  }
}

signinSubmit.addEventListener('click', submitSignin);
[signinEmail, signinPassword, signin2fa].forEach((el) =>
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitSignin();
  })
);

// --- Download progress wiring ---
function fmtBytes(n) {
  if (!n || n < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function rowFor(bundleID) {
  return resultsEl.querySelector(`.row[data-bundle="${CSS.escape(bundleID)}"]`);
}

EventsOn('download:start', (info) => {
  const row = rowFor(info.bundleID);
  if (!row) return;
  row.style.setProperty('--progress', '0%');
  row.classList.add('downloading');
  const subText = row.querySelector('.row-progress');
  if (subText) subText.textContent = info.totalBytes ? `0 / ${fmtBytes(info.totalBytes)}` : 'starting…';
});

EventsOn('download:progress', (info) => {
  const row = rowFor(info.bundleID);
  if (!row) return;
  const total = Number(info.totalBytes) || 0;
  const cur = Number(info.bytes) || 0;
  let pct = 0;
  if (total > 0) {
    pct = Math.min(100, (cur / total) * 100);
  } else if (cur > 0) {
    // No total known — animate based on log scale, capped at 90%
    pct = Math.min(90, 10 + Math.log10(1 + cur / 1024) * 10);
  }
  row.style.setProperty('--progress', `${pct.toFixed(1)}%`);
  const subText = row.querySelector('.row-progress');
  if (subText) {
    subText.textContent = total
      ? `${fmtBytes(cur)} / ${fmtBytes(total)}`
      : `${fmtBytes(cur)} downloaded`;
  }
});

EventsOn('download:done', (res) => {
  const row = rowFor(res.bundleID);
  if (!row) return;
  if (res.success) {
    row.style.setProperty('--progress', '100%');
    row.classList.add('done');
  } else {
    row.classList.remove('downloading');
    row.style.removeProperty('--progress');
  }
});

async function refreshAuthAndCache() {
  await refreshAuth();
  try {
    const info = await AuthInfo();
    if (info.email) lastKnownEmail = info.email;
    if (info.name) lastKnownName = info.name;
  } catch {}
  await refreshSignedInDSID();
  await refreshAccounts();
}

refreshAuthAndCache();
initOutdir();
qEl.focus();
