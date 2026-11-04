/**
 * The MCP surface: every operation whose surface is `cli-and-mcp` becomes a tool named after
 * it (`post_create`), with the same parameters as the CLI flags in camelCase.
 *
 * Failures come back as the tool's JSON result with `isError: true` and the same
 * `{ code, message, fix }` the CLI prints, so an agent always gets the next step. Spending tools
 * take `dryRun`; there is no `yes`, because the MCP client's approval prompt is the gate
 * (the repository's .claude/settings.json asks before each one).
 */

import { Layer, Logger, type Schema } from "effect";
import { McpProtocol, McpServer, Tool, Toolkit } from "effect/ai";
import type { Context } from "../core/context.ts";
import { ShortsError } from "../core/errors.ts";
import { type Operation, toolInputSchema } from "../core/operation.ts";

export const SERVER_INSTRUCTIONS = [
	"shorts-studio turns audio into vertical short videos (Reels, TikTok, Shorts) from AI images timed to the audio.",
	"Start with post_list or post_show: post_show always returns `next`, the exact step to take.",
	"Approving a script or a draft is the user's decision and isn't available as a tool.",
	"Tools that spend money take dryRun: call them with dryRun first and show the user the estimate.",
].join(" ");

export const mcpOperations = (operations: ReadonlyArray<Operation>): ReadonlyArray<Operation> =>
	operations.filter((op) => op.surface === "cli-and-mcp");

// MCP requires an object root for parameters; an empty Struct doesn't encode to one.
const parametersOf = (op: Operation) =>
	Object.keys(op.params).length === 0 && !op.spends
		? Tool.EmptyParams
		: (toolInputSchema(op) as Schema.Struct<Schema.Struct.Fields>);

const toTool = (op: Operation) =>
	Tool.make(op.name, {
		description: op.description,
		parameters: parametersOf(op),
		success: op.output,
		failure: ShortsError,
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
export const mcpRegistrations = (operations: ReadonlyArray<Operation>, ctx: Context) => {
	const ops = mcpOperations(operations);
	// The toolkit is assembled at runtime from the registry, so its precise tuple type isn't
	// known to TypeScript; each handler is checked against its tool's Schema when called.
	const toolkit = Toolkit.make(...(ops.map(toTool) as [ReturnType<typeof toTool>]));
	const handlers: Record<string, (params: Record<string, unknown>) => unknown> = {};
	for (const op of ops) {
		handlers[op.name] = (params) =>
			op.run(normalize(op, params) as never, ctx, {
				dryRun: params["dryRun"] === true,
				confirmed: true,
			});
	}
	return McpServer.toolkit(toolkit).pipe(
		Layer.provide(toolkit.toLayer(handlers as never)),
	) as Layer.Layer<never, never, McpServer.McpServer>;
};

export const mcpServerLayer = (
	operations: ReadonlyArray<Operation>,
	ctx: Context,
	version: string,
) =>
	McpServer.layerStdio({
		name: "shorts-studio",
		version,
		instructions: SERVER_INSTRUCTIONS,
		protocols: [McpProtocol.v2025_11_25, McpProtocol.v2025_06_18],
		registrations: mcpRegistrations(operations, ctx),
	}).pipe(Layer.provideMerge(Layer.succeed(Logger.LogToStderr, true)));
