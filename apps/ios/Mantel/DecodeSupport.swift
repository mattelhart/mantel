import Foundation

extension KeyedDecodingContainer {
    func value<T: Decodable>(_ type: T.Type, _ key: Key, _ fallback: T) throws -> T {
        try decodeIfPresent(type, forKey: key) ?? fallback
    }
}

extension AuthStatus {
    enum CodingKeys: String, CodingKey {
        case authMode, networkTrusted, authorizationRequired
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        authMode = try c.value(String.self, .authMode, "lan")
        networkTrusted = try c.value(Bool.self, .networkTrusted, false)
        authorizationRequired = try c.value(Bool.self, .authorizationRequired, false)
    }
}

extension PairResult {
    enum CodingKeys: String, CodingKey { case token, tokenType, device }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        token = try c.decode(String.self, forKey: .token)
        tokenType = try c.value(String.self, .tokenType, "bearer")
        device = try c.decode(DeviceInfo.self, forKey: .device)
    }
}

extension DeviceInfo {
    enum CodingKeys: String, CodingKey { case id, name, tokenPrefix, createdAt, lastUsedAt }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        tokenPrefix = try c.value(String.self, .tokenPrefix, "")
        createdAt = try c.value(String.self, .createdAt, "")
        lastUsedAt = try c.decodeIfPresent(String.self, forKey: .lastUsedAt)
    }
}

extension HouseholdSettings {
    enum CodingKeys: String, CodingKey { case firstDayOfWeek, timeFormat24h, homeTimezone }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        firstDayOfWeek = try c.value(Int.self, .firstDayOfWeek, 0)
        timeFormat24h = try c.value(Bool.self, .timeFormat24h, false)
        homeTimezone = try c.value(String.self, .homeTimezone, "UTC")
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(firstDayOfWeek, forKey: .firstDayOfWeek)
        try c.encode(timeFormat24h, forKey: .timeFormat24h)
        try c.encode(homeTimezone, forKey: .homeTimezone)
    }
}

extension SettingsSnapshot {
    enum CodingKeys: String, CodingKey { case firstDayOfWeek, timeFormat24h, homeTimezone, haBaseUrl, server }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        firstDayOfWeek = try c.value(Int.self, .firstDayOfWeek, 0)
        timeFormat24h = try c.value(Bool.self, .timeFormat24h, false)
        homeTimezone = try c.value(String.self, .homeTimezone, "UTC")
        haBaseUrl = try c.value(String.self, .haBaseUrl, "")
        server = try c.decodeIfPresent(HomeSetupServer.self, forKey: .server) ?? HomeSetupServer()
    }
}

extension FamilyMember {
    enum CodingKeys: String, CodingKey { case id, name, color, avatarEmoji, sortOrder, phone }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        color = try c.value(String.self, .color, "#3b82f6")
        avatarEmoji = try c.decodeIfPresent(String.self, forKey: .avatarEmoji)
        sortOrder = try c.value(Int.self, .sortOrder, 0)
        phone = try c.decodeIfPresent(String.self, forKey: .phone)
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(name, forKey: .name)
        try c.encode(color, forKey: .color)
        try c.encodeIfPresent(avatarEmoji, forKey: .avatarEmoji)
        try c.encode(sortOrder, forKey: .sortOrder)
        try c.encodeIfPresent(phone, forKey: .phone)
    }
}

extension CalInfo {
    enum CodingKeys: String, CodingKey { case id, name, color, claimedByUserId, writable }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        color = try c.value(String.self, .color, "#3b82f6")
        claimedByUserId = try c.decodeIfPresent(Int.self, forKey: .claimedByUserId)
        writable = try c.value(Bool.self, .writable, false)
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(name, forKey: .name)
        try c.encode(color, forKey: .color)
        try c.encodeIfPresent(claimedByUserId, forKey: .claimedByUserId)
        try c.encode(writable, forKey: .writable)
    }
}

extension CalEvent {
    enum CodingKeys: String, CodingKey {
        case id, calendarId, calendarName, color, userId, title, description, location
        case startAt, endAt, allDay, timezone, recurring, recurrenceRule, recurrenceText
        case origin, syncState, editable
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        calendarId = try c.decode(Int.self, forKey: .calendarId)
        calendarName = try c.value(String.self, .calendarName, "")
        color = try c.value(String.self, .color, "#3b82f6")
        userId = try c.decodeIfPresent(Int.self, forKey: .userId)
        title = try c.decode(String.self, forKey: .title)
        description = try c.decodeIfPresent(String.self, forKey: .description)
        location = try c.decodeIfPresent(String.self, forKey: .location)
        startAt = try c.decode(String.self, forKey: .startAt)
        endAt = try c.decode(String.self, forKey: .endAt)
        allDay = try c.value(Bool.self, .allDay, false)
        timezone = try c.decodeIfPresent(String.self, forKey: .timezone)
        recurring = try c.value(Bool.self, .recurring, false)
        recurrenceRule = try c.decodeIfPresent(String.self, forKey: .recurrenceRule)
        recurrenceText = try c.decodeIfPresent(String.self, forKey: .recurrenceText)
        origin = try c.value(String.self, .origin, "local")
        syncState = try c.value(String.self, .syncState, "synced")
        editable = try c.value(Bool.self, .editable, true)
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(calendarId, forKey: .calendarId)
        try c.encode(calendarName, forKey: .calendarName)
        try c.encode(color, forKey: .color)
        try c.encodeIfPresent(userId, forKey: .userId)
        try c.encode(title, forKey: .title)
        try c.encodeIfPresent(description, forKey: .description)
        try c.encodeIfPresent(location, forKey: .location)
        try c.encode(startAt, forKey: .startAt)
        try c.encode(endAt, forKey: .endAt)
        try c.encode(allDay, forKey: .allDay)
        try c.encodeIfPresent(timezone, forKey: .timezone)
        try c.encode(recurring, forKey: .recurring)
        try c.encodeIfPresent(recurrenceRule, forKey: .recurrenceRule)
        try c.encodeIfPresent(recurrenceText, forKey: .recurrenceText)
        try c.encode(origin, forKey: .origin)
        try c.encode(syncState, forKey: .syncState)
        try c.encode(editable, forKey: .editable)
    }
}

extension ListItem {
    enum CodingKeys: String, CodingKey { case id, listId, text, checked, color }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        listId = try c.decode(Int.self, forKey: .listId)
        text = try c.decode(String.self, forKey: .text)
        checked = try c.value(Bool.self, .checked, false)
        color = try c.decodeIfPresent(String.self, forKey: .color)
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(listId, forKey: .listId)
        try c.encode(text, forKey: .text)
        try c.encode(checked, forKey: .checked)
        try c.encodeIfPresent(color, forKey: .color)
    }
}

extension SharedList {
    enum CodingKeys: String, CodingKey { case id, name, icon, itemCount, items }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        icon = try c.decodeIfPresent(String.self, forKey: .icon)
        itemCount = try c.value(Int.self, .itemCount, 0)
        items = try c.value([ListItem].self, .items, [])
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(name, forKey: .name)
        try c.encodeIfPresent(icon, forKey: .icon)
        try c.encode(itemCount, forKey: .itemCount)
        try c.encode(items, forKey: .items)
    }
}

extension ChoreCompletion {
    enum CodingKeys: String, CodingKey { case id, choreId, userId, on, status, pointsAwarded }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        choreId = try c.decode(Int.self, forKey: .choreId)
        userId = try c.decode(Int.self, forKey: .userId)
        on = try c.decode(String.self, forKey: .on)
        status = try c.decode(String.self, forKey: .status)
        pointsAwarded = try c.value(Int.self, .pointsAwarded, 0)
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(choreId, forKey: .choreId)
        try c.encode(userId, forKey: .userId)
        try c.encode(on, forKey: .on)
        try c.encode(status, forKey: .status)
        try c.encode(pointsAwarded, forKey: .pointsAwarded)
    }
}

extension BoardChore {
    enum CodingKeys: String, CodingKey { case choreId, title, icon, points, requiresApproval, completion }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        choreId = try c.decode(Int.self, forKey: .choreId)
        title = try c.decode(String.self, forKey: .title)
        icon = try c.decodeIfPresent(String.self, forKey: .icon)
        points = try c.value(Int.self, .points, 0)
        requiresApproval = try c.value(Bool.self, .requiresApproval, false)
        completion = try c.decodeIfPresent(ChoreCompletion.self, forKey: .completion)
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(choreId, forKey: .choreId)
        try c.encode(title, forKey: .title)
        try c.encodeIfPresent(icon, forKey: .icon)
        try c.encode(points, forKey: .points)
        try c.encode(requiresApproval, forKey: .requiresApproval)
        try c.encodeIfPresent(completion, forKey: .completion)
    }
}

extension PersonBoard {
    enum CodingKeys: String, CodingKey { case userId, name, color, avatarEmoji, stars, chores }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        userId = try c.decode(Int.self, forKey: .userId)
        name = try c.decode(String.self, forKey: .name)
        color = try c.value(String.self, .color, "#3b82f6")
        avatarEmoji = try c.decodeIfPresent(String.self, forKey: .avatarEmoji)
        stars = try c.value(Int.self, .stars, 0)
        chores = try c.value([BoardChore].self, .chores, [])
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(userId, forKey: .userId)
        try c.encode(name, forKey: .name)
        try c.encode(color, forKey: .color)
        try c.encodeIfPresent(avatarEmoji, forKey: .avatarEmoji)
        try c.encode(stars, forKey: .stars)
        try c.encode(chores, forKey: .chores)
    }
}

extension RewardInfo {
    enum CodingKeys: String, CodingKey { case id, title, pointsCost, icon }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        title = try c.decode(String.self, forKey: .title)
        pointsCost = try c.decode(Int.self, forKey: .pointsCost)
        icon = try c.decodeIfPresent(String.self, forKey: .icon)
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(title, forKey: .title)
        try c.encode(pointsCost, forKey: .pointsCost)
        try c.encodeIfPresent(icon, forKey: .icon)
    }
}

extension RedemptionInfo {
    enum CodingKeys: String, CodingKey {
        case id, rewardId, rewardTitle, userId, userName, color, pointsSpent, status
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        rewardId = try c.decode(Int.self, forKey: .rewardId)
        rewardTitle = try c.decode(String.self, forKey: .rewardTitle)
        userId = try c.decode(Int.self, forKey: .userId)
        userName = try c.decode(String.self, forKey: .userName)
        color = try c.value(String.self, .color, "#3b82f6")
        pointsSpent = try c.decode(Int.self, forKey: .pointsSpent)
        status = try c.decode(String.self, forKey: .status)
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(rewardId, forKey: .rewardId)
        try c.encode(rewardTitle, forKey: .rewardTitle)
        try c.encode(userId, forKey: .userId)
        try c.encode(userName, forKey: .userName)
        try c.encode(color, forKey: .color)
        try c.encode(pointsSpent, forKey: .pointsSpent)
        try c.encode(status, forKey: .status)
    }
}

extension PendingApproval {
    enum CodingKeys: String, CodingKey {
        case completionId, choreId, title, userId, userName, color, points, on
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        completionId = try c.decode(Int.self, forKey: .completionId)
        choreId = try c.decode(Int.self, forKey: .choreId)
        title = try c.decode(String.self, forKey: .title)
        userId = try c.decode(Int.self, forKey: .userId)
        userName = try c.decode(String.self, forKey: .userName)
        color = try c.value(String.self, .color, "#3b82f6")
        points = try c.decode(Int.self, forKey: .points)
        on = try c.decode(String.self, forKey: .on)
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(completionId, forKey: .completionId)
        try c.encode(choreId, forKey: .choreId)
        try c.encode(title, forKey: .title)
        try c.encode(userId, forKey: .userId)
        try c.encode(userName, forKey: .userName)
        try c.encode(color, forKey: .color)
        try c.encode(points, forKey: .points)
        try c.encode(on, forKey: .on)
    }
}

extension ChoreBoard {
    enum CodingKeys: String, CodingKey { case on, people, rewards, pendingRedemptions, pendingApprovals }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        on = try c.decode(String.self, forKey: .on)
        people = try c.value([PersonBoard].self, .people, [])
        rewards = try c.value([RewardInfo].self, .rewards, [])
        pendingRedemptions = try c.value([RedemptionInfo].self, .pendingRedemptions, [])
        pendingApprovals = try c.value([PendingApproval].self, .pendingApprovals, [])
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(on, forKey: .on)
        try c.encode(people, forKey: .people)
        try c.encode(rewards, forKey: .rewards)
        try c.encode(pendingRedemptions, forKey: .pendingRedemptions)
        try c.encode(pendingApprovals, forKey: .pendingApprovals)
    }
}

extension ChoreDefinition {
    enum CodingKeys: String, CodingKey {
        case id, title, notes, points, schedule, weekdays, dueOn, requiresApproval, icon, assigneeIds
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        title = try c.decode(String.self, forKey: .title)
        notes = try c.decodeIfPresent(String.self, forKey: .notes)
        points = try c.value(Int.self, .points, 0)
        schedule = try c.value(String.self, .schedule, "daily")
        weekdays = try c.value([Int].self, .weekdays, [])
        dueOn = try c.decodeIfPresent(String.self, forKey: .dueOn)
        requiresApproval = try c.value(Bool.self, .requiresApproval, false)
        icon = try c.decodeIfPresent(String.self, forKey: .icon)
        assigneeIds = try c.value([Int].self, .assigneeIds, [])
    }
}

extension HomeSetup {
    enum CodingKeys: String, CodingKey { case haBaseUrl, server }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        haBaseUrl = try c.value(String.self, .haBaseUrl, "")
        server = try c.decodeIfPresent(HomeSetupServer.self, forKey: .server) ?? HomeSetupServer()
    }
}

extension HomeSetupServer {
    enum CodingKeys: String, CodingKey { case haTokenSet }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        haTokenSet = try c.value(Bool.self, .haTokenSet, false)
    }
}

extension HomeTestResult {
    enum CodingKeys: String, CodingKey { case ok, status, message }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        ok = try c.value(Bool.self, .ok, false)
        status = try c.value(String.self, .status, "")
        message = try c.value(String.self, .message, "")
    }
}

extension HomeEntity {
    enum CodingKeys: String, CodingKey { case entityId, domain, name, state, available, on, level, adjustable }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        entityId = try c.decode(String.self, forKey: .entityId)
        domain = try c.decode(String.self, forKey: .domain)
        name = try c.decode(String.self, forKey: .name)
        state = try c.value(String.self, .state, "")
        available = try c.value(Bool.self, .available, true)
        on = try c.decodeIfPresent(Bool.self, forKey: .on)
        level = try c.decodeIfPresent(Int.self, forKey: .level)
        adjustable = try c.value(Bool.self, .adjustable, false)
    }
}

extension HomeRoom {
    enum CodingKeys: String, CodingKey { case areaId, name, entities }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        areaId = try c.decodeIfPresent(String.self, forKey: .areaId)
        name = try c.value(String.self, .name, "")
        entities = try c.value([HomeEntity].self, .entities, [])
    }
}

extension HomeSnapshot {
    enum CodingKeys: String, CodingKey { case status, message, rooms, actions }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        status = try c.value(String.self, .status, "ok")
        message = try c.value(String.self, .message, "")
        rooms = try c.value([HomeRoom].self, .rooms, [])
        actions = try c.value([HomeEntity].self, .actions, [])
    }
}

extension FamilyMessage {
    enum CodingKeys: String, CodingKey {
        case id, userId, phone, direction, body, mediaUrl, mediaContentType, status, errorMessage, createdAt
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        userId = try c.decodeIfPresent(Int.self, forKey: .userId)
        phone = try c.value(String.self, .phone, "")
        direction = try c.value(String.self, .direction, "out")
        body = try c.decodeIfPresent(String.self, forKey: .body)
        mediaUrl = try c.decodeIfPresent(String.self, forKey: .mediaUrl)
        mediaContentType = try c.decodeIfPresent(String.self, forKey: .mediaContentType)
        status = try c.value(String.self, .status, "")
        errorMessage = try c.decodeIfPresent(String.self, forKey: .errorMessage)
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt)
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encodeIfPresent(userId, forKey: .userId)
        try c.encode(phone, forKey: .phone)
        try c.encode(direction, forKey: .direction)
        try c.encodeIfPresent(body, forKey: .body)
        try c.encodeIfPresent(mediaUrl, forKey: .mediaUrl)
        try c.encodeIfPresent(mediaContentType, forKey: .mediaContentType)
        try c.encode(status, forKey: .status)
        try c.encodeIfPresent(errorMessage, forKey: .errorMessage)
        try c.encodeIfPresent(createdAt, forKey: .createdAt)
    }
}

extension Conversation {
    enum CodingKeys: String, CodingKey {
        case id, userId, name, phone, color, avatarEmoji, unknown, lastMessage, canSend, messages
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        userId = try c.decodeIfPresent(Int.self, forKey: .userId)
        name = try c.decode(String.self, forKey: .name)
        phone = try c.decodeIfPresent(String.self, forKey: .phone)
        color = try c.value(String.self, .color, "#3b82f6")
        avatarEmoji = try c.decodeIfPresent(String.self, forKey: .avatarEmoji)
        unknown = try c.value(Bool.self, .unknown, false)
        lastMessage = try c.decodeIfPresent(FamilyMessage.self, forKey: .lastMessage)
        canSend = try c.decodeIfPresent(Bool.self, forKey: .canSend)
        messages = try c.decodeIfPresent([FamilyMessage].self, forKey: .messages)
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encodeIfPresent(userId, forKey: .userId)
        try c.encode(name, forKey: .name)
        try c.encodeIfPresent(phone, forKey: .phone)
        try c.encode(color, forKey: .color)
        try c.encodeIfPresent(avatarEmoji, forKey: .avatarEmoji)
        try c.encode(unknown, forKey: .unknown)
        try c.encodeIfPresent(lastMessage, forKey: .lastMessage)
        try c.encodeIfPresent(canSend, forKey: .canSend)
        try c.encodeIfPresent(messages, forKey: .messages)
    }
}

extension ConversationsResponse {
    enum CodingKeys: String, CodingKey { case configured, fromNumber, quickReplies, conversations }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        configured = try c.value(Bool.self, .configured, false)
        fromNumber = try c.value(String.self, .fromNumber, "")
        quickReplies = try c.value([String].self, .quickReplies, ["Dinner's ready", "Call me", "On my way?"])
        conversations = try c.value([Conversation].self, .conversations, [])
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(configured, forKey: .configured)
        try c.encode(fromNumber, forKey: .fromNumber)
        try c.encode(quickReplies, forKey: .quickReplies)
        try c.encode(conversations, forKey: .conversations)
    }
}

extension PhotoInfo {
    enum CodingKeys: String, CodingKey { case id, originalName, width, height, sizeBytes, sortOrder, url }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        originalName = try c.decodeIfPresent(String.self, forKey: .originalName)
        width = try c.value(Int.self, .width, 0)
        height = try c.value(Int.self, .height, 0)
        sizeBytes = try c.value(Int.self, .sizeBytes, 0)
        sortOrder = try c.value(Int.self, .sortOrder, 0)
        url = try c.value(String.self, .url, "")
    }
}

extension PairingCode {
    enum CodingKeys: String, CodingKey { case code, expiresAt, qrPayload }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        code = try c.decode(String.self, forKey: .code)
        expiresAt = try c.decode(String.self, forKey: .expiresAt)
        qrPayload = try c.value(String.self, .qrPayload, "")
    }
}
