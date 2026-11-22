import Foundation

struct ErrorEnvelope: Decodable {
    var error: ErrorDetail?
    var detail: DetailValue?
}

struct ErrorDetail: Decodable {
    var code: String?
    var message: String?
}

enum DetailValue: Decodable {
    case text(String)
    case object([String: String])
    case other

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let text = try? c.decode(String.self) {
            self = .text(text)
            return
        }
        if let obj = try? c.decode([String: String].self) {
            self = .object(obj)
            return
        }
        self = .other
    }

    var message: String? {
        switch self {
        case .text(let text): text
        case .object(let obj): obj["message"] ?? obj["msg"]
        case .other: nil
        }
    }
}

struct MantelError: Error, LocalizedError, Equatable {
    var code: String
    var message: String
    var status: Int

    var errorDescription: String? { message }

    static func unreachable(_ origin: String) -> MantelError {
        MantelError(code: "unreachable", message: ServerAddress.unreachableMessage(origin), status: 0)
    }
}

struct AuthStatus: Decodable, Equatable {
    var authMode: String = "lan"
    var networkTrusted: Bool = false
    var authorizationRequired: Bool = false
}

struct DeviceInfo: Decodable, Equatable, Identifiable {
    var id: Int
    var name: String
    var tokenPrefix: String = ""
    var createdAt: String = ""
    var lastUsedAt: String?
}

struct PairResult: Decodable {
    var token: String
    var tokenType: String = "bearer"
    var device: DeviceInfo
}

struct HouseholdSettings: Codable, Equatable {
    var firstDayOfWeek: Int = 0
    var timeFormat24h: Bool = false
    var homeTimezone: String = "UTC"
}

struct FamilyMember: Codable, Equatable, Identifiable, Hashable {
    var id: Int
    var name: String
    var color: String = "#3b82f6"
    var avatarEmoji: String?
    var sortOrder: Int = 0
    var phone: String?
}

struct CalInfo: Codable, Equatable, Identifiable, Hashable {
    var id: Int
    var name: String
    var color: String = "#3b82f6"
    var claimedByUserId: Int?
    var writable: Bool = false
}

struct CalEvent: Codable, Equatable, Identifiable, Hashable {
    var id: Int
    var calendarId: Int
    var calendarName: String = ""
    var color: String = "#3b82f6"
    var userId: Int?
    var title: String
    var description: String?
    var location: String?
    var startAt: String
    var endAt: String
    var allDay: Bool = false
    var timezone: String?
    var recurring: Bool = false
    var recurrenceRule: String?
    var recurrenceText: String?
    var origin: String = "local"
    var syncState: String = "synced"
    var editable: Bool = true
}

struct ListItem: Codable, Equatable, Identifiable, Hashable {
    var id: Int
    var listId: Int
    var text: String
    var checked: Bool = false
    var color: String?
}

struct SharedList: Codable, Equatable, Identifiable, Hashable {
    var id: Int
    var name: String
    var icon: String?
    var itemCount: Int = 0
    var items: [ListItem] = []
}

struct ChoreCompletion: Codable, Equatable, Identifiable, Hashable {
    var id: Int
    var choreId: Int
    var userId: Int
    var on: String
    var status: String
    var pointsAwarded: Int = 0
}

struct BoardChore: Codable, Equatable, Identifiable, Hashable {
    var choreId: Int
    var title: String
    var icon: String?
    var points: Int = 0
    var requiresApproval: Bool = false
    var completion: ChoreCompletion?

    var id: Int { choreId }
}

struct PersonBoard: Codable, Equatable, Identifiable, Hashable {
    var userId: Int
    var name: String
    var color: String = "#3b82f6"
    var avatarEmoji: String?
    var stars: Int = 0
    var chores: [BoardChore] = []

    var id: Int { userId }
}

struct RewardInfo: Codable, Equatable, Identifiable, Hashable {
    var id: Int
    var title: String
    var pointsCost: Int
    var icon: String?
}

struct RedemptionInfo: Codable, Equatable, Identifiable, Hashable {
    var id: Int
    var rewardId: Int
    var rewardTitle: String
    var userId: Int
    var userName: String
    var color: String = "#3b82f6"
    var pointsSpent: Int
    var status: String
}

struct PendingApproval: Codable, Equatable, Identifiable, Hashable {
    var completionId: Int
    var choreId: Int
    var title: String
    var userId: Int
    var userName: String
    var color: String = "#3b82f6"
    var points: Int
    var on: String

    var id: Int { completionId }
}

struct ChoreBoard: Codable, Equatable {
    var on: String
    var people: [PersonBoard] = []
    var rewards: [RewardInfo] = []
    var pendingRedemptions: [RedemptionInfo] = []
    var pendingApprovals: [PendingApproval] = []
}

struct CompleteResult: Decodable {
    var completion: ChoreCompletion?
}

struct ChoreDefinition: Decodable, Equatable, Identifiable, Hashable {
    var id: Int
    var title: String
    var notes: String?
    var points: Int = 0
    var schedule: String = "daily"
    var weekdays: [Int] = []
    var dueOn: String?
    var requiresApproval: Bool = false
    var icon: String?
    var assigneeIds: [Int] = []
}

struct DisplayTarget: Decodable, Equatable, Identifiable, Hashable {
    var id: String
    var name: String
}

struct PairingCode: Decodable, Equatable {
    var code: String
    var expiresAt: String
    var qrPayload: String = ""
}

struct HomeSetup: Decodable, Equatable {
    var haBaseUrl: String = ""
    var server: HomeSetupServer = .init()
}

struct HomeSetupServer: Decodable, Equatable {
    var haTokenSet: Bool = false
}

struct HomeTestResult: Decodable, Equatable {
    var ok: Bool = false
    var status: String = ""
    var message: String = ""
}

struct HomeEntity: Decodable, Equatable, Identifiable, Hashable {
    var entityId: String
    var domain: String
    var name: String
    var state: String = ""
    var available: Bool = true
    var on: Bool?
    var level: Int?
    var adjustable: Bool = false

    var id: String { entityId }
}

struct HomeRoom: Decodable, Equatable, Identifiable, Hashable {
    var areaId: String?
    var name: String = ""
    var entities: [HomeEntity] = []

    var id: String { areaId ?? name }
}

struct HomeSnapshot: Decodable, Equatable {
    var status: String = "ok"
    var message: String = ""
    var rooms: [HomeRoom] = []
    var actions: [HomeEntity] = []
}

struct FamilyMessage: Codable, Equatable, Identifiable, Hashable {
    var id: Int
    var userId: Int?
    var phone: String = ""
    var direction: String = "out"
    var body: String?
    var mediaUrl: String?
    var mediaContentType: String?
    var status: String = ""
    var errorMessage: String?
    var createdAt: String?

    var isIncoming: Bool { direction == "in" }
    var hasPicture: Bool { mediaUrl != nil }
}

struct Conversation: Codable, Equatable, Identifiable, Hashable {
    var id: String
    var userId: Int?
    var name: String
    var phone: String?
    var color: String = "#3b82f6"
    var avatarEmoji: String?
    var unknown: Bool = false
    var lastMessage: FamilyMessage?
    var canSend: Bool?
    var messages: [FamilyMessage]?
}

struct ConversationsResponse: Codable, Equatable {
    var configured: Bool = false
    var fromNumber: String = ""
    var quickReplies: [String] = ["Dinner's ready", "Call me", "On my way?"]
    var conversations: [Conversation] = []
}

struct PhotoInfo: Decodable, Equatable, Identifiable, Hashable {
    var id: Int
    var originalName: String?
    var width: Int = 0
    var height: Int = 0
    var sizeBytes: Int = 0
    var sortOrder: Int = 0
    var url: String = ""
}

struct SettingsSnapshot: Decodable {
    var firstDayOfWeek: Int = 0
    var timeFormat24h: Bool = false
    var homeTimezone: String = "UTC"
    var haBaseUrl: String = ""
    var server: HomeSetupServer = .init()

    var household: HouseholdSettings {
        HouseholdSettings(
            firstDayOfWeek: firstDayOfWeek,
            timeFormat24h: timeFormat24h,
            homeTimezone: homeTimezone
        )
    }

    var homeSetup: HomeSetup {
        HomeSetup(haBaseUrl: haBaseUrl, server: server)
    }
}
