import SwiftUI
import UIKit
import CoreImage

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var confirmForget = false

    var body: some View {
        @Bindable var model = model
        Form {
            Section("Looks") {
                Picker("Theme", selection: $model.theme) {
                    ForEach(ThemeChoice.allCases) { choice in
                        Text(choice.label).tag(choice)
                    }
                }
                .onChange(of: model.theme) { _, value in
                    model.setTheme(value)
                }
            }
            Section("Family") {
                NavigationLink("Family members") { FamilyListView() }
                NavigationLink("Meal plan") { MealsView() }
                NavigationLink("Photos") { PhotosView() }
            }
            Section("House") {
                NavigationLink("Lights") { HomeControlView() }
                NavigationLink("Show on TV") { ShowOnTVView() }
                NavigationLink("Pair a TV") { PairTVView() }
            }
            Section("This iPhone") {
                LabeledContent("Server", value: model.origin ?? "Not set")
                Text("The pairing token stays in the iPhone Keychain. Revoke this phone from the wall and it will ask to pair again.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Button("Forget this server", role: .destructive) {
                    confirmForget = true
                }
                .frame(minHeight: 44)
            }
            if model.offline {
                Section {
                    Text(model.offlineDetail)
                        .foregroundStyle(.orange)
                }
            }
        }
        .navigationTitle("Settings")
        .alert("Forget this server?", isPresented: $confirmForget) {
            Button("Forget", role: .destructive) { model.forgetServer() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("You'll need the address and a new pairing code to connect again.")
        }
    }
}

struct PairTVView: View {
    @Environment(AppModel.self) private var model
    @State private var code: PairingCode?
    @State private var error: String?
    @State private var loading = false

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                Text("Type this code on the TV when it says Pair this TV. It works once and expires after 10 minutes.")
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                if let error {
                    ErrorBanner(text: error, onDismiss: { error = nil })
                }
                if loading {
                    ProgressView("Getting a code…")
                } else if let code {
                    Text(code.code)
                        .font(.system(size: 48, weight: .bold, design: .monospaced))
                        .padding()
                    if !code.qrPayload.isEmpty {
                        QRCodeImage(payload: code.qrPayload)
                            .frame(width: 220, height: 220)
                    }
                }
                WarmButton(title: "New code") {
                    Task { await mint() }
                }
            }
            .padding(24)
        }
        .navigationTitle("Pair a TV")
        .task { await mint() }
    }

    private func mint() async {
        loading = true
        defer { loading = false }
        switch await model.createPairingCode() {
        case .success(let value):
            code = value
            error = nil
        case .failure(let message):
            error = message
        }
    }
}

/// Draws a QR with Core Image. No paid service.
struct QRCodeImage: View {
    var payload: String

    var body: some View {
        if let image = Self.make(payload) {
            Image(uiImage: image)
                .interpolation(.none)
                .resizable()
                .scaledToFit()
                .padding(8)
                .background(Color.white, in: RoundedRectangle(cornerRadius: 12))
        }
    }

    private static func make(_ text: String) -> UIImage? {
        let data = Data(text.utf8)
        guard let filter = CIFilter(name: "CIQRCodeGenerator") else { return nil }
        filter.setValue(data, forKey: "inputMessage")
        filter.setValue("M", forKey: "inputCorrectionLevel")
        guard let output = filter.outputImage else { return nil }
        let scaled = output.transformed(by: CGAffineTransform(scaleX: 10, y: 10))
        let context = CIContext()
        guard let cg = context.createCGImage(scaled, from: scaled.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
}

struct ShowOnTVView: View {
    @Environment(AppModel.self) private var model
    @State private var displays: [DisplayTarget] = []
    @State private var error: String?
    @State private var sent: String?

    private let destinations = [
        ("today", "Today"),
        ("week", "Week"),
        ("month", "Month"),
        ("lists", "Lists"),
        ("photos", "Photos"),
        ("meals", "Meals"),
    ]

    var body: some View {
        List {
            if let error {
                ErrorBanner(text: error, onDismiss: { error = nil })
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            }
            if let sent {
                Text(sent).foregroundStyle(MantelTheme.ember)
            }
            if displays.isEmpty {
                Text("No TVs are connected right now.")
                    .foregroundStyle(.secondary)
            }
            ForEach(displays) { display in
                Section(display.name) {
                    ForEach(destinations, id: \.0) { dest in
                        Button(dest.1) {
                            Task {
                                if let message = await model.showOnDisplay(id: display.id, destination: dest.0) {
                                    error = message
                                    sent = nil
                                } else {
                                    sent = "Showing \(dest.1) on \(display.name)."
                                    error = nil
                                }
                            }
                        }
                        .font(.title3)
                        .frame(minHeight: 44)
                    }
                }
            }
        }
        .navigationTitle("Show on TV")
        .task { displays = await model.displays() }
        .refreshable { displays = await model.displays() }
    }
}
