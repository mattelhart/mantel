import Foundation
import Security

/// Origin lives in UserDefaults. The pairing token is in the Keychain,
/// similar to the Android Keystore-backed store. The token is never logged.
struct KeychainStore {
    private let service = "com.mattelhart.mantel"
    private let tokenAccount = "device-token"
    private let defaults = UserDefaults.standard
    private let originKey = "mantel.origin"
    private let themeKey = "mantel.theme"
    private let anchorKey = "mantel.calendar_anchor"
    private let pairedLinkKey = "mantel.paired_link"

    func loadOrigin() -> String? {
        defaults.string(forKey: originKey)
    }

    func saveOrigin(_ origin: String) {
        defaults.set(origin, forKey: originKey)
    }

    func loadToken() -> String? {
        readKeychain()
    }

    func saveToken(_ token: String) {
        deleteKeychain()
        let data = Data(token.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: tokenAccount,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        SecItemAdd(query as CFDictionary, nil)
    }

    func loadTheme() -> ThemeChoice {
        ThemeChoice(rawValue: defaults.string(forKey: themeKey) ?? "") ?? .light
    }

    func saveTheme(_ choice: ThemeChoice) {
        defaults.set(choice.rawValue, forKey: themeKey)
    }

    func loadAnchor() -> String? {
        defaults.string(forKey: anchorKey)
    }

    func saveAnchor(_ ymd: String) {
        defaults.set(ymd, forKey: anchorKey)
    }

    func loadPairedLink() -> String? {
        defaults.string(forKey: pairedLinkKey)
    }

    func savePairedLink(_ raw: String) {
        defaults.set(raw, forKey: pairedLinkKey)
    }

    func clear() {
        defaults.removeObject(forKey: originKey)
        defaults.removeObject(forKey: pairedLinkKey)
        deleteKeychain()
    }

    func clearToken() {
        deleteKeychain()
    }

    private func readKeychain() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: tokenAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var out: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &out)
        guard status == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func deleteKeychain() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: tokenAccount,
        ]
        SecItemDelete(query as CFDictionary)
    }
}

enum SnapshotStore {
    private static var folder: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let dir = base.appendingPathComponent("mantel-cache", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    static func save(_ data: Data, name: String) {
        try? data.write(to: folder.appendingPathComponent(name), options: .atomic)
    }

    static func load(_ name: String) -> Data? {
        try? Data(contentsOf: folder.appendingPathComponent(name))
    }

    static func clear() {
        try? FileManager.default.removeItem(at: folder)
    }
}
