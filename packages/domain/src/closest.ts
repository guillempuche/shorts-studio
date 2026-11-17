/**
 * The name someone most likely meant, for "did you mean" in errors: a setting, a variable, a flag.
 */

/**
 * The candidate `name` most likely meant, ignoring case: one that `name` is the start of
 * (`daily` → `dailyUsd`, the shortest if several), else the nearest by edit distance, within a
 * third of `name`'s length. Undefined when none is that close: guessing further would mislead,
 * so the caller lists the candidates instead.
 */
export const closest = (name: string, candidates: ReadonlyArray<string>): string | undefined => {
	const wanted = name.toLowerCase();
	if (wanted === "") return undefined;
	const completion = candidates
		.filter((candidate) => candidate.toLowerCase().startsWith(wanted))
		.reduce<string | undefined>(
			(shortest, candidate) =>
				shortest === undefined || candidate.length < shortest.length ? candidate : shortest,
			undefined,
		);
	if (completion !== undefined) return completion;

	let nearest: { readonly candidate: string; readonly distance: number } | undefined;
	for (const candidate of candidates) {
		const distance = editDistance(wanted, candidate.toLowerCase());
		if (nearest === undefined || distance < nearest.distance) nearest = { candidate, distance };
	}
	return nearest !== undefined && nearest.distance <= Math.floor(name.length / 3)
		? nearest.candidate
		: undefined;
};

/** How many characters to add, remove or change to turn `a` into `b` (Levenshtein). */
const editDistance = (a: string, b: string): number => {
	// One row of the table at a time: the distances from a's first i characters to each prefix of b.
	let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const current = [i];
		for (let j = 1; j <= b.length; j++) {
			const change = a[i - 1] === b[j - 1] ? 0 : 1;
			current[j] = Math.min(
				(previous[j] ?? 0) + 1,
				(current[j - 1] ?? 0) + 1,
				(previous[j - 1] ?? 0) + change,
			);
		}
		previous = current;
	}
	return previous[b.length] ?? 0;
};
