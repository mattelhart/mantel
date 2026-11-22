import SwiftUI

struct ListsView: View {
    @Environment(AppModel.self) private var model
    @State private var newName = ""
    @State private var adding = false

    var body: some View {
        List {
            if model.offline {
                OfflineBanner(text: model.offlineDetail.isEmpty ? "Can't reach the calendar server." : model.offlineDetail)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            }
            ForEach(model.lists) { list in
                NavigationLink {
                    ListDetailView(listId: list.id)
                } label: {
                    HStack {
                        Text(list.icon ?? "☰").font(.title2)
                        VStack(alignment: .leading) {
                            Text(list.name).font(.title3.weight(.semibold))
                            Text("\(list.items.count) items")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 6)
                }
            }
        }
        .navigationTitle("Lists")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    adding = true
                } label: {
                    Image(systemName: "plus").frame(minWidth: 44, minHeight: 44)
                }
                .accessibilityLabel("New list")
            }
        }
        .alert("New list", isPresented: $adding) {
            TextField("Name", text: $newName)
            Button("Add") {
                Task { await model.addList(name: newName); newName = "" }
            }
            Button("Cancel", role: .cancel) { newName = "" }
        }
        .refreshable { await model.reload(spinner: false) }
    }
}

struct ListDetailView: View {
    @Environment(AppModel.self) private var model
    var listId: Int
    @State private var newItem = ""

    private var list: SharedList? {
        model.lists.first { $0.id == listId }
    }

    var body: some View {
        List {
            if let list {
                ForEach(list.items) { item in
                    Button {
                        Task { await model.toggleItem(listId: list.id, itemId: item.id, checked: !item.checked) }
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: item.checked ? "checkmark.circle.fill" : "circle")
                                .font(.title)
                                .foregroundStyle(item.checked ? MantelTheme.ember : MantelTheme.line)
                            Text(item.text)
                                .font(.title3)
                                .foregroundStyle(.primary)
                                .strikethrough(item.checked)
                            Spacer()
                        }
                        .padding(.vertical, 6)
                    }
                    .buttonStyle(.plain)
                    .swipeActions {
                        Button(role: .destructive) {
                            Task { await model.deleteItem(listId: list.id, itemId: item.id) }
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                }
            } else {
                Text("This list isn't here anymore.")
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle(list?.name ?? "List")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if let list {
                    Button("Clear checked") {
                        Task { await model.clearChecked(listId: list.id) }
                    }
                    .font(.headline)
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            HStack(spacing: 8) {
                TextField("Add an item", text: $newItem)
                    .font(.title3)
                    .padding(12)
                    .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16))
                Button("Add") {
                    Task {
                        await model.addItem(listId: listId, text: newItem)
                        newItem = ""
                    }
                }
                .font(.title3.weight(.semibold))
                .frame(minWidth: 72, minHeight: 52)
                .buttonStyle(.borderedProminent)
                .tint(MantelTheme.ember)
                .disabled(newItem.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .padding(12)
            .background(Color(.systemBackground))
        }
    }
}
