import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

struct PhotosView: View {
    @Environment(AppModel.self) private var model
    @State private var pick: PhotosPickerItem?
    @State private var error: String?
    @State private var uploading = false

    private let columns = [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if let error {
                    ErrorBanner(text: error, onDismiss: { error = nil })
                }
                Text("These pictures show on the wall screensaver.")
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 16)
                LazyVGrid(columns: columns, spacing: 8) {
                    ForEach(model.photos) { photo in
                        AuthedImage(path: photo.url, model: model, contentMode: .fill)
                            .frame(minHeight: 140)
                            .clipped()
                            .clipShape(RoundedRectangle(cornerRadius: 16))
                            .overlay(alignment: .topTrailing) {
                                Button {
                                    Task { await model.deletePhoto(photo.id) }
                                } label: {
                                    Image(systemName: "xmark.circle.fill")
                                        .font(.title2)
                                        .foregroundStyle(.white)
                                        .shadow(radius: 2)
                                        .padding(8)
                                }
                                .accessibilityLabel("Delete photo")
                            }
                    }
                }
                .padding(.horizontal, 16)
            }
            .padding(.vertical, 12)
        }
        .navigationTitle("Photos")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                PhotosPicker(selection: $pick, matching: .images) {
                    Label("Add", systemImage: "plus")
                        .font(.headline)
                }
                .disabled(uploading)
            }
        }
        .task { await model.reloadPhotos() }
        .onChange(of: pick) {
            Task { await upload() }
        }
    }

    private func upload() async {
        guard let pick else { return }
        uploading = true
        defer { uploading = false; self.pick = nil }
        do {
            guard let picked = try await pick.loadTransferable(type: PhotoData.self) else {
                error = "That picture could not be read."
                return
            }
            if let message = await model.uploadPhoto(data: picked.data, filename: "photo.jpg", mime: "image/jpeg") {
                error = message
            }
        } catch {
            self.error = "That picture could not be read."
        }
    }
}

private struct PhotoData: Transferable {
    var data: Data

    static var transferRepresentation: some TransferRepresentation {
        DataRepresentation(importedContentType: .image) { data in
            PhotoData(data: data)
        }
    }
}
