import SwiftUI

struct FamilyListView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        List {
            ForEach(model.users) { user in
                NavigationLink {
                    FamilyEditorView(member: user)
                } label: {
                    HStack(spacing: 14) {
                        PersonDot(name: user.name, color: user.color, emoji: user.avatarEmoji, size: 52)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(user.name).font(.title3.weight(.semibold))
                            Text(user.phone?.isEmpty == false ? user.phone! : "No phone number")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 6)
                }
            }
        }
        .navigationTitle("Family")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink {
                    FamilyEditorView(member: nil)
                } label: {
                    Image(systemName: "plus").frame(minWidth: 44, minHeight: 44)
                }
                .accessibilityLabel("Add family member")
            }
        }
    }
}

struct FamilyEditorView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    var member: FamilyMember?

    @State private var name = ""
    @State private var color = FamilyPalette.colors[0]
    @State private var emoji = ""
    @State private var phone = ""
    @State private var error: String?
    @State private var saving = false
    @State private var confirmDelete = false

    var body: some View {
        Form {
            if let error {
                ErrorBanner(text: error, onDismiss: { error = nil })
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            }
            Section("Person") {
                TextField("Name", text: $name).font(.title3)
                TextField("Emoji (optional)", text: $emoji)
                TextField("Phone", text: $phone)
                    .keyboardType(.phonePad)
                    .textContentType(.telephoneNumber)
            }
            Section("Color") {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 4), spacing: 12) {
                    ForEach(FamilyPalette.colors, id: \.self) { hex in
                        Button {
                            color = hex
                        } label: {
                            Circle()
                                .fill(Color(hex: hex))
                                .frame(width: 44, height: 44)
                                .overlay {
                                    if color == hex {
                                        Image(systemName: "checkmark")
                                            .foregroundStyle(.white)
                                            .font(.headline)
                                    }
                                }
                        }
                        .accessibilityLabel("Color \(hex)")
                    }
                }
            }
            Section {
                WarmButton(title: saving ? "Saving…" : "Save", enabled: !saving) {
                    Task {
                        saving = true
                        defer { saving = false }
                        if let message = await model.saveMember(existing: member, name: name, color: color, emoji: emoji, phone: phone) {
                            error = message
                        } else {
                            dismiss()
                        }
                    }
                }
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
                if member != nil {
                    Button("Remove from family", role: .destructive) { confirmDelete = true }
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
            }
        }
        .navigationTitle(member == nil ? "New person" : "Edit person")
        .onAppear {
            if let member {
                name = member.name
                color = member.color
                emoji = member.avatarEmoji ?? ""
                phone = member.phone ?? ""
            }
        }
        .alert("Remove this person?", isPresented: $confirmDelete) {
            Button("Remove", role: .destructive) {
                Task {
                    if let id = member?.id, let message = await model.deleteMember(id) {
                        error = message
                    } else {
                        dismiss()
                    }
                }
            }
            Button("Cancel", role: .cancel) {}
        }
    }
}
