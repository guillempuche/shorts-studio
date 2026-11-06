#!/usr/bin/env node
/**
 * The entry point: parse the arguments, run the command, set the exit code.
 *
 * `NodeRuntime.runMain` interrupts the program on Ctrl-C or SIGTERM. The cleanup steps then run
 * (locks are released, child processes stopped), and an interrupted run exits 130. A usage error
 * exits 2, not Effect's default 1, so scripts can tell "you called it wrong" from "it failed".
 */

import * as NodeChildProcessSpawner from "@effect/platform-node-shared/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import * as NodePath from "@effect/platform-node-shared/NodePath";
import * as NodeRuntime from "@effect/platform-node-shared/NodeRuntime";
import * as NodeStdio from "@effect/platform-node-shared/NodeStdio";
import * as NodeTerminal from "@effect/platform-node-shared/NodeTerminal";
import { mcpServerLayer } from "@shorts-studio/mcp/mcp";
import { providersLayer } from "@shorts-studio/providers/index";
import { makeContext } from "@shorts-studio/providers/node";
import { configCheck } from "@shorts-studio/usecases/operations/config";
import { operations } from "@shorts-studio/usecases/operations/index";
import { Cause, Effect, Exit, Layer, Runtime } from "effect";
import { CliError, Command } from "effect/cli";
import { aliasCommand, nounCommands, root } from "./cli.ts";

export const VERSION = "0.1.0";

const ctx = makeContext();
const ports = providersLayer(ctx);

const mcp = Command.make("mcp").pipe(
	Command.withDescription("Model Context Protocol server for AI agents"),
	Command.withSubcommands([
		Command.make("serve", {}, () =>
			Layer.launch(
				mcpServerLayer(operations, ctx, ports, VERSION).pipe(Layer.provide(NodeStdio.layer)),
			),
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
	Command.withSubcommands([
		...nounCommands(operations, ctx),
		aliasCommand(configCheck, ctx, "doctor"),
		mcp,
	]),
	Command.run({ version: VERSION }),
	Effect.provide(Layer.mergeAll(platform, ports)),
	(program) => NodeRuntime.runMain(program, { teardown }),
);
