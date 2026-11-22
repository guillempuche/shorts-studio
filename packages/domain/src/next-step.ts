/**
 * A step that moves the work on, as data an agent can act on. Results return them as
 * `nextSteps`, and so do errors whose fix names a step: the same shape in both places, so an
 * agent reads its next move without parsing prose.
 */

import { Schema } from "effect";

/**
 * One step. An agent's step names its MCP tool and arguments; `cli` is the same command for the
 * terminal, without the program's name, like every `fix`. A user's step (an approval, setting a
 * key) has no tool. `or` marks a step that replaces the one before.
 */
export const NextStep = Schema.Struct({
	by: Schema.Literals(["agent", "user"]),
	or: Schema.optionalKey(Schema.Boolean),
	cli: Schema.optionalKey(Schema.String),
	tool: Schema.optionalKey(Schema.String),
	args: Schema.optionalKey(
		Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Boolean])),
	),
	/** The arguments whose value is a placeholder (`<final.mp4>`): the agent fills them in first. */
	fill: Schema.optionalKey(Schema.Array(Schema.String)),
	note: Schema.optionalKey(Schema.String),
});
export type NextStep = typeof NextStep.Type;
