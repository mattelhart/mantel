import Foundation
import SwiftUI
import UIKit

enum Phase: Equatable {
    case loading, address, pair, ready
}

enum PhoneTab: String, CaseIterable, Identifiable, Hashable {
    case home, calendar, messages, chores, lists
    var id: String { rawValue }
    var label: String {
        switch self {
        case .home: "Home"
        case .calendar: "Calendar"
        case .messages: "Messages"
        case .chores: "Chores"
        case .lists: "Lists"
        }
    }
    var systemImage: String {
        switch self {
        case .home: "house.fill"
        case .calendar: "calendar"
        case .messages: "bubble.left.and.bubble.right.fill"
        case .chores: "checkmark.circle.fill"
        case .lists: "checklist"
        }
    }
}

enum CalendarMode: String, CaseIterable, Identifiable {
    case day, week, month
    var id: String { rawValue }
    var label: String {
        switch self {
        case .day: "Day"
        case .week: "Week"
        case .month: "Month"
        }
    }
}


/// Shares the server origin and token with the HTTP client without hopping to the main actor.
final class ConnectionBox: @unchecked Sendable {
    private let lock = NSLock()
    private var _origin = ServerAddress.familyCalOrigin
    private var _token: String?

    var origin: String {
        get { lock.lock(); defer { lock.unlock() }; return _origin }
        set { lock.lock(); _origin = newValue; lock.unlock() }
    }

    var token: String? {
        get { lock.lock(); defer { lock.unlock() }; return _token }
        set { lock.lock(); _token = newValue; lock.unlock() }
    }
}

@MainActor
@Observable
final class AppModel {
    var phase: Phase = .loading
    var message: String?
    var offline = false
    var refreshing = false
    var origin: String? {
        didSet { connection.origin = origin ?? ServerAddress.familyCalOrigin }
    }
    var settings = HouseholdSettings()
    var users: [FamilyMember] = []
    var calendars: [CalInfo] = []
    var events: [CalEvent] = []
    var lists: [SharedList] = []
    var chores: [ChoreDefinition] = []
    var board: ChoreBoard?
    var conversations = ConversationsResponse()
    var photos: [PhotoInfo] = []
    var meals: [String: String] = [:]
    var anchor = Date()
    var choreDay = Date()
    var calendarMode: CalendarMode = .day
    var theme: ThemeChoice = .light
    var hiddenUserIds: Set<Int> = []
    var syncedDetail = "Not synced yet"
    var offlineDetail = ""
    var tab: PhoneTab = .home

    private let store = KeychainStore()
    private let connection = ConnectionBox()
    private var token: String? {
        didSet { connection.token = token }
    }
    private var liveTask: Task<Void, Never>?
    private var pollTask: Task<Void, Never>?
    private var lastEventId: Int64?
    private var sseParser = SseParser()
    private var pairedLinkHandled: String?
    private lazy var client: MantelClient = {
        let box = connection
        return MantelClient(origin: { box.origin }, token: { box.token })
    }()

    var homeZone: TimeZone { CalendarDates.zone(named: settings.homeTimezone) }

    var calendar: Calendar {
        CalendarDates.calendar(for: homeZone, firstDayOfWeek: settings.firstDayOfWeek)
    }

    var visibleEvents: [CalEvent] {
        events.filter { event in
            guard let userId = event.userId else { return true }
            return !hiddenUserIds.contains(userId)
        }
    }

    var writableCalendars: [CalInfo] { calendars.filter(\.writable) }

    init() {
        theme = store.loadTheme()
        token = store.loadToken()
        origin = store.loadOrigin()
        connection.origin = origin ?? ServerAddress.familyCalOrigin
        connection.token = token
        if let saved = store.loadAnchor(), let day = CalendarDates.parseYMD(saved, calendar: Calendar.current) {
            anchor = day
        }
        pairedLinkHandled = store.loadPairedLink()
    }

    func start() {
        Task { await boot() }
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                guard let self, self.phase == .ready else { continue }
                await self.reload()
            }
        }
    }

    func stop() {
        liveTask?.cancel()
        pollTask?.cancel()
    }

    func refresh() {
        Task { await reload(spinner: true) }
    }

    // MARK: - Connection

    func connect(_ raw: String) {
        guard let normalized = ServerAddress.normalize(raw) else {
            message = "Enter an address like 192.168.1.20"
            return
        }
        if !ServerAddress.cleartextPermitted(normalized) {
            phase = .address
            origin = normalized
            message = ServerAddress.publicHTTPMessage
            return
        }
        Task { await connectNormalized(normalized) }
    }

    private func connectNormalized(_ normalized: String) async {
        phase = .loading
        message = nil
        origin = normalized
        do {
            let probe = try await client.probeServer(normalized, timeout: ServerAddress.connectTimeout)
            if probe != .up {
                phase = .address
                message = probe.failureMessage(origin: normalized)
                return
            }
            store.saveOrigin(normalized)
            await enter()
        } catch is CancellationError {
            return
        } catch {
            phase = .address
            message = ServerAddress.unreachableMessage(normalized)
        }
    }

    func pair(code: String) {
        let normalized = ServerAddress.normalizePairCode(code)
        if !ServerAddress.pairCodeComplete(normalized) {
            phase = .pair
            message = "The code is 8 characters, with no 0, O, 1 or I."
            return
        }
        Task { _ = await pairNormalized(normalized) }
    }

    func openPairingLink(_ raw: String, fromExternal: Bool = false) {
        if fromExternal, pairedLinkHandled == raw { return }
        guard let link = ServerAddress.parsePairingLink(raw) else {
            if ServerAddress.pairCodeComplete(raw), origin != nil {
                pair(code: raw)
            } else {
                message = "That QR isn't a Mantel pairing code."
            }
            return
        }
        if !ServerAddress.cleartextPermitted(link.base) {
            phase = .address
            origin = link.base
            message = ServerAddress.publicHTTPMessage
            return
        }
        Task {
            phase = .loading
            message = nil
            origin = link.base
            store.saveOrigin(link.base)
            do {
                let probe = try await client.probeServer(link.base, timeout: ServerAddress.connectTimeout)
                if probe != .up {
                    phase = .address
                    message = probe.failureMessage(origin: link.base)
                    return
                }
                if await pairNormalized(link.code) {
                    pairedLinkHandled = raw
                    store.savePairedLink(raw)
                }
            } catch is CancellationError {
                return
            } catch {
                phase = .address
                message = ServerAddress.unreachableMessage(link.base)
            }
        }
    }

    func editServer() {
        phase = .address
        message = nil
    }

    func forgetServer() {
        origin = nil
        token = nil
        store.clear()
        SnapshotStore.clear()
        liveTask?.cancel()
        users = []; calendars = []; events = []; lists = []; board = nil
        conversations = ConversationsResponse(); photos = []; meals = [:]
        phase = .address
        message = nil
        offline = false
    }

    func dismissMessage() { message = nil }

    func setTheme(_ choice: ThemeChoice) {
        theme = choice
        store.saveTheme(choice)
    }

    func setAnchor(_ day: Date) {
        anchor = calendar.startOfDay(for: day)
        store.saveAnchor(CalendarDates.ymd(anchor, calendar: calendar))
        Task { await reload() }
    }

    func setChoreDay(_ day: Date) {
        choreDay = calendar.startOfDay(for: day)
        Task { await reloadBoard() }
    }

    func toggleUser(_ id: Int) {
        if hiddenUserIds.contains(id) { hiddenUserIds.remove(id) }
        else { hiddenUserIds.insert(id) }
    }

    // MARK: - Boot

    private func boot() async {
        phase = .loading
        message = "Looking for the calendar server…"
        let steps = ServerAddress.probeSchedule(saved: store.loadOrigin())
        var previous: String?
        for step in steps {
            if previous == step.origin {
                try? await Task.sleep(for: .seconds(ServerAddress.probeBackoff))
            }
            previous = step.origin
            do {
                let probe = try await client.probeServer(step.origin, timeout: step.timeout)
                if probe == .up {
                    origin = step.origin
                    store.saveOrigin(step.origin)
                    await enter()
                    return
                }
            } catch is CancellationError {
                return
            } catch {
                continue
            }
        }
        origin = ServerAddress.savedAddressPrefill(store.loadOrigin()).nilIfEmpty
        phase = .address
        message = ServerAddress.discoveryMissMessage(saved: store.loadOrigin())
    }

    private func enter() async {
        do {
            let status = try await client.authStatus()
            if status.authorizationRequired, token == nil || token?.isEmpty == true {
                phase = .pair
                message = nil
                return
            }
            phase = .ready
            message = nil
            await reload(spinner: true)
            startLive()
        } catch let error as MantelError where error.status == 401 {
            token = nil
            store.clearToken()
            phase = .pair
            message = ServerAddress.revokedDeviceMessage()
        } catch let error as MantelError where error.status == 0 {
            applySnapshotIfAny()
            if users.isEmpty && events.isEmpty && lists.isEmpty {
                phase = .address
                message = error.message
            } else {
                phase = .ready
                offline = true
                offlineDetail = error.message
            }
        } catch {
            phase = .address
            message = ServerAddress.unreachableMessage(origin ?? "the calendar server")
        }
    }

    private func pairNormalized(_ code: String) async -> Bool {
        let name = UIDevice.current.name
        do {
            let result = try await client.pair(code: code, name: name)
            token = result.token
            store.saveToken(result.token)
            await enter()
            return phase == .ready
        } catch let error as MantelError {
            phase = .pair
            message = ServerAddress.pairingFailureMessage(status: error.status, serverMessage: error.message)
            return false
        } catch {
            phase = .pair
            message = ServerAddress.unreachableMessage(origin ?? "the calendar server")
            return false
        }
    }

    // MARK: - Reload

    func reload(spinner: Bool = false) async {
        guard origin != nil, phase == .ready || phase == .loading else { return }
        if spinner { refreshing = true }
        defer { refreshing = false }
        do {
            let range = eventFetchRange()
            async let settingsLoad = client.settings()
            async let usersLoad = client.users()
            async let calendarsLoad = client.calendars()
            async let eventsLoad = client.events(start: range.0, end: range.1)
            async let listsLoad = client.lists()
            async let boardLoad = client.choreBoard(on: CalendarDates.ymd(choreDay, calendar: calendar))
            async let choresLoad = client.chores()
            async let conversationsLoad = client.conversations()
            async let photosLoad = client.photos()

            let snap = try await settingsLoad
            settings = snap.household
            users = try await usersLoad
            calendars = try await calendarsLoad
            events = try await eventsLoad
            lists = try await listsLoad
            board = try await boardLoad
            chores = try await choresLoad
            // Unknown numbers are already hidden by the server.
            conversations = try await conversationsLoad
            photos = (try? await photosLoad) ?? photos
            offline = false
            offlineDetail = ""
            syncedDetail = "Updated \(Self.timeFormatter.string(from: Date()))"
            persistSnapshot()
            if phase != .ready { phase = .ready }
        } catch let error as MantelError where error.status == 401 {
            token = nil
            store.clearToken()
            liveTask?.cancel()
            phase = .pair
            message = ServerAddress.revokedDeviceMessage()
        } catch let error as MantelError {
            offline = true
            offlineDetail = error.message
            if users.isEmpty { applySnapshotIfAny() }
            if phase == .loading { phase = .ready }
        } catch is CancellationError {
            return
        } catch {
            offline = true
            offlineDetail = ServerAddress.unreachableMessage(origin ?? "the calendar server")
            applySnapshotIfAny()
            if phase == .loading { phase = .ready }
        }
    }

    private func reloadBoard() async {
        do {
            board = try await client.choreBoard(on: CalendarDates.ymd(choreDay, calendar: calendar))
        } catch let error as MantelError {
            offlineDetail = error.message
        } catch { }
    }

    func reloadConversations() async {
        do {
            conversations = try await client.conversations()
        } catch let error as MantelError {
            offlineDetail = error.message
        } catch { }
    }

    func loadThread(_ id: String) async -> Conversation? {
        do {
            return try await client.conversation(id)
        } catch let error as MantelError {
            message = error.message
            return nil
        } catch {
            message = ServerAddress.unreachableMessage(origin ?? "the calendar server")
            return nil
        }
    }

    func sendMessage(userId: Int, body: String, mediaBase64: String?) async -> String? {
        do {
            _ = try await client.sendMessage(userId: userId, body: body, mediaBase64: mediaBase64)
            await reloadConversations()
            return nil
        } catch let error as MantelError {
            return friendlyFailureText(error.message)
        } catch {
            return ServerAddress.unreachableMessage(origin ?? "the calendar server")
        }
    }

    func eventFetchRange() -> (String, String) {
        let cal = calendar
        let monthStart = cal.date(from: cal.dateComponents([.year, .month], from: anchor)) ?? anchor
        let monthEnd = cal.date(byAdding: .month, value: 1, to: monthStart) ?? monthStart
        // A little padding so week/agenda swipes don't immediately refetch.
        let first = cal.date(byAdding: .day, value: -7, to: monthStart) ?? monthStart
        let last = cal.date(byAdding: .day, value: 7, to: monthEnd) ?? monthEnd
        return CalendarDates.fetchRange(first: first, endExclusive: last, zone: homeZone)
    }

    // MARK: - Events

    func saveEvent(
        existing: CalEvent?,
        title: String,
        location: String,
        description: String,
        startDay: Date,
        endDay: Date,
        allDay: Bool,
        startMinutes: Int,
        endMinutes: Int,
        calendarId: Int,
        repeat choice: RepeatChoice
    ) async -> String? {
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty { return "Add a title" }
        let kind = eventEditKind(existing)
        if kind == .readOnly { return "This calendar is read-only, so it can't be changed here." }
        var chosen = choice
        if chosen.freq == .weekly, chosen.byday.isEmpty {
            chosen.byday = [Recurrence.weekdayCode(for: startDay, calendar: calendar)]
        }
        let rule = Recurrence.build(chosen)
        let start: String
        let end: String
        if allDay {
            (start, end) = CalendarDates.allDaySpan(startDay: startDay, endDay: endDay, calendar: calendar)
        } else {
            (start, end) = CalendarDates.timedRange(day: startDay, startMinutes: startMinutes, endMinutes: endMinutes, zone: homeZone)
        }
        var body: [String: Any] = [
            "title": name,
            "location": location.trimmingCharacters(in: .whitespaces).nilIfEmpty.map { $0 as Any } ?? NSNull(),
            "description": description.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty.map { $0 as Any } ?? NSNull(),
            "start_at": start,
            "end_at": end,
            "all_day": allDay,
        ]
        if kind != .occurrence { body["calendar_id"] = calendarId }
        if !allDay { body["timezone"] = settings.homeTimezone }
        if kind != .occurrence {
            if let rule { body["recurrence_rule"] = rule }
            else if kind == .series { body["recurrence_rule"] = NSNull() }
        }
        do {
            if let existing {
                _ = try await client.updateEvent(id: existing.id, body)
            } else {
                _ = try await client.createEvent(body)
            }
            await reload()
            return nil
        } catch let error as MantelError {
            return error.status == 0 ? "Can't save while the server is unreachable." : error.message
        } catch {
            return "Can't save while the server is unreachable."
        }
    }

    func deleteEvent(_ id: Int) async -> String? {
        do {
            try await client.deleteEvent(id: id)
            await reload()
            return nil
        } catch let error as MantelError {
            return error.status == 0 ? "Can't delete while the server is unreachable." : error.message
        } catch {
            return "Can't delete while the server is unreachable."
        }
    }

    // MARK: - Lists / chores / meals / family / photos

    func toggleItem(listId: Int, itemId: Int, checked: Bool) async {
        do {
            _ = try await client.setItemChecked(listId: listId, itemId: itemId, checked: checked)
            lists = try await client.lists()
        } catch let error as MantelError { message = error.message } catch { }
    }

    func addItem(listId: Int, text: String) async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        do {
            _ = try await client.addItem(listId: listId, text: trimmed)
            lists = try await client.lists()
        } catch let error as MantelError { message = error.message } catch { }
    }

    func deleteItem(listId: Int, itemId: Int) async {
        do {
            try await client.deleteItem(listId: listId, itemId: itemId)
            lists = try await client.lists()
        } catch let error as MantelError { message = error.message } catch { }
    }

    func clearChecked(listId: Int) async {
        do {
            _ = try await client.clearChecked(listId: listId)
            lists = try await client.lists()
        } catch let error as MantelError { message = error.message } catch { }
    }

    func addList(name: String) async {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        do {
            _ = try await client.addList(name: trimmed)
            lists = try await client.lists()
        } catch let error as MantelError { message = error.message } catch { }
    }

    func completeChore(choreId: Int, userId: Int, done: Bool) async {
        do {
            _ = try await client.completeChore(
                choreId: choreId,
                userId: userId,
                on: CalendarDates.ymd(choreDay, calendar: calendar),
                done: done,
                requestId: UUID().uuidString
            )
            await reloadBoard()
        } catch let error as MantelError { message = error.message } catch { }
    }

    func approve(_ completionId: Int) async {
        do {
            _ = try await client.approveChore(completionId: completionId)
            await reloadBoard()
        } catch let error as MantelError { message = error.message } catch { }
    }

    func reject(_ completionId: Int) async {
        do {
            try await client.rejectChore(completionId: completionId)
            await reloadBoard()
        } catch let error as MantelError { message = error.message } catch { }
    }

    func redeem(rewardId: Int, userId: Int) async {
        do {
            _ = try await client.redeem(rewardId: rewardId, userId: userId, requestId: UUID().uuidString)
            await reloadBoard()
        } catch let error as MantelError { message = error.message } catch { }
    }

    func fulfill(_ id: Int) async {
        do {
            _ = try await client.fulfill(redemptionId: id)
            await reloadBoard()
        } catch let error as MantelError { message = error.message } catch { }
    }

    func deny(_ id: Int) async {
        do {
            _ = try await client.deny(redemptionId: id)
            await reloadBoard()
        } catch let error as MantelError { message = error.message } catch { }
    }

    func saveChore(id: Int?, body: [String: Any]) async -> String? {
        do {
            _ = try await client.saveChore(id: id, body: body)
            chores = try await client.chores()
            await reloadBoard()
            return nil
        } catch let error as MantelError { return error.message } catch {
            return ServerAddress.unreachableMessage(origin ?? "the calendar server")
        }
    }

    func deleteChore(_ id: Int) async -> String? {
        do {
            try await client.deleteChore(id: id)
            chores = try await client.chores()
            await reloadBoard()
            return nil
        } catch let error as MantelError { return error.message } catch {
            return ServerAddress.unreachableMessage(origin ?? "the calendar server")
        }
    }

    func loadMeals(around day: Date) async {
        let cal = calendar
        let start = CalendarDates.startOfWeek(day, calendar: cal)
        let end = cal.date(byAdding: .day, value: 6, to: start) ?? start
        do {
            meals = try await client.mealPlan(
                start: CalendarDates.ymd(start, calendar: cal),
                end: CalendarDates.ymd(end, calendar: cal)
            )
        } catch let error as MantelError { message = error.message } catch { }
    }

    func saveMeal(day: Date, meal: String, title: String) async {
        do {
            try await client.saveMeal(day: CalendarDates.ymd(day, calendar: calendar), meal: meal, title: title)
            await loadMeals(around: day)
        } catch let error as MantelError { message = error.message } catch { }
    }

    func saveMember(existing: FamilyMember?, name: String, color: String, emoji: String, phone: String) async -> String? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return "Add a name" }
        let phoneValue = phone.trimmingCharacters(in: .whitespacesAndNewlines)
        let emojiValue = emoji.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            if let existing {
                _ = try await client.updateUser(
                    id: existing.id,
                    name: trimmed,
                    color: color,
                    emoji: emojiValue,
                    phone: phoneValue
                )
            } else {
                _ = try await client.createUser(
                    name: trimmed,
                    color: color,
                    emoji: emojiValue.nilIfEmpty,
                    phone: phoneValue.nilIfEmpty
                )
            }
            users = try await client.users()
            return nil
        } catch let error as MantelError { return error.message } catch {
            return ServerAddress.unreachableMessage(origin ?? "the calendar server")
        }
    }

    func deleteMember(_ id: Int) async -> String? {
        do {
            try await client.deleteUser(id: id)
            users = try await client.users()
            return nil
        } catch let error as MantelError { return error.message } catch {
            return ServerAddress.unreachableMessage(origin ?? "the calendar server")
        }
    }

    func reloadPhotos() async {
        do { photos = try await client.photos() } catch { }
    }

    func uploadPhoto(data: Data, filename: String, mime: String) async -> String? {
        do {
            _ = try await client.uploadPhoto(data: data, filename: filename, mime: mime)
            await reloadPhotos()
            return nil
        } catch let error as MantelError { return error.message } catch {
            return ServerAddress.unreachableMessage(origin ?? "the calendar server")
        }
    }

    func deletePhoto(_ id: Int) async {
        do {
            try await client.deletePhoto(id: id)
            await reloadPhotos()
        } catch let error as MantelError { message = error.message } catch { }
    }

    func createPairingCode() async -> Result<PairingCode, String> {
        let base = origin ?? ServerAddress.familyCalOrigin
        do {
            return .success(try await client.createPairingCode(baseURL: base))
        } catch let error as MantelError {
            return .failure(error.message)
        } catch {
            return .failure(ServerAddress.unreachableMessage(base))
        }
    }

    func loadHomeSetup() async -> HomeSetup? {
        try? await client.settings().homeSetup
    }

    func saveHomeConnection(baseURL: String?, token: String?, clearToken: Bool) async -> String? {
        do {
            try await client.saveHomeConnection(baseURL: baseURL, token: token, clearToken: clearToken)
            return nil
        } catch let error as MantelError { return error.message } catch {
            return ServerAddress.unreachableMessage(origin ?? "the calendar server")
        }
    }

    func testHome() async -> HomeTestResult? {
        try? await client.testHome()
    }

    func loadHome() async -> HomeSnapshot? {
        do { return try await client.home() }
        catch let error as MantelError {
            return HomeSnapshot(status: "unreachable", message: error.message, rooms: [], actions: [])
        } catch {
            return HomeSnapshot(status: "unreachable", message: ServerAddress.unreachableMessage(origin ?? "the calendar server"), rooms: [], actions: [])
        }
    }

    func homeAction(entityId: String, action: String, value: Int? = nil, confirm: Bool = false) async -> String? {
        do {
            try await client.homeAction(entityId: entityId, action: action, value: value, confirm: confirm)
            return nil
        } catch let error as MantelError { return error.message } catch {
            return ServerAddress.unreachableMessage(origin ?? "the calendar server")
        }
    }

    func displays() async -> [DisplayTarget] {
        (try? await client.displays()) ?? []
    }

    func showOnDisplay(id: String, destination: String) async -> String? {
        do {
            try await client.showOnDisplay(id: id, destination: destination)
            return nil
        } catch let error as MantelError { return error.message } catch {
            return ServerAddress.unreachableMessage(origin ?? "the calendar server")
        }
    }

    func loadImage(path: String) async -> Data? {
        try? await client.authenticatedData(at: path).0
    }

    func mediaURL(_ path: String?) -> URL? {
        guard let path else { return nil }
        return /* handled by AuthedImage */ URL(string: path)
    }

    // MARK: - Live

    private func startLive() {
        liveTask?.cancel()
        liveTask = Task { [weak self] in
            var attempt = 0
            while !Task.isCancelled {
                guard let self, self.phase == .ready else {
                    try? await Task.sleep(for: .seconds(2))
                    continue
                }
                do {
                    self.sseParser.reset()
                    try await self.client.listen(lastId: self.lastEventId) { line in
                        Task { @MainActor in
                            guard let self else { return }
                            for message in self.sseParser.feed(line) {
                                switch message {
                                case .hello(let id), .resync(let id):
                                    self.lastEventId = id ?? self.lastEventId
                                    await self.reload()
                                case .change(let id, _):
                                    self.lastEventId = id ?? self.lastEventId
                                    await self.reload()
                                }
                            }
                        }
                    }
                    attempt = 0
                } catch is CancellationError {
                    return
                } catch {
                    attempt += 1
                    let delay = reconnectDelay(attempt: attempt)
                    try? await Task.sleep(for: .seconds(delay))
                }
            }
        }
    }

    // MARK: - Snapshot

    private func persistSnapshot() {
        let snap = CacheBox(settings: settings, users: users, calendars: calendars, events: events, lists: lists, board: board, conversations: conversations)
        if let data = try? JSONEncoder().encode(snap) {
            SnapshotStore.save(data, name: "phone.json")
        }
    }

    private func applySnapshotIfAny() {
        guard let data = SnapshotStore.load("phone.json"),
              let snap = try? JSONDecoder().decode(CacheBox.self, from: data)
        else { return }
        settings = snap.settings
        users = snap.users
        calendars = snap.calendars
        events = snap.events
        lists = snap.lists
        board = snap.board
        conversations = snap.conversations
        offline = true
        if offlineDetail.isEmpty {
            offlineDetail = ServerAddress.unreachableMessage(origin ?? "the calendar server")
        }
    }

    private static let timeFormatter: DateFormatter = {
        let f = DateFormatter()
        f.timeStyle = .short
        f.dateStyle = .none
        return f
    }()
}

private struct CacheBox: Codable {
    var settings: HouseholdSettings
    var users: [FamilyMember]
    var calendars: [CalInfo]
    var events: [CalEvent]
    var lists: [SharedList]
    var board: ChoreBoard?
    var conversations: ConversationsResponse
}


extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}

