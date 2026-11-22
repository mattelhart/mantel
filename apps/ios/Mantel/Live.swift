import Foundation

enum LiveMessage: Equatable {
    case hello(Int64?)
    case change(Int64?, Set<String>)
    case resync(Int64?)
}

/// Frames arrive a line at a time. A blank line ends one.
struct SseParser {
    private var lines: [String] = []

    mutating func reset() { lines.removeAll() }

    mutating func feed(_ line: String) -> [LiveMessage] {
        if !line.isEmpty {
            lines.append(line)
            return []
        }
        if lines.isEmpty { return [] }
        let message = parse(lines)
        lines.removeAll()
        return message.map { [$0] } ?? []
    }

    private func parse(_ frame: [String]) -> LiveMessage? {
        var id: Int64?
        var event = "message"
        var data = ""
        for raw in frame {
            if raw.hasPrefix(":") { continue }
            let split = raw.firstIndex(of: ":")
            let field = split.map { String(raw[..<$0]) } ?? raw
            var value = split.map { String(raw[raw.index(after: $0)...]) } ?? ""
            if value.hasPrefix(" ") { value.removeFirst() }
            switch field {
            case "id": id = Int64(value)
            case "event": event = value
            case "data":
                if !data.isEmpty { data.append("\n") }
                data.append(value)
            default: break
            }
        }
        switch event {
        case "hello": return .hello(id)
        case "resync": return .resync(id)
        case "change": return .change(id, Self.topics(data))
        default: return nil
        }
    }

    private static func topics(_ data: String) -> Set<String> {
        guard let raw = data.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: raw) as? [String: Any],
              let array = obj["topics"] as? [String]
        else { return [] }
        return Set(array)
    }
}

func reconnectDelay(attempt: Int) -> TimeInterval {
    let step = max(attempt - 1, 0)
    let exp = min((1 << min(step, 15)), 30)
    let jitter = Double.random(in: 0...0.4)
    return TimeInterval(exp) + jitter
}
