/**
 * server.js — jembatan antara SMS dari gunung dan dashboard di laptop.
 *
 * Alur nyata:
 *   iPhone --SMS--> jaringan seluler --> nomor Twilio --> POST /webhook/sms --> SSE --> browser
 *
 * Alur saat testing di VS Code:
 *   tombol "Simulasi" di dashboard --> POST /api/simulate --> SSE --> browser
 *
 * Jalankan:  npm install && npm start   lalu buka http://localhost:3000
 */

const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'positions.json');

app.use(express.json());
app.use(express.urlencoded({ extended: false })); // Twilio mengirim form-urlencoded
app.use(express.static(path.join(__dirname, 'public')));

/* ============================================================
   Penyimpanan sederhana (file JSON, cukup untuk satu keluarga)
   ============================================================ */
let positions = [];
try {
  if (fs.existsSync(DB_FILE)) positions = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
} catch (e) {
  console.warn('positions.json rusak, mulai dari kosong.');
}

function persist() {
  fs.writeFile(DB_FILE, JSON.stringify(positions, null, 2), () => {});
}

/* ============================================================
   SSE — dorong data ke browser tanpa perlu socket.io
   ============================================================ */
const clients = new Set();

app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`retry: 3000\n\n`);
  res.write(`event: init\ndata: ${JSON.stringify(positions)}\n\n`);

  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);

  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
});

function broadcast(event, payload) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const c of clients) {
    try { c.write(frame); } catch (_) { clients.delete(c); }
  }
}

/* ============================================================
   Parser isi SMS
   Format yang dikirim app iOS:
       DARURAT Arif
       LOC -7.471200,110.449800
       Elevasi 1720 mdpl · akurasi ±12 m
       Waktu 19/09 08:14
       Baterai 63%
       https://maps.google.com/?q=-7.471200,110.449800
   Parser dibuat longgar: cukup ada sepasang angka koordinat di mana pun.
   ============================================================ */
function parseSms(body = '') {
  const text = String(body);

  // 1) baris LOC, 2) parameter q= di link maps, 3) sepasang angka mana pun
  const patterns = [
    /LOC\s*(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/i,
    /[?&]q=(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/i,
    /(-?\d{1,2}\.\d{4,})\s*,\s*(-?\d{1,3}\.\d{4,})/,
  ];

  let lat = null, lon = null;
  for (const re of patterns) {
    const m = text.match(re);
    if (m) { lat = parseFloat(m[1]); lon = parseFloat(m[2]); break; }
  }
  if (lat === null || Number.isNaN(lat) || Number.isNaN(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

  const name    = (text.match(/DARURAT\s+([^\n\r]+)/i) || [])[1]?.trim() || 'Pendaki';
  const alt     = parseFloat((text.match(/Elevasi\s+(-?\d+(?:\.\d+)?)/i) || [])[1]);
  const acc     = parseFloat((text.match(/akurasi\s*±?\s*(\d+(?:\.\d+)?)/i) || [])[1]);
  const battery = parseFloat((text.match(/Baterai\s+(\d+)\s*%/i) || [])[1]);
  const sos     = /DARURAT|SOS|TOLONG/i.test(text);

  return {
    name,
    lat,
    lon,
    alt: Number.isNaN(alt) ? null : alt,
    accuracy: Number.isNaN(acc) ? null : acc,
    battery: Number.isNaN(battery) ? null : battery,
    sos,
    raw: text,
  };
}

function record(parsed, source) {
  const entry = {
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    receivedAt: new Date().toISOString(),
    source,
    ...parsed,
  };
  positions.push(entry);
  if (positions.length > 500) positions.splice(0, positions.length - 500);
  persist();
  broadcast('position', entry);
  return entry;
}

/* ============================================================
   Endpoint
   ============================================================ */

// --- Webhook Twilio. Di Twilio Console, set Messaging webhook ke:
//     https://<ngrok-anda>.ngrok.io/webhook/sms  (HTTP POST)
app.post('/webhook/sms', (req, res) => {
  const body = req.body.Body || req.body.body || '';
  const from = req.body.From || 'tidak diketahui';

  const parsed = parseSms(body);

  if (!parsed) {
    console.log(`[SMS ${from}] tidak mengandung koordinat, diabaikan.`);
    // Tetap balas TwiML kosong supaya Twilio tidak menganggap error
    res.type('text/xml').send('<Response></Response>');
    return;
  }

  const entry = record({ ...parsed, from }, 'sms');
  console.log(`[SMS ${from}] ${entry.lat}, ${entry.lon}${entry.sos ? '  ** SOS **' : ''}`);

  res.type('text/xml').send(
    '<Response><Message>Posisi diterima. Tetap di tempat bila memungkinkan.</Message></Response>'
  );
});

// --- Endpoint JSON biasa, kalau Anda pakai gateway SMS lain (Vonage, gammu, Android forwarder)
app.post('/api/position', (req, res) => {
  const parsed = req.body.body ? parseSms(req.body.body) : null;
  const data = parsed || {
    name: req.body.name || 'Pendaki',
    lat: parseFloat(req.body.lat),
    lon: parseFloat(req.body.lon),
    alt: req.body.alt ?? null,
    accuracy: req.body.accuracy ?? null,
    battery: req.body.battery ?? null,
    sos: !!req.body.sos,
    raw: JSON.stringify(req.body),
  };
  if (Number.isNaN(data.lat) || Number.isNaN(data.lon)) {
    return res.status(400).json({ error: 'lat dan lon wajib diisi' });
  }
  res.json(record(data, 'api'));
});

// --- Riwayat
app.get('/api/positions', (_req, res) => res.json(positions));

app.delete('/api/positions', (_req, res) => {
  positions = [];
  persist();
  broadcast('clear', {});
  res.json({ ok: true });
});

/* ============================================================
   Simulator — supaya dashboard bisa dites tanpa Twilio
   Membangkitkan SMS palsu yang bentuknya persis seperti kiriman iPhone.
   ============================================================ */
let simTimer = null;
let sim = { lat: -7.47120, lon: 110.44980, alt: 1720, battery: 92, step: 0 };

function fakeSms(sos = false) {
  sim.lat += 0.00045 * (0.6 + Math.random() * 0.8);
  sim.lon += 0.00032 * (0.6 + Math.random() * 0.8);
  sim.alt += 22 * (0.5 + Math.random());
  sim.battery = Math.max(5, sim.battery - 0.9);
  sim.step++;

  const lat = sim.lat.toFixed(6), lon = sim.lon.toFixed(6);
  return [
    `${sos ? 'DARURAT' : 'POSISI'} Arif`,
    `LOC ${lat},${lon}`,
    `Elevasi ${Math.round(sim.alt)} mdpl · akurasi ±${Math.round(8 + Math.random() * 20)} m`,
    `Waktu ${new Date().toLocaleString('id-ID')}`,
    `Baterai ${Math.round(sim.battery)}%`,
    `https://maps.google.com/?q=${lat},${lon}`,
  ].join('\n');
}

app.post('/api/simulate', (req, res) => {
  const parsed = parseSms(fakeSms(!!req.body.sos));
  res.json(record({ ...parsed, from: '+628••••••simulasi' }, 'simulasi'));
});

app.post('/api/simulate/auto', (req, res) => {
  const on = !!req.body.on;
  clearInterval(simTimer);
  simTimer = null;
  if (on) {
    simTimer = setInterval(() => {
      record({ ...parseSms(fakeSms()), from: '+628••••••simulasi' }, 'simulasi');
    }, Number(req.body.everyMs) || 4000);
  }
  res.json({ running: on });
});

app.listen(PORT, () => {
  console.log(`\n  Dashboard  : http://localhost:${PORT}`);
  console.log(`  Webhook SMS: POST http://localhost:${PORT}/webhook/sms`);
  console.log(`  Tip        : jalankan  ngrok http ${PORT}  lalu pasang URL-nya di Twilio.\n`);
});
