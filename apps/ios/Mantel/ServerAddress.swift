import Foundation

enum ServerAddress {
    static let familyCalOrigin = "http://familycal.local:8080"
    static let discoveryTimeout: TimeInterval = 2
    static let savedProbeTimeout: TimeInterval = 3
    static let savedProbeAttempts = 2
    static let probeBackoff: TimeInterval = 0.5
    static let connectTimeout: TimeInterval = 4
    static let pairAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    static let publicHTTPMessage =
        "That address is on the public internet. Use the address on your LAN or VPN, or https."

    struct ProbeStep: Equatable {
        let origin: String
        let timeout: TimeInterval
        let saved: Bool
    }

    struct PairingLink: Equatable {
        let base: String
        let code: String
    }

    /// A bare IP gets port 8080, the server's default.
    static func normalize(_ raw: String) -> String? {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { return nil }
        if !text.contains("://") { text = "http://\(text)" }
        guard let uri = URL(string: text), let scheme = uri.scheme?.lowercased() else { return nil }
        guard scheme == "http" || scheme == "https" else { return nil }
        if uri.user != nil || uri.password != nil { return nil }
        guard let host = uri.host, !host.isEmpty else { return nil }
        let port: Int?
        if let given = uri.port {
            port = given
        } else if scheme == "http" {
            port = 8080
        } else {
            port = nil
        }
        let portPart = port.map { ":\($0)" } ?? ""
        let shown = host.contains(":") ? "[\(host)]" : host
        return "\(scheme)://\(shown)\(portPart)"
    }

    static func probeSchedule(saved: String?) -> [ProbeStep] {
        let normalized = saved.flatMap(normalize)
        var steps: [ProbeStep] = []
        if let normalized {
            for _ in 0..<savedProbeAttempts {
                steps.append(ProbeStep(origin: normalized, timeout: savedProbeTimeout, saved: true))
            }
        }
        if normalized != familyCalOrigin {
            steps.append(ProbeStep(origin: familyCalOrigin, timeout: discoveryTimeout, saved: false))
        }
        return steps
    }

    static func savedAddressPrefill(_ saved: String?) -> String {
        saved.flatMap(normalize) ?? ""
    }

    static func discoveryMissMessage(saved: String?) -> String {
        if savedAddressPrefill(saved).isEmpty {
            return "Enter the calendar server's address, such as 192.168.1.20."
        }
        return "Couldn't reach the saved calendar server. The last address is filled in below."
    }

    static func unreachableMessage(_ origin: String) -> String {
        let target = origin.isEmpty ? "the calendar server" : origin
        return "Can't reach \(target). Check that the calendar server is running, and that this device is on the same network or a VPN."
    }

    static func pairingFailureMessage(status: Int, serverMessage: String?) -> String {
        let text = serverMessage?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        switch status {
        case 401:
            if text.localizedCaseInsensitiveContains("expired") || text.localizedCaseInsensitiveContains("wrong") {
                return text
            }
            return "That pairing code has expired or was already used. On the wall, open Settings → Devices and show a new code."
        case 429:
            return text.isEmpty ? "Too many pairing attempts. Wait a few minutes and try again." : text
        case 0:
            return text.isEmpty ? unreachableMessage("the calendar server") : text
        default:
            return text.isEmpty ? "Could not pair with the calendar server." : text
        }
    }

    static func revokedDeviceMessage() -> String {
        "This device is no longer paired. On the wall, open Settings → Devices and pair it again."
    }

    /// Mantel is a LAN server. Cleartext is fine on a private address, on
    /// Tailscale's 100.64.0.0/10 range, and on a name such as familycal.local.
    /// A public IP over HTTP is the port-forward case, and we refuse it.
    static func cleartextPermitted(_ origin: String) -> Bool {
        guard let normalized = normalize(origin), let uri = URL(string: normalized) else { return false }
        if uri.scheme?.lowercased() == "https" { return true }
        guard let host = uri.host else { return false }
        return cleartextHost(host)
    }

    static func cleartextHost(_ host: String) -> Bool {
        let bare = host.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
            .lowercased()
        if bare.isEmpty { return false }
        if bare == "localhost" || bare.hasSuffix(".local") || bare.hasSuffix(".local.") { return true }
        if bare.contains(":") { return ipv6Cleartext(bare) }
        let parts = bare.split(separator: ".")
        if parts.count != 4 { return true }
        let nums = parts.compactMap { Int($0) }
        if nums.count != 4 || nums.contains(where: { $0 < 0 || $0 > 255 }) { return true }
        let a = nums[0], b = nums[1]
        if a == 10 || a == 127 || a == 0 { return true }
        if a == 169 && b == 254 { return true }
        if a == 192 && b == 168 { return true }
        if a == 172 && (16...31).contains(b) { return true }
        if a == 100 && (64...127).contains(b) { return true }
        return false
    }

    private static func ipv6Cleartext(_ host: String) -> Bool {
        if host == "::1" || host == "0:0:0:0:0:0:0:1" { return true }
        if host.hasPrefix("fc") || host.hasPrefix("fd") { return true }
        return host.hasPrefix("fe8") || host.hasPrefix("fe9") || host.hasPrefix("fea") || host.hasPrefix("feb")
    }

    static func normalizePairCode(_ raw: String) -> String {
        raw.uppercased().filter { pairAlphabet.contains($0) }
    }

    static func pairCodeComplete(_ raw: String) -> Bool {
        let code = normalizePairCode(raw)
        return code.count == 8 && code.allSatisfy { pairAlphabet.contains($0) }
    }

    /// `mantel://pair?v=1&base=…&code=K7NQ-4RMP` from the wall's pairing QR.
    static func parsePairingLink(_ raw: String) -> PairingLink? {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard text.lowercased().hasPrefix("mantel:") else { return nil }
        guard let uri = URL(string: text) else { return nil }
        guard uri.scheme?.lowercased() == "mantel" else { return nil }
        guard uri.host?.lowercased() == "pair" else { return nil }
        guard let items = URLComponents(url: uri, resolvingAgainstBaseURL: false)?.queryItems else { return nil }
        var params: [String: String] = [:]
        for item in items {
            if let value = item.value { params[item.name] = value }
        }
        guard let base = params["base"].flatMap(normalize) else { return nil }
        let code = normalizePairCode(params["code"] ?? "")
        guard pairCodeComplete(code) else { return nil }
        return PairingLink(base: base, code: code)
    }
}

enum ServerProbe: Equatable {
    case up
    case down
    case unhealthy(Int)

    func failureMessage(origin: String) -> String? {
        switch self {
        case .up: nil
        case .down: ServerAddress.unreachableMessage(origin)
        case .unhealthy(let status):
            "The calendar server at \(origin) answered, but it is not ready (HTTP \(status))."
        }
    }
}
