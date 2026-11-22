import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Group {
            switch model.phase {
            case .loading:
                LoadingView(text: model.message)
            case .address:
                AddressScreen()
            case .pair:
                PairScreen()
            case .ready:
                MainTabs()
            }
        }
        .animation(.easeInOut(duration: 0.2), value: model.phase)
    }
}

struct LoadingView: View {
    var text: String?

    var body: some View {
        VStack(spacing: 20) {
            ProgressView()
                .scaleEffect(1.4)
            Text(text ?? "Looking for the calendar server…")
                .font(.title3)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(MantelTheme.sand)
    }
}

struct MainTabs: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        TabView(selection: $model.tab) {
            NavigationStack {
                HomeView()
            }
            .tabItem { Label(PhoneTab.home.label, systemImage: PhoneTab.home.systemImage) }
            .tag(PhoneTab.home)

            NavigationStack {
                CalendarHomeView()
            }
            .tabItem { Label(PhoneTab.calendar.label, systemImage: PhoneTab.calendar.systemImage) }
            .tag(PhoneTab.calendar)

            NavigationStack {
                MessagesListView()
            }
            .tabItem { Label(PhoneTab.messages.label, systemImage: PhoneTab.messages.systemImage) }
            .tag(PhoneTab.messages)

            NavigationStack {
                ChoresView()
            }
            .tabItem { Label(PhoneTab.chores.label, systemImage: PhoneTab.chores.systemImage) }
            .tag(PhoneTab.chores)

            NavigationStack {
                ListsView()
            }
            .tabItem { Label(PhoneTab.lists.label, systemImage: PhoneTab.lists.systemImage) }
            .tag(PhoneTab.lists)
        }
        .tint(MantelTheme.ember)
    }
}
