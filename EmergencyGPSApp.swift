//
//  EmergencyGPSApp.swift
//  EmergencyGPS
//

import SwiftUI
import UIKit

@main
struct EmergencyGPSApp: App {
    init() {
        // Wajib dinyalakan kalau mau membaca UIDevice.current.batteryLevel
        UIDevice.current.isBatteryMonitoringEnabled = true
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
