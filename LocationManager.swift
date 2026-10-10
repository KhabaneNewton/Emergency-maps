//
//  LocationManager.swift
//  EmergencyGPS
//
//  CoreLocation membaca sinyal satelit GNSS langsung dari chip.
//  Tidak ada satu pun bagian di file ini yang butuh koneksi internet.
//

import Foundation
import CoreLocation
import Combine

@MainActor
final class LocationManager: NSObject, ObservableObject {

    // MARK: - Output untuk UI
    @Published var lastFix: CLLocation?
    @Published var authorization: CLAuthorizationStatus = .notDetermined
    @Published var isTracking = false
    @Published var statusText = "GPS belum aktif"
    @Published var trail: [Fix] = []          // riwayat lokal, tersimpan di device

    struct Fix: Identifiable, Codable {
        var id = UUID()
        let lat: Double
        let lon: Double
        let alt: Double
        let accuracy: Double
        let date: Date
    }

    private let manager = CLLocationManager()
    private let storeURL: URL = {
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return dir.appendingPathComponent("trail.json")
    }()

    /// Jarak minimum (meter) sebelum iOS membangunkan app lagi.
    /// Makin besar = makin hemat baterai. 100 m cocok untuk pendakian.
    private let distanceFilterMeters: CLLocationDistance = 100

    override init() {
        super.init()
        manager.delegate = self

        // --- Konfigurasi hemat baterai ---
        // kCLLocationAccuracyHundredMeters jauh lebih irit daripada BestForNavigation,
        // dan untuk pencarian orang hilang, presisi 100 m sudah sangat berguna.
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        manager.distanceFilter = distanceFilterMeters
        manager.activityType = .fitness
        manager.pausesLocationUpdatesAutomatically = true   // berhenti sendiri saat user diam/istirahat
        manager.showsBackgroundLocationIndicator = true

        authorization = manager.authorizationStatus
        loadTrail()
    }

    // MARK: - Izin

    func requestPermission() {
        // Minta WhenInUse dulu. iOS akan menaikkan ke Always lewat prompt kedua
        // setelah app benar-benar memakai lokasi di background.
        manager.requestWhenInUseAuthorization()
    }

    func requestAlways() {
        manager.requestAlwaysAuthorization()
    }

    // MARK: - Kontrol perekaman

    func start() {
        guard authorization == .authorizedAlways || authorization == .authorizedWhenInUse else {
            requestPermission()
            return
        }

        // Background updates hanya legal kalau mode "location" ada di Info.plist
        // DAN izinnya Always.
        if authorization == .authorizedAlways {
            manager.allowsBackgroundLocationUpdates = true
        }

        manager.startUpdatingLocation()

        // Lapisan kedua: significant-change. Sangat hemat baterai dan tetap
        // membangunkan app walaupun iOS mematikan startUpdatingLocation.
        if CLLocationManager.significantLocationChangeMonitoringAvailable() {
            manager.startMonitoringSignificantLocationChanges()
        }

        isTracking = true
        statusText = "Mencari satelit…"
    }

    func stop() {
        manager.stopUpdatingLocation()
        manager.stopMonitoringSignificantLocationChanges()
        manager.allowsBackgroundLocationUpdates = false
        isTracking = false
        statusText = "Perekaman dihentikan"
    }

    /// Satu kali tembak, dipakai tombol darurat supaya dapat fix paling segar.
    func requestOneShot() {
        manager.requestLocation()
    }

    // MARK: - Penyimpanan lokal (offline)

    private func append(_ location: CLLocation) {
        let fix = Fix(lat: location.coordinate.latitude,
                      lon: location.coordinate.longitude,
                      alt: location.altitude,
                      accuracy: location.horizontalAccuracy,
                      date: location.timestamp)
        trail.append(fix)
        if trail.count > 3000 { trail.removeFirst(trail.count - 3000) }
        saveTrail()
    }

    private func saveTrail() {
        do {
            let data = try JSONEncoder().encode(trail)
            try data.write(to: storeURL, options: .atomic)
        } catch {
            print("Gagal menyimpan jejak:", error)
        }
    }

    private func loadTrail() {
        guard let data = try? Data(contentsOf: storeURL),
              let decoded = try? JSONDecoder().decode([Fix].self, from: data) else { return }
        trail = decoded
        if let last = decoded.last {
            lastFix = CLLocation(coordinate: .init(latitude: last.lat, longitude: last.lon),
                                 altitude: last.alt,
                                 horizontalAccuracy: last.accuracy,
                                 verticalAccuracy: last.accuracy,
                                 timestamp: last.date)
        }
    }

    func clearTrail() {
        trail.removeAll()
        lastFix = nil
        try? FileManager.default.removeItem(at: storeURL)
    }
}

// MARK: - CLLocationManagerDelegate

extension LocationManager: CLLocationManagerDelegate {

    nonisolated func locationManager(_ manager: CLLocationManager,
                                     didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }

        // Buang fix sampah: akurasi negatif = tidak valid, > 500 m = belum terkunci.
        guard loc.horizontalAccuracy > 0, loc.horizontalAccuracy < 500 else { return }

        Task { @MainActor in
            self.lastFix = loc
            self.append(loc)
            self.statusText = String(format: "Terkunci · akurasi ±%.0f m", loc.horizontalAccuracy)
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager,
                                     didFailWithError error: Error) {
        Task { @MainActor in
            if (error as? CLError)?.code == .denied {
                self.statusText = "Izin lokasi ditolak"
                self.isTracking = false
            } else {
                self.statusText = "Belum dapat sinyal satelit"
            }
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in
            self.authorization = status
            switch status {
            case .authorizedAlways:
                self.statusText = "Izin penuh diberikan"
                if self.isTracking { self.start() }
            case .authorizedWhenInUse:
                self.statusText = "Izin terbatas. Pilih \"Selalu\" agar tetap merekam di dalam tas."
            case .denied, .restricted:
                self.statusText = "Izin lokasi ditolak"
                self.isTracking = false
            default:
                break
            }
        }
    }
}
