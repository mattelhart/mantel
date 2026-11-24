import SwiftUI

struct HomeControlView: View {
    @Environment(AppModel.self) private var model
    @State private var setup: HomeSetup?
    @State private var snapshot: HomeSnapshot?
    @State private var baseURL = ""
    @State private var token = ""
    @State private var error: String?
    @State private var testResult: String?
    @State private var confirmLock: HomeEntity?

    var body: some View {
        Group {
            if let snapshot, snapshot.status == "ok" || !snapshot.rooms.isEmpty {
                lightsList(snapshot)
            } else {
                setupForm
            }
        }
        .navigationTitle("Lights")
        .task {
            setup = await model.loadHomeSetup()
            baseURL = setup?.haBaseUrl ?? ""
            snapshot = await model.loadHome()
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink("Setup") { setupForm.navigationTitle("Home setup") }
                    .font(.headline)
            }
        }
        .alert("Change this lock?", isPresented: Binding(
            get: { confirmLock != nil },
            set: { if !$0 { confirmLock = nil } }
        )) {
            Button("Yes") {
                if let entity = confirmLock {
                    Task { await act(entity, action: entity.on == true ? "turn_off" : "turn_on", confirm: true) }
                }
                confirmLock = nil
            }
            Button("Cancel", role: .cancel) { confirmLock = nil }
        } message: {
            Text("Locks need a confirmation so they aren't toggled by accident.")
        }
    }

    private var setupForm: some View {
        Form {
            if let error {
                ErrorBanner(text: error, onDismiss: { error = nil })
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            }
            if let testResult {
                Text(testResult).foregroundStyle(.secondary)
            }
            Section("Home Assistant") {
                TextField("Address", text: $baseURL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                SecureField("Long-lived token", text: $token)
                if setup?.server.haTokenSet == true {
                    Text("A token is already saved on the server. Leave the box empty to keep it.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Text("The token is stored on the Homie server, not on this iPhone. It is never shown again after you save it.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Section {
                WarmButton(title: "Save") {
                    Task {
                        if let message = await model.saveHomeConnection(
                            baseURL: baseURL,
                            token: token.isEmpty ? nil : token,
                            clearToken: false
                        ) {
                            error = message
                        } else {
                            token = ""
                            error = nil
                            testResult = "Saved."
                            setup = await model.loadHomeSetup()
                        }
                    }
                }
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
                SoftButton(title: "Test connection") {
                    Task {
                        if let message = await model.saveHomeConnection(
                            baseURL: baseURL,
                            token: token.isEmpty ? nil : token,
                            clearToken: false
                        ) {
                            error = message
                            return
                        }
                        token = ""
                        if let result = await model.testHome() {
                            testResult = result.message.isEmpty ? (result.ok ? "Connected." : result.status) : result.message
                        }
                    }
                }
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
                if setup?.server.haTokenSet == true {
                    Button("Remove token", role: .destructive) {
                        Task {
                            _ = await model.saveHomeConnection(baseURL: nil, token: nil, clearToken: true)
                            setup = await model.loadHomeSetup()
                            token = ""
                        }
                    }
                }
            }
        }
    }

    private func lightsList(_ snapshot: HomeSnapshot) -> some View {
        List {
            if snapshot.status != "ok", !snapshot.message.isEmpty {
                ErrorBanner(text: snapshot.message)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            }
            ForEach(snapshot.rooms) { room in
                Section(room.name) {
                    ForEach(room.entities) { entity in
                        entityRow(entity)
                    }
                }
            }
            if !snapshot.actions.isEmpty {
                Section("Scenes") {
                    ForEach(snapshot.actions) { entity in
                        Button(entity.name) {
                            Task { await act(entity, action: "turn_on") }
                        }
                        .font(.title3)
                        .frame(minHeight: 44)
                    }
                }
            }
        }
        .refreshable { self.snapshot = await model.loadHome() }
    }

    @ViewBuilder
    private func entityRow(_ entity: HomeEntity) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(entity.name).font(.headline)
                Spacer()
                if entity.domain == "lock" {
                    Button(entity.on == true ? "Locked" : "Unlocked") {
                        confirmLock = entity
                    }
                    .buttonStyle(.bordered)
                } else if entity.on != nil {
                    Toggle("", isOn: Binding(
                        get: { entity.on ?? false },
                        set: { on in
                            Task { await act(entity, action: on ? "turn_on" : "turn_off") }
                        }
                    ))
                    .labelsHidden()
                    .disabled(!entity.available)
                } else {
                    Text(entity.state).foregroundStyle(.secondary)
                }
            }
            if entity.adjustable, let level = entity.level {
                Slider(
                    value: Binding(
                        get: { Double(level) },
                        set: { newValue in
                            Task { await act(entity, action: "set_level", value: Int(newValue)) }
                        }
                    ),
                    in: 0...100
                )
                .tint(MantelTheme.ember)
            }
        }
        .padding(.vertical, 4)
    }

    private func act(_ entity: HomeEntity, action: String, value: Int? = nil, confirm: Bool = false) async {
        if let message = await model.homeAction(entityId: entity.entityId, action: action, value: value, confirm: confirm) {
            error = message
        } else {
            snapshot = await model.loadHome()
        }
    }
}
