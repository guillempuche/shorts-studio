import { spawn } from "node:child_process";
import { join } from "node:path";
import * as NodeChildProcessSpawner from "@effect/platform-node-shared/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import * as NodePath from "@effect/platform-node-shared/NodePath";
import * as NodeStdio from "@effect/platform-node-shared/NodeStdio";
import * as NodeTerminal from "@effect/platform-node-shared/NodeTerminal";
import { Effect, Layer } from "effect";
import { McpProtocol, McpTest } from "effect/ai";
import { Command } from "effect/cli";
import { TestConsole } from "effect/testing";
import { afterEach, describe, expect, it } from "vitest";
import { nounCommands, root } from "../src/app/cli.ts";
import { mcpOperations, mcpRegistrations } from "../src/app/mcp.ts";
import { commandPath } from "../src/core/operation.ts";
import { operations } from "../src/operations/index.ts";
import { makeTestContext, type TestContext } from "./support/context.ts";

let ctx: TestContext;
afterEach(() => ctx?.cleanup());

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

/** Runs the CLI in-process and returns what it printed. */
const cli = (argv: ReadonlyArray<string>) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const program = root.pipe(Command.withSubcommands(nounCommands(operations, ctx)));
			const exit = yield* Effect.exit(Command.runWith(program, { version: "0.0.0" })([...argv]));
			return {
				exit,
				out: (yield* TestConsole.logLines).join("\n"),
				err: (yield* TestConsole.errorLines).join("\n"),
			};
		}).pipe(Effect.provide(platform)) as Effect.Effect<{ exit: unknown; out: string; err: string }>,
	);

describe("CLI", () => {
	it("should print one JSON envelope with --json", async () => {
		// GIVEN a post
		ctx = makeTestContext();
		await cli(["post", "create", "--post", "demo"]);
		// WHEN posts are listed as JSON
		const { out } = await cli(["post", "list", "--json"]);
		// THEN stdout is one JSON object with the result
		const parsed = JSON.parse(out) as { ok: boolean; result: { posts: Array<{ slug: string }> } };
		expect(parsed.ok).toBe(true);
		expect(parsed.result.posts[0]?.slug).toBe("2026-11-04-demo");
	});

	it("should print the error's code, message and fix as JSON when a command fails", async () => {
		// GIVEN no posts
		ctx = makeTestContext();
		// WHEN a missing post is shown with --json
		const { out } = await cli(["post", "show", "--post", "nope", "--json"]);
		// THEN the envelope carries the error with its fix
		const parsed = JSON.parse(out) as { ok: boolean; error: { code: string; fix: string } };
		expect(parsed.ok).toBe(false);
		expect(parsed.error.code).toBe("not-found");
		expect(parsed.error.fix).toContain("post list");
	});
});

describe("CLI and MCP parity", () => {
	it("should expose every shared operation as an MCP tool with the same parameters", async () => {
		// GIVEN the registry
		ctx = makeTestContext();
		// WHEN an MCP client lists the tools
		const tools = await Effect.runPromise(
			Effect.scoped(
				McpTest.makeClient(mcpRegistrations(operations, ctx), {
					protocols: [McpProtocol.v2025_11_25],
				}).pipe(Effect.flatMap((client) => client.listTools())),
			),
		);
		// THEN each shared operation is a tool whose properties are its parameters (+ dryRun when it spends)
		const byName = new Map(tools.tools.map((t) => [t.name, t]));
		for (const op of mcpOperations(operations)) {
			const tool = byName.get(op.name);
			expect(tool, op.name).toBeDefined();
			const expected = [...Object.keys(op.params), ...(op.spends ? ["dryRun"] : [])].sort();
			const schema = tool?.inputSchema as { properties?: object } | undefined;
			expect(Object.keys(schema?.properties ?? {}).sort()).toEqual(expected);
		}
		// AND decisions that belong to the user are not tools
		expect(byName.has("script_approve")).toBe(false);
		expect(tools.tools).toHaveLength(mcpOperations(operations).length);
	});

	it("should give every operation a noun-verb CLI command", () => {
		// GIVEN the registry
		ctx = makeTestContext();
		// WHEN the CLI is built
		const nouns = new Set(nounCommands(operations, ctx).map((c) => c.name));
		// THEN each operation's noun is a command group
		for (const op of operations) expect(nouns.has(commandPath(op.name)[0])).toBe(true);
	});
});

describe("signals", () => {
	it("should exit 130 when interrupted with SIGINT", async () => {
		// GIVEN the MCP server running as a real process, waiting for input
		const child = spawn(
			process.execPath,
			[
				"--disable-warning=ExperimentalWarning",
				join(import.meta.dirname, "..", "src", "main.ts"),
				"mcp",
				"serve",
			],
			{
				stdio: ["pipe", "pipe", "pipe"],
			},
		);
		await new Promise((r) => setTimeout(r, 1500));
		// WHEN it receives SIGINT
		child.kill("SIGINT");
		const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
		// THEN it stops cleanly with the interrupted exit code
		expect(code).toBe(130);
	}, 15_000);
});
