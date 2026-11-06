/**
 * Runs the CLI in-process against a test Context and returns what it printed, so tests check
 * real argument parsing and output without spawning a process.
 */

import * as NodeChildProcessSpawner from "@effect/platform-node-shared/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import * as NodePath from "@effect/platform-node-shared/NodePath";
import * as NodeStdio from "@effect/platform-node-shared/NodeStdio";
import * as NodeTerminal from "@effect/platform-node-shared/NodeTerminal";
import { Effect, Exit, Layer } from "effect";
import { Command } from "effect/cli";
import { TestConsole } from "effect/testing";
import { nounCommands, root } from "../../src/app/cli.ts";
import type { Context } from "../../src/core/context.ts";
import { operations } from "../../src/operations/index.ts";

const platform = Layer.mergeAll(
	NodeFileSystem.layer,
	NodePath.layer,
	NodeTerminal.layer,
	NodeStdio.layer,
	NodeChildProcessSpawner.layer.pipe(
		Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
	),
	TestConsole.layer,
);

export interface CliRun {
	readonly ok: boolean;
	readonly out: string;
	readonly err: string;
}

export const runCli = (ctx: Context, argv: ReadonlyArray<string>): Promise<CliRun> =>
	Effect.runPromise(
		Effect.gen(function* () {
			const program = root.pipe(Command.withSubcommands(nounCommands(operations, ctx)));
			const exit = yield* Effect.exit(Command.runWith(program, { version: "0.0.0" })([...argv]));
			return {
				ok: Exit.isSuccess(exit),
				out: (yield* TestConsole.logLines).join("\n"),
				err: (yield* TestConsole.errorLines).join("\n"),
			};
			// The CLI's environment is fully provided above; the cast drops its requirement type.
		}).pipe(Effect.provide(platform)) as Effect.Effect<CliRun>,
	);
