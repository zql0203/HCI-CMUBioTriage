/* CMUbiotrage – offline-first first-response guide (demo). All content lives in data.json. */
const STALE_MS = 24 * 3600 * 1000;
const appRoot = new URL('../../', document.currentScript.src);
const appUrl = path => new URL(path, appRoot).href;
const guideOnly = ['guide', 'guide/', 'guide/index.html'].some(path => location.pathname === new URL(path, appRoot).pathname);
const guideRoutes = new Set(['tell', 'do', 'nosignal']);
let D = null, deferredInstall = null;
let guideOfflineReady = false;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const isNum = n => typeof n === 'string' && /^\+?[\d\s\-()]+$/.test(n) && (n.match(/\d/g) || []).length >= 7;
const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
const back = (to = guideOnly ? '#/tell' : '#/home') => `<a class="back" href="${to}">‹ Back</a>`;
const dashboardNav = active => {
  const sections = [['tell', '▣', 'Handoff Summary'], ['do', '✚', 'First Aid and Contacts']];
  if (!guideOnly) sections.unshift(['home', '⌁', 'Antivenom status']);
  return `<nav class="status-nav" aria-label="Main navigation">${sections.map(([route, icon, label]) => `<a${active === route ? ' class="status-nav-active" aria-current="page"' : ''} href="#/${route}"><span aria-hidden="true">${icon}&nbsp;</span>${label}</a>`).join('')}</nav>`;
};

function dial(c, cls = 'btn dial') {
  return isNum(c.number)
    ? `<a class="${cls}" href="tel:${esc(c.number.replace(/[^\d+]/g, ''))}">📞 Tap to dial ${esc(c.label)}</a>`
    : `<span class="review">${esc(c.label)}: number not set yet</span>`;
}
function facilityContactLinks(h, context = 'public') {
  const contacts = Array.isArray(h.contacts) && h.contacts.length ? h.contacts : (h.number ? [{ label: 'Main', number: h.number }] : []);
  if (!contacts.length) return '<span class="facility-number"><strong>Phone number not set</strong><br>Contact details need confirmation</span>';
  return contacts.map((contact, index) => isNum(contact.number)
    ? `<a class="${context === 'public' && index === 0 ? 'btn primary facility-call-main' : 'facility-call-secondary'}" href="tel:${esc(contact.number.replace(/[^\d+]/g, ''))}"><span>📞 ${context === 'public' && index === 0 ? 'Call ' : ''}${esc(contact.label)}</span><small>${esc(contact.number)}</small></a>`
    : `<span class="facility-number">${esc(contact.label)} number not set</span>`).join('');
}
function relativeTime(timestamp) {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
function toast(msg) {
  const t = document.createElement('div'); t.className = 'msg toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.append(t); setTimeout(() => t.remove(), 3000);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('✔ Copied to clipboard'); }
  catch { const a = document.createElement('textarea'); a.value = text; document.body.append(a); a.select(); try { document.execCommand('copy'); toast('✔ Copied to clipboard'); } catch { toast('Could not copy. Select the text and copy it by hand.'); } a.remove(); }
}
async function share(text, url = location.href) {
  if (navigator.share) { try { await navigator.share({ title: 'CMUBioTriage', text, url }); return; } catch { return; } }
  copy(url ? `${text} ${url}` : text);
}

function unverifiedContacts() {
  const contacts = [D.alternate, D.campusSecurity].filter(contact => contact && contact.number);
  if (!contacts.length) return '';
  return `<details class="card unverified-contact-list"><summary>Unverified contacts — confirm before use</summary><p>These numbers have not been confirmed by local staff. Do not rely on them until verified.</p><ul>${contacts.map(contact => `<li><strong>${esc(contact.label)}:</strong> ${esc(contact.number)}</li>`).join('')}</ul></details>`;
}

const tellBody = () => `
    <section class="handoff-callout" aria-label="Emergency calling"><div><h2>Call for help first</h2><p>Use a phone call to reach help. This guide cannot dispatch responders.</p></div><div class="handoff-call-actions"><a class="btn emergency-call" href="tel:143">Call Philippine Red Cross · 143</a><a class="btn small" href="#/nosignal">Call didn’t connect?</a><a class="btn small" href="#/do">Other listed contacts</a></div></section>
    <section class="card handoff-preview"><h2>Share a handoff summary</h2><p class="lead">Review these details, then choose how to share them. Sharing does not send a staff report.</p><pre id="liveSummary" aria-label="Current handoff summary"></pre><div class="handoff-share-actions"><button class="btn small" id="copySummary" type="button">Copy summary</button><a class="btn small primary" id="sumSms" href="sms:?&body=">Open SMS draft</a><button class="btn small" id="sumShare" type="button">Share with another app</button></div><p class="handoff-share-note">Copying or opening SMS does not contact responders automatically. In SMS, you still need to choose a recipient and send. Phone service may be needed.</p></section>
    <div class="cols">
      <section class="card"><h2>Where are you?</h2><p class="field-hint">If the map or GPS is unavailable, choose the area and enter a nearby landmark. A map pin is optional.</p>
        ${sel('area','Area',D.options.areas)}${sel('surr','Surroundings',D.options.surroundings)}
        ${chips('meet','Can someone meet responders at the road?',D.options.meet,true)}
        ${txt('landmark','Nearest landmark (optional)')}
        <button class="btn primary" id="mapBtn" type="button">🗺 Pick my location on the map</button>
        <div id="mapBox" hidden><p class="lead">Tap the map where you are. Zoom in for accuracy.</p><div id="map"></div>
          <p id="mapNote" class="review" hidden>Map needs internet for new areas. Use GPS or the area list instead.</p></div>
        <button class="btn" id="gps" type="button">📍 Use my GPS</button><div id="gpsOut" aria-live="polite"></div>
        <div id="pinOut" aria-live="polite"></div></section>
      <section class="card"><h2>What happened?</h2><p class="field-hint">${guideOnly ? 'Include details you can share with responders. Choose Unknown if unsure.' : 'For a staff report, provide an area, a landmark, or a location pin. Other answers are optional; choose Unknown if unsure.'}</p>
        ${sel('time','Time of the bite',D.options.times)}
        <p class="urgent-symptom-note">Symptoms to tell the responder about. This guide does not diagnose or rank severity.</p>${chips('cond','Victim’s condition (tap all that apply)',[...['Hard to breathe','Unconscious','Drooping eyelids'],...D.options.conditions.filter(x => !['Hard to breathe','Unconscious','Drooping eyelids'].includes(x))])}
        ${chips('done','Actions already taken',D.options.actions)}
        ${sel('snake','Snake (only if safe to note)',D.options.snakes)}</section>
    </div>
    ${guideOnly ? '' : `<section class="card"><h2>Optional: submit a report to staff</h2><p>This sends the details to the staff report inbox when online. It does not call emergency services or confirm that help is on the way.</p><p class="connection-state" data-connection-state></p><button class="btn primary" id="submitReport" type="button">Submit report to staff</button><a class="btn emergency-call" href="tel:143">Call for urgent help · 143</a><div id="submitStatus" role="status" aria-live="polite"></div></section>`}`;

/* ---------- Public screens ---------- */
const screens = {
  home: () => {
    const states = D.hospitals.map(h => hState(h));
    return `<section class="status-page availability-dashboard">
      <div class="dashboard-brand"><strong>CMUBioTriage</strong></div>
      <section class="emergency-start" aria-labelledby="emergencyStartTitle">
        <div><p class="emergency-eyebrow">Snakebite response guide</p><h1 id="emergencyStartTitle">Get help first</h1><p>Ask someone nearby to help. Follow these steps in order.</p></div>
        <ol class="emergency-steps"><li><strong>Call for help</strong><a class="btn emergency-call" href="tel:143">Call Philippine Red Cross · 143</a><a class="call-failed-link" href="#/nosignal">Call didn’t connect?</a></li><li><strong>Follow the guide</strong><a class="btn primary" href="#/do">Open first aid and contacts</a><small>Step-by-step first aid, what to avoid, and who to contact.</small></li><li><strong>Share useful details</strong><a class="btn" href="#/tell">Prepare a handoff summary</a><small>A summary or staff report does not dispatch help.</small></li></ol>
      </section>
      <p class="offline-hint"><strong>Offline:</strong> Previously saved guide content and the area/landmark form can work offline. Reports are not queued to send later. New map areas need internet; calls and SMS need phone service. <a href="#/before">Save the guide</a> or <a href="${appUrl('qr/')}">get the printable QR code</a>.</p>
      <div class="status-heading"><div><h1>Facility status</h1><p class="lead">Reported antivenom stock and facility contacts</p></div><span class="status-connection ${SYNC() ? 'is-shared' : 'is-device-only'}">● ${SYNC() ? 'Shared sync configured' : 'Device only'}</span></div>
      <p class="field-hint status-sync-explainer">${SYNC() ? 'Facility updates are set to sync across devices when online. Check each update time and call the facility to verify.' : 'Facility updates saved by staff in this browser are not visible on other devices. Availability still needs to be confirmed directly with each facility.'}</p>
      ${dashboardNav('home')}
      <h2 class="section-title">Listed facilities</h2>
      <div class="facility-grid" id="facilityGrid">${D.hospitals.map((h, i) => {
        const st = states[i], s = st.s;
        const statusClass = st.tag === 'Confirmed' ? 'facility-confirmed' : st.tag === 'Restock announced' ? 'facility-restock' : st.tag === 'Unavailable' ? 'facility-unavailable' : 'facility-needs';
        const place = h.location || '';
        const note = st.tag === 'Stale' ? 'Staff update is more than 24 hours old. Call to verify current stock.' : st.tag === 'Confirmed' ? 'Staff reported availability. Call to verify before referring a patient.' : st.tag === 'Unavailable' ? 'Staff reported no vials at the last update. Call to verify.' : st.tag === 'Restock announced' ? 'Restock announced; current stock is not confirmed. Call to verify.' : 'Availability must be verified directly with the facility.';
        const timestampLabel = s ? (s.status === 'Confirmed' ? 'Last confirmed' : s.status === 'Restock announced' ? 'Restock announced' : 'Last status update') : '';
        const hasCoords = h.coordinatesVerified === true && h.locationPending !== true && h.lat !== null && h.lat !== undefined && h.lng !== null && h.lng !== undefined && h.lat !== '' && h.lng !== '' && Number.isFinite(Number(h.lat)) && Number.isFinite(Number(h.lng)) && Math.abs(Number(h.lat)) <= 90 && Math.abs(Number(h.lng)) <= 180;
        const mapLink = hasCoords ? `<a class="facility-map-link" href="https://maps.google.com/?q=${Number(h.lat)},${Number(h.lng)}" target="_blank" rel="noopener">Open confirmed location in maps</a>` : '';
        const hasStock = s && s.stock !== undefined && s.stock !== null && s.stock !== '';
        const stockBlock = `<div class="facility-stock ${hasStock ? '' : 'stock-none'}"><span>Last reported stock (not a guarantee)</span><strong>${hasStock ? esc(String(s.stock)) + (Number(s.stock) === 1 ? ' vial' : ' vials') : 'Not reported'}</strong>${s ? `<small>Source: ${esc(s.by || 'staff update')} · ${esc(relativeTime(s.at))}</small>` : '<small>No staff update recorded</small>'}</div>`;
        return `<article class="facility-card ${statusClass} ${st.tag === 'Stale' ? 'facility-stale' : ''}" data-facility="${esc((h.name + ' ' + place).toLowerCase())}" data-state="${statusClass}"><div class="facility-title"><div><h2>${esc(h.name)}</h2>${h.namePending ? '<span class="detail-pending">Facility name needs confirmation</span>' : ''}</div><span class="facility-badge ${st.tag === 'Stale' ? 'badge-stale' : ''}">${st.tag === 'Stale' ? 'Outdated' : st.tag === 'Confirmed' ? 'Confirmed' : st.tag === 'Unavailable' ? 'No vials reported' : st.tag === 'Restock announced' ? 'Restock announced' : 'Unconfirmed'}</span></div>
          ${place ? `<p class="facility-location">${esc(place)}${h.locationPending ? ' <span class="detail-pending">Location unverified</span>' : ''}</p>` : '<p class="facility-location"><span class="detail-pending">Facility location not confirmed</span></p>'}
          ${stockBlock}<p class="facility-note"><strong>${esc(note)}</strong> Current stock and capacity are not guaranteed.</p><div class="facility-actions">${facilityContactLinks(h)}${mapLink}</div><hr class="facility-divider">${s ? `<div class="facility-verification"><p><strong>${timestampLabel}:</strong> <time datetime="${new Date(s.at).toISOString()}">${esc(new Date(s.at).toLocaleString())}</time> (${esc(relativeTime(s.at))})</p><p><strong>Source:</strong> Staff update${s.by ? ` by ${esc(s.by)}` : ''}</p><p><strong>Details:</strong> ${esc(s.details || 'No details provided.')}</p></div>` : '<div class="facility-verification"><p><strong>Last updated:</strong> No staff confirmation recorded.</p><p><strong>Source:</strong> None recorded</p></div>'}</article>`;
      }).join('')}</div>
      <section class="home-handoff" id="handoff" aria-labelledby="handoffTitle"><h2 id="handoffTitle" tabindex="-1">Tell the Responders</h2><p class="lead">Share the key details with responders. Tap an answer or mark it Unknown; you do not need to guess.</p>${tellBody()}</section>
      <div class="status-contacts"><a href="#/do">First aid guidance</a><a href="#/about">About this guide</a></div>
    </section>`;
  },

  do: () => `<h1>First Aid and Contacts</h1>
    <section class="card"><h2>Call for help now</h2><div class="contact-links">
      <div><strong>${esc(D.primary.label)}</strong><span class="num">${esc(D.primary.number)}</span>${dial(D.primary)}</div>
    </div><a class="btn dial" href="tel:143">Call Philippine Red Cross · 143</a><a class="btn" href="#/nosignal">Call didn’t connect?</a></section>
    ${unverifiedContacts()}
    <h2>What to do now</h2>
    <div class="cols">
      <div class="card do"><h2>✔ Do</h2><ul class="clean">${D.dos.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
      <div class="card dont"><h2>✖ Don’t</h2><ul class="clean">${D.donts.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
    </div>
    <a class="btn primary" href="#/tell">Tell the Responder</a>
    ${guideOnly ? '' : '<a class="btn dial" style="background:var(--alarm);color:var(--onalarm)" href="#/home">Go to call block</a>'}`,

  tell: () => `<h1>${guideOnly ? 'Handoff Summary' : 'Tell the Responder'}</h1>
    <p class="lead">Share the key details with responders. Tap an answer or mark it Unknown; you do not need to guess.</p>
    ${tellBody()}`,

  nosignal: () => `${back()}<h1>Call didn’t connect</h1>
    <div class="card"><h2>Try these next steps</h2><ol class="clean">
      <li>Ask someone nearby to try calling a listed emergency or facility contact.</li>
      <li>If it is safe, ask someone to move to a place with phone signal and call. Stay with the person who needs help.</li>
      <li>${guideOnly ? 'Open First Aid and Contacts to see the listed numbers.' : 'Open the facility list and choose a number to call directly.'}</li>
      <li>Continue the first-aid guide. A report or message does not replace a call for help.</li></ol></div>
    ${guideOnly ? '<a class="btn primary" href="#/do">Open First Aid and Contacts</a>' : '<a class="btn primary" href="#/home">Open facility contact list</a><a class="btn" href="#/do">Open first-aid guide</a>'}
    <a class="btn dial" href="tel:143">📞 Call Philippine Red Cross · 143</a>
    <button class="btn" id="shareBtn">Share this guide</button>`,

  before: () => `${back()}<h1>Before an emergency</h1>
    <div class="card"><h2>Save for offline use</h2><p>Open this guide online once and save it before going somewhere without signal. First aid content can work offline; maps, calls, SMS, and staff reports may still need internet or phone service.</p>
    <button class="btn primary" id="save">Save for offline use</button><div id="saveOut" aria-live="polite"></div>
    <button class="btn" id="install" hidden>Install app</button></div>
    <div class="card"><h2>Add to home screen</h2><p><b>Android (Chrome):</b> menu ⋮ → Add to Home screen / Install app.</p><p><b>iPhone (Safari):</b> Share → Add to Home Screen.</p></div>
    <button class="btn" id="shareBtn">Share this guide</button>`,

  about: () => `${back()}<h1>About this guide</h1>
    <div class="card"><p>A first-response guide for snakebites at CMU, with a referral tool for UH staff.</p>
    <p><b>Limits:</b> This is not medical treatment and not a diagnostic tool. It does not guarantee antivenom stock or hospital capacity.</p></div>
    <div class="card"><p><b>Content owner:</b> ${esc(D.owner)}</p><p><b>Version:</b> ${esc(D.version)}</p><p><b>Review status:</b> ${esc(D.reviewStatus || D.reviewed || 'Clinical review pending')}</p>
    <p><b>Report outdated information:</b> ${esc(D.reportContact)}</p></div>`
};

const optHtml = o => o.map(x => `<option>${esc(x)}</option>`).join('');
function sel(id, label, opts) {
  return `<div class="f"><label for="f_${id}">${label}</label><select id="f_${id}" data-sel="${id}"><option value="">Choose…</option>${optHtml(opts)}<option>Other (type)</option><option>Unknown</option></select><input id="o_${id}" class="other" placeholder="Type here" hidden></div>`;
}
function chips(id, label, opts, single) {
  const urgent = ['Hard to breathe', 'Unconscious', 'Drooping eyelids'];
  return `<div class="f"><div class="lbl" id="l_${id}">${label}</div><div class="chips" role="group" aria-labelledby="l_${id}" data-chips="${id}" ${single ? 'data-single' : ''}>${[...opts, 'Unknown'].map(o => `<button type="button" class="chip${id === 'cond' && urgent.includes(o) ? ' urgent-symptom' : ''}" aria-pressed="false">${esc(o)}</button>`).join('')}</div></div>`;
}
function txt(id, label, type = 'text', v = '') {
  return `<div class="f"><label for="f_${id}">${label}</label><input id="f_${id}" type="${type}" value="${esc(v)}"></div>`;
}
function val(id) {
  const g = document.querySelector(`[data-chips="${id}"]`);
  if (g) { const on = [...g.querySelectorAll('.chip[aria-pressed="true"]')].map(b => b.textContent); return on.join(', ') || 'Not answered'; }
  const e = document.getElementById('f_' + id); if (!e) return 'Not answered';
  if (e.tagName === 'SELECT') { if (e.value === 'Other (type)') return document.getElementById('o_' + id).value.trim() || 'Not answered'; return e.value || 'Not answered'; }
  return e.value.trim() || 'Not answered';
}
function biteTime() {
  return val('time');
}
function buildHandoffSummary() {
  return `SNAKEBITE HANDOFF\nArea: ${val('area')}\nSurroundings: ${val('surr')}\nLandmark: ${val('landmark')}\nCan someone meet responders: ${val('meet')}\nLocation pin: ${pinText()}\nTime of bite: ${biteTime()}\nCondition: ${val('cond')}\nActions already taken: ${val('done')}\nSnake (only if safely seen): ${val('snake')}`;
}
function updateHandoffSummary() {
  const preview = $('#liveSummary');
  if (!preview) return;
  const summary = buildHandoffSummary();
  preview.textContent = summary;
  const sms = $('#sumSms');
  if (sms) sms.href = 'sms:?&body=' + encodeURIComponent(summary);
}
function bindUnknown() {
  document.querySelectorAll('[data-sel]').forEach(e => e.addEventListener('change', () => {
    const o = document.getElementById('o_' + e.dataset.sel); o.hidden = e.value !== 'Other (type)'; if (!o.hidden) o.focus();
  }));
  document.querySelectorAll('[data-chips]').forEach(g => g.addEventListener('click', ev => {
    const b = ev.target.closest('.chip'); if (!b) return;
    const was = b.getAttribute('aria-pressed') === 'true', unk = b.textContent === 'Unknown';
    if (unk || g.hasAttribute('data-single')) g.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', 'false'));
    else g.querySelectorAll('.chip').forEach(c => { if (c.textContent === 'Unknown') c.setAttribute('aria-pressed', 'false'); });
    b.setAttribute('aria-pressed', was ? 'false' : 'true');
  }));
}

/* ---------- Map pin ---------- */
let map = null, pinMarker = null;
const getPin = () => { try { return JSON.parse(sessionStorage.getItem('ss_pin')); } catch { return null; } };
const pinLink = p => `https://maps.google.com/?q=${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
const pinText = () => {
  const p = getPin();
  if (!p) return 'No location pin attached';
  const method = p.source === 'GPS' ? `GPS (accuracy about ${Math.round(p.accuracy || 0)} m)` : p.source === 'Map' ? 'Map tap (accuracy not measured)' : 'Previously saved pin (source and accuracy not recorded)';
  const captured = p.at ? `; selected ${new Date(p.at).toLocaleString()}` : '';
  return `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)} · ${method}${captured} · ${pinLink(p)}`;
};
const pinNote = () => { const p = getPin(); return p ? `<p class="review">Location pin attached: ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}. Check whether it is still current; clear or replace it if needed.</p>` : ''; };
function renderPin() {
  const o = $('#pinOut'); if (!o) return; const p = getPin(); if (!p) { o.innerHTML = '<p class="location-empty"><strong>No location pin selected.</strong> Area and landmark can still be used.</p>'; updateHandoffSummary(); return; }
  const link = pinLink(p), body = 'Snakebite location: ' + link;
  o.innerHTML = `<div class="card location-pin"><div class="lbl">Location pin · ${p.source === 'GPS' ? 'GPS estimate' : p.source === 'Map' ? 'Map selection' : 'Source unknown'}</div><span class="big">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</span>
    <p>${p.source === 'GPS' ? `Estimated accuracy: about ${Math.round(p.accuracy || 0)} m` : p.source === 'Map' ? 'Accuracy not measured. Check the map point.' : 'Accuracy and source not recorded.'}${p.at ? ` · selected ${new Date(p.at).toLocaleString()}` : ''}</p>
    <p class="field-hint">Confirm this is the current incident location. Choose GPS or tap a new map point to replace it.</p>
    <p><a href="${link}" target="_blank" rel="noopener">Open in maps</a> (needs internet)</p>
    <button class="btn small" id="cpPin" type="button">Copy link</button>
    <a class="btn small primary" href="sms:?&body=${encodeURIComponent(body)}">Send location by SMS</a>
    <button class="btn small" id="clrPin" type="button">Clear pin</button></div>`;
  $('#cpPin').onclick = () => copy(link);
  $('#clrPin').onclick = () => { sessionStorage.removeItem('ss_pin'); if (pinMarker) { pinMarker.remove(); pinMarker = null; } renderPin(); };
  updateHandoffSummary();
}
function setPin(lat, lng, center, source = 'Map', accuracy = null) {
  sessionStorage.setItem('ss_pin', JSON.stringify({ lat, lng, source, accuracy, at: Date.now() }));
  if (map) { if (pinMarker) pinMarker.setLatLng([lat, lng]); else pinMarker = L.marker([lat, lng]).addTo(map); if (center) map.setView([lat, lng], 17); }
  renderPin();
}
function openMap() {
  $('#mapBox').hidden = false;
  if (!window.L) { $('#mapNote').hidden = false; return; }
  if (map) { map.invalidateSize(); return; }
  const p = getPin(), c = p ? { lat: p.lat, lng: p.lng, zoom: 17 } : D.mapCenter;
  map = L.map('map').setView([c.lat, c.lng], c.zoom || 16);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map)
    .on('tileerror', () => { $('#mapNote').hidden = false; });
  if (p) pinMarker = L.marker([p.lat, p.lng]).addTo(map);
  map.on('click', e => setPin(e.latlng.lat, e.latlng.lng, false, 'Map'));
}

/* ---------- Optional shared sync (Firebase Realtime Database REST) ---------- */
const SYNC = () => (D.syncUrl || '').replace(/\/$/, '');
const syncNote = () => SYNC() ? '<p class="review">Shared board: syncs when online.</p>' : '<p class="review">This device only: shared sync is not set up yet.</p>';
const pulled = {};
async function pullStatus() {
  const u = SYNC(); if (!u || !navigator.onLine) return;
  try { const remote = (await (await fetch(u + '/status.json')).json()) || {}; const all = hStatus();
    D.hospitals.forEach((h, i) => { const rm = remote['h' + i]; if (rm && (!all[h.name] || rm.at > all[h.name].at)) all[h.name] = rm; });
    store.set('ss_status', all); } catch {}
}
function pushStatus(i, rec) { const u = SYNC(); if (u && navigator.onLine) fetch(`${u}/status/h${i}.json`, { method: 'PUT', body: JSON.stringify(rec) }).catch(() => {}); }
async function pullLog() {
  const u = SYNC(); if (!u || !navigator.onLine) return;
  try { const remote = (await (await fetch(u + '/log.json')).json()) || {}; const l = store.get('ss_log', []); const have = new Set(l.map(x => x.id));
    Object.values(remote).forEach(e => { if (e && e.id && !have.has(e.id)) l.push(e); }); l.sort((a, b) => String(a.id).localeCompare(String(b.id))); store.set('ss_log', l); } catch {}
}
function pushLog(e) { const u = SYNC(); if (u && navigator.onLine) fetch(`${u}/log/${e.id}.json`, { method: 'PUT', body: JSON.stringify(e) }).catch(() => {}); }

/* ---------- Staff mode ---------- */
const hStatus = () => store.get('ss_status', {});
function hState(h) {
  const s = hStatus()[h.name];
  if (!s || !s.at) return { tag: 'Unverified', note: 'Never confirmed.' };
  const status = s.status || 'Unverified';
  if ((status === 'Confirmed' || status === 'Unavailable' || status === 'Restock announced') && Date.now() - s.at > STALE_MS) return { tag: 'Stale', note: 'Last staff update is over 24 hours old.', s };
  return { tag: status, note: '', s };
}
function availabilityOverview() {
  const states = D.hospitals.map(h => hState(h));
  const confirmed = states.filter(s => s.tag === 'Confirmed').length;
  const restock = states.filter(s => s.tag === 'Restock announced').length;
  const needs = D.hospitals.length - confirmed - restock;
  return `<section class="staff-overview" aria-label="Availability overview">
    <div class="overview-heading"><h2>Availability overview</h2><span>Illustrative data</span></div>
    <div class="status-stats">
      <div class="status-stat stat-green"><span class="stat-icon">✓</span><div><small>Confirmed available</small><strong>${confirmed}</strong></div></div>
      <div class="status-stat stat-red"><span class="stat-icon">♧</span><div><small>Needs confirmation</small><strong>${needs}</strong></div></div>
      <div class="status-stat stat-lime"><span class="stat-icon">⚑</span><div><small>Restock announced</small><strong>${restock}</strong></div></div>
      <div class="status-stat stat-blue"><span class="stat-icon">▤</span><div><small>Total facilities</small><strong>${D.hospitals.length}</strong></div></div>
    </div>
    <div class="connection-warning ${SYNC() ? 'connection-shared' : 'connection-device-only'}" role="status"><strong>${SYNC() ? 'Shared sync is configured.' : 'Staff updates are saved only in this browser and are not visible on other devices.'}</strong> ${SYNC() ? (navigator.onLine ? 'Updates sync when online; check the time of the latest confirmation.' : 'This device is offline, so updates cannot reach other devices yet.') : 'Set up shared sync before staff use the board across multiple devices.'}</div>
    <div class="status-warning dashboard-reminder" role="note"><strong>ⓘ &nbsp;Important reminder</strong><br>Always contact the healthcare facility to verify current antivenom availability before referring a patient. A restock announcement is not a current stock confirmation.</div>
  </section>`;
}
const screensStaff = {
  staff: () => sessionStorage.getItem('ss_staff') ? (location.hash = '#/staff-reports', '') : `${back()}<h1>Staff access</h1>
    <p>For UH staff and responders.</p><label for="pin">PIN</label><input id="pin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="128">
    <button class="btn primary" id="pinGo">Open staff mode</button><div id="pinOut" aria-live="polite"></div>`,

  'staff-dir': () => staffNav() + `<h1>Referral directory</h1>${availabilityOverview()}<button class="btn small" id="refresh" type="button">⟳ Refresh</button>
    <p class="review">Call to confirm antivenom. Listing does not guarantee stock or capacity.</p>
    <div class="card"><div class="f"><label for="staffName">Your name (used for every confirmation)</label><input id="staffName" autocomplete="name" placeholder="Type once"></div><p class="field-hint">To confirm stock, record a vial count and verification details: who you contacted, when, and what they reported. Updates older than 24 hours are marked stale.</p></div>
    ${D.hospitals.map((h, i) => { const st = hState(h), s = st.s;
      return `<div class="card staff-directory-card"><b>${esc(h.name)}</b><div class="staff-directory-contacts">${facilityContactLinks(h, 'staff')}</div>
      <span class="tag t-${st.tag}">${st.tag}</span> ${st.note ? `<small>${st.note}</small>` : ''}
      <div><small>${s ? `Last updated by ${esc(s.by)} on ${new Date(s.at).toLocaleString()} (${relativeTime(s.at)})` : 'Not confirmed yet'}</small></div>
      <div class="f"><label for="verificationDetails${i}">Verification details (required to confirm)</label><textarea id="verificationDetails${i}" rows="2" data-verification-details="${i}" placeholder="Who did you contact, when, and what did they report?">${esc(s?.details || '')}</textarea></div>
            <div class="f"><label for="stock${i}">Antivenom vials in stock</label><input id="stock${i}" type="number" min="0" max="9999" step="1" inputmode="numeric" data-stock="${i}" value="${s && s.stock !== undefined && s.stock !== null ? s.stock : ''}" placeholder="Number of vials"><small class="field-hint">Shown to the public on this hospital’s card. Required to mark confirmed.</small></div>
            <button class="btn small primary" data-conf="${i}">Mark confirmed now</button>
      <button class="btn small" data-unavailable="${i}">Record no vials (0)</button>
      <button class="btn small" data-restock="${i}">Mark restock announced</button>
      <button class="btn small" data-unconf="${i}">Mark unverified</button>
      </div>`; }).join('')}`,

  'staff-alert': () => staffNav() + `<h1>Pre-alert message</h1>${pinNote()}
    <div class="cols"><section class="card">
      <div class="f"><label for="p_h">Receiving hospital</label><select id="p_h">${optHtml(D.hospitals.map(h => h.name))}</select></div>
      ${sel('pl','Location',D.options.areas)}${sel('pe','ETA',D.options.etas)}</section>
    <section class="card">${sel('pt','Time of bite',D.options.times)}${chips('pc','Victim’s condition',D.options.conditions)}${sel('ps','Snake',D.options.snakes)}</section></div>
    <button class="btn primary" id="gen">Generate message</button><div id="genOut"></div>`,

  'staff-log': () => staffNav() + `<h1>Incident log</h1>${syncNote()}
    <section class="card cols">${txt('ld','Date','date',new Date().toISOString().slice(0, 10))}${sel('ll','Location',D.options.areas)}${sel('ln','Outcome',D.options.outcomes)}</section>
    <button class="btn primary" id="addLog">Save entry</button><button class="btn" id="csv">Export CSV</button>
    <div id="logList">${logList()}</div>`,
};
const staffNav = () => {
  const cur = location.hash.replace('#/', '');
  const tabs = [['staff-reports', 'Submitted reports'], ['staff-dir', 'Directory'], ['staff-alert', 'Pre-alert'], ['staff-log', 'Log']];
  return '<nav class="staff-tabs" aria-label="Staff sections">' + tabs.map(([key, label]) => `<a class="btn small${cur === key ? ' primary' : ''}" href="#/${key}"${cur === key ? ' aria-current="page"' : ''}>${label}</a>`).join('') + '<a class="btn small" href="#/staff-out">Log out</a></nav>';
};
const logList = () => store.get('ss_log', []).map(l => `<div class="card">${esc(l.d)} – ${esc(l.l)}<br>${esc(l.n)}</div>`).join('') || '<p>No entries yet.</p>';


/* ---------- API helpers (work in any folder, on XAMPP/PHP; no Netlify needed) ---------- */
const apiUrl = name => location.pathname.replace(/[^/]*$/, '') + 'api/' + name + '.php';
const uuid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
function timeoutSignal(ms) {
  if (window.AbortSignal && AbortSignal.timeout) return AbortSignal.timeout(ms);
  const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal;
}

/* ---------- Shared submitted reports ---------- */
async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers }, credentials: 'same-origin', cache: 'no-store', signal: options.signal || timeoutSignal(18000) });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('Could not reach the service. Check your connection and try again.');
  }
  let data;
  try { data = await response.json(); } catch { throw new Error('The service is unavailable. Please try again.'); }
  if (!response.ok) {
    const error = new Error(data.error || 'Request failed. Please try again.'); error.status = response.status; throw error;
  }
  return data;
}
let pendingSubmission = null;
async function submitReport() {
  const button = $('#submitReport'), out = $('#submitStatus');
  if (!navigator.onLine) { out.textContent = 'You appear to be offline, so this report was not sent. Keep the guide open, call for help using phone service, and try again when internet is available.'; return; }
  const details = Object.fromEntries(['area', 'surr', 'meet', 'landmark', 'time', 'cond', 'done', 'snake'].map(key => [key, key === 'time' ? biteTime() : val(key)]));
  const pin = getPin();
  if (!pin && ['Unknown', 'Not answered'].includes(details.area) && ['Unknown', 'Not answered'].includes(details.landmark)) {
    out.textContent = 'Choose an area, enter a landmark, or attach a location using the map or GPS.'; return;
  }
  const signature = JSON.stringify({ details, pin });
  if (!pendingSubmission || pendingSubmission.signature !== signature) pendingSubmission = { signature, id: uuid() };
  button.disabled = true; out.textContent = 'Sending your report…';
  try {
    const result = await api(apiUrl('reports'), { method: 'POST', body: JSON.stringify({ id: pendingSubmission.id, details, pin }) });
    out.textContent = `Report received by the staff report system. Reference: ${result.id.slice(0, 8)}. This does not confirm that staff have read it or that help is on the way. Call for urgent help.`;
    button.textContent = 'Report sent';
    const reset = () => { button.disabled = false; button.textContent = 'Submit report to staff'; };
    $('#app').addEventListener('input', reset, { once: true });
    $('#app').addEventListener('click', e => { if (e.target.closest('.chip, #gps, #clrPin, #map')) reset(); });
  } catch (error) {
    out.textContent = `${error.message} This report was not confirmed as received. Retry when connected, or use the summary actions above. Your answers remain on this screen.`;
    button.disabled = false;
  }
}
let staffMap = null, reportMarkers = null, reportTimer = null, reportController = null;
let reportRows = [], reportNext = null, reportFilter = 'active';
screensStaff['staff-reports'] = () => staffNav() + `<h1>Submitted reports</h1>
  <p class="lead">Reports from users, with their submitted locations.</p>
  <button class="btn small" id="refreshReports" type="button">Refresh reports</button>
  <div class="chips" id="reportFilter" role="group" aria-label="Show reports">${[['active', 'Active'], ['handled', 'Handled'], ['all', 'All']].map(([k, t]) => `<button type="button" class="chip" data-filter="${k}" aria-pressed="${k === reportFilter}">${t}</button>`).join('')}</div>
  <p id="reportsStatus" role="status" aria-live="polite">Loading submitted reports…</p>
  <section class="card"><h2>Report locations</h2><div id="staffMap" aria-label="Map of submitted report locations"></div>
  <p id="staffMapNote" class="review" hidden>Map tiles could not load. Coordinates and map links are available in each report below.</p>
  <p id="locationCount"></p></section>
  <section aria-label="Submitted report details" id="reportsList" aria-busy="true"></section>
  <button class="btn" id="olderReports" type="button" hidden>Load older reports</button>`;
function stopReportView() {
  clearInterval(reportTimer); reportTimer = null;
  reportController?.abort(); reportController = null;
  if (staffMap) { staffMap.remove(); staffMap = null; reportMarkers = null; }
  reportRows = []; reportNext = null;
}
function startReportView() {
  if (window.L) {
    staffMap = L.map('staffMap').setView([D.mapCenter.lat, D.mapCenter.lng], D.mapCenter.zoom || 16);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(staffMap)
      .on('tileerror', () => { const note = $('#staffMapNote'); if (note) note.hidden = false; });
    reportMarkers = L.featureGroup().addTo(staffMap);
  } else $('#staffMapNote').hidden = false;
  document.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => {
    reportFilter = b.dataset.filter; reportRows = []; reportNext = null;
    document.querySelectorAll('[data-filter]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    if (reportController) { reportController.abort(); reportController = null; }
    loadReports(false, false);
  });
  $('#refreshReports').onclick = () => loadReports(false, false);
  $('#olderReports').onclick = () => loadReports(true, false);
  loadReports(false, false);
  reportTimer = setInterval(() => { if (!document.hidden && navigator.onLine) loadReports(false, true); }, 15000);
}
async function loadReports(older, automatic) {
  if (reportController) return;
  const controller = new AbortController(); reportController = controller;
  const timeout = setTimeout(() => controller.abort(), 18000);
  const list = $('#reportsList'), status = $('#reportsStatus');
  list.setAttribute('aria-busy', 'true');
  $('#refreshReports').disabled = true; $('#olderReports').disabled = true;
  if (!automatic) status.textContent = 'Loading submitted reports…';
  try {
    const result = await api(apiUrl('reports') + '?' + new URLSearchParams(Object.assign({ status: reportFilter }, older && reportNext ? { before: reportNext } : {})), { signal: controller.signal });
    if (controller.signal.aborted) return;
    const previousIds = new Set(reportRows.map(r => r.id));
    const newReports = result.reports.filter(r => !previousIds.has(r.id));
    if (automatic) {
      // Keep older pages while polling the latest submissions.
      reportRows = [...newReports, ...reportRows];
      if (!reportNext && result.next) reportNext = result.next;
    } else if (older) { reportRows.push(...newReports); reportNext = result.next; }
    else { reportRows = result.reports; reportNext = result.next; }
    if (!automatic || newReports.length) renderReports(!automatic && !older);
    status.textContent = `${reportRows.length} report${reportRows.length === 1 ? '' : 's'} loaded. Updated ${new Date().toLocaleTimeString()}. Checks for new reports every 15 seconds.`;
  } catch (error) {
    if (!$('#reportsStatus')) return;
    if (error.status === 401) { sessionStorage.removeItem('ss_staff'); location.hash = '#/staff'; return; }
    status.textContent = (error.name === 'AbortError' ? 'Loading timed out. Please refresh to try again.' : error.message) + (reportRows.length ? ' Showing previously loaded reports.' : ' Use Refresh reports to retry.');
  } finally {
    clearTimeout(timeout);
    if (reportController === controller) reportController = null;
    if (list.isConnected) {
      list.setAttribute('aria-busy', 'false');
      $('#refreshReports').disabled = false; $('#olderReports').disabled = false;
    }
  }
}
async function reportAction(id, request, apply) {
  try { await api(apiUrl('report') + request.query, request.options); apply(); renderReports(false);
    const st = $('#reportsStatus'); if (st) st.textContent = `${reportRows.length} report${reportRows.length === 1 ? '' : 's'} shown.`; toast('✔ Done');
  } catch (error) {
    if (error.status === 401) { sessionStorage.removeItem('ss_staff'); location.hash = '#/staff'; return; }
    if (error.status === 404) { reportRows = reportRows.filter(r => r.id !== id); renderReports(false); }
    toast(error.message);
  }
}
function renderReports(fit) {
  reportMarkers?.clearLayers();
  let mapped = 0;
  $('#reportsList').innerHTML = reportRows.map(report => {
    const d = report.details, hasPin = Number.isFinite(report.lat) && Number.isFinite(report.lng);
    const title = `${d.area} · ${report.id.slice(0, 8)}`;
    if (hasPin) {
      mapped++;
      if (staffMap) L.marker([report.lat, report.lng]).addTo(reportMarkers).bindPopup(`<b>${esc(title)}</b><br>${esc(new Date(report.submittedAt).toLocaleString())}<br>${esc(d.cond)}`);
    }
    return `<article class="card report-card" id="report-${report.id}"><h2>${esc(title)}</h2>
      <p class="report-time">Submitted ${esc(new Date(report.submittedAt).toLocaleString())} ${report.handled ? '<span class="tag t-Confirmed">Handled</span>' : ''}</p>
      <dl class="report-details">${[['Area', d.area], ['Surroundings', d.surr], ['Landmark', d.landmark], ['Can meet responders', d.meet], ['Time of bite', d.time], ['Condition', d.cond], ['Actions taken', d.done], ['Snake', d.snake]].map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>
      ${hasPin ? `<p>Location: ${report.lat.toFixed(5)}, ${report.lng.toFixed(5)}</p><p class="report-time">${report.locationSource === 'GPS' ? `GPS estimate, accuracy about ${Number.isFinite(report.locationAccuracy) ? Math.round(report.locationAccuracy) + ' m' : 'not recorded'}` : report.locationSource === 'Map' ? 'Selected on map; accuracy not measured' : 'Location source or accuracy not recorded'}</p><button class="btn small primary" data-report-map="${report.id}" type="button">Show on map</button><a class="btn small" href="${pinLink(report)}" target="_blank" rel="noopener">Open in maps</a>` : '<p class="review">No map pin attached. Use the area and landmark provided.</p>'}<div class="report-actions"><button class="btn small" data-handle="${report.id}" data-to="${report.handled ? 0 : 1}" type="button">${report.handled ? 'Reopen' : '✔ Mark as handled'}</button><button class="btn small danger" data-del="${report.id}" type="button">Delete…</button></div></article>`;
  }).join('') || '<div class="card"><h2>No reports yet</h2><p>Reports appear here after a user submits them from “Tell the responder”.</p></div>';
  $('#locationCount').textContent = `${mapped} of ${reportRows.length} loaded reports have map locations.`;
  $('#olderReports').hidden = !reportNext;
  if (fit && mapped && staffMap) staffMap.fitBounds(reportMarkers.getBounds(), { padding: [30, 30], maxZoom: 17 });
  document.querySelectorAll('[data-handle]').forEach(b => b.onclick = () => {
    const id = b.dataset.handle, to = b.dataset.to === '1';
    reportAction(id, { query: '', options: { method: 'POST', body: JSON.stringify({ id, handled: to }) } }, () => {
      if (reportFilter === 'all') { const row = reportRows.find(r => r.id === id); if (row) row.handled = to; } else reportRows = reportRows.filter(r => r.id !== id);
    });
  });
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    const id = b.dataset.del;
    if (!confirm('Delete this report permanently? This cannot be undone.')) return;
    reportAction(id, { query: '?id=' + encodeURIComponent(id), options: { method: 'DELETE' } }, () => { reportRows = reportRows.filter(r => r.id !== id); });
  });
  document.querySelectorAll('[data-report-map]').forEach(button => button.onclick = () => {
    const report = reportRows.find(row => row.id === button.dataset.reportMap);
    if (!staffMap) { toast('Map unavailable. Use Open in maps.'); return; }
    staffMap.setView([report.lat, report.lng], 17);
    reportMarkers.getLayers().find(marker => marker.getLatLng().lat === report.lat && marker.getLatLng().lng === report.lng)?.openPopup();
    $('#staffMap').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

/* ---------- Router ---------- */
function route() {
  if (!D) return;
  stopReportView();
  if (map) { map.remove(); map = null; pinMarker = null; }
  let r = location.hash.replace('#/', '') || (guideOnly ? 'tell' : 'home');
  if (guideOnly && !guideRoutes.has(r)) {
    r = 'tell';
    history.replaceState(null, '', '#/tell');
  }
  if (r === 'staff-out') {
    api(apiUrl('session'), { method: 'DELETE' }).then(() => { sessionStorage.removeItem('ss_staff'); location.hash = '#/home'; }).catch(() => { $('#app').innerHTML = '<p class="msg">Could not log out. Check your connection and <a href="#/staff-reports">try again</a>.</p>'; }); return;
  }
  const isStaff = r.startsWith('staff-');
  if (isStaff && !sessionStorage.getItem('ss_staff')) { location.hash = '#/staff'; return; }
  if ((r === 'staff-dir' || r === 'staff-log') && SYNC() && !pulled[r]) { pulled[r] = true; $('#app').innerHTML = '<p class="msg">Loading shared data…</p>'; (r === 'staff-dir' ? pullStatus() : pullLog()).finally(route); return; }
  const view = screens[r] || screensStaff[r] || screens.home;
  const html = view(); if (html === '' ) return;
  const page = html + (guideOnly || r === 'about' || r === 'home' ? '' : '<p class="aboutlink"><a href="#/about">About this guide</a></p>');
  $('#app').innerHTML = guideOnly || r === 'tell' || r === 'do'
    ? `<section class="status-page availability-dashboard app-page-shell"><div class="dashboard-brand"><strong>CMUBioTriage</strong></div>${dashboardNav(r)}${guideOnly ? '<p class="offline-hint" id="guideOffline" role="status"></p>' : ''}<div class="app-page-content">${page}</div></section>`
    : page;
  showGuideOfflineStatus();
  $('#app').focus({ preventScroll: true }); window.scrollTo(0, 0);
  bindUnknown(); wire(r);
}
function wire(r) {
  const on = (id, fn) => { const e = document.getElementById(id); if (e) e.addEventListener('click', fn); };
  on('shareBtn', () => share('Snakebite first-response guide for CMU.', guideOnly ? appUrl('guide/') : location.href));
  if (r === 'home') {
    document.querySelectorAll('[data-scroll]').forEach(a => a.addEventListener('click', ev => {
      ev.preventDefault();
      const t = document.getElementById(a.dataset.scroll); if (!t) return;
      const calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
      t.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
      const h = t.querySelector('h2'); if (h) h.focus({ preventScroll: true });
    }));
  }
  if (r === 'tell' || r === 'home') {
    if (!guideOnly) {
      const updateConnection = () => document.querySelectorAll('[data-connection-state]').forEach(el => { el.textContent = navigator.onLine ? 'Internet appears available. Submission still needs confirmation.' : 'Offline: staff reports cannot be sent. Use the call option if you need urgent help.'; el.classList.toggle('is-offline', !navigator.onLine); });
      updateConnection();
      window.ononline = updateConnection;
      window.onoffline = updateConnection;
      pendingSubmission = null;
      on('submitReport', submitReport);
    }
    on('copySummary', () => copy(buildHandoffSummary()));
    on('sumShare', () => share(buildHandoffSummary(), ''));
    $('#app').querySelectorAll('input,select').forEach(field => {
      field.addEventListener('input', updateHandoffSummary);
      field.addEventListener('change', updateHandoffSummary);
    });
    document.querySelectorAll('[data-chips]').forEach(group => group.addEventListener('click', updateHandoffSummary));
    updateHandoffSummary();
    on('mapBtn', openMap); renderPin();
    on('gps', () => {
      const o = $('#gpsOut'); o.innerHTML = '<p>Finding location…</p>';
      if (!navigator.geolocation) { o.innerHTML = '<p class="msg">GPS is not available. Tap the map or choose an area instead.</p>'; return; }
      navigator.geolocation.getCurrentPosition(p => { o.innerHTML = `<p>GPS estimate; reported accuracy about ${Math.round(p.coords.accuracy)} m.</p>`; setPin(p.coords.latitude, p.coords.longitude, true, 'GPS', p.coords.accuracy); },
        error => { const reason = error.code === error.PERMISSION_DENIED ? 'Location permission was denied.' : error.code === error.TIMEOUT ? 'GPS timed out.' : 'GPS could not find your location.'; o.innerHTML = `<p class="msg">${reason} You can still choose an area and landmark, or select a point on the map.</p>`; }, { enableHighAccuracy: true, timeout: 15000 });
    });
  }
  if (r === 'before') {
    on('save', async () => {
      const o = $('#saveOut');
      if (!('serviceWorker' in navigator)) { o.innerHTML = '<p class="msg">This browser cannot save offline. Add it to your home screen instead.</p>'; return; }
      try {
        const registration = await navigator.serviceWorker.ready;
        const worker = registration.active;
        if (!worker) throw new Error('No active offline worker');
        const saved = await checkOfflineCache(worker, 'CHECK_OFFLINE_CACHE');
        o.innerHTML = saved ? `<p class="msg">✔ Guide files are saved offline. ${esc(D.reviewStatus || D.reviewed || 'Clinical review pending')}</p>` : '<p class="msg">Not saved yet. Stay online, reload the guide, then check again.</p>';
      } catch { o.innerHTML = '<p class="msg">Could not check. Reload the page while online and try again.</p>'; }
      netStatus();
    });
    if (deferredInstall) { const b = $('#install'); b.hidden = false; b.onclick = async () => { deferredInstall.prompt(); deferredInstall = null; b.hidden = true; }; }
  }
  if (r === 'staff') {
    on('pinGo', async () => {
      const button = $('#pinGo'); button.disabled = true;
      $('#pinOut').textContent = 'Checking PIN…';
      try {
        await api(apiUrl('session'), { method: 'POST', body: JSON.stringify({ pin: $('#pin').value }) });
        const session = await api(apiUrl('session'));
        if (!session.authenticated) {
          sessionStorage.removeItem('ss_staff');
          $('#pinOut').textContent = 'Your PIN was accepted, but this browser could not keep the staff session. Open this site in its own tab and allow cookies, then sign in again. ';
          const link = document.createElement('a');
          link.href = location.pathname + '#/staff';
          link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'Open staff login in a new tab';
          $('#pinOut').append(link);
          return;
        }
        sessionStorage.setItem('ss_staff', '1'); location.hash = '#/staff-reports';
      } catch (error) { $('#pinOut').textContent = error.message; }
      finally { button.disabled = false; }
    });
    $('#pin').addEventListener('keydown', e => { if (e.key === 'Enter') $('#pinGo').click(); });
  }
  if (r === 'staff-reports') startReportView();
  if (r === 'staff-dir') on('refresh', () => { pulled[r] = false; route(); });
  if (r === 'staff-dir') document.querySelectorAll('[data-conf],[data-restock],[data-unconf],[data-unavailable]').forEach(b => b.addEventListener('click', () => {
    const conf = b.dataset.conf !== undefined, restock = b.dataset.restock !== undefined, unavailable = b.dataset.unavailable !== undefined, key = b.dataset.conf ?? b.dataset.restock ?? b.dataset.unavailable ?? b.dataset.unconf, i = +key, h = D.hospitals[i];
    const by = $('#staffName').value.trim(); if ((conf || restock || unavailable) && !by) { toast('Enter your name at the top first.'); $('#staffName').focus(); return; }
    const detailInput = document.querySelector(`[data-verification-details="${i}"]`);
    const details = detailInput?.value.trim() || '';
    const stockInput = document.querySelector(`[data-stock="${i}"]`);
    let stock = null;
    if (!b.dataset.unconf && !unavailable && stockInput && stockInput.value.trim() !== '') {
      const n = Number(stockInput.value);
      if (!Number.isInteger(n) || n < 0 || n > 9999) { toast('Enter vials as a whole number from 0 to 9999.'); stockInput.focus(); return; }
      stock = n;
    }
    if (conf && (stock === null || stock < 1)) { toast(stock === 0 ? 'Confirmed needs at least 1 vial. If none are in stock, use Mark unverified.' : 'Enter how many vials are in stock first.'); stockInput && stockInput.focus(); return; }
    if (unavailable) stock = 0;
    if ((conf || restock || unavailable) && !details) { toast('Add who you contacted, when, and what they reported before saving this update.'); detailInput?.focus(); return; }
    const all = hStatus(); all[h.name] = { status: conf ? 'Confirmed' : restock ? 'Restock announced' : unavailable ? 'Unavailable' : 'Unverified', by: by || 'staff', at: Date.now(), details, stock };
    store.set('ss_status', all); pushStatus(i, all[h.name]); const keep = by; route(); const n = $('#staffName'); if (n) n.value = keep;
  }));
  if (r === 'staff-alert') on('gen', () => {
    const h = $('#p_h').value;
    const msg = `PRE-ALERT: Snakebite patient arriving at ${h}.\nCondition: ${val('pc')}\nTime of bite: ${val('pt')}\nLocation: ${val('pl')}\nETA: ${val('pe')}\nSnake: ${val('ps')}\nMap pin: ${pinText()}\nPlease confirm antivenom availability.`;
    const script = `Call script: "This is [name] from CMU University Hospital. We are bringing a snakebite patient. Bitten at ${val('pt')}. Condition: ${val('pc')}. ETA ${val('pe')}. Can you confirm antivenom and bed availability?"`;
    $('#genOut').innerHTML = `<pre>${esc(msg)}</pre><pre>${esc(script)}</pre>
      <a class="btn small primary" href="sms:?&body=${encodeURIComponent(msg)}">Open in SMS</a><button class="btn small" id="cp">Copy</button><button class="btn small" id="sh">Share</button>`;
    on('cp', () => copy(msg)); on('sh', () => share(msg, ''));
  });
  if (r === 'staff-log') {
    on('addLog', () => { const l = store.get('ss_log', []); const e = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 6), d: val('ld'), l: val('ll'), n: val('ln') }; l.push(e); store.set('ss_log', l); pushLog(e); route(); });
    on('csv', () => { const rows = [['date', 'location', 'notes'], ...store.get('ss_log', []).map(x => [x.d, x.l, x.n])];
      const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'cmubiotrage-log.csv'; a.click(); });
  }
}

/* ---------- Status banner + boot ---------- */
function checkOfflineCache(worker, type) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); reject(new Error('Offline check timed out')); }, 5000);
    channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(!!event.data?.saved); };
    worker.postMessage({ type }, [channel.port2]);
  });
}
function showGuideOfflineStatus() {
  const status = $('#guideOffline');
  if (!status) return;
  status.textContent = guideOfflineReady
    ? 'Saved offline in this browser. Bookmark this page to reopen it without internet. Calls and SMS still need phone service.'
    : 'Open this guide while connected and wait for “Saved offline” before relying on it without internet.';
}
async function updateGuideOfflineStatus() {
  const worker = navigator.serviceWorker.controller;
  const saved = worker ? await checkOfflineCache(worker, 'CHECK_GUIDE_OFFLINE_CACHE').catch(() => false) : false;
  if (navigator.serviceWorker.controller !== worker) return;
  guideOfflineReady = saved;
  showGuideOfflineStatus();
}
function netStatus() {
  const ok = 'serviceWorker' in navigator && navigator.serviceWorker.controller;
  const n = $('#net'); if (!n) return; n.textContent = ok ? `Saved offline · ${D.reviewStatus || D.reviewed || 'Clinical review pending'}` : 'Not saved for offline use yet';
  n.className = 'pill' + (ok ? '' : ' off');
}
const MOON = '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>';
const SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
function applyPrefs() {
  const p = store.get('ss_pref', { ts: 1 });
  const root = document.documentElement;
  root.style.setProperty('--ts', p.ts || 1);
  root.classList.remove('sun');
  root.classList.toggle('light', !!p.light);
  const tb = $('#themeBtn');
  if (tb) {
    tb.querySelector('span').textContent = p.light ? 'Theme: Light' : 'Theme: Dark';
    tb.setAttribute('aria-label', p.light ? 'Theme: Light. Switch to dark theme' : 'Theme: Dark. Switch to light theme');
    $('#themeIcon').innerHTML = p.light ? SUN : MOON;
  }
}
function bindPrefs() {
  $('#tsBtn').onclick = () => { const p = store.get('ss_pref', { ts: 1 }); const o = [1, 1.25, 1.5]; p.ts = o[(o.indexOf(p.ts) + 1) % 3]; store.set('ss_pref', p); applyPrefs(); toast(p.ts === 1 ? 'Normal text' : p.ts === 1.25 ? 'Large text' : 'Extra large text'); };
  $('#themeBtn').onclick = () => { const p = store.get('ss_pref', { ts: 1 }); p.light = !p.light; p.sun = false; store.set('ss_pref', p); applyPrefs(); };
  applyPrefs();
}
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });
window.addEventListener('hashchange', route);
(async function boot() {
  try { D = await (await fetch(appUrl('assets/data/data.json'))).json(); }
  catch { $('#app').innerHTML = location.protocol === 'file:'
    ? '<div class="card"><h1>Open this through Apache</h1><p>You opened the file directly from the folder, which browsers block. Start Apache in XAMPP, then open:</p><p class="big">http://localhost/CMUBioTriage/</p></div>'
    : '<p class="msg">Could not load guide data. Reload while online once, then it will work offline.</p>'; return; }
  if (window.L) L.Icon.Default.imagePath = appUrl('assets/vendor/leaflet/images/');
  bindPrefs();
  if ($('#ver')) $('#ver').textContent = `Version ${D.version} · ${D.reviewStatus || D.reviewed || 'Clinical review pending'}`;
  if ('serviceWorker' in navigator) {
    const onController = guideOnly ? updateGuideOfflineStatus : netStatus;
    navigator.serviceWorker.addEventListener('controllerchange', onController);
    navigator.serviceWorker.register(appUrl('sw.js')).then(onController).catch(() => {});
  }
  if (guideOnly) { route(); return; }
  try { const session = await api(apiUrl('session')); if (session.authenticated) sessionStorage.setItem('ss_staff', '1'); else sessionStorage.removeItem('ss_staff'); } catch { sessionStorage.removeItem('ss_staff'); }
  netStatus(); route();
})();
