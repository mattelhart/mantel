import SwiftUI

struct MessagesListView: View {
    @Environment(AppModel.self) private var model
    var openDraw: Bool = false
    @State private var drawing = false

    var body: some View {
        let people = model.conversations.conversations.filter { !$0.unknown }
        Group {
            if !model.conversations.configured {
                ContentUnavailableView {
                    Label("Messages", systemImage: "bubble.left.and.bubble.right")
                } description: {
                    Text("Add your Twilio or Signal details in Settings on the wall to send notes and doodles.")
                }
            } else if people.isEmpty {
                ContentUnavailableView {
                    Label("No one to text yet", systemImage: "person.crop.circle.badge.plus")
                } description: {
                    Text("Add a phone number to a family member, then you can text them from here.")
                } actions: {
                    NavigationLink("Family") { FamilyListView() }
                        .buttonStyle(.borderedProminent)
                        .tint(MantelTheme.ember)
                        .font(.title3.weight(.semibold))
                }
            } else {
                List(people) { item in
                    NavigationLink {
                        ConversationView(conversationId: item.id)
                    } label: {
                        HStack(spacing: 14) {
                            PersonDot(name: item.name, color: item.color, emoji: item.avatarEmoji, size: 56)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(item.name)
                                    .font(.title3.weight(.semibold))
                                Text(preview(item))
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(2)
                            }
                        }
                        .padding(.vertical, 6)
                    }
                    .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                }
                .listStyle(.plain)
            }
        }
        .navigationTitle("Messages")
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    drawing = true
                } label: {
                    Label("Draw", systemImage: "pencil.tip")
                        .font(.headline)
                }
                .disabled(!model.conversations.configured || people.isEmpty)
                .accessibilityLabel("Draw")
            }
        }
        .overlay(alignment: .top) {
            VStack(spacing: 8) {
                if model.offline {
                    OfflineBanner(text: model.offlineDetail.isEmpty ? "Can't reach the calendar server." : model.offlineDetail)
                }
                if let message = model.message {
                    ErrorBanner(text: message, onDismiss: model.dismissMessage)
                }
            }
            .padding(.horizontal, 16)
        }
        .refreshable { await model.reloadConversations() }
        .fullScreenCover(isPresented: $drawing) {
            SendDoodleFlow(people: people) { drawing = false }
        }
        .onAppear {
            if openDraw, model.conversations.configured, !people.isEmpty {
                drawing = true
            }
        }
    }

    private func preview(_ item: Conversation) -> String {
        guard let last = item.lastMessage else { return "No messages yet" }
        if last.hasPicture { return last.isIncoming ? "Sent you a drawing" : "You sent a drawing" }
        let body = last.body?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if body.isEmpty { return last.isIncoming ? "New message" : "Sent" }
        return last.isIncoming ? body : "You: \(body)"
    }
}

struct ConversationView: View {
    @Environment(AppModel.self) private var model
    var conversationId: String

    @State private var thread: Conversation?
    @State private var text = ""
    @State private var error: String?
    @State private var drawing = false
    @State private var sending = false

    var body: some View {
        VStack(spacing: 0) {
            if model.offline {
                OfflineBanner(text: "Can't reach the calendar server right now.")
                    .padding(8)
            }
            if let error {
                ErrorBanner(text: error, onDismiss: { error = nil })
                    .padding(8)
            }
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 10) {
                        ForEach(thread?.messages ?? []) { message in
                            MessageBubble(message: message, color: thread?.color ?? "#3b82f6")
                                .id(message.id)
                        }
                    }
                    .padding(16)
                }
                .onChange(of: thread?.messages?.count) {
                    if let last = thread?.messages?.last {
                        withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                    }
                }
            }
            if canSend {
                quickReplies
                composer
            } else if thread != nil {
                Text("This person needs a phone number before you can send a message.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding()
            }
        }
        .navigationTitle(thread?.name ?? "Messages")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if canSend {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        drawing = true
                    } label: {
                        Label("Draw", systemImage: "pencil.tip")
                            .font(.headline.weight(.semibold))
                    }
                    .accessibilityLabel("Draw")
                }
            }
        }
        .task(id: conversationId) { await load() }
        .fullScreenCover(isPresented: $drawing) {
            if let userId = thread?.userId {
                DoodleCanvasView { png in
                    drawing = false
                    Task { await send(body: "", media: png) }
                } onClose: {
                    drawing = false
                }
            } else {
                NavigationStack {
                    Text("Pick someone with a phone number first.")
                        .toolbar {
                            ToolbarItem(placement: .topBarLeading) {
                                Button { drawing = false } label: { BackLabel() }
                            }
                        }
                }
            }
        }
    }

    private var canSend: Bool {
        Bool(thread?.canSend ?? false) && thread?.userId != nil && model.conversations.configured
    }

    private var quickReplies: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(model.conversations.quickReplies, id: \.self) { phrase in
                    Button(phrase) {
                        Task { await send(body: phrase, media: nil) }
                    }
                    .font(.headline)
                    .padding(.horizontal, 16)
                    .frame(minHeight: 48)
                    .background(MantelTheme.warmFill, in: Capsule())
                    .foregroundStyle(MantelTheme.ink)
                    .disabled(sending)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
    }

    private var composer: some View {
        HStack(alignment: .bottom, spacing: 8) {
            Button {
                drawing = true
            } label: {
                Image(systemName: "pencil.tip")
                    .font(.title2.weight(.semibold))
                    .frame(width: 52, height: 52)
                    .background(MantelTheme.ember, in: Circle())
                    .foregroundStyle(.white)
            }
            .accessibilityLabel("Draw")
            .disabled(sending)

            TextField("Write a message", text: $text, axis: .vertical)
                .lineLimit(1...5)
                .font(.title3)
                .padding(12)
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 18))

            Button {
                Task { await send(body: text, media: nil) }
            } label: {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 44))
                    .foregroundStyle(MantelTheme.ember)
            }
            .accessibilityLabel("Send")
            .disabled(sending || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color(.systemBackground))
    }

    private func load() async {
        thread = await model.loadThread(conversationId)
    }

    private func send(body: String, media: String?) async {
        guard let userId = thread?.userId else { return }
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty && media == nil { return }
        sending = true
        defer { sending = false }
        if let message = await model.sendMessage(userId: userId, body: trimmed, mediaBase64: media) {
            error = message
        } else {
            text = ""
            await load()
        }
    }
}

struct MessageBubble: View {
    @Environment(AppModel.self) private var model
    var message: FamilyMessage
    var color: String

    var body: some View {
        HStack {
            if !message.isIncoming { Spacer(minLength: 40) }
            VStack(alignment: message.isIncoming ? .leading : .trailing, spacing: 6) {
                if let path = message.mediaUrl {
                    AuthedImage(path: path, model: model, contentMode: .fit)
                        .frame(maxWidth: 240, maxHeight: 240)
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                }
                if let body = message.body, !body.isEmpty {
                    Text(body)
                        .font(.title3)
                        .padding(12)
                        .background(
                            message.isIncoming ? Color(hex: color).opacity(0.18) : MantelTheme.ember,
                            in: RoundedRectangle(cornerRadius: 18)
                        )
                        .foregroundStyle(message.isIncoming ? .primary : .white)
                }
                HStack(spacing: 6) {
                    if message.status == "failed" {
                        Text(message.errorMessage ?? "Didn't send")
                            .foregroundStyle(MantelTheme.danger)
                    }
                    if let created = message.createdAt {
                        Text(Self.stamp(created))
                            .foregroundStyle(.secondary)
                    }
                }
                .font(.caption)
            }
            if message.isIncoming { Spacer(minLength: 40) }
        }
    }

    private static func stamp(_ iso: String) -> String {
        let date = CalendarDates.parseInstant(iso)
        let f = DateFormatter()
        f.timeStyle = .short
        f.dateStyle = .none
        return f.string(from: date)
    }
}

struct SendDoodleFlow: View {
    var people: [Conversation]
    var onClose: () -> Void
    @Environment(AppModel.self) private var model
    @State private var chosen: Conversation?
    @State private var error: String?
    @State private var sending = false

    var body: some View {
        if let chosen, let userId = chosen.userId {
            DoodleCanvasView { png in
                Task {
                    sending = true
                    if let message = await model.sendMessage(userId: userId, body: "", mediaBase64: png) {
                        error = message
                        sending = false
                    } else {
                        onClose()
                    }
                }
            } onClose: {
                self.chosen = nil
            }
            .overlay {
                if sending { ProgressView("Sending…") }
            }
            .alert("Couldn't send", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(error ?? "")
            }
        } else {
            NavigationStack {
                List(people.filter { $0.userId != nil && !$0.unknown }) { person in
                    Button {
                        chosen = person
                    } label: {
                        HStack(spacing: 14) {
                            PersonDot(name: person.name, color: person.color, emoji: person.avatarEmoji, size: 56)
                            Text("Send to \(person.name)")
                                .font(.title3.weight(.semibold))
                                .foregroundStyle(.primary)
                        }
                        .padding(.vertical, 6)
                    }
                }
                .navigationTitle("Who is it for?")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button(action: onClose) { BackLabel() }
                    }
                }
            }
        }
    }
}
