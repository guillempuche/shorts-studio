#!/usr/bin/env node
/**
 * The entry point: parse the arguments, run the command, set the exit code.
 *
 * `NodeRuntime.runMain` interrupts the program on Ctrl-C or SIGTERM. The cleanup steps then run
 * (locks are released, child processes stopped), and an interrupted run exits 130. A usage error
 * exits 2, not Effect's default 1, so scripts can tell "you called it wrong" from "it failed".
 */

import * as NodeRuntime from "@effect/platform-node-shared/NodeRuntime";
import { exitCodeOf } from "@shorts-studio/domain/errors";
import { mcpServerLayer } from "@shorts-studio/mcp/mcp";
import { providersLayer } from "@shorts-studio/providers/index";
import { makeContext } from "@shorts-studio/providers/node";
import { configCheck } from "@shorts-studio/usecases/operations/config";
import { operations } from "@shorts-studio/usecases/operations/index";
import { Cause, Effect, Exit, Layer, Logger, Runtime } from "effect";
import { CliError, Command } from "effect/cli";
import { aliasCommand, cliOutput, jsonRequested, nounCommands, root } from "./cli.ts";
import { platform } from "./platform.ts";

export const VERSION = "0.1.0";

const ctx = makeContext();
const ports = providersLayer(ctx);

const mcp = Command.make("mcp").pipe(
	Command.withDescription("Model Context Protocol server for AI agents"),
	Command.withSubcommands([
		Command.make("serve", {}, () => Layer.launch(mcpServerLayer(operations, ctx, VERSION))).pipe(
			Command.withDescription("Serve every tool over stdio (point your MCP client here)"),
		),
	]),
);

const json = jsonRequested(process.argv);

// A group of commands given no command (`post`) shows its help and exits 0, but with --json it
// has printed a usage error, so it exits as one.
const isUsageError = (error: unknown): boolean =>
	CliError.isCliError(error) && (error._tag !== "ShowHelp" || error.errors.length > 0 || json);

const teardown: Runtime.Teardown = (exit, onExit) => {
	if (Exit.isFailure(exit) && isUsageError(Cause.squash(exit.cause))) onExit(exitCodeOf("usage"));
	else Runtime.defaultTeardown(exit, onExit);
};

root.pipe(
	Command.withSubcommands([
		...nounCommands(operations, ctx),
		aliasCommand(configCheck, ctx, "doctor"),
		mcp,
	]),
	Command.run({ version: VERSION }),
	Effect.provide(Layer.mergeAll(platform, ports, cliOutput(process.argv))),
	// What runMain would report, reported here instead so it goes to stderr: stdout holds only
	// results and MCP messages.
	Effect.tapCause((cause) =>
		Cause.hasInterruptsOnly(cause) || !Runtime.getErrorReported(Cause.squash(cause))
			? Effect.void
			: Effect.logError(cause),
	),
	Effect.provideService(Logger.LogToStderr, true),
	(program) => NodeRuntime.runMain(program, { teardown, disableErrorReporting: true }),
);
