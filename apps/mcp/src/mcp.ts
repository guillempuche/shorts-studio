/**
 * The MCP server: every operation whose surface is `cli-and-mcp` becomes a tool with the same
 * name (`post_create`). Its parameters match the CLI flags, in camelCase.
 *
 * A failed operation comes back as the tool's JSON result with `isError: true` and the same
 * `{ code, message, fix }` the CLI prints, so an agent always gets the next step. Arguments that
 * don't match the tool's Schema get Effect's own error instead, before any operation runs.
 *
 * Spending tools take `dryRun` but not `yes`: the MCP client's approval prompt does that job (the
 * repository's .claude/settings.json asks before each one).
 */

import { ErrorReport, reportOf } from "@shorts-studio/domain/errors";
import type { Context } from "@shorts-studio/usecases/context";
import { type Operation, toolInputSchema } from "@shorts-studio/usecases/operation";
import type { Ports } from "@shorts-studio/usecases/ports";
import { Effect, Layer, Logger } from "effect";
import { McpProtocol, McpServer, Tool, Toolkit } from "effect/ai";

export const SERVER_INSTRUCTIONS = [
	"shorts-studio turns audio into vertical short videos (Reels, TikTok, Shorts) from AI images timed to the audio.",
	"Start with post_list or post_show: post_show always returns `next`, the exact step to take.",
	"Approving a script or a draft is the user's decision and isn't available as a tool.",
	"Tools that spend money take dryRun: call them with dryRun first and show the user the estimate.",
].join(" ");

export const mcpOperations = (operations: ReadonlyArray<Operation>): ReadonlyArray<Operation> =>
	operations.filter((op) => op.surface === "cli-and-mcp");

// Every tool, one with no parameters too, refuses a field it doesn't take (see toolInputSchema).
const parametersOf = (op: Operation) => toolInputSchema(op);

const toTool = (op: Operation) =>
	Tool.make(op.name, {
		description: op.description,
		parameters: parametersOf(op),
		success: op.output,
		failure: ErrorReport,
		failureMode: "return",
	})
		.annotate(Tool.Readonly, op.hints.readonly)
		.annotate(Tool.Destructive, op.hints.destructive)
		.annotate(Tool.Idempotent, op.hints.idempotent)
		.annotate(Tool.OpenWorld, op.hints.openWorld);

/**
 * The toolkit and its handlers, as one registration layer for any MCP transport. The ports are
 * built once, when the server starts, and every tool call shares them.
 */
export const mcpRegistrations = (operations: ReadonlyArray<Operation>, ctx: Context) => {
	const ops = mcpOperations(operations);
	const toolkit = Toolkit.make(...ops.map(toTool));
	const handlers = Effect.gen(function* () {
		const services = yield* Effect.context<Ports>();
		return toolkit.of(
			Object.fromEntries(
				ops.map((op) => [
					op.name,
					// The input arrives decoded through the tool's Schema, so a boolean left out is false.
					({ dryRun, ...input }: Record<string, unknown>) =>
						op
							.run(input, ctx, { dryRun: dryRun === true, confirmed: true })
							.pipe(Effect.mapError(reportOf), Effect.provide(services)),
				]),
			),
		);
	});
	return McpServer.toolkit(toolkit).pipe(Layer.provide(toolkit.toLayer(handlers)));
};

/**
 * The MCP versions the server speaks, newest first; the tests run on each. A 2026-07-28 client
 * sends no `initialize`. A client that does gets the version it asks for if it's listed, and
 * 2025-11-25 otherwise, whatever the order: `initialize` never picks the stateless 2026-07-28.
 */
export const MCP_PROTOCOLS = [
	McpProtocol.v2026_07_28,
	McpProtocol.v2025_11_25,
	McpProtocol.v2025_06_18,
] as const;

export const mcpServerLayer = (
	operations: ReadonlyArray<Operation>,
	ctx: Context,
	version: string,
) =>
	McpServer.layerStdio({
		name: "shorts-studio",
		version,
		instructions: SERVER_INSTRUCTIONS,
		protocols: MCP_PROTOCOLS,
		registrations: mcpRegistrations(operations, ctx),
	}).pipe(Layer.provideMerge(Layer.succeed(Logger.LogToStderr, true)));
