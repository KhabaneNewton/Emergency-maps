# Offline Emergency GPS Tracker

Sistem dua sisi: iPhone di gunung merekam posisi dari satelit dan menyiapkan SMS darurat,
laptop Windows di rumah menampilkannya di peta secara real-time.

```
offline-gps-tracker/
├─ ios/EmergencyGPS/
│  ├─ EmergencyGPSApp.swift     entry point, aktifkan battery monitoring
│  ├─ ContentView.swift         UI gelap minimalis + tombol darurat
│  ├─ LocationManager.swift     CoreLocation, hemat baterai, simpan jejak lokal
│  └─ Info.plist                izin lokasi + background mode
└─ dashboard/
   ├─ server.js                 Express: webhook Twilio, parser SMS, SSE, simulator
   ├─ package.json
   └─ public/
      ├─ index.html             sidebar log + area peta
      ├─ style.css              tema gelap
      └─ app.js                 Leaflet + SSE
```

---

## 1. Menjalankan dashboard (paling cepat dites dulu)

```bash
cd dashboard
npm install
npm start
```

Buka `http://localhost:3000`, lalu klik **Mulai aliran otomatis**. Marker akan berjalan
naik gunung setiap 4 detik, sidebar terisi, jarak antar titik dihitung sendiri.
Tombol **Simulasi SOS** memunculkan banner darurat.

Tidak perlu socket.io. Real-time-nya memakai Server-Sent Events, satu arah server ke
browser, yang memang persis kebutuhan kasus ini dan tahan reconnect otomatis.

---

## 2. Menjalankan app iPhone

1. Xcode → File → New → Project → iOS App → Interface **SwiftUI**, nama `EmergencyGPS`.
2. Ganti isi file dengan ketiga file `.swift` di folder `ios/EmergencyGPS/`.
3. Buka tab **Info** pada target, lalu tambahkan key dari `Info.plist`:
   - `NSLocationWhenInUseUsageDescription`
   - `NSLocationAlwaysAndWhenInUseUsageDescription`
4. Tab **Signing & Capabilities** → **+ Capability** → **Background Modes** → centang
   **Location updates**. Ini wajib; tanpa itu `allowsBackgroundLocationUpdates = true`
   akan langsung crash.
5. Jalankan di **perangkat fisik**. Simulator tidak punya chip GPS.

Untuk menguji tanpa naik gunung: aktifkan Airplane Mode lalu matikan Wi-Fi.
Koordinat tetap muncul, karena CoreLocation membaca satelit, bukan jaringan.

---

## 3. Menyambungkan SMS asli ke dashboard

```
iPhone --SMS--> nomor Twilio --webhook--> server.js --SSE--> browser
```

1. Beli nomor Twilio yang bisa menerima SMS (nomor Indonesia sulit; nomor US/UK
   tetap bisa menerima SMS internasional, biayanya di sisi pengirim).
2. Ekspos server lokal ke internet:
   ```bash
   ngrok http 3000
   ```
3. Twilio Console → Phone Numbers → nomor Anda → **A message comes in**:
   `POST  https://xxxx.ngrok.io/webhook/sms`
4. Isi nomor Twilio itu di kolom **Nomor tujuan** pada app iPhone.

Parser di `server.js` mencari baris `LOC lat,lon`, lalu `?q=lat,lon` dari link Google Maps,
lalu pola koordinat apa pun. Jadi pesan tetap terbaca walau formatnya berubah sedikit.

### Alternatif tanpa Twilio
Pakai HP Android bekas di rumah sebagai gateway (aplikasi SMS-forwarder yang bisa
POST ke URL). Arahkan ke:

```
POST http://<ip-laptop>:3000/api/position
Content-Type: application/json

{ "body": "DARURAT Arif\nLOC -7.471200,110.449800" }
```

---

## Batasan yang perlu diketahui sejak awal

- **iOS tidak mengizinkan kirim SMS otomatis.** Tombol darurat hanya bisa membuka
  composer dengan teks terisi; jari user yang menekan kirim. Ini batasan sandbox iOS,
  bukan hal yang bisa diakali. Sisi baiknya: SMS yang gagal terkirim akan dicoba ulang
  sendiri oleh iOS begitu sinyal muncul.
- **Peta Leaflet butuh internet**, tapi itu di sisi laptop orang tua, jadi aman.
  App iPhone sengaja tidak menampilkan peta — selain boros baterai, tile-nya tidak
  akan termuat di gunung.
- **Baterai.** Dengan `desiredAccuracy = HundredMeters`, `distanceFilter = 100 m`, dan
  `pausesLocationUpdatesAutomatically`, perekaman terus-menerus selama 3 hari realistis
  jika HP dibawa dalam mode pesawat dan layar jarang dinyalakan. Radio seluler yang
  terus mencari sinyal justru jauh lebih boros daripada GPS.
- **Kalau butuh benar-benar tanpa jaringan seluler sama sekali**, jalur kirimnya harus
  diganti: satelit (Garmin inReach, atau SOS satelit bawaan iPhone 14 ke atas) atau
  radio LoRa/Meshtastic dengan satu unit penerima di basecamp. Struktur `server.js`
  tidak berubah — hanya sumber yang masuk ke `/api/position`.
