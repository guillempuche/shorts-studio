/**
 * Building next steps, for results and errors alike. Kept apart from `operations/post.ts`, which
 * imports `post-store.ts`, so the store, the inputs and the ledger can build steps too.
 */

import type { NextStep } from "@shorts-studio/domain/next-step";
import { commandPath, flagName } from "./operation.ts";

type Arg = string | boolean;

/** A value the agent fills in before running the step, such as `<final.mp4>`. */
const PLACEHOLDER = /^<[^<>]+>$/;

/**
 * `value` as one shell word: as it is when that's safe, else in single quotes. A placeholder stays
 * as written, so it still reads as one.
 */
export const shellWord = (value: string): string =>
	/^[\w@%+=:,./-]+$/.test(value) || PLACEHOLDER.test(value)
		? value
		: `'${value.replaceAll("'", "'\\''")}'`;

/** The terminal command for a tool call: `image_generate { post, dryRun }` → `image generate --post … --dry-run`. */
export const cliOf = (tool: string, args: Readonly<Record<string, Arg>>, yes = false): string =>
	[
		...commandPath(tool),
		...Object.entries(args).flatMap(([key, value]) =>
			value === true
				? [`--${flagName(key)}`]
				: value === false
					? []
					: [`--${flagName(key)}`, shellWord(value)],
		),
		...(yes ? ["--yes"] : []),
	].join(" ");

interface StepOptions {
	readonly note?: string;
	readonly or?: boolean;
	/** On the CLI the real run of a spending command needs `--yes`; over MCP the client asks. */
	readonly yes?: boolean;
}

/** An agent's step: an MCP tool call and the same command for the terminal. */
export const agentStep = (
	tool: string,
	args: Readonly<Record<string, Arg>>,
	{ note, or, yes = false }: StepOptions = {},
): NextStep => {
	const fill = Object.entries(args)
		.filter(([, value]) => typeof value === "string" && PLACEHOLDER.test(value))
		.map(([key]) => key);
	return {
		by: "agent",
		...(or ? { or } : {}),
		cli: cliOf(tool, args, yes),
		tool,
		args: { ...args },
		...(fill.length === 0 ? {} : { fill }),
		...(note === undefined ? {} : { note }),
	};
};

/** A step for the user to take, such as an approval, which no agent can run. */
export const userStep = (cli: string | undefined, note?: string): NextStep => ({
	by: "user",
	...(cli === undefined ? {} : { cli }),
	...(note === undefined ? {} : { note }),
});

/** How `beat set --beats` takes each beat, for fixes and notes. */
export const BEAT_ITEM = '[{"beat": 0, "moment": "hook", "prompt": "a red door"}, …]';

/** A step with nothing to run, such as applying review notes. */
export const agentNote = (note: string): NextStep => ({ by: "agent", note });
