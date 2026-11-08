import { DateTime } from "effect";
import { describe, expect, it } from "vitest";
import { localDays } from "./days.ts";

const zone = (name: string) => DateTime.zoneMakeNamedUnsafe(name);
const at = (iso: string) => new Date(iso);

describe("localDays", () => {
	it("should already be the next day far east of UTC, from local midnight", () => {
		// GIVEN Kiritimati (UTC+14), at 10:30 UTC on 4 November
		// WHEN its local calendar is read
		const days = localDays(zone("Pacific/Kiritimati"), at("2026-11-04T10:30:00Z"));

		// THEN it is 5 November there, which began at 10:00 UTC
		expect(days).toMatchObject({ today: "2026-11-05", startOfToday: "2026-11-04T10:00:00.000Z" });
	});

	it("should still be the day before far west of UTC", () => {
		// GIVEN Pago Pago (UTC−11), at 10:30 UTC on 4 November
		// WHEN its local calendar is read
		const days = localDays(zone("Pacific/Pago_Pago"), at("2026-11-04T10:30:00Z"));

		// THEN it is still 3 November there, which began at 11:00 UTC that day
		expect(days).toMatchObject({ today: "2026-11-03", startOfToday: "2026-11-03T11:00:00.000Z" });
	});

	it("should change day on a 45-minute offset at its own midnight", () => {
		// GIVEN Kathmandu (UTC+5:45), a millisecond before and at 18:15 UTC on 4 November
		const before = localDays(zone("Asia/Kathmandu"), at("2026-11-04T18:14:59.999Z"));
		const after = localDays(zone("Asia/Kathmandu"), at("2026-11-04T18:15:00.000Z"));

		// THEN the first is still 4 November, and the second is 5 November from that instant
		expect(before.today).toBe("2026-11-04");
		expect(after).toMatchObject({ today: "2026-11-05", startOfToday: "2026-11-04T18:15:00.000Z" });
	});

	it("should still be last month on the month's last evening west of UTC", () => {
		// GIVEN New York at 22:30 on 30 November (03:30 UTC on 1 December)
		// WHEN its local calendar is read
		const days = localDays(zone("America/New_York"), at("2026-12-01T03:30:00Z"));

		// THEN it is November there, which began at local midnight on the 1st (summer time, UTC−4)
		expect(days).toMatchObject({ month: "2026-11", startOfMonth: "2026-11-01T04:00:00.000Z" });
	});

	it("should start a day whose midnight doesn't exist at its first real instant", () => {
		// GIVEN Santiago on 6 September 2026, when 00:00 jumps to 01:00 for summer time
		// WHEN its local calendar is read that afternoon, and just before the jump
		const afternoon = localDays(zone("America/Santiago"), at("2026-09-06T15:00:00Z"));
		const justBefore = localDays(zone("America/Santiago"), at("2026-09-06T03:59:59.999Z"));

		// THEN the day began at 01:00 local, 04:00 UTC
		expect(afternoon.startOfToday).toBe("2026-09-06T04:00:00.000Z");
		// AND a millisecond earlier it was still 5 September
		expect(justBefore.today).toBe("2026-09-05");
	});

	it("should start a day with two midnights at the first one", () => {
		// GIVEN Havana on 1 November 2026, when 01:00 falls back to 00:00 for winter time
		// WHEN its local calendar is read at noon, and at the second 00:30
		const noon = localDays(zone("America/Havana"), at("2026-11-01T12:00:00Z"));
		const secondMidnight = localDays(zone("America/Havana"), at("2026-11-01T05:30:00Z"));

		// THEN the day and the month began at the first midnight, 04:00 UTC
		expect(noon).toMatchObject({
			startOfToday: "2026-11-01T04:00:00.000Z",
			startOfMonth: "2026-11-01T04:00:00.000Z",
		});
		// AND the second 00:30 is still the same day
		expect(secondMidnight.today).toBe("2026-11-01");
	});

	it("should give the instant it was read at, as the ledger writes it", () => {
		// GIVEN an instant
		// WHEN its local calendar is read
		const days = localDays(zone("Europe/Madrid"), at("2026-11-04T09:00:00Z"));

		// THEN it carries that instant in the ledger's form
		expect(days.at).toBe("2026-11-04T09:00:00.000Z");
	});
});
