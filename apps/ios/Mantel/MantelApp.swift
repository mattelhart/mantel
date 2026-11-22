import SwiftUI

@main
struct MantelApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .preferredColorScheme(model.theme.preferred)
                .onAppear { model.start() }
                .onOpenURL { url in
                    model.openPairingLink(url.absoluteString, fromExternal: true)
                }
        }
    }
}
