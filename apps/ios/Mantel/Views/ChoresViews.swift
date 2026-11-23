import SwiftUI

struct ChoresView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let board = model.board
        VStack(spacing: 0) {
            HStack {
                Button {
                    model.setChoreDay(CalendarDates.addDays(model.choreDay, -1, calendar: model.calendar))
                } label: {
                    Image(systemName: "chevron.left").font(.title2.weight(.semibold)).frame(width: 44, height: 44)
                }
                Spacer()
                Text(CalendarDates.dayLabel(model.choreDay, calendar: model.calendar))
                    .font(.title3.weight(.semibold))
                Spacer()
                Button {
                    model.setChoreDay(CalendarDates.addDays(model.choreDay, 1, calendar: model.calendar))
                } label: {
                    Image(systemName: "chevron.right").font(.title2.weight(.semibold)).frame(width: 44, height: 44)
                }
            }
            .padding(.horizontal, 8)
            if model.offline {
                OfflineBanner(text: model.offlineDetail.isEmpty ? "Can't reach the calendar server." : model.offlineDetail)
                    .padding(.horizontal, 16)
            }
            List {
                if let board, !board.pendingApprovals.isEmpty {
                    Section("Waiting for a yes") {
                        ForEach(board.pendingApprovals) { item in
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(item.title).font(.headline)
                                    Text("\(item.userName) · \(item.points) stars")
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                Button("Yes") { Task { await model.approve(item.completionId) } }
                                    .buttonStyle(.borderedProminent)
                                    .tint(MantelTheme.ember)
                                Button("No") { Task { await model.reject(item.completionId) } }
                                    .buttonStyle(.bordered)
                            }
                            .font(.headline)
                            .frame(minHeight: 48)
                        }
                    }
                }
                if let board {
                    ForEach(board.people) { person in
                        Section {
                            ForEach(person.chores) { chore in
                                Button {
                                    let done = chore.completion == nil
                                    Task { await model.completeChore(choreId: chore.choreId, userId: person.userId, done: done) }
                                } label: {
                                    HStack(spacing: 12) {
                                        Image(systemName: chore.completion == nil ? "circle" : "checkmark.circle.fill")
                                            .font(.title)
                                            .foregroundStyle(chore.completion == nil ? MantelTheme.line : MantelTheme.ember)
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(chore.title)
                                                .font(.title3.weight(.semibold))
                                                .foregroundStyle(.primary)
                                                .strikethrough(chore.completion != nil)
                                            if chore.points > 0 {
                                                Text("\(chore.points) stars")
                                                    .font(.subheadline)
                                                    .foregroundStyle(.secondary)
                                            }
                                            if chore.completion?.status == "pending" {
                                                Text("Waiting for a yes")
                                                    .font(.subheadline)
                                                    .foregroundStyle(.orange)
                                            }
                                        }
                                        Spacer()
                                    }
                                    .padding(.vertical, 6)
                                }
                                .buttonStyle(.plain)
                            }
                        } header: {
                            HStack {
                                PersonDot(name: person.name, color: person.color, emoji: person.avatarEmoji, size: 32)
                                Text(person.name)
                                Spacer()
                                Label("\(person.stars)", systemImage: "star.fill")
                            }
                            .font(.headline)
                        }
                    }
                } else {
                    Text("No chores for this day.")
                        .foregroundStyle(.secondary)
                }
            }
            .listStyle(.insetGrouped)
        }
        .navigationTitle("Chores")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    NavigationLink("All chores") { AllChoresView() }
                    NavigationLink("Rewards") { RewardsView() }
                    NavigationLink("New chore") { ChoreEditorView(chore: nil) }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .font(.title3)
                        .frame(minWidth: 44, minHeight: 44)
                }
                .accessibilityLabel("More")
            }
        }
        .refreshable { await model.reload(spinner: false) }
    }
}

struct AllChoresView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        List {
            ForEach(model.chores) { chore in
                NavigationLink {
                    ChoreEditorView(chore: chore)
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(chore.title).font(.headline)
                        Text(chore.schedule.capitalized)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                }
            }
        }
        .navigationTitle("All chores")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink {
                    ChoreEditorView(chore: nil)
                } label: {
                    Image(systemName: "plus").frame(minWidth: 44, minHeight: 44)
                }
                .accessibilityLabel("New chore")
            }
        }
    }
}

struct ChoreEditorView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    var chore: ChoreDefinition?

    @State private var title = ""
    @State private var notes = ""
    @State private var points = 1
    @State private var schedule = "daily"
    @State private var weekdays: Set<Int> = []
    @State private var requiresApproval = false
    @State private var assignees: Set<Int> = []
    @State private var error: String?
    @State private var saving = false

    var body: some View {
        Form {
            if let error {
                ErrorBanner(text: error, onDismiss: { error = nil })
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            }
            Section("Chore") {
                TextField("Title", text: $title).font(.title3)
                TextField("Notes", text: $notes, axis: .vertical).lineLimit(2...4)
                Stepper("Stars: \(points)", value: $points, in: 0...50)
                Toggle("Needs a yes first", isOn: $requiresApproval)
            }
            Section("When") {
                Picker("Schedule", selection: $schedule) {
                    Text("Every day").tag("daily")
                    Text("Some days").tag("weekly")
                    Text("Once").tag("once")
                }
                if schedule == "weekly" {
                    ForEach(Array(["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].enumerated()), id: \.offset) { index, label in
                        Toggle(label, isOn: Binding(
                            get: { weekdays.contains(index) },
                            set: { on in if on { weekdays.insert(index) } else { weekdays.remove(index) } }
                        ))
                    }
                }
            }
            Section("Who") {
                ForEach(model.users) { user in
                    Toggle(isOn: Binding(
                        get: { assignees.contains(user.id) },
                        set: { on in if on { assignees.insert(user.id) } else { assignees.remove(user.id) } }
                    )) {
                        HStack {
                            PersonDot(name: user.name, color: user.color, emoji: user.avatarEmoji, size: 28)
                            Text(user.name)
                        }
                    }
                }
            }
            Section {
                WarmButton(title: saving ? "Saving…" : "Save", enabled: !saving) {
                    Task { await save() }
                }
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
                if chore != nil {
                    Button("Delete chore", role: .destructive) {
                        Task {
                            if let message = await model.deleteChore(chore!.id) {
                                error = message
                            } else {
                                dismiss()
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, minHeight: 44)
                }
            }
        }
        .navigationTitle(chore == nil ? "New chore" : "Edit chore")
        .onAppear {
            if let chore {
                title = chore.title
                notes = chore.notes ?? ""
                points = chore.points
                schedule = chore.schedule
                weekdays = Set(chore.weekdays)
                requiresApproval = chore.requiresApproval
                assignees = Set(chore.assigneeIds)
            } else if let first = model.users.first {
                assignees = [first.id]
            }
        }
    }

    private func save() async {
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty { error = "Add a title"; return }
        var body: [String: Any] = [
            "title": name,
            "notes": notes.trimmingCharacters(in: .whitespacesAndNewlines),
            "points": points,
            "schedule": schedule,
            "requires_approval": requiresApproval,
            "assignee_ids": Array(assignees),
        ]
        if schedule == "weekly" { body["weekdays"] = Array(weekdays).sorted() }
        saving = true
        defer { saving = false }
        if let message = await model.saveChore(id: chore?.id, body: body) {
            error = message
        } else {
            dismiss()
        }
    }
}

struct RewardsView: View {
    @Environment(AppModel.self) private var model
    @State private var pick: RewardInfo?

    var body: some View {
        List {
            if let board = model.board, !board.pendingRedemptions.isEmpty {
                Section("Waiting") {
                    ForEach(board.pendingRedemptions) { item in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(item.rewardTitle).font(.headline)
                                Text("\(item.userName) · \(item.pointsSpent) stars")
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button("Given") { Task { await model.fulfill(item.id) } }
                                .buttonStyle(.borderedProminent)
                                .tint(MantelTheme.ember)
                            Button("Send back") { Task { await model.deny(item.id) } }
                                .buttonStyle(.bordered)
                        }
                    }
                }
            }
            Section("Rewards") {
                if let board = model.board {
                    ForEach(board.rewards) { reward in
                        Button {
                            pick = reward
                        } label: {
                            HStack {
                                Text(reward.icon ?? "★")
                                Text(reward.title).font(.headline).foregroundStyle(.primary)
                                Spacer()
                                Text("\(reward.pointsCost) stars").foregroundStyle(.secondary)
                            }
                            .frame(minHeight: 44)
                        }
                    }
                    if board.rewards.isEmpty {
                        Text("No rewards yet. Add them on the wall.")
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .navigationTitle("Rewards")
        .sheet(item: $pick) { reward in
            NavigationStack {
                List(model.users) { user in
                    Button {
                        Task {
                            await model.redeem(rewardId: reward.id, userId: user.id)
                            pick = nil
                        }
                    } label: {
                        HStack {
                            PersonDot(name: user.name, color: user.color, emoji: user.avatarEmoji, size: 36)
                            Text("Give to \(user.name)")
                                .font(.title3.weight(.semibold))
                        }
                        .padding(.vertical, 6)
                    }
                }
                .navigationTitle(reward.title)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button { pick = nil } label: { BackLabel() }
                    }
                }
            }
            .presentationDetents([.medium, .large])
        }
    }
}

