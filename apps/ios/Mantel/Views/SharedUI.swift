import SwiftUI
import UIKit

struct WarmButton: View {
    var title: String
    var enabled: Bool = true
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.title3.weight(.semibold))
                .frame(maxWidth: .infinity, minHeight: 52)
        }
        .buttonStyle(.borderedProminent)
        .tint(MantelTheme.ember)
        .disabled(!enabled)
    }
}

struct SoftButton: View {
    var title: String
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.title3.weight(.semibold))
                .frame(maxWidth: .infinity, minHeight: 52)
        }
        .buttonStyle(.bordered)
        .tint(MantelTheme.ember)
    }
}

struct OfflineBanner: View {
    var text: String

    var body: some View {
        Text(text)
            .font(.subheadline.weight(.medium))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(Color.orange.opacity(0.95), in: RoundedRectangle(cornerRadius: 12))
    }
}

struct ErrorBanner: View {
    var text: String
    var onDismiss: (() -> Void)?

    var body: some View {
        HStack(alignment: .top) {
            Text(text)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let onDismiss {
                Button("OK", action: onDismiss)
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(.white)
            }
        }
        .padding(12)
        .background(MantelTheme.danger, in: RoundedRectangle(cornerRadius: 12))
    }
}

struct PersonDot: View {
    var name: String
    var color: String
    var emoji: String?
    var size: CGFloat = 44
    var dimmed: Bool = false

    var body: some View {
        ZStack {
            Circle().fill(Color(hex: color).opacity(dimmed ? 0.35 : 1))
            if let emoji, !emoji.isEmpty {
                Text(emoji).font(.system(size: size * 0.45))
            } else {
                Text(initials)
                    .font(.system(size: size * 0.38, weight: .bold))
                    .foregroundStyle(.white)
            }
        }
        .frame(width: size, height: size)
        .opacity(dimmed ? 0.55 : 1)
        .accessibilityLabel(name)
    }

    private var initials: String {
        let parts = name.split(separator: " ")
        let letters = parts.prefix(2).compactMap { $0.first }
        return String(letters).uppercased()
    }
}

struct BackLabel: View {
    var body: some View {
        Label("Back", systemImage: "chevron.left")
            .font(.title3.weight(.semibold))
    }
}

/// Loads a protected image with the device token.
struct AuthedImage: View {
    var path: String
    var model: AppModel
    var contentMode: ContentMode = .fit

    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: contentMode)
            } else if failed {
                Image(systemName: "photo")
                    .font(.largeTitle)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 80)
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity, minHeight: 80)
            }
        }
        .task(id: path) {
            failed = false
            image = nil
            if let data = await model.loadImage(path: path), let loaded = UIImage(data: data) {
                image = loaded
            } else {
                failed = true
            }
        }
    }
}
