import SwiftUI

struct MealsView: View {
    @Environment(AppModel.self) private var model
    @State private var weekStart = Date()
    @State private var editing: MealEdit?

    private let meals = ["breakfast", "lunch", "dinner"]
    private let labels = ["Breakfast", "Lunch", "Dinner"]

    var body: some View {
        let days = (0..<7).compactMap { model.calendar.date(byAdding: .day, value: $0, to: weekStart) }
        List {
            ForEach(days, id: \.timeIntervalSince1970) { day in
                Section(CalendarDates.dayLabel(day, calendar: model.calendar)) {
                    ForEach(Array(meals.enumerated()), id: \.offset) { index, meal in
                        let key = "\(CalendarDates.ymd(day, calendar: model.calendar)):\(meal)"
                        Button {
                            editing = MealEdit(day: day, meal: meal, title: model.meals[key] ?? "")
                        } label: {
                            HStack {
                                Text(labels[index]).foregroundStyle(.secondary)
                                Spacer()
                                Text(model.meals[key] ?? "Add")
                                    .foregroundStyle(model.meals[key] == nil ? MantelTheme.ember : .primary)
                            }
                            .font(.title3)
                            .frame(minHeight: 44)
                        }
                    }
                }
            }
        }
        .navigationTitle("Meal plan")
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button {
                    weekStart = model.calendar.date(byAdding: .day, value: -7, to: weekStart) ?? weekStart
                    Task { await model.loadMeals(around: weekStart) }
                } label: { Image(systemName: "chevron.left").frame(width: 44, height: 44) }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    weekStart = model.calendar.date(byAdding: .day, value: 7, to: weekStart) ?? weekStart
                    Task { await model.loadMeals(around: weekStart) }
                } label: { Image(systemName: "chevron.right").frame(width: 44, height: 44) }
            }
        }
        .task {
            weekStart = CalendarDates.startOfWeek(Date(), calendar: model.calendar)
            await model.loadMeals(around: weekStart)
        }
        .sheet(item: $editing) { item in
            MealEditor(item: item) { title in
                Task {
                    await model.saveMeal(day: item.day, meal: item.meal, title: title)
                    editing = nil
                }
            } onClose: { editing = nil }
        }
    }
}

struct MealEdit: Identifiable {
    var day: Date
    var meal: String
    var title: String
    var id: String { "\(day.timeIntervalSince1970)-\(meal)" }
}

private struct MealEditor: View {
    var item: MealEdit
    var onSave: (String) -> Void
    var onClose: () -> Void
    @State private var title = ""

    var body: some View {
        NavigationStack {
            Form {
                TextField("What's for \(item.meal)?", text: $title)
                    .font(.title3)
                WarmButton(title: "Save") { onSave(title) }
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            }
            .navigationTitle(item.meal.capitalized)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(action: onClose) { BackLabel() }
                }
            }
            .onAppear { title = item.title }
        }
        .presentationDetents([.medium])
    }
}
