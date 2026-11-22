import SwiftUI

enum MantelTheme {
    static let ember = Color(red: 0.090, green: 0.420, blue: 0.486)
    static let ink = Color(red: 0.110, green: 0.141, blue: 0.188)
    static let paper = Color.white
    static let danger = Color(red: 0.608, green: 0.110, blue: 0.110)
    static let dim = Color(red: 0.239, green: 0.290, blue: 0.361)
    static let line = Color(red: 0.306, green: 0.349, blue: 0.408)
    static let warmFill = Color(red: 0.863, green: 0.937, blue: 0.945)
    static let sand = Color(red: 0.969, green: 0.957, blue: 0.933)

    static let light: ColorScheme? = .light
}

enum ThemeChoice: String, CaseIterable, Identifiable {
    case system, light, dark
    var id: String { rawValue }
    var label: String {
        switch self {
        case .system: "System"
        case .light: "Light"
        case .dark: "Dark"
        }
    }

    var preferred: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}

extension Color {
    init(hex: String) {
        let raw = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        var value: UInt64 = 0
        Scanner(string: raw).scanHexInt64(&value)
        let r, g, b: Double
        if raw.count == 6 {
            r = Double((value >> 16) & 0xFF) / 255
            g = Double((value >> 8) & 0xFF) / 255
            b = Double(value & 0xFF) / 255
        } else {
            r = 0.23; g = 0.51; b = 0.96
        }
        self.init(red: r, green: g, blue: b)
    }
}

enum FamilyPalette {
    static let colors = [
        "#3b82f6", "#f97316", "#22c55e", "#a855f7",
        "#ec4899", "#eab308", "#14b8a6", "#ef4444",
    ]
}

extension View {
    /// Kid-friendly minimum hit target.
    func bigTap() -> some View {
        self.frame(minHeight: 52)
    }
}
