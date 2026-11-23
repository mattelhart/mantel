import SwiftUI

struct CalendarHomeView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        VStack(spacing: 0) {
            if model.offline {
                OfflineBanner(text: model.offlineDetail.isEmpty ? "Can't reach the calendar server." : model.offlineDetail)
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
            }
            Picker("View", selection: $model.calendarMode) {
                ForEach(CalendarMode.allCases) { mode in
                    Text(mode.label).tag(mode)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)

            personFilter
                .padding(.horizontal, 16)
                .padding(.bottom, 8)

            switch model.calendarMode {
            case .day:
                DayAgendaView()
            case .week:
                WeekView()
            case .month:
                MonthView()
            }
        }
        .navigationTitle("Calendar")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Today") { model.setAnchor(model.calendar.startOfDay(for: Date())) }
                    .font(.headline)
            }
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink {
                    EventEditorView(event: nil, day: model.anchor)
                } label: {
                    Image(systemName: "plus")
                        .font(.title3.weight(.semibold))
                        .frame(minWidth: 44, minHeight: 44)
                }
                .accessibilityLabel("Add event")
            }
        }
        .refreshable { await model.reload(spinner: false) }
    }

    private var personFilter: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(model.users) { user in
                    Button {
                        model.toggleUser(user.id)
                    } label: {
                        VStack(spacing: 4) {
                            PersonDot(
                                name: user.name,
                                color: user.color,
                                emoji: user.avatarEmoji,
                                size: 48,
                                dimmed: model.hiddenUserIds.contains(user.id)
                            )
                            Text(user.name)
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(model.hiddenUserIds.contains(user.id) ? .secondary : .primary)
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(model.hiddenUserIds.contains(user.id) ? "Show \(user.name)" : "Hide \(user.name)")
                }
            }
            .padding(.vertical, 4)
        }
    }
}

struct DayAgendaView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let events = CalendarDates.eventsOn(model.visibleEvents, day: model.anchor, home: model.homeZone, calendar: model.calendar)
        VStack(spacing: 0) {
            HStack {
                Button {
                    model.setAnchor(CalendarDates.addDays(model.anchor, -1, calendar: model.calendar))
                } label: {
                    Image(systemName: "chevron.left").font(.title2.weight(.semibold)).frame(width: 44, height: 44)
                }
                Spacer()
                Text(CalendarDates.dayLabel(model.anchor, calendar: model.calendar))
                    .font(.title2.weight(.semibold))
                Spacer()
                Button {
                    model.setAnchor(CalendarDates.addDays(model.anchor, 1, calendar: model.calendar))
                } label: {
                    Image(systemName: "chevron.right").font(.title2.weight(.semibold)).frame(width: 44, height: 44)
                }
            }
            .padding(.horizontal, 8)
            List {
                if events.isEmpty {
                    Text("Nothing on this day.")
                        .foregroundStyle(.secondary)
                        .listRowSeparator(.hidden)
                }
                ForEach(events) { event in
                    NavigationLink {
                        EventDetailView(event: event)
                    } label: {
                        EventRow(event: event)
                    }
                    .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
                    .listRowSeparator(.hidden)
                }
            }
            .listStyle(.plain)
        }
    }
}

struct WeekView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let days = CalendarDates.weekDays(anchor: model.anchor, calendar: model.calendar)
        VStack(spacing: 0) {
            HStack {
                Button {
                    model.setAnchor(CalendarDates.addDays(model.anchor, -7, calendar: model.calendar))
                } label: {
                    Image(systemName: "chevron.left").font(.title2.weight(.semibold)).frame(width: 44, height: 44)
                }
                Spacer()
                Text(weekTitle(days))
                    .font(.headline)
                Spacer()
                Button {
                    model.setAnchor(CalendarDates.addDays(model.anchor, 7, calendar: model.calendar))
                } label: {
                    Image(systemName: "chevron.right").font(.title2.weight(.semibold)).frame(width: 44, height: 44)
                }
            }
            .padding(.horizontal, 8)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) {
                    ForEach(days, id: \.timeIntervalSince1970) { day in
                        let events = CalendarDates.eventsOn(model.visibleEvents, day: day, home: model.homeZone, calendar: model.calendar)
                        VStack(alignment: .leading, spacing: 8) {
                            Button {
                                model.setAnchor(day)
                                model.calendarMode = .day
                            } label: {
                                Text(CalendarDates.dayLabel(day, calendar: model.calendar))
                                    .font(.title3.weight(.semibold))
                                    .foregroundStyle(model.calendar.isDateInToday(day) ? MantelTheme.ember : .primary)
                            }
                            if events.isEmpty {
                                Text("Free")
                                    .foregroundStyle(.secondary)
                            }
                            ForEach(events) { event in
                                NavigationLink {
                                    EventDetailView(event: event)
                                } label: {
                                    EventRow(event: event)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
                .padding(16)
            }
        }
    }

    private func weekTitle(_ days: [Date]) -> String {
        guard let first = days.first, let last = days.last else { return "Week" }
        let f = DateFormatter()
        f.calendar = model.calendar
        f.timeZone = model.homeZone
        f.dateFormat = "MMM d"
        return "\(f.string(from: first)) – \(f.string(from: last))"
    }
}

struct MonthView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let days = CalendarDates.monthGrid(anchor: model.anchor, calendar: model.calendar)
        let columns = Array(repeating: GridItem(.flexible(), spacing: 4), count: 7)
        VStack(spacing: 8) {
            HStack {
                Button {
                    model.setAnchor(model.calendar.date(byAdding: .month, value: -1, to: model.anchor) ?? model.anchor)
                } label: {
                    Image(systemName: "chevron.left").font(.title2.weight(.semibold)).frame(width: 44, height: 44)
                }
                Spacer()
                Text(CalendarDates.monthLabel(model.anchor, calendar: model.calendar))
                    .font(.title3.weight(.semibold))
                Spacer()
                Button {
                    model.setAnchor(model.calendar.date(byAdding: .month, value: 1, to: model.anchor) ?? model.anchor)
                } label: {
                    Image(systemName: "chevron.right").font(.title2.weight(.semibold)).frame(width: 44, height: 44)
                }
            }
            .padding(.horizontal, 8)
            HStack {
                ForEach(weekdayHeaders, id: \.self) { label in
                    Text(label)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)
                }
            }
            .padding(.horizontal, 8)
            LazyVGrid(columns: columns, spacing: 4) {
                ForEach(days, id: \.timeIntervalSince1970) { day in
                    let inMonth = model.calendar.isDate(day, equalTo: model.anchor, toGranularity: .month)
                    let count = CalendarDates.eventsOn(model.visibleEvents, day: day, home: model.homeZone, calendar: model.calendar).count
                    Button {
                        model.setAnchor(day)
                        model.calendarMode = .day
                    } label: {
                        VStack(spacing: 4) {
                            Text("\(model.calendar.component(.day, from: day))")
                                .font(.headline)
                                .foregroundStyle(inMonth ? .primary : .secondary)
                            Circle()
                                .fill(count > 0 ? MantelTheme.ember : Color.clear)
                                .frame(width: 6, height: 6)
                        }
                        .frame(maxWidth: .infinity, minHeight: 48)
                        .background(
                            model.calendar.isDate(day, inSameDayAs: model.anchor)
                            ? MantelTheme.warmFill
                            : Color.clear,
                            in: RoundedRectangle(cornerRadius: 10)
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 8)
            Spacer()
        }
    }

    private var weekdayHeaders: [String] {
        let symbols = model.calendar.veryShortWeekdaySymbols
        let first = model.calendar.firstWeekday - 1
        return (0..<7).map { symbols[($0 + first) % 7] }
    }
}
