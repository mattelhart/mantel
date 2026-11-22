import AVFoundation
import SwiftUI

struct QRScanner: View {
    var onResult: (String) -> Void
    var onClose: () -> Void
    @State private var denied = false

    var body: some View {
        NavigationStack {
            ZStack {
                ScannerPreview(onResult: onResult, onDenied: { denied = true })
                    .ignoresSafeArea()
                VStack {
                    Spacer()
                    Text("Point the camera at the pairing code on the wall.")
                        .font(.title3.weight(.semibold))
                        .multilineTextAlignment(.center)
                        .padding()
                        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
                        .padding()
                }
                if denied {
                    VStack(spacing: 16) {
                        Text("Camera access is off. You can still type the 8-character code.")
                            .multilineTextAlignment(.center)
                            .padding()
                        WarmButton(title: "Close") { onClose() }
                            .padding(.horizontal)
                    }
                    .padding()
                    .background(.background, in: RoundedRectangle(cornerRadius: 20))
                    .padding()
                }
            }
            .navigationTitle("Scan")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(action: onClose) { BackLabel() }
                }
            }
        }
    }
}

private struct ScannerPreview: UIViewControllerRepresentable {
    var onResult: (String) -> Void
    var onDenied: () -> Void

    func makeUIViewController(context: Context) -> ScannerController {
        let controller = ScannerController()
        controller.onResult = onResult
        controller.onDenied = onDenied
        return controller
    }

    func updateUIViewController(_ uiViewController: ScannerController, context: Context) {}
}

final class ScannerController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var onResult: ((String) -> Void)?
    var onDenied: (() -> Void)?
    private let session = AVCaptureSession()
    private var preview: AVCaptureVideoPreviewLayer?
    private var handled = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            start()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] ok in
                DispatchQueue.main.async {
                    if ok { self?.start() } else { self?.onDenied?() }
                }
            }
        default:
            onDenied?()
        }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        preview?.frame = view.bounds
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        if session.isRunning { session.stopRunning() }
    }

    private func start() {
        guard let device = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(input)
        else {
            onDenied?()
            return
        }
        session.beginConfiguration()
        session.addInput(input)
        let output = AVCaptureMetadataOutput()
        if session.canAddOutput(output) {
            session.addOutput(output)
            output.setMetadataObjectsDelegate(self, queue: .main)
            output.metadataObjectTypes = [.qr]
        }
        session.commitConfiguration()
        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        layer.frame = view.bounds
        view.layer.insertSublayer(layer, at: 0)
        preview = layer
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.session.startRunning()
        }
    }

    func metadataOutput(
        _ output: AVCaptureMetadataOutput,
        didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        guard !handled,
              let obj = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
              let value = obj.stringValue,
              !value.isEmpty
        else { return }
        handled = true
        session.stopRunning()
        onResult?(value)
    }
}
