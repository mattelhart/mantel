import SwiftUI

struct HomeView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                statusBanners
                tileGrid
                shortcutRow
                todaySection
                choreSection
            }
            .padding(16)
        }
        .background(Color(.systemBackground))
        .navigationTitle("Homie")
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink {
                    SettingsView()
                } label: {
                    Image(systemName: "gearshape.fill")
                        .font(.title3)
                        .frame(minWidth: 44, minHeight: 44)
                }
                .accessibilityLabel("Settings")
            }
        }
        .refreshable { await model.reload(spinner: false) }
        .safeAreaInset(edge: .bottom) {
            NavigationLink {
                EventEditorView(event: nil, day: model.calendar.startOfDay(for: Date()))
            } label: {
                Text("Add event")
                    .font(.title3.weight(.semibold))
                    .frame(maxWidth: .infinity, minHeight: 52)
            }
            .buttonStyle(.borderedProminent)
            .tint(MantelTheme.ember)
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
        }
    }

    @ViewBuilder
    private var statusBanners: some View {
        if model.offline {
            OfflineBanner(text: model.offlineDetail.isEmpty
                          ? "Can't reach the calendar server. Showing the last copy."
                          : model.offlineDetail)
        }
        if let message = model.message {
            ErrorBanner(text: message, onDismiss: model.dismissMessage)
        }
    }

    private var tileGrid: some View {
        let tiles: [(String, String, Color, PhoneTab? , String?)] = [
            ("Calendar", "calendar", Color(red: 0.99, green: 0.88, blue: 0.86), .calendar, nil),
            ("Messages", "bubble.left.and.bubble.right.fill", Color(red: 0.87, green: 0.93, blue: 0.96), .messages, nil),
            ("Chores", "checkmark.circle.fill", Color(red: 0.89, green: 0.94, blue: 0.84), .chores, nil),
            ("Lists", "checklist", Color(red: 0.96, green: 0.93, blue: 0.84), .lists, nil),
            ("Rewards", "star.fill", Color(red: 1, green: 0.94, blue: 0.80), nil, "rewards"),
            ("Draw", "pencil.tip", Color(red: 0.93, green: 0.88, blue: 0.96), .messages, "draw"),
        ]
        return LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
            ForEach(Array(tiles.enumerated()), id: \.offset) { _, tile in
                if let tab = tile.3, tile.4 == nil {
                    Button {
                        model.tab = tab
                    } label: {
                        tileView(title: tile.0, icon: tile.1, color: tile.2)
                    }
                    .buttonStyle(.plain)
                } else if tile.4 == "rewards" {
                    NavigationLink {
                        RewardsView()
                    } label: {
                        tileView(title: tile.0, icon: tile.1, color: tile.2)
                    }
                    .buttonStyle(.plain)
                } else {
                    NavigationLink {
                        MessagesListView(openDraw: true)
                    } label: {
                        tileView(title: tile.0, icon: tile.1, color: tile.2)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func tileView(title: String, icon: String, color: Color) -> some View {
        VStack(spacing: 10) {
            ZStack {
                Circle().fill(color).frame(width: 76, height: 76)
                Image(systemName: icon)
                    .font(.system(size: 30, weight: .semibold))
                    .foregroundStyle(MantelTheme.ink)
            }
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.primary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
    }

    private var shortcutRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                NavigationLink("Meals") { MealsView() }
                NavigationLink("Photos") { PhotosView() }
                NavigationLink("Family") { FamilyListView() }
                NavigationLink("Lights") { HomeControlView() }
                NavigationLink("Show on TV") { ShowOnTVView() }
                NavigationLink("Pair TV") { PairTVView() }
            }
            .buttonStyle(.bordered)
            .font(.headline)
        }
    }

    private var todaySection: some View {
        let today = model.calendar.startOfDay(for: Date())
        let events = CalendarDates.eventsOn(model.visibleEvents, day: today, home: model.homeZone, calendar: model.calendar)
        return VStack(alignment: .leading, spacing: 10) {
            Text(CalendarDates.dayLabel(today, calendar: model.calendar))
                .font(.title.weight(.semibold))
            if events.isEmpty {
                Text("No events today. A little room to breathe.")
                    .foregroundStyle(.secondary)
            }
            ForEach(events.prefix(5)) { event in
                NavigationLink {
                    EventDetailView(event: event)
                } label: {
                    EventRow(event: event)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var choreSection: some View {
        let today = CalendarDates.ymd(Date(), calendar: model.calendar)
        let board = model.board
        return VStack(alignment: .leading, spacing: 10) {
            Text("Chores today")
                .font(.title2.weight(.semibold))
            if let board, board.on == today {
                let remaining = board.people.map { person in
                    (person, person.chores.filter { $0.completion == nil })
                }.filter { !$0.1.isEmpty }
                if remaining.isEmpty {
                    Text("No chores left to do.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(remaining, id: \.0.id) { person, chores in
                        Text(person.name).font(.headline)
                        Text(chores.map(\.title).joined(separator: " · "))
                            .foregroundStyle(.secondary)
                    }
                }
            }
            Button("Open today's chores") {
                model.setChoreDay(model.calendar.startOfDay(for: Date()))
                model.tab = .chores
            }
            .font(.headline)
            .frame(minHeight: 44)
        }
    }
}

struct EventRow: View {
    @Environment(AppModel.self) private var model
    var event: CalEvent

    var body: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 4)
                .fill(Color(hex: event.color))
                .frame(width: 6, height: 48)
            VStack(alignment: .leading, spacing: 2) {
                Text(event.title)
                    .font(.headline)
                    .foregroundStyle(.primary)
                Text(CalendarDates.formatWhen(event, home: model.homeZone, use24h: model.settings.timeFormat24h, calendar: model.calendar))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                if let location = event.location, !location.isEmpty {
                    Text(location).font(.subheadline).foregroundStyle(.secondary)
                }
            }
            Spacer()
        }
        .padding(10)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14))
    }
}
