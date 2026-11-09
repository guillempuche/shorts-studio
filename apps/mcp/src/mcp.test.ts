import type { Context } from "@shorts-studio/usecases/context";
import { operations } from "@shorts-studio/usecases/operations/index";
import type { Ports } from "@shorts-studio/usecases/ports";
import { testContext } from "@shorts-studio/usecases/test/context";
import { fakeImageMaker, fakePorts } from "@shorts-studio/usecases/test/fakes";
import { readyForImages, seedPost } from "@shorts-studio/usecases/test/posts";
import { Effect, Fiber, Layer } from "effect";
import { McpProtocol, McpTest } from "effect/ai";
import { describe, expect, it, vi } from "vitest";
import { mcpOperations, mcpRegistrations } from "./mcp.ts";

/** Connects an in-memory MCP client to the server and runs `use` with it. */
const withClient = <A, E>(
	ctx: Context,
	ports: Layer.Layer<Ports>,
	use: (client: McpTest.Client) => Effect.Effect<A, E>,
) =>
	Effect.runPromise(
		Effect.scoped(
			McpTest.makeClient(mcpRegistrations(operations, ctx).pipe(Layer.provide(ports)), {
				protocols: [McpProtocol.v2025_11_25],
			}).pipe(Effect.flatMap(use)),
		),
	);

describe("MCP tools", () => {
	it("should offer every shared operation as a tool with the same parameters as the CLI", async () => {
		// GIVEN the registry
		const ctx = testContext();

		// WHEN an MCP client lists the tools
		const { tools } = await withClient(ctx, fakePorts(), (client) => client.listTools());

		// THEN each shared operation is a tool whose properties are its parameters, and dryRun when it spends
		const byName = new Map(tools.map((t) => [t.name, t]));
		for (const op of mcpOperations(operations)) {
			const schema = byName.get(op.name)?.inputSchema as { properties?: object } | undefined;
			expect(schema, op.name).toBeDefined();
			const expected = [...Object.keys(op.params), ...(op.spends ? ["dryRun"] : [])].sort();
			expect(Object.keys(schema?.properties ?? {}).sort(), op.name).toEqual(expected);
		}
		// AND decisions that belong to the user are not tools
		expect(byName.has("script_approve")).toBe(false);
		expect(byName.has("post_review")).toBe(false);
		expect(tools).toHaveLength(mcpOperations(operations).length);
	});

	it("should return a failure as the documented code, message and fix", async () => {
		// GIVEN no posts
		const ctx = testContext();

		// WHEN a client asks for a post that doesn't exist
		const result = await withClient(ctx, fakePorts(), (client) =>
			client.callTool({ name: "post_show", arguments: { post: "nope" } }),
		);

		// THEN the call is marked as an error
		expect(result.isError).toBe(true);
		// AND its text is the same code, message and fix the CLI prints
		const [content] = result.content;
		const report = JSON.parse(content?.type === "text" ? content.text : "{}") as object;
		expect(Object.keys(report).sort()).toEqual(["code", "fix", "message"]);
		expect(report).toMatchObject({ code: "not-found", fix: "List posts with: post list" });
	});

	it("should spend without --yes, since the client's approval is the gate, and honour dryRun", async () => {
		// GIVEN a post ready for images
		const ctx = testContext();
		await seedPost(ctx, "2026-11-04-mcp", readyForImages());
		const maker = fakeImageMaker();
		const ports = fakePorts({ imageMaker: maker });

		// WHEN a client asks for a dry run, then for the images
		const dry = await withClient(ctx, ports, (client) =>
			client.callTool({
				name: "image_generate",
				arguments: { post: "2026-11-04-mcp", dryRun: true },
			}),
		);
		const submitsAfterDryRun = maker.submits.length;
		const real = await withClient(ctx, ports, (client) =>
			client.callTool({ name: "image_generate", arguments: { post: "2026-11-04-mcp" } }),
		);

		// THEN the dry run spent nothing
		expect(dry.isError).not.toBe(true);
		expect(submitsAfterDryRun).toBe(0);
		// AND the real call paid for both images
		expect(real.isError).not.toBe(true);
		expect(maker.submits).toHaveLength(2);
	});

	it("should stop a tool's work when the client cancels the call", async () => {
		// GIVEN a post ready for images, and a provider that never finishes an image
		const ctx = testContext();
		await seedPost(ctx, "2026-11-04-mcp", readyForImages());
		let waiting = 0;
		let stopped = 0;
		const maker = {
			...fakeImageMaker(),
			collect: () =>
				Effect.sync(() => {
					waiting += 1;
				}).pipe(
					Effect.andThen(Effect.never),
					Effect.onInterrupt(() =>
						Effect.sync(() => {
							stopped += 1;
						}),
					),
				),
		};

		// WHEN a client asks for the images, then cancels while they're being made
		await withClient(ctx, fakePorts({ imageMaker: maker }), (client) =>
			Effect.gen(function* () {
				const call = yield* Effect.forkChild(
					client.callTool({ name: "image_generate", arguments: { post: "2026-11-04-mcp" } }),
				);
				yield* Effect.promise(() => vi.waitUntil(() => waiting > 0));
				yield* Fiber.interrupt(call);
				// THEN the tool's work is interrupted while the server still runs, which is what
				// aborts fetches and stops child processes
				yield* Effect.promise(() => vi.waitUntil(() => stopped > 0));
			}),
		);
		expect(stopped).toBeGreaterThan(0);
	});

	it("should build the providers once for all the calls a server answers", async () => {
		// GIVEN providers that count how often they're built
		const ctx = testContext();
		let builds = 0;
		const ports = Layer.unwrap(
			Effect.sync(() => {
				builds += 1;
				return fakePorts();
			}),
		);

		// WHEN one client makes three calls
		await withClient(ctx, ports, (client) =>
			Effect.forEach([1, 2, 3], () => client.callTool({ name: "post_list", arguments: {} })),
		);

		// THEN the providers were built once, when the server started
		expect(builds).toBe(1);
	});
});
