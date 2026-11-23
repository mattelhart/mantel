import Foundation

enum RepeatFreq: String, CaseIterable, Identifiable {
    case none = "Once"
    case daily = "Every day"
    case weekly = "Every week"
    case monthly = "Every month"
    case yearly = "Every year"
    var id: String { rawValue }
    var ical: String? {
        switch self {
        case .none: nil
        case .daily: "DAILY"
        case .weekly: "WEEKLY"
        case .monthly: "MONTHLY"
        case .yearly: "YEARLY"
        }
    }
}

struct RepeatChoice: Equatable {
    var freq: RepeatFreq = .none
    var byday: [String] = []
    var until: String = ""
}

enum Recurrence {
    /// Sunday first, matching the wall's recurrence picker.
    static let weekdayCodes = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"]
    static let weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

    static func weekdayCode(for date: Date, calendar: Calendar) -> String {
        let weekday = calendar.component(.weekday, from: date) // 1 = Sunday
        return weekdayCodes[(weekday - 1 + 7) % 7]
    }

    static func parse(_ rule: String?) -> RepeatChoice {
        guard let rule, !rule.isEmpty else { return RepeatChoice() }
        var parts: [String: String] = [:]
        for piece in rule.split(separator: ";") {
            let bits = piece.split(separator: "=", maxSplits: 1)
            if bits.count == 2 {
                parts[bits[0].uppercased()] = String(bits[1])
            }
        }
        let freq: RepeatFreq = switch parts["FREQ"]?.uppercased() {
        case "DAILY": .daily
        case "WEEKLY": .weekly
        case "MONTHLY": .monthly
        case "YEARLY": .yearly
        default: .none
        }
        let rawUntil = parts["UNTIL"] ?? ""
        var until = ""
        if rawUntil.count >= 8, rawUntil.first?.isNumber == true {
            let y = rawUntil.prefix(4)
            let m = rawUntil.dropFirst(4).prefix(2)
            let d = rawUntil.dropFirst(6).prefix(2)
            until = "\(y)-\(m)-\(d)"
        }
        let byday = (parts["BYDAY"] ?? "")
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces).uppercased() }
            .filter { weekdayCodes.contains($0) }
        return RepeatChoice(freq: freq, byday: byday, until: until)
    }

    static func build(_ choice: RepeatChoice) -> String? {
        guard let ical = choice.freq.ical else { return nil }
        var parts = ["FREQ=\(ical)"]
        if choice.freq == .weekly, !choice.byday.isEmpty {
            let ordered = weekdayCodes.filter { choice.byday.contains($0) }
            parts.append("BYDAY=\(ordered.joined(separator: ","))")
        }
        let until = choice.until.trimmingCharacters(in: .whitespaces)
        if until.count >= 10 {
            let compact = until.prefix(10).replacingOccurrences(of: "-", with: "")
            parts.append("UNTIL=\(compact)T235959")
        }
        return parts.joined(separator: ";")
    }
}

enum EventEditKind {
    case create, single, series, occurrence, readOnly
}

func eventEditKind(_ event: CalEvent?) -> EventEditKind {
    guard let event else { return .create }
    if !event.editable { return .readOnly }
    if let rule = event.recurrenceRule, !rule.isEmpty { return .series }
    if event.recurring { return .occurrence }
    return .single
}
