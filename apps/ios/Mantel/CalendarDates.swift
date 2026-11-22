import Foundation

enum CalendarDates {
    static func isoParser() -> ISO8601DateFormatter {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }

    static func isoParserPlain() -> ISO8601DateFormatter {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }

    static func parseInstant(_ iso: String) -> Date {
        if let d = isoParser().date(from: iso) { return d }
        if let d = isoParserPlain().date(from: iso) { return d }
        // "2026-08-03T17:00:00" without Z
        let fallback = ISO8601DateFormatter()
        fallback.formatOptions = [.withFullDate, .withTime, .withColonSeparatorInTime]
        fallback.timeZone = TimeZone(secondsFromGMT: 0)
        return fallback.date(from: iso) ?? Date()
    }

    static func formatInstant(_ date: Date) -> String {
        isoParserPlain().string(from: date)
    }

    static func zone(named name: String?) -> TimeZone {
        if let name, let zone = TimeZone(identifier: name) { return zone }
        return TimeZone(identifier: "UTC") ?? .gmt
    }

    static func eventZone(_ event: CalEvent, home: TimeZone) -> TimeZone {
        if let name = event.timezone, let zone = TimeZone(identifier: name) { return zone }
        return home
    }

    static func calendar(for zone: TimeZone, firstDayOfWeek: Int) -> Calendar {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = zone
        cal.firstWeekday = firstDayOfWeek == 1 ? 2 : 1 // 1 Sunday, 2 Monday
        return cal
    }

    static func startOfDay(_ date: Date, calendar: Calendar) -> Date {
        calendar.startOfDay(for: date)
    }

    static func dateOnly(_ date: Date, calendar: Calendar) -> Date {
        calendar.startOfDay(for: date)
    }

    static func utcDate(_ iso: String) -> Date {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(secondsFromGMT: 0)!
        return cal.startOfDay(for: parseInstant(iso))
    }

    static func addDays(_ date: Date, _ days: Int, calendar: Calendar) -> Date {
        calendar.date(byAdding: .day, value: days, to: calendar.startOfDay(for: date)) ?? date
    }

    static func startOfWeek(_ day: Date, calendar: Calendar) -> Date {
        let start = calendar.startOfDay(for: day)
        let weekday = calendar.component(.weekday, from: start)
        let first = calendar.firstWeekday
        let delta = (weekday - first + 7) % 7
        return calendar.date(byAdding: .day, value: -delta, to: start) ?? start
    }

    static func weekDays(anchor: Date, calendar: Calendar) -> [Date] {
        let start = startOfWeek(anchor, calendar: calendar)
        return (0..<7).compactMap { calendar.date(byAdding: .day, value: $0, to: start) }
    }

    static func monthGrid(anchor: Date, calendar: Calendar) -> [Date] {
        let startOfMonth = calendar.date(from: calendar.dateComponents([.year, .month], from: anchor)) ?? anchor
        let start = startOfWeek(startOfMonth, calendar: calendar)
        var days: [Date] = []
        var cursor = start
        // 6 weeks keeps the grid a rectangle
        for _ in 0..<42 {
            days.append(cursor)
            cursor = calendar.date(byAdding: .day, value: 1, to: cursor) ?? cursor
        }
        return days
    }

    static func sameDay(_ a: Date, _ b: Date, calendar: Calendar) -> Bool {
        calendar.isDate(a, inSameDayAs: b)
    }

    static func occursOn(_ event: CalEvent, day: Date, home: TimeZone, calendar: Calendar) -> Bool {
        let dayStart = calendar.startOfDay(for: day)
        if event.allDay {
            let start = utcDate(event.startAt)
            let end = utcDate(event.endAt)
            var utc = Calendar(identifier: .gregorian)
            utc.timeZone = TimeZone(secondsFromGMT: 0)!
            // Compare as yyyy-mm-dd in UTC for all-day, then as the wall date.
            let dayYMD = ymd(dayStart, calendar: calendar)
            let startYMD = ymd(start, calendar: utc)
            let endYMD = ymd(end, calendar: utc)
            return dayYMD >= startYMD && dayYMD < endYMD
        }
        let zone = eventZone(event, home: home)
        var zcal = Calendar(identifier: .gregorian)
        zcal.timeZone = zone
        let start = parseInstant(event.startAt)
        let end = parseInstant(event.endAt)
        let localDayStart = zcal.startOfDay(for: dayStart)
        let localDayEnd = zcal.date(byAdding: .day, value: 1, to: localDayStart) ?? localDayStart
        return start < localDayEnd && end > localDayStart
    }

    static func ymd(_ date: Date, calendar: Calendar) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    static func parseYMD(_ text: String, calendar: Calendar) -> Date? {
        let parts = text.split(separator: "-").compactMap { Int($0) }
        guard parts.count >= 3 else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    static func eventsOn(_ events: [CalEvent], day: Date, home: TimeZone, calendar: Calendar) -> [CalEvent] {
        events
            .filter { occursOn($0, day: day, home: home, calendar: calendar) }
            .sorted { a, b in
                if a.allDay != b.allDay { return a.allDay && !b.allDay }
                return a.startAt < b.startAt
            }
    }

    static func eventDay(_ event: CalEvent, home: TimeZone, calendar: Calendar) -> Date {
        if event.allDay {
            var utc = Calendar(identifier: .gregorian)
            utc.timeZone = TimeZone(secondsFromGMT: 0)!
            let start = utcDate(event.startAt)
            let y = utc.component(.year, from: start)
            let m = utc.component(.month, from: start)
            let d = utc.component(.day, from: start)
            return calendar.date(from: DateComponents(year: y, month: m, day: d)) ?? start
        }
        var zcal = Calendar(identifier: .gregorian)
        zcal.timeZone = eventZone(event, home: home)
        return calendar.startOfDay(for: parseInstant(event.startAt))
    }

    /// All-day events are UTC midnights with an exclusive end. `endDay` is inclusive.
    static func allDaySpan(startDay: Date, endDay: Date, calendar: Calendar) -> (String, String) {
        let start = calendar.startOfDay(for: startDay)
        var end = calendar.startOfDay(for: endDay)
        if end < start { end = start }
        let endExclusive = calendar.date(byAdding: .day, value: 1, to: end) ?? end
        return ("\(ymd(start, calendar: calendar))T00:00:00Z", "\(ymd(endExclusive, calendar: calendar))T00:00:00Z")
    }

    static func timedRange(day: Date, startMinutes: Int, endMinutes: Int, zone: TimeZone) -> (String, String) {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = zone
        let startOf = cal.startOfDay(for: day)
        let endMin = endMinutes > startMinutes ? endMinutes : startMinutes + 30
        let start = cal.date(byAdding: .minute, value: startMinutes, to: startOf) ?? startOf
        let end = cal.date(byAdding: .minute, value: endMin, to: startOf) ?? startOf
        return (formatInstant(start), formatInstant(end))
    }

    static func eventMinutes(_ event: CalEvent, home: TimeZone) -> (Int, Int)? {
        if event.allDay { return nil }
        let zone = eventZone(event, home: home)
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = zone
        let start = parseInstant(event.startAt)
        let end = parseInstant(event.endAt)
        let s = cal.component(.hour, from: start) * 60 + cal.component(.minute, from: start)
        let e = cal.component(.hour, from: end) * 60 + cal.component(.minute, from: end)
        return (s, e)
    }

    static func dayLabel(_ day: Date, calendar: Calendar) -> String {
        let f = DateFormatter()
        f.calendar = calendar
        f.timeZone = calendar.timeZone
        f.locale = .current
        f.dateFormat = "EEE, MMM d"
        return f.string(from: day)
    }

    static func monthLabel(_ day: Date, calendar: Calendar) -> String {
        let f = DateFormatter()
        f.calendar = calendar
        f.timeZone = calendar.timeZone
        f.locale = .current
        f.dateFormat = "MMMM yyyy"
        return f.string(from: day)
    }

    static func clockLabel(_ date: Date, calendar: Calendar, use24h: Bool) -> String {
        let f = DateFormatter()
        f.calendar = calendar
        f.timeZone = calendar.timeZone
        f.locale = .current
        f.dateFormat = use24h ? "HH:mm" : "h:mm a"
        return f.string(from: date)
    }

    static func formatWhen(_ event: CalEvent, home: TimeZone, use24h: Bool, calendar: Calendar) -> String {
        if event.allDay {
            var utc = Calendar(identifier: .gregorian)
            utc.timeZone = TimeZone(secondsFromGMT: 0)!
            let start = utcDate(event.startAt)
            let endInclusive = utc.date(byAdding: .day, value: -1, to: utcDate(event.endAt)) ?? start
            if utc.isDate(start, inSameDayAs: endInclusive) { return "All day" }
            return "All day · \(dayLabel(start, calendar: utc)) – \(dayLabel(endInclusive, calendar: utc))"
        }
        let zone = eventZone(event, home: home)
        var zcal = Calendar(identifier: .gregorian)
        zcal.timeZone = zone
        let start = parseInstant(event.startAt)
        let end = parseInstant(event.endAt)
        if zcal.isDate(start, inSameDayAs: end) {
            return "\(clockLabel(start, calendar: zcal, use24h: use24h)) – \(clockLabel(end, calendar: zcal, use24h: use24h))"
        }
        return "\(dayLabel(start, calendar: zcal)) \(clockLabel(start, calendar: zcal, use24h: use24h))"
    }

    /// Query a day past either end so all-day UTC dates are not clipped.
    static func fetchRange(first: Date, endExclusive: Date, zone: TimeZone) -> (String, String) {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = zone
        let start = cal.date(byAdding: .day, value: -1, to: cal.startOfDay(for: first)) ?? first
        let end = cal.date(byAdding: .day, value: 1, to: cal.startOfDay(for: endExclusive)) ?? endExclusive
        return (formatInstant(start), formatInstant(end))
    }
}
