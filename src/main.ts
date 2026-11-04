/**
 * The entry point: parse the arguments, run the command, set the exit code.
 *
 * `NodeRuntime.runMain` interrupts the program on SIGINT/SIGTERM, so finalisers run (locks are
 * released, child processes stopped) and an interrupted run exits 130. A usage error exits 2
 * rather than Effect's default 1, so scripts can tell "you called it wrong" from "it failed".
 */

import * as NodeChildProcessSpawner from "@effect/platform-node-shared/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import * as NodePath from "@effect/platform-node-shared/NodePath";
import * as NodeRuntime from "@effect/platform-node-shared/NodeRuntime";
import * as NodeStdio from "@effect/platform-node-shared/NodeStdio";
import * as NodeTerminal from "@effect/platform-node-shared/NodeTerminal";
import { Cause, Effect, Exit, Layer, Runtime } from "effect";
import { CliError, Command } from "effect/cli";
import { nounCommands, root } from "./app/cli.ts";
import { mcpServerLayer } from "./app/mcp.ts";
import { makeContext } from "./core/context.ts";
import { operations } from "./operations/index.ts";

export const VERSION = "0.1.0";

const ctx = makeContext();

const mcp = Command.make("mcp").pipe(
	Command.withDescription("Model Context Protocol server for AI agents"),
	Command.withSubcommands([
		Command.make("serve", {}, () =>
			Layer.launch(mcpServerLayer(operations, ctx, VERSION).pipe(Layer.provide(NodeStdio.layer))),
		).pipe(Command.withDescription("Serve every tool over stdio (point your MCP client here)")),
	]),
);

const platform = Layer.mergeAll(
	NodeFileSystem.layer,
	NodePath.layer,
	NodeTerminal.layer,
	NodeStdio.layer,
	NodeChildProcessSpawner.layer.pipe(
		Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
	),
);

const isUsageError = (error: unknown): boolean =>
	CliError.isCliError(error) && (error._tag !== "ShowHelp" || error.errors.length > 0);

const teardown: Runtime.Teardown = (exit, onExit) => {
	if (Exit.isFailure(exit) && isUsageError(Cause.squash(exit.cause))) onExit(2);
	else Runtime.defaultTeardown(exit, onExit);
};

root.pipe(
	Command.withSubcommands([...nounCommands(operations, ctx), mcp]),
	Command.run({ version: VERSION }),
	Effect.provide(platform),
	(program) => NodeRuntime.runMain(program, { teardown }),
);
