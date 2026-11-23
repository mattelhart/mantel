import Foundation

/// HTTP calls a Mantel phone makes. The app keeps the token and server address.
actor MantelClient {
    private let session: URLSession
    private let origin: @Sendable () -> String
    private let token: @Sendable () -> String?

    init(origin: @escaping @Sendable () -> String, token: @escaping @Sendable () -> String?) {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 30
        config.waitsForConnectivity = false
        self.session = URLSession(configuration: config)
        self.origin = origin
        self.token = token
    }

    // MARK: - Probe

    func probeServer(_ base: String, timeout: TimeInterval = ServerAddress.connectTimeout) async throws -> ServerProbe {
        guard let url = URL(string: base.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/api/health") else {
            return .down
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = timeout
        request.httpMethod = "GET"
        do {
            let (_, response) = try await session.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            return (200...299).contains(status) ? .up : .unhealthy(status)
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            return .down
        }
    }

    // MARK: - Auth

    func authStatus() async throws -> AuthStatus {
        try await get("/auth/status")
    }

    func pair(code: String, name: String) async throws -> PairResult {
        let body: [String: Any] = [
            "code": code.trimmingCharacters(in: .whitespaces),
            "name": name.trimmingCharacters(in: .whitespaces).isEmpty ? "iPhone" : name.trimmingCharacters(in: .whitespaces),
        ]
        return try await send(method: "POST", path: "/auth/pair", body: body, authenticate: false, expected: 201)
    }

    func createPairingCode(baseURL: String) async throws -> PairingCode {
        let encoded = baseURL.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? baseURL
        return try await send(method: "POST", path: "/auth/pairing-codes?base_url=\(encoded)", body: [:])
    }

    func settings() async throws -> SettingsSnapshot {
        try await get("/settings")
    }

    // MARK: - Home Assistant

    func saveHomeConnection(baseURL: String?, token haToken: String?, clearToken: Bool) async throws {
        var body: [String: Any] = [:]
        if let baseURL { body["ha_base_url"] = baseURL.trimmingCharacters(in: .whitespaces) }
        if clearToken {
            body["ha_token"] = NSNull()
        } else if let haToken, !haToken.trimmingCharacters(in: .whitespaces).isEmpty {
            body["ha_token"] = haToken.trimmingCharacters(in: .whitespaces)
        }
        let _: [String: AnyCodableValue] = try await send(method: "PATCH", path: "/settings", body: body)
    }

    func testHome() async throws -> HomeTestResult {
        try await send(method: "POST", path: "/home/test", body: [:])
    }

    func home() async throws -> HomeSnapshot {
        try await get("/home")
    }

    func homeAction(entityId: String, action: String, value: Int?, confirm: Bool) async throws {
        var body: [String: Any] = ["action": action, "confirm": confirm]
        if let value { body["value"] = value }
        let encoded = entityId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? entityId
        let _: [String: AnyCodableValue] = try await send(method: "POST", path: "/home/entities/\(encoded)/action", body: body)
    }

    // MARK: - Family / calendar

    func users() async throws -> [FamilyMember] { try await get("/users") }

    func createUser(name: String, color: String?, emoji: String?, phone: String?) async throws -> FamilyMember {
        var body: [String: Any] = ["name": name]
        if let color { body["color"] = color }
        if let emoji { body["avatar_emoji"] = emoji }
        if let phone { body["phone"] = phone }
        return try await send(method: "POST", path: "/users", body: body, expected: 201)
    }

    func updateUser(id: Int, name: String?, color: String?, emoji: String?, phone: String?) async throws -> FamilyMember {
        var body: [String: Any] = [:]
        if let name { body["name"] = name }
        if let color { body["color"] = color }
        if let emoji { body["avatar_emoji"] = emoji.isEmpty ? NSNull() : emoji }
        if let phone { body["phone"] = phone.isEmpty ? NSNull() : phone }
        return try await send(method: "PATCH", path: "/users/\(id)", body: body)
    }

    func deleteUser(id: Int) async throws {
        try await sendEmpty(method: "DELETE", path: "/users/\(id)")
    }

    func calendars() async throws -> [CalInfo] { try await get("/calendars") }

    func events(start: String, end: String) async throws -> [CalEvent] {
        try await get("/events", query: ["start": start, "end": end])
    }

    func createEvent(_ body: [String: Any]) async throws -> CalEvent {
        try await send(method: "POST", path: "/events", body: body)
    }

    func updateEvent(id: Int, _ body: [String: Any]) async throws -> CalEvent {
        try await send(method: "PATCH", path: "/events/\(id)", body: body)
    }

    func deleteMessage(id: Int) async throws {
        try await sendEmpty(method: "DELETE", path: "/messages/\(id)")
    }

    func deleteEvent(id: Int) async throws {
        try await sendEmpty(method: "DELETE", path: "/events/\(id)")
    }

    // MARK: - Meals / displays

    func mealPlan(start: String, end: String) async throws -> [String: String] {
        try await get("/meals", query: ["start": start, "end": end])
    }

    func saveMeal(day: String, meal: String, title: String) async throws {
        let _: [String: AnyCodableValue] = try await send(
            method: "POST",
            path: "/meals",
            body: ["day": day, "meal": meal, "title": title]
        )
    }

    func displays() async throws -> [DisplayTarget] { try await get("/displays") }

    func showOnDisplay(id: String, destination: String) async throws {
        let _: [String: AnyCodableValue] = try await send(
            method: "POST",
            path: "/displays/\(id)/show",
            body: ["destination": destination]
        )
    }

    // MARK: - Lists

    func lists() async throws -> [SharedList] { try await get("/lists") }

    func setItemChecked(listId: Int, itemId: Int, checked: Bool) async throws -> ListItem {
        try await send(method: "PATCH", path: "/lists/\(listId)/items/\(itemId)", body: ["checked": checked])
    }

    func addItem(listId: Int, text: String) async throws -> ListItem {
        try await send(method: "POST", path: "/lists/\(listId)/items", body: ["text": text])
    }

    func addList(name: String) async throws -> SharedList {
        try await send(method: "POST", path: "/lists", body: ["name": name])
    }

    func deleteItem(listId: Int, itemId: Int) async throws {
        try await sendEmpty(method: "DELETE", path: "/lists/\(listId)/items/\(itemId)")
    }

    func clearChecked(listId: Int) async throws -> SharedList {
        try await send(method: "POST", path: "/lists/\(listId)/clear-checked", body: [:])
    }

    func renameList(id: Int, name: String) async throws -> SharedList {
        try await send(method: "PATCH", path: "/lists/\(id)", body: ["name": name])
    }

    func deleteList(id: Int) async throws {
        try await sendEmpty(method: "DELETE", path: "/lists/\(id)")
    }

    func renameItem(listId: Int, itemId: Int, text: String) async throws -> ListItem {
        try await send(method: "PATCH", path: "/lists/\(listId)/items/\(itemId)", body: ["text": text])
    }

    // MARK: - Chores

    func chores() async throws -> [ChoreDefinition] { try await get("/chores") }

    func saveChore(id: Int?, body: [String: Any]) async throws -> ChoreDefinition {
        if let id {
            return try await send(method: "PATCH", path: "/chores/\(id)", body: body)
        }
        return try await send(method: "POST", path: "/chores", body: body)
    }

    func deleteChore(id: Int) async throws {
        try await sendEmpty(method: "DELETE", path: "/chores/\(id)")
    }

    func choreBoard(on: String?) async throws -> ChoreBoard {
        if let on {
            return try await get("/chores/board", query: ["on": on])
        }
        return try await get("/chores/board")
    }

    func completeChore(choreId: Int, userId: Int, on: String, done: Bool, requestId: String?) async throws -> CompleteResult {
        var body: [String: Any] = ["user_id": userId, "on": on, "done": done]
        if let requestId { body["request_id"] = requestId }
        return try await send(method: "POST", path: "/chores/\(choreId)/complete", body: body)
    }

    func approveChore(completionId: Int) async throws -> ChoreCompletion {
        try await send(method: "POST", path: "/chores/completions/\(completionId)/approve", body: [:])
    }

    func rejectChore(completionId: Int) async throws {
        try await sendEmpty(method: "POST", path: "/chores/completions/\(completionId)/reject", body: [:])
    }

    func redeem(rewardId: Int, userId: Int, requestId: String?) async throws -> RedemptionInfo {
        var body: [String: Any] = ["user_id": userId]
        if let requestId { body["request_id"] = requestId }
        return try await send(method: "POST", path: "/rewards/\(rewardId)/redeem", body: body)
    }

    func fulfill(redemptionId: Int) async throws -> RedemptionInfo {
        try await send(method: "POST", path: "/redemptions/\(redemptionId)/fulfill", body: [:])
    }

    func deny(redemptionId: Int) async throws -> RedemptionInfo {
        try await send(method: "POST", path: "/redemptions/\(redemptionId)/deny", body: [:])
    }

    // MARK: - Messages

    func conversations() async throws -> ConversationsResponse {
        try await get("/messages/conversations")
    }

    func conversation(_ id: String) async throws -> Conversation {
        let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        return try await get("/messages/conversations/\(encoded)")
    }

    func sendMessage(userId: Int, body: String, mediaBase64: String?, requestId: String = UUID().uuidString) async throws -> FamilyMessage {
        var payload: [String: Any] = ["user_id": userId, "body": body, "request_id": requestId]
        if let mediaBase64 { payload["media_base64"] = mediaBase64 }
        return try await send(method: "POST", path: "/messages", body: payload, expected: 201)
    }

    // MARK: - Photos

    func photos() async throws -> [PhotoInfo] { try await get("/photos") }

    func uploadPhoto(data: Data, filename: String, mime: String) async throws -> PhotoInfo {
        let path = url("/photos")
        var request = URLRequest(url: path)
        request.httpMethod = "POST"
        request.timeoutInterval = 60
        auth(&request)
        let boundary = "mantel-\(UUID().uuidString)"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        var body = Data()
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"file\"; filename=\"\(filename)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: \(mime)\r\n\r\n".data(using: .utf8)!)
        body.append(data)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        request.httpBody = body
        return try await read(request, expected: 201)
    }

    func deletePhoto(id: Int) async throws {
        try await sendEmpty(method: "DELETE", path: "/photos/\(id)")
    }

    /// Absolute URL for a relative media path, with a bearer token header preferred by callers.
    func resolve(_ path: String) -> URL? {
        if path.hasPrefix("http://") || path.hasPrefix("https://") { return URL(string: path) }
        let base = origin().trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        if path.hasPrefix("/") { return URL(string: base + path) }
        return URL(string: base + "/api/" + path)
    }

    func authenticatedData(at path: String) async throws -> (Data, String?) {
        guard let url = resolve(path) else {
            throw MantelError(code: "error", message: "That picture could not be loaded.", status: 0)
        }
        var request = URLRequest(url: url)
        auth(&request)
        do {
            let (data, response) = try await session.data(for: request)
            let http = response as? HTTPURLResponse
            let status = http?.statusCode ?? 0
            if !(200...299).contains(status) {
                throw await decodeError(data, status: status)
            }
            return (data, http?.mimeType)
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as MantelError {
            throw error
        } catch {
            throw MantelError.unreachable(origin())
        }
    }

    // MARK: - Live

    /// Blocks until the stream ends. Callers reconnect after a short delay.
    func listen(lastId: Int64?, onLine: @escaping @Sendable (String) -> Void) async throws {
        var request = URLRequest(url: url("/live"))
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        if let lastId {
            request.setValue(String(lastId), forHTTPHeaderField: "Last-Event-ID")
        }
        request.timeoutInterval = 60
        auth(&request)
        do {
            let (bytes, response) = try await session.bytes(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if !(200...299).contains(status) {
                throw MantelError(code: "error", message: "The calendar could not do that", status: status)
            }
            for try await line in bytes.lines {
                onLine(line)
            }
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as MantelError {
            throw error
        } catch {
            throw MantelError.unreachable(origin())
        }
    }

    // MARK: - Transport

    private func get<T: Decodable>(_ path: String, query: [String: String] = [:]) async throws -> T {
        var request = URLRequest(url: url(path, query: query))
        request.httpMethod = "GET"
        auth(&request)
        return try await read(request)
    }

    private func send<T: Decodable>(
        method: String,
        path: String,
        body: [String: Any],
        authenticate: Bool = true,
        expected: Int? = nil
    ) async throws -> T {
        var request = URLRequest(url: url(path))
        request.httpMethod = method
        if authenticate { auth(&request) }
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        return try await read(request, expected: expected)
    }

    private func sendEmpty(method: String, path: String, body: [String: Any]? = nil) async throws {
        var request = URLRequest(url: url(path))
        request.httpMethod = method
        auth(&request)
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let _: EmptyValue = try await read(request, allowEmpty: true)
    }

    private func read<T: Decodable>(_ request: URLRequest, expected: Int? = nil, allowEmpty: Bool = false) async throws -> T {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw MantelError.unreachable(origin())
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 204 || (allowEmpty && data.isEmpty && (200...299).contains(status)) {
            if T.self == EmptyValue.self, let empty = EmptyValue() as? T { return empty }
        }
        if !(200...299).contains(status) {
            throw await decodeError(data, status: status)
        }
        if T.self == EmptyValue.self, let empty = EmptyValue() as? T { return empty }
        do {
            return try Self.decoder.decode(T.self, from: data)
        } catch {
            throw MantelError(code: "error", message: "The calendar sent a reply this app could not read.", status: status)
        }
    }

    private func decodeError(_ data: Data, status: Int) -> MantelError {
        if let envelope = try? Self.decoder.decode(ErrorEnvelope.self, from: data) {
            let message = envelope.error?.message ?? envelope.detail?.message ?? "The calendar could not do that"
            let code = envelope.error?.code ?? "error"
            return MantelError(code: code, message: message, status: status)
        }
        if let text = String(data: data, encoding: .utf8), !text.isEmpty, text.count < 240 {
            return MantelError(code: "error", message: text, status: status)
        }
        return MantelError(code: "error", message: "The calendar could not do that", status: status)
    }

    private func auth(_ request: inout URLRequest) {
        if let token = token(), !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
    }

    private func url(_ path: String, query: [String: String] = [:]) -> URL {
        var absolute = origin().trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/api" + path
        if !query.isEmpty {
            var bits: [String] = []
            for (key, value) in query {
                let enc = value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? value
                bits.append("\(key)=\(enc)")
            }
            absolute += (path.contains("?") ? "&" : "?") + bits.joined(separator: "&")
        }
        return URL(string: absolute) ?? URL(string: "http://127.0.0.1/api/health")!
    }

    static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }()
}

/// Placeholder for 204 / empty bodies.
struct EmptyValue: Decodable {}

/// Loose JSON object for endpoints that return a generic map.
enum AnyCodableValue: Decodable {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
    case object([String: AnyCodableValue])
    case array([AnyCodableValue])
    case null

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null; return }
        if let v = try? c.decode(Bool.self) { self = .bool(v); return }
        if let v = try? c.decode(Int.self) { self = .int(v); return }
        if let v = try? c.decode(Double.self) { self = .double(v); return }
        if let v = try? c.decode(String.self) { self = .string(v); return }
        if let v = try? c.decode([String: AnyCodableValue].self) { self = .object(v); return }
        if let v = try? c.decode([AnyCodableValue].self) { self = .array(v); return }
        self = .null
    }
}
