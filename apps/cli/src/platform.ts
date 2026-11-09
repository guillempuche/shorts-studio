/**
 * What `effect/cli` needs from Node: files, paths, the terminal, stdio, and a process spawner.
 */

import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import * as NodePath from "@effect/platform-node-shared/NodePath";
import * as NodeStdio from "@effect/platform-node-shared/NodeStdio";
import * as NodeTerminal from "@effect/platform-node-shared/NodeTerminal";
import { Effect, Layer } from "effect";
import { ChildProcessSpawner } from "effect/process";

// effect/cli's types require a spawner, but it never starts a process. A stub keeps Effect's
// spawner from being used by mistake: programs run through `runProcess` (see "Why spawn" in
// docs/architecture.md#key-decisions).
const noSpawner = Layer.succeed(
	ChildProcessSpawner.ChildProcessSpawner,
	ChildProcessSpawner.make(() =>
		Effect.die(new Error("Start programs with runProcess (docs/architecture.md#key-decisions).")),
	),
);

export const platform = Layer.mergeAll(
	NodeFileSystem.layer,
	NodePath.layer,
	NodeTerminal.layer,
	NodeStdio.layer,
	noSpawner,
);
