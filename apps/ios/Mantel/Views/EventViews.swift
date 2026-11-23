import SwiftUI

struct EventDetailView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    var event: CalEvent
    @State private var error: String?
    @State private var confirmDelete = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let error {
                    ErrorBanner(text: error, onDismiss: { error = nil })
                }
                HStack(spacing: 10) {
                    RoundedRectangle(cornerRadius: 4).fill(Color(hex: event.color)).frame(width: 8, height: 36)
                    Text(event.title).font(.largeTitle.weight(.semibold))
                }
                labeled("When", CalendarDates.formatWhen(event, home: model.homeZone, use24h: model.settings.timeFormat24h, calendar: model.calendar))
                if let location = event.location, !location.isEmpty {
                    labeled("Where", location)
                }
                if let description = event.description, !description.isEmpty {
                    labeled("Notes", description)
                }
                if let text = event.recurrenceText, !text.isEmpty {
                    labeled("Repeats", text)
                }
                labeled("Calendar", event.calendarName)
                if event.editable {
                    NavigationLink {
                        EventEditorView(event: event, day: CalendarDates.eventDay(event, home: model.homeZone, calendar: model.calendar))
                    } label: {
                        Text("Edit")
                            .font(.title3.weight(.semibold))
                            .frame(maxWidth: .infinity, minHeight: 52)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(MantelTheme.ember)
                    Button("Delete") { confirmDelete = true }
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(MantelTheme.danger)
                        .frame(maxWidth: .infinity, minHeight: 52)
                } else {
                    Text("This calendar is read-only, so it can't be changed here.")
                        .foregroundStyle(.secondary)
                }
            }
            .padding(20)
        }
        .navigationTitle("Event")
        .navigationBarTitleDisplayMode(.inline)
        .alert("Delete this event?", isPresented: $confirmDelete) {
            Button("Delete", role: .destructive) {
                Task {
                    if let message = await model.deleteEvent(event.id) {
                        error = message
                    } else {
                        dismiss()
                    }
                }
            }
            Button("Cancel", role: .cancel) {}
        }
    }

    private func labeled(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
            Text(value).font(.title3)
        }
    }
}

struct EventEditorView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    var event: CalEvent?
    var day: Date

    @State private var title = ""
    @State private var location = ""
    @State private var notes = ""
    @State private var allDay = false
    @State private var startDay = Date()
    @State private var endDay = Date()
    @State private var startTime = Date()
    @State private var endTime = Date()
    @State private var calendarId: Int?
    @State private var repeatChoice = RepeatChoice()
    @State private var error: String?
    @State private var saving = false

    var body: some View {
        Form {
            if let error {
                ErrorBanner(text: error, onDismiss: { error = nil })
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            }
            Section("What") {
                TextField("Title", text: $title)
                    .font(.title3)
                TextField("Where", text: $location)
                TextField("Notes", text: $notes, axis: .vertical)
                    .lineLimit(3...6)
            }
            Section("When") {
                Toggle("All day", isOn: $allDay)
                DatePicker("Starts", selection: $startDay, displayedComponents: .date)
                if !allDay {
                    DatePicker("Start time", selection: $startTime, displayedComponents: .hourAndMinute)
                    DatePicker("End time", selection: $endTime, displayedComponents: .hourAndMinute)
                } else {
                    DatePicker("Ends", selection: $endDay, displayedComponents: .date)
                }
            }
            if eventEditKind(event) != .occurrence {
                Section("Calendar") {
                    Picker("Calendar", selection: $calendarId) {
                        ForEach(model.writableCalendars) { cal in
                            Text(cal.name).tag(Optional(cal.id))
                        }
                    }
                }
                Section("Repeats") {
                    Picker("Repeats", selection: $repeatChoice.freq) {
                        ForEach(RepeatFreq.allCases) { freq in
                            Text(freq.rawValue).tag(freq)
                        }
                    }
                    if repeatChoice.freq == .weekly {
                        weekdayPicker
                    }
                }
            } else {
                Section {
                    Text("This is one day in a series that lives in Google or iCloud. Saving changes only this day.")
                        .foregroundStyle(.secondary)
                }
            }
            Section {
                WarmButton(title: saving ? "Saving…" : "Save", enabled: !saving) {
                    Task { await save() }
                }
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
            }
        }
        .navigationTitle(event == nil ? "New event" : "Edit event")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { populate() }
    }

    private var weekdayPicker: some View {
        HStack {
            ForEach(Array(Recurrence.weekdayCodes.enumerated()), id: \.offset) { index, code in
                let on = repeatChoice.byday.contains(code)
                Button(Recurrence.weekdayLabels[index]) {
                    if on { repeatChoice.byday.removeAll { $0 == code } }
                    else { repeatChoice.byday.append(code) }
                }
                .font(.caption.weight(.semibold))
                .frame(maxWidth: .infinity, minHeight: 40)
                .background(on ? MantelTheme.ember : Color(.secondarySystemBackground), in: Capsule())
                .foregroundStyle(on ? .white : .primary)
            }
        }
    }

    private func populate() {
        startDay = model.calendar.startOfDay(for: day)
        endDay = startDay
        var startComps = DateComponents(hour: 9, minute: 0)
        var endComps = DateComponents(hour: 10, minute: 0)
        if let event {
            title = event.title
            location = event.location ?? ""
            notes = event.description ?? ""
            allDay = event.allDay
            startDay = CalendarDates.eventDay(event, home: model.homeZone, calendar: model.calendar)
            if event.allDay {
                var utc = Calendar(identifier: .gregorian)
                utc.timeZone = TimeZone(secondsFromGMT: 0)!
                let end = utc.date(byAdding: .day, value: -1, to: CalendarDates.utcDate(event.endAt)) ?? startDay
                let y = utc.component(.year, from: end)
                let m = utc.component(.month, from: end)
                let d = utc.component(.day, from: end)
                endDay = model.calendar.date(from: DateComponents(year: y, month: m, day: d)) ?? startDay
            }
            if let minutes = CalendarDates.eventMinutes(event, home: model.homeZone) {
                startComps = DateComponents(hour: minutes.0 / 60, minute: minutes.0 % 60)
                endComps = DateComponents(hour: minutes.1 / 60, minute: minutes.1 % 60)
            }
            calendarId = event.calendarId
            repeatChoice = Recurrence.parse(event.recurrenceRule)
        } else {
            calendarId = model.writableCalendars.first?.id
        }
        startTime = model.calendar.date(bySettingHour: startComps.hour ?? 9, minute: startComps.minute ?? 0, second: 0, of: startDay) ?? startDay
        endTime = model.calendar.date(bySettingHour: endComps.hour ?? 10, minute: endComps.minute ?? 0, second: 0, of: startDay) ?? startDay
    }

    private func minutes(from date: Date) -> Int {
        model.calendar.component(.hour, from: date) * 60 + model.calendar.component(.minute, from: date)
    }

    private func save() async {
        guard let calendarId else {
            error = "Pick a calendar to save this on."
            return
        }
        saving = true
        defer { saving = false }
        if let message = await model.saveEvent(
            existing: event,
            title: title,
            location: location,
            description: notes,
            startDay: startDay,
            endDay: endDay,
            allDay: allDay,
            startMinutes: minutes(from: startTime),
            endMinutes: minutes(from: endTime),
            calendarId: calendarId,
            repeat: repeatChoice
        ) {
            error = message
        } else {
            dismiss()
        }
    }
}
