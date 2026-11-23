import XCTest
@testable import Mantel

final class ServerAddressTests: XCTestCase {
    func testNormalizeAddsDefaultPort() {
        XCTAssertEqual(ServerAddress.normalize("10.0.15.178"), "http://10.0.15.178:8080")
        XCTAssertEqual(ServerAddress.normalize("http://10.0.15.178"), "http://10.0.15.178:8080")
        XCTAssertEqual(ServerAddress.normalize("https://calendar.example"), "https://calendar.example")
        XCTAssertNil(ServerAddress.normalize(""))
        XCTAssertNil(ServerAddress.normalize("ftp://10.0.15.178"))
        XCTAssertNil(ServerAddress.normalize("http://user:pass@10.0.15.178"))
    }

    func testCleartextPermittedForPrivateAndVPN() {
        XCTAssertTrue(ServerAddress.cleartextPermitted("http://10.0.15.178:8080"))
        XCTAssertTrue(ServerAddress.cleartextPermitted("http://192.168.1.20"))
        XCTAssertTrue(ServerAddress.cleartextPermitted("http://familycal.local"))
        XCTAssertTrue(ServerAddress.cleartextPermitted("http://100.64.1.2"))
        XCTAssertTrue(ServerAddress.cleartextPermitted("https://example.com"))
        XCTAssertFalse(ServerAddress.cleartextPermitted("http://8.8.8.8"))
        XCTAssertFalse(ServerAddress.cleartextPermitted("http://1.1.1.1:8080"))
    }

    func testPairCodeIgnoresDashAndCase() {
        XCTAssertEqual(ServerAddress.normalizePairCode("k7nq-4rmp"), "K7NQ4RMP")
        XCTAssertTrue(ServerAddress.pairCodeComplete("K7NQ-4RMP"))
        XCTAssertFalse(ServerAddress.pairCodeComplete("K7NQ4RM"))
        XCTAssertFalse(ServerAddress.pairCodeComplete("K7NQ0RMP")) // 0 is not in the alphabet
    }

    func testParsePairingLink() {
        let raw = "mantel://pair?v=1&base=http%3A%2F%2F10.0.15.178%3A8080&code=K7NQ-4RMP"
        let link = ServerAddress.parsePairingLink(raw)
        XCTAssertEqual(link?.base, "http://10.0.15.178:8080")
        XCTAssertEqual(link?.code, "K7NQ4RMP")
        XCTAssertNil(ServerAddress.parsePairingLink("https://example.com"))
    }

    func testProbeScheduleTriesSavedFirst() {
        let steps = ServerAddress.probeSchedule(saved: "10.0.15.178")
        XCTAssertEqual(steps.first?.origin, "http://10.0.15.178:8080")
        XCTAssertEqual(steps.filter { $0.saved }.count, 2)
        XCTAssertEqual(steps.last?.origin, ServerAddress.familyCalOrigin)
    }
}

final class RecurrenceTests: XCTestCase {
    func testBuildAndParseWeekly() {
        var choice = RepeatChoice(freq: .weekly, byday: ["WE", "MO"], until: "2026-12-31")
        let rule = Recurrence.build(choice)
        XCTAssertEqual(rule, "FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231T235959")
        let parsed = Recurrence.parse(rule)
        XCTAssertEqual(parsed.freq, .weekly)
        XCTAssertEqual(parsed.byday, ["MO", "WE"])
        XCTAssertEqual(parsed.until, "2026-12-31")
    }

    func testNoneIsNil() {
        XCTAssertNil(Recurrence.build(RepeatChoice()))
        XCTAssertEqual(Recurrence.parse(nil).freq, .none)
    }
}

final class LiveParserTests: XCTestCase {
    func testChangeFrame() {
        var parser = SseParser()
        XCTAssertTrue(parser.feed("id: 12").isEmpty)
        XCTAssertTrue(parser.feed("event: change").isEmpty)
        XCTAssertTrue(parser.feed("data: {\"topics\":[\"messages\",\"events\"]}").isEmpty)
        let messages = parser.feed("")
        guard case .change(let id, let topics)? = messages.first else {
            return XCTFail("expected a change event")
        }
        XCTAssertEqual(id, 12)
        XCTAssertEqual(topics, ["messages", "events"])
    }
}

final class CalendarDatesTests: XCTestCase {
    func testAllDaySpanIsExclusiveEnd() {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(secondsFromGMT: 0)!
        let start = cal.date(from: DateComponents(year: 2026, month: 11, day: 22))!
        let (from, to) = CalendarDates.allDaySpan(startDay: start, endDay: start, calendar: cal)
        XCTAssertEqual(from, "2026-11-22T00:00:00Z")
        XCTAssertEqual(to, "2026-11-23T00:00:00Z")
    }
}
