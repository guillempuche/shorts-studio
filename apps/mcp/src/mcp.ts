/**
 * The MCP server: every operation whose surface is `cli-and-mcp` becomes a tool with the same
 * name (`post_create`). Its parameters match the CLI flags, in camelCase.
 *
 * A failure comes back as the tool's JSON result with `isError: true` and the same
 * `{ code, message, fix }` the CLI prints, so an agent always gets the next step. Spending tools
 * take `dryRun` but not `yes`: the MCP client's approval prompt does that job (the repository's
 * .claude/settings.json asks before each one).
 */

import { ErrorReport, reportOf } from "@shorts-studio/domain/errors";
import type { Context } from "@shorts-studio/usecases/context";
import { type Operation, toolInputSchema } from "@shorts-studio/usecases/operation";
import type { Ports } from "@shorts-studio/usecases/ports";
import { Effect, Layer, Logger, type Schema } from "effect";
import { McpProtocol, McpServer, Tool, Toolkit } from "effect/ai";

export const SERVER_INSTRUCTIONS = [
	"shorts-studio turns audio into vertical short videos (Reels, TikTok, Shorts) from AI images timed to the audio.",
	"Start with post_list or post_show: post_show always returns `next`, the exact step to take.",
	"Approving a script or a draft is the user's decision and isn't available as a tool.",
	"Tools that spend money take dryRun: call them with dryRun first and show the user the estimate.",
].join(" ");

export const mcpOperations = (operations: ReadonlyArray<Operation>): ReadonlyArray<Operation> =>
	operations.filter((op) => op.surface === "cli-and-mcp");

// MCP requires a tool's parameters to be an object, and an empty Struct doesn't encode to one.
const parametersOf = (op: Operation) =>
	Object.keys(op.params).length === 0 && !op.spends
		? Tool.EmptyParams
		: (toolInputSchema(op) as Schema.Struct<Schema.Struct.Fields>);

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

const normalize = (op: Operation, params: Record<string, unknown>): Record<string, unknown> => {
	const input: Record<string, unknown> = {};
	for (const [key, param] of Object.entries(op.params)) input[key] = param.normalize(params[key]);
	return input;
};

/** The toolkit and its handlers, as one registration layer for any MCP transport. */
export const mcpRegistrations = (
	operations: ReadonlyArray<Operation>,
	ctx: Context,
	ports: Layer.Layer<Ports>,
) => {
	const ops = mcpOperations(operations);
	// The toolkit is built at runtime from the registry, so TypeScript can't know its exact
	// tuple type. Each handler is checked against its tool's Schema when it's called.
	const toolkit = Toolkit.make(...(ops.map(toTool) as [ReturnType<typeof toTool>]));
	// The ports are built once, when the server starts, and every tool call shares them.
	const handlers = Effect.gen(function* () {
		const services = yield* Effect.context<Ports>();
		const byName: Record<string, (params: Record<string, unknown>) => unknown> = {};
		for (const op of ops) {
			byName[op.name] = (params) =>
				op
					.run(normalize(op, params), ctx, { dryRun: params["dryRun"] === true, confirmed: true })
					.pipe(Effect.mapError(reportOf), Effect.provide(services));
		}
		return byName;
	});
	return McpServer.toolkit(toolkit).pipe(
		Layer.provide(toolkit.toLayer(handlers as never).pipe(Layer.provide(ports))),
	) as Layer.Layer<never, never, McpServer.McpServer>;
};

export const mcpServerLayer = (
	operations: ReadonlyArray<Operation>,
	ctx: Context,
	ports: Layer.Layer<Ports>,
	version: string,
) =>
	McpServer.layerStdio({
		name: "shorts-studio",
		version,
		instructions: SERVER_INSTRUCTIONS,
		protocols: [McpProtocol.v2025_11_25, McpProtocol.v2025_06_18],
		registrations: mcpRegistrations(operations, ctx, ports),
	}).pipe(Layer.provideMerge(Layer.succeed(Logger.LogToStderr, true)));
