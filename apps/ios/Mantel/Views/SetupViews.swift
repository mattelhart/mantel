import SwiftUI

struct AddressScreen: View {
    @Environment(AppModel.self) private var model
    @State private var address: String = ""
    @State private var scanning = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("Connect to Mantel")
                        .font(.largeTitle.weight(.semibold))
                    Text("Type the calendar server's address on your home network or VPN, such as 10.0.15.178. Don't use a public address.")
                        .foregroundStyle(.secondary)
                    if let message = model.message {
                        ErrorBanner(text: message, onDismiss: model.dismissMessage)
                    }
                    TextField("Calendar server", text: $address)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .textContentType(.URL)
                        .padding()
                        .background(.background, in: RoundedRectangle(cornerRadius: 14))
                        .overlay(RoundedRectangle(cornerRadius: 14).stroke(MantelTheme.line.opacity(0.3)))
                        .font(.title3)
                    WarmButton(title: "Connect", enabled: !address.trimmingCharacters(in: .whitespaces).isEmpty) {
                        model.connect(address)
                    }
                    SoftButton(title: "Scan pairing QR") { scanning = true }
                }
                .padding(24)
            }
            .background(MantelTheme.sand)
            .navigationTitle("Server")
            .navigationBarTitleDisplayMode(.inline)
            .onAppear {
                if address.isEmpty {
                    address = model.origin ?? ServerAddress.savedAddressPrefill(model.origin)
                }
            }
            .fullScreenCover(isPresented: $scanning) {
                QRScanner { payload in
                    scanning = false
                    model.openPairingLink(payload)
                } onClose: {
                    scanning = false
                }
            }
        }
    }
}

struct PairScreen: View {
    @Environment(AppModel.self) private var model
    @State private var code = ""
    @State private var scanning = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("Pair this iPhone")
                        .font(.largeTitle.weight(.semibold))
                    Text("On the wall: Settings → Devices → Pair a phone. Scan the QR, or type the 8-character code.")
                        .foregroundStyle(.secondary)
                    if let message = model.message {
                        ErrorBanner(text: message, onDismiss: model.dismissMessage)
                    }
                    TextField("Code", text: $code)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .font(.largeTitle.monospaced())
                        .multilineTextAlignment(.center)
                        .padding()
                        .background(.background, in: RoundedRectangle(cornerRadius: 14))
                    WarmButton(title: "Pair") { model.pair(code: code) }
                    SoftButton(title: "Scan pairing QR") { scanning = true }
                    Button("Use a different server") { model.editServer() }
                        .font(.title3.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 52)
                }
                .padding(24)
            }
            .background(MantelTheme.sand)
            .navigationTitle("Pair")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        model.editServer()
                    } label: {
                        BackLabel()
                    }
                }
            }
            .fullScreenCover(isPresented: $scanning) {
                QRScanner { payload in
                    scanning = false
                    model.openPairingLink(payload)
                } onClose: {
                    scanning = false
                }
            }
        }
    }
}
