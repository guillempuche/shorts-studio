/**
 * Dollar amounts in words and in results. Prices here are fractions of a cent (a second of audio,
 * one megapixel), so two decimals would show $0.0003 as $0.00 and a $0.003 spend against a
 * $0.004 cap as "$0.00 of $0.00". These show as many decimals as it takes, up to six.
 */

const MIN_DECIMALS = 2;
/** Amounts are kept to millionths of a dollar (`roundUsd`), so more decimals show nothing. */
const MAX_DECIMALS = 6;

/** `x` to millionths of a dollar, so float sums ($0.1 + $0.2) don't reach a result. */
export const roundUsd = (x: number): number => Math.round(x * 1e6) / 1e6;

/** How many digits show in `text`, a fixed-point number, after its leading zeros. */
const significantDigits = (text: string): number =>
	text.replace(/^[-0.]+/, "").replace(".", "").length;

/** The fewest decimals, from two to six, at which `x` shows two significant digits. */
const decimalsFor = (x: number): number => {
	for (let decimals = MIN_DECIMALS; decimals < MAX_DECIMALS; decimals++) {
		if (significantDigits(x.toFixed(decimals)) >= 2) return decimals;
	}
	return MAX_DECIMALS;
};

/** `x` with `decimals` decimals, less the trailing zeros past the first `keep`. */
const fixed = (x: number, decimals: number, keep: number): string => {
	const text = x.toFixed(decimals);
	const point = text.indexOf(".");
	let end = text.length;
	while (point >= 0 && end > point + 1 + keep && text[end - 1] === "0") end--;
	return `$${text.slice(0, end)}`;
};

/**
 * One amount: at least two decimals, and more, up to six, until two significant digits show.
 * So $0.0003, $0.012, $0.072, $0.50, $2.00. An amount above $0 never shows as $0.00.
 */
export const usd = (x: number): string => {
	if (x < 0) return `-${usd(-x)}`;
	const text = fixed(x, decimalsFor(x), MIN_DECIMALS);
	return x > 0 && text === "$0.00" ? "<$0.000001" : text;
};

/**
 * An amount and the cap it's compared with, both with the fewest decimals at which they differ
 * when they differ, so $0.003 of a $0.004 cap doesn't read as the whole cap. Each still shows at
 * least as many as `usd` would give it.
 */
export const usdOf = (amount: number, cap: number): readonly [string, string] => {
	let decimals = MIN_DECIMALS;
	while (decimals < MAX_DECIMALS && amount.toFixed(decimals) === cap.toFixed(decimals)) decimals++;
	if (amount.toFixed(decimals) === cap.toFixed(decimals)) return [usd(amount), usd(cap)];
	const shown = (x: number) => {
		const text = fixed(x, Math.max(decimals, decimalsFor(x)), decimals);
		// Below a millionth, only `usd`'s "<$0.000001" keeps it from reading as nothing.
		return x > 0 && Number(text.slice(1)) === 0 ? usd(x) : text;
	};
	return [shown(amount), shown(cap)];
};
