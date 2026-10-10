/* ============================================================
   Pos Pantau — frontend
   Menerima aliran posisi lewat Server-Sent Events, lalu
   menggambar marker + jalur di Leaflet dan mengisi sidebar.
   ============================================================ */

const $ = (id) => document.getElementById(id);

let positions = [];
let liveMarker = null;
let startMarker = null;
let trail = null;
let followMap = true;      // ikut bergerak ke titik terbaru, mati kalau user menggeser peta
let autoRunning = false;
let activeId = null;

/* ---------------- Peta ---------------- */
const map = L.map('map', { zoomControl: true, attributionControl: true })
  .setView([-7.4712, 110.4498], 14);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap',
}).addTo(map);

map.on('dragstart', () => { followMap = false; });

const livePin = L.divIcon({ className: '', html: '<div class="pin"><i></i></div>', iconSize: [14, 14], iconAnchor: [7, 7] });
const startPin = L.divIcon({ className: '', html: '<div class="pin start"><i></i></div>', iconSize: [10, 10], iconAnchor: [5, 5] });

/* ---------------- Util ---------------- */
const pad = (n) => String(n).padStart(2, '0');

function fmtTime(iso) {
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtAgo(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return `${Math.round(s)} dtk lalu`;
  if (s < 5400) return `${Math.round(s / 60)} menit lalu`;
  if (s < 172800) return `${Math.round(s / 3600)} jam lalu`;
  return `${Math.round(s / 86400)} hari lalu`;
}

function haversine(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const fmtM = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`);

/* ---------------- Render ---------------- */
function render() {
  renderLog();
  renderMap();
  renderVitals();
}

function renderVitals() {
  const last = positions[positions.length - 1];
  if (!last) {
    ['vPos', 'vAlt', 'vBat', 'vAge'].forEach((id) => ($(id).textContent = '—'));
    $('subject').textContent = 'menunggu kabar';
    $('banner').hidden = true;
    return;
  }

  $('subject').textContent = `memantau ${last.name}`;
  $('vPos').textContent = `${last.lat.toFixed(5)}, ${last.lon.toFixed(5)}`;
  $('vAlt').textContent = last.alt != null ? `${Math.round(last.alt)} mdpl` : '—';
  $('vBat').textContent = last.battery != null ? `${Math.round(last.battery)}%` : '—';

  const age = $('vAge');
  age.textContent = fmtAgo(last.receivedAt);
  const stale = Date.now() - new Date(last.receivedAt).getTime() > 12 * 3600e3;
  age.classList.toggle('hot', stale);
  $('vBat').classList.toggle('hot', last.battery != null && last.battery < 20);

  const sos = positions.some((p) => p.sos);
  $('banner').hidden = !sos;
  if (sos) {
    const s = positions.filter((p) => p.sos).pop();
    $('bannerText').textContent = `${s.lat.toFixed(5)}, ${s.lon.toFixed(5)} · ${fmtTime(s.receivedAt)}`;
  }
}

function renderLog() {
  const ul = $('log');
  $('logCount').textContent = positions.length;

  if (!positions.length) {
    ul.innerHTML = '<li class="empty">Belum ada SMS yang masuk.</li>';
    return;
  }

  ul.innerHTML = positions
    .slice()
    .reverse()
    .map((p, i) => {
      const prev = positions[positions.length - 2 - i];
      const delta = prev ? ` · ${fmtM(haversine(prev, p))} dari titik sebelumnya` : ' · titik awal';
      return `
        <li data-id="${p.id}" class="${p.sos ? 'sos' : ''} ${p.id === activeId ? 'active' : ''}">
          <div class="t">
            <span class="time">${fmtTime(p.receivedAt)}</span>
            <span class="tag ${p.sos ? 'sos' : ''}">${p.sos ? 'SOS' : p.source}</span>
          </div>
          <div class="coord">${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}</div>
          <div class="meta">${p.alt != null ? Math.round(p.alt) + ' mdpl' : ''}${delta}</div>
        </li>`;
    })
    .join('');

  ul.querySelectorAll('li[data-id]').forEach((li) => {
    li.onclick = () => {
      const p = positions.find((x) => x.id === li.dataset.id);
      if (!p) return;
      activeId = p.id;
      followMap = false;
      map.flyTo([p.lat, p.lon], Math.max(map.getZoom(), 15), { duration: 0.6 });
      renderLog();
    };
  });
}

function renderMap() {
  if (!positions.length) return;

  const latlngs = positions.map((p) => [p.lat, p.lon]);
  const last = positions[positions.length - 1];

  if (trail) trail.setLatLngs(latlngs);
  else trail = L.polyline(latlngs, { color: '#5BC8AC', weight: 3, opacity: 0.85 }).addTo(map);

  const first = positions[0];
  if (startMarker) startMarker.setLatLng([first.lat, first.lon]);
  else startMarker = L.marker([first.lat, first.lon], { icon: startPin })
    .addTo(map)
    .bindPopup(`<b>Titik awal</b><br>${fmtTime(first.receivedAt)}`);

  const popup = `
    <b>${last.name}</b><br>
    ${last.lat.toFixed(6)}, ${last.lon.toFixed(6)}<br>
    ${last.alt != null ? Math.round(last.alt) + ' mdpl · ' : ''}${fmtTime(last.receivedAt)}<br>
    <a href="https://maps.google.com/?q=${last.lat},${last.lon}" target="_blank"
       style="color:#5BC8AC">buka di Google Maps</a>`;

  if (liveMarker) {
    liveMarker.setLatLng([last.lat, last.lon]);
    liveMarker.setPopupContent(popup);
  } else {
    liveMarker = L.marker([last.lat, last.lon], { icon: livePin }).addTo(map).bindPopup(popup);
  }

  if (last.accuracy) {
    if (!renderMap.circle) {
      renderMap.circle = L.circle([last.lat, last.lon], {
        radius: last.accuracy, color: '#FF6B3D', weight: 1, fillOpacity: 0.07,
      }).addTo(map);
    } else {
      renderMap.circle.setLatLng([last.lat, last.lon]).setRadius(last.accuracy);
    }
  }

  if (followMap) {
    if (positions.length === 1) map.setView([last.lat, last.lon], 15);
    else map.panTo([last.lat, last.lon], { animate: true, duration: 0.5 });
  }
}

/* ---------------- Aliran data (SSE) ---------------- */
function connect() {
  const es = new EventSource('/api/stream');

  es.addEventListener('open', () => {
    $('conn').className = 'conn online';
    $('connText').textContent = 'tersambung ke pos penerima';
  });

  es.addEventListener('init', (e) => {
    positions = JSON.parse(e.data);
    followMap = true;
    render();
    if (positions.length) {
      map.fitBounds(L.latLngBounds(positions.map((p) => [p.lat, p.lon])).pad(0.25));
    }
  });

  es.addEventListener('position', (e) => {
    positions.push(JSON.parse(e.data));
    render();
  });

  es.addEventListener('clear', () => {
    positions = [];
    [liveMarker, startMarker, trail, renderMap.circle].forEach((l) => l && map.removeLayer(l));
    liveMarker = startMarker = trail = renderMap.circle = null;
    render();
  });

  es.onerror = () => {
    $('conn').className = 'conn offline';
    $('connText').textContent = 'terputus, mencoba menyambung lagi…';
  };
}
connect();

/* ---------------- Tombol ---------------- */
const post = (url, body) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });

$('btnSim').onclick = () => { followMap = true; post('/api/simulate'); };
$('btnSos').onclick = () => { followMap = true; post('/api/simulate', { sos: true }); };

$('btnAuto').onclick = async () => {
  autoRunning = !autoRunning;
  followMap = true;
  await post('/api/simulate/auto', { on: autoRunning, everyMs: 4000 });
  $('btnAuto').textContent = autoRunning ? 'Hentikan aliran otomatis' : 'Mulai aliran otomatis';
  $('btnAuto').classList.toggle('ghost', !autoRunning);
};

$('btnClear').onclick = () => fetch('/api/positions', { method: 'DELETE' });

setInterval(renderVitals, 30000);
