import PencilKit
import SwiftUI
import UIKit

struct DoodleCanvasView: View {
    var onSend: (String) -> Void
    var onClose: () -> Void

    @State private var canvas = PKCanvasView()
    @State private var ink = UIColor(red: 0.11, green: 0.14, blue: 0.19, alpha: 1)
    @State private var width: CGFloat = 8
    @State private var error: String?

    private let colors: [UIColor] = [
        UIColor(red: 0.11, green: 0.14, blue: 0.19, alpha: 1),
        UIColor(red: 0.61, green: 0.11, blue: 0.11, alpha: 1),
        UIColor(red: 0.88, green: 0.45, blue: 0.09, alpha: 1),
        UIColor(red: 0.92, green: 0.70, blue: 0.03, alpha: 1),
        UIColor(red: 0.13, green: 0.77, blue: 0.37, alpha: 1),
        UIColor(red: 0.09, green: 0.42, blue: 0.49, alpha: 1),
        UIColor(red: 0.23, green: 0.51, blue: 0.96, alpha: 1),
        UIColor(red: 0.66, green: 0.33, blue: 0.97, alpha: 1),
        UIColor(red: 0.93, green: 0.28, blue: 0.60, alpha: 1),
    ]

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if let error {
                    ErrorBanner(text: error, onDismiss: { error = nil })
                        .padding(8)
                }
                PencilCanvas(canvas: canvas, color: ink, width: width)
                    .background(Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: 0))
                tools
            }
            .background(Color.white)
            .navigationTitle("Draw")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(action: onClose) { BackLabel() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Send") { send() }
                        .font(.title3.weight(.bold))
                        .frame(minHeight: 44)
                }
            }
        }
    }

    private var tools: some View {
        VStack(spacing: 10) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(Array(colors.enumerated()), id: \.offset) { _, color in
                        Button {
                            ink = color
                        } label: {
                            Circle()
                                .fill(Color(uiColor: color))
                                .frame(width: 40, height: 40)
                                .overlay {
                                    if ink == color {
                                        Circle().stroke(Color.white, lineWidth: 3)
                                        Circle().stroke(MantelTheme.ink, lineWidth: 1)
                                    }
                                }
                        }
                        .accessibilityLabel("Color")
                    }
                }
                .padding(.horizontal, 16)
            }
            HStack(spacing: 12) {
                Button("Clear") {
                    canvas.drawing = PKDrawing()
                }
                .font(.headline)
                .frame(minWidth: 80, minHeight: 48)
                Slider(value: $width, in: 3...24)
                    .tint(MantelTheme.ember)
                Text(width < 10 ? "Thin" : (width < 16 ? "Medium" : "Thick"))
                    .font(.headline)
                    .frame(width: 80, alignment: .trailing)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
        }
        .padding(.top, 8)
        .background(Color(.secondarySystemBackground))
    }

    private func send() {
        let bounds = canvas.bounds.isEmpty ? CGRect(x: 0, y: 0, width: 1024, height: 1024) : canvas.bounds
        if canvas.drawing.strokes.isEmpty {
            error = "Draw something first, then tap Send."
            return
        }
        let scale = UIScreen.main.scale
        let rendered = canvas.drawing.image(from: bounds, scale: scale)
        let size = rendered.size
        let format = UIGraphicsImageRendererFormat()
        format.scale = scale
        format.opaque = true
        let image = UIGraphicsImageRenderer(size: size, format: format).image { ctx in
            UIColor.white.setFill()
            ctx.fill(CGRect(origin: .zero, size: size))
            rendered.draw(in: CGRect(origin: .zero, size: size))
        }
        guard let data = image.pngData() else {
            error = "That drawing could not be saved."
            return
        }
        let payload = "data:image/png;base64," + data.base64EncodedString()
        onSend(payload)
    }
}

private struct PencilCanvas: UIViewRepresentable {
    var canvas: PKCanvasView
    var color: UIColor
    var width: CGFloat

    func makeUIView(context: Context) -> PKCanvasView {
        canvas.drawingPolicy = .anyInput
        canvas.backgroundColor = .white
        canvas.isOpaque = true
        canvas.overrideUserInterfaceStyle = .light
        applyInk()
        return canvas
    }

    func updateUIView(_ uiView: PKCanvasView, context: Context) {
        applyInk()
    }

    private func applyInk() {
        canvas.tool = PKInkingTool(.pen, color: color, width: width)
    }
}
