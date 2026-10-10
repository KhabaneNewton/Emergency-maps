//
//  ContentView.swift
//  EmergencyGPS
//
//  UI sengaja dibuat gelap, statis, tanpa animasi dan tanpa peta.
//  Peta = GPU + render terus-menerus = baterai habis. Di gunung, angka lebih berguna.
//

import SwiftUI
import CoreLocation
import MessageUI

struct ContentView: View {

    @StateObject private var gps = LocationManager()
    @AppStorage("emergencyNumber") private var emergencyNumber = "+6281234567890"
    @AppStorage("hikerName") private var hikerName = "Arif"

    @State private var showComposer = false
    @State private var composerBody = ""
    @State private var toast: String?

    private var fix: CLLocation? { gps.lastFix }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            VStack(alignment: .leading, spacing: 18) {

                header

                coordinateCard

                statusRow

                Spacer(minLength: 0)

                emergencyButton

                controls

                settings
            }
            .padding(20)
        }
        .preferredColorScheme(.dark)
        .sheet(isPresented: $showComposer) {
            MessageComposer(recipients: [emergencyNumber], body: composerBody) { result in
                showComposer = false
                switch result {
                case .sent:      toast = "Pesan terkirim."
                case .cancelled: toast = "Pesan disimpan sebagai draf, bisa dikirim ulang nanti."
                case .failed:    toast = "Gagal terkirim. Coba lagi saat dapat sinyal."
                @unknown default: break
                }
            }
        }
        .overlay(alignment: .top) { toastView }
        .onAppear { gps.requestPermission() }
    }

    // MARK: - Bagian UI

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Emergency GPS")
                .font(.system(size: 26, weight: .bold, design: .rounded))
            Text("Koordinat dibaca langsung dari satelit. Tidak butuh internet.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    private var coordinateCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            row("Lintang",  fix.map { String(format: "%.6f", $0.coordinate.latitude) }  ?? "—")
            Divider().overlay(Color.white.opacity(0.08))
            row("Bujur",    fix.map { String(format: "%.6f", $0.coordinate.longitude) } ?? "—")
            Divider().overlay(Color.white.opacity(0.08))
            row("Elevasi",  fix.map { String(format: "%.0f mdpl", $0.altitude) }        ?? "—")
            Divider().overlay(Color.white.opacity(0.08))
            row("Diambil",  fix.map { Self.timeFormatter.string(from: $0.timestamp) }   ?? "—")
        }
        .padding(16)
        .background(Color(white: 0.08), in: RoundedRectangle(cornerRadius: 12))
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
                .font(.system(size: 14))
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .font(.system(size: 17, weight: .semibold, design: .monospaced))
        }
    }

    private var statusRow: some View {
        HStack(spacing: 10) {
            Circle()
                .fill(gps.isTracking ? Color.green : Color.gray)
                .frame(width: 8, height: 8)
            Text(gps.statusText)
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
            Spacer()
            Text("\(gps.trail.count) titik")
                .font(.system(size: 13, design: .monospaced))
                .foregroundStyle(.secondary)
        }
    }

    private var emergencyButton: some View {
        Button {
            sendEmergency()
        } label: {
            VStack(spacing: 3) {
                Text("Kirim Lokasi Darurat")
                    .font(.system(size: 19, weight: .bold))
                Text("membuka SMS dengan teks siap kirim")
                    .font(.system(size: 12, weight: .regular))
                    .opacity(0.75)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 18)
            .background(fix == nil ? Color.gray.opacity(0.3) : Color(red: 0.86, green: 0.25, blue: 0.16))
            .foregroundStyle(.white)
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .disabled(fix == nil)
    }

    private var controls: some View {
        HStack(spacing: 10) {
            Button(gps.isTracking ? "Hentikan GPS" : "Nyalakan GPS") {
                gps.isTracking ? gps.stop() : gps.start()
            }
            .buttonStyle(Outline())

            Button("Ambil titik sekarang") { gps.requestOneShot() }
                .buttonStyle(Outline())
        }
    }

    private var settings: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Nomor tujuan")
                .font(.caption).foregroundStyle(.secondary)
            TextField("+62…", text: $emergencyNumber)
                .keyboardType(.phonePad)
                .textFieldStyle(.plain)
                .font(.system(size: 15, design: .monospaced))
                .padding(10)
                .background(Color(white: 0.1), in: RoundedRectangle(cornerRadius: 8))

            if gps.authorization == .authorizedWhenInUse {
                Button("Naikkan izin ke \"Selalu\"") { gps.requestAlways() }
                    .font(.footnote)
                    .tint(.orange)
            }
        }
    }

    @ViewBuilder
    private var toastView: some View {
        if let toast {
            Text(toast)
                .font(.footnote)
                .padding(.horizontal, 14).padding(.vertical, 9)
                .background(Color(white: 0.15), in: Capsule())
                .padding(.top, 8)
                .task {
                    try? await Task.sleep(nanoseconds: 3_000_000_000)
                    self.toast = nil
                }
        }
    }

    // MARK: - Aksi darurat

    private func sendEmergency() {
        gps.requestOneShot()               // coba segarkan fix, tapi jangan menunggu
        guard let f = fix else { return }

        composerBody = Self.buildMessage(name: hikerName, fix: f, pointCount: gps.trail.count)

        if MFMessageComposeViewController.canSendText() {
            showComposer = true            // tetap di dalam app, draf sudah terisi
        } else {
            // Fallback kalau composer tidak tersedia (mis. iPad tanpa iMessage)
            let encoded = composerBody.addingPercentEncoding(
                withAllowedCharacters: .urlQueryAllowed) ?? ""
            if let url = URL(string: "sms:\(emergencyNumber)&body=\(encoded)") {
                UIApplication.shared.open(url)
            }
        }
    }

    /// Format pesan sengaja dibuat mesin-bacaan sekaligus manusia-bacaan.
    /// Baris LOC dipakai server untuk parsing, sisanya dibaca orang tua.
    static func buildMessage(name: String, fix: CLLocation, pointCount: Int) -> String {
        let lat = String(format: "%.6f", fix.coordinate.latitude)
        let lon = String(format: "%.6f", fix.coordinate.longitude)
        let alt = String(format: "%.0f", fix.altitude)
        let acc = String(format: "%.0f", fix.horizontalAccuracy)
        let time = timeFormatter.string(from: fix.timestamp)
        let battery = Int(UIDevice.current.batteryLevel * 100)

        return """
        DARURAT \(name)
        LOC \(lat),\(lon)
        Elevasi \(alt) mdpl · akurasi ±\(acc) m
        Waktu \(time)
        Baterai \(battery < 0 ? "?" : String(battery))%
        https://maps.google.com/?q=\(lat),\(lon)
        """
    }

    static let timeFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "dd/MM HH:mm"
        f.locale = Locale(identifier: "id_ID")
        return f
    }()
}

// MARK: - Gaya tombol sekunder

private struct Outline: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .medium))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 13)
            .background(Color(white: 0.1), in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.white.opacity(0.12)))
            .foregroundStyle(.white)
            .opacity(configuration.isPressed ? 0.6 : 1)
    }
}

// MARK: - Pembungkus MFMessageComposeViewController

struct MessageComposer: UIViewControllerRepresentable {
    let recipients: [String]
    let body: String
    let onFinish: (MessageComposeResult) -> Void

    func makeUIViewController(context: Context) -> MFMessageComposeViewController {
        let vc = MFMessageComposeViewController()
        vc.recipients = recipients
        vc.body = body
        vc.messageComposeDelegate = context.coordinator
        return vc
    }

    func updateUIViewController(_ vc: MFMessageComposeViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(onFinish: onFinish) }

    final class Coordinator: NSObject, MFMessageComposeViewControllerDelegate {
        let onFinish: (MessageComposeResult) -> Void
        init(onFinish: @escaping (MessageComposeResult) -> Void) { self.onFinish = onFinish }

        func messageComposeViewController(_ controller: MFMessageComposeViewController,
                                          didFinishWith result: MessageComposeResult) {
            onFinish(result)
        }
    }
}

#Preview { ContentView() }
