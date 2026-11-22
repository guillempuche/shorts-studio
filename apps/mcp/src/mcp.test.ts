import type { Context } from "@shorts-studio/usecases/context";
import { operations } from "@shorts-studio/usecases/operations/index";
import type { Ports } from "@shorts-studio/usecases/ports";
import { readPost } from "@shorts-studio/usecases/post-store";
import { testContext } from "@shorts-studio/usecases/test/context";
import { fakeImageMaker, fakePorts } from "@shorts-studio/usecases/test/fakes";
import { readyForImages, seedPost } from "@shorts-studio/usecases/test/posts";
import { Effect, Fiber, Layer } from "effect";
import { McpTest } from "effect/ai";
import { describe, expect, it, vi } from "vitest";
import { MCP_PROTOCOLS, mcpOperations, mcpRegistrations, SERVER_INSTRUCTIONS } from "./mcp.ts";

type Version = (typeof MCP_PROTOCOLS)[number]["protocolVersion"];

const VERSIONS: ReadonlyArray<Version> = MCP_PROTOCOLS.map((protocol) => protocol.protocolVersion);

describe("the server's instructions", () => {
	it("should say how to read a fix and an error's next steps", () => {
		// GIVEN the instructions a client reads when it connects
		// THEN they say how a CLI command maps to a tool, and whose step is whose
		expect(SERVER_INSTRUCTIONS).toContain("noun_verb");
		expect(SERVER_INSTRUCTIONS).toContain("nextSteps");
		expect(SERVER_INSTRUCTIONS).toContain("`user`");
	});
});

// Every case runs once per version the server offers, against the server's own list.
describe.each(VERSIONS)("MCP tools on %s", (version) => {
	/** Connects an in-memory MCP client speaking `version` to the server and runs `use` with it. */
	const withClient = <A, E>(
		ctx: Context,
		ports: Layer.Layer<Ports>,
		use: (client: McpTest.Client) => Effect.Effect<A, E>,
	) =>
		Effect.runPromise(
			Effect.scoped(
				McpTest.makeClient(mcpRegistrations(operations, ctx).pipe(Layer.provide(ports)), {
					protocols: MCP_PROTOCOLS,
					protocolVersion: version,
				}).pipe(Effect.flatMap(use)),
			),
		);

	it("should answer the client in the version it speaks", async () => {
		// GIVEN the server's list of versions
		const ctx = testContext();

		// WHEN a client speaking this version connects
		const spoken = await withClient(ctx, fakePorts(), (client) =>
			Effect.succeed(client.protocolVersion),
		);

		// THEN the server answers in that version
		expect(spoken).toBe(version);
	});

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

	it("should not mark image_generate idempotent, since calling it twice with reroll pays twice", async () => {
		// GIVEN the registry
		const ctx = testContext();

		// WHEN an MCP client lists the tools
		const { tools } = await withClient(ctx, fakePorts(), (client) => client.listTools());

		// THEN image_generate isn't idempotent, so a client won't retry it on its own
		const imageGenerate = tools.find((tool) => tool.name === "image_generate");
		expect(imageGenerate?.annotations?.idempotentHint).toBe(false);
	});

	it("should return a failure as the documented code, message, fix and next steps", async () => {
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
		expect(Object.keys(report).sort()).toEqual(["code", "fix", "message", "nextSteps"]);
		expect(report).toMatchObject({ code: "not-found", fix: "List posts with: post list" });
		// AND its first step is the agent's post_list
		expect(report).toMatchObject({ nextSteps: [{ by: "agent", tool: "post_list", args: {} }] });
	});

	it("should list in budget_show's result a config.json that can't be used, since MCP shows no stderr", async () => {
		// GIVEN a config.json that isn't valid JSON, so the caps are the defaults
		const ctx = testContext({
			settingsIssues: [
				{ source: "/data/config.json", risk: "caps", text: "Unexpected end of JSON input" },
			],
		});

		// WHEN a client calls budget_show
		const result = await withClient(ctx, fakePorts(), (client) =>
			client.callTool({ name: "budget_show", arguments: {} }),
		);

		// THEN the result names config.json and the problem
		expect(result.isError).not.toBe(true);
		const [content] = result.content;
		const output = JSON.parse(content?.type === "text" ? content.text : "{}");
		expect(output.settingsIssues).toEqual([
			{ source: "/data/config.json", risk: "caps", text: "Unexpected end of JSON input" },
		]);
		// AND it says each cap is the default
		expect(output.capsFrom).toEqual({
			dailyUsd: "default",
			monthlyUsd: "default",
			postUsd: "default",
		});
	});

	it("should refuse a field the tool doesn't take, rather than drop it and spend", async () => {
		// GIVEN a post ready for images
		const ctx = testContext();
		await seedPost(ctx, "2026-11-04-mcp", readyForImages());
		const maker = fakeImageMaker();

		// WHEN a client asks for images with dryRun misspelt as dry_run
		const text = await withClient(ctx, fakePorts({ imageMaker: maker }), (client) =>
			client
				.callTool({ name: "image_generate", arguments: { post: "2026-11-04-mcp", dry_run: true } })
				.pipe(
					// 2025-06-18 answers with a protocol error, the newer versions with a tool error.
					Effect.map((result) => {
						expect(result.isError).toBe(true);
						const [content] = result.content;
						return content?.type === "text" ? content.text : "";
					}),
					Effect.catch((error) => Effect.succeed(error.message)),
				),
		);

		// THEN nothing was sent to the provider
		expect(maker.submits).toHaveLength(0);
		// AND the error names the field and the fields the tool takes
		expect(text).toContain("dry_run");
		expect(text).toContain("dryRun");
	});

	it("should publish every tool's input as taking no other field", async () => {
		// GIVEN the registry
		const ctx = testContext();

		// WHEN a client lists the tools
		const { tools } = await withClient(ctx, fakePorts(), (client) => client.listTools());

		// THEN every tool's input schema says it takes no other field
		for (const tool of tools) {
			const schema = tool.inputSchema as { additionalProperties?: unknown };
			expect(schema.additionalProperties, tool.name).toBe(false);
		}
	});

	it("should refuse a field inside a list, changing no beat", async () => {
		// GIVEN a post with beats
		const ctx = testContext();
		await seedPost(ctx, "2026-11-04-mcp", readyForImages());

		// WHEN a client sets a beat with prompt misspelt as promt
		const text = await withClient(ctx, fakePorts(), (client) =>
			client
				.callTool({
					name: "beat_set",
					arguments: { post: "2026-11-04-mcp", beats: [{ beat: 0, promt: "x" }] },
				})
				.pipe(
					Effect.map((result) => {
						expect(result.isError).toBe(true);
						const [content] = result.content;
						return content?.type === "text" ? content.text : "";
					}),
					Effect.catch((error) => Effect.succeed(error.message)),
				),
		);

		// THEN the error names the field
		expect(text).toContain("promt");
		// AND beat 0 keeps its prompt
		const post = await Effect.runPromise(readPost(ctx, "2026-11-04-mcp"));
		expect(post.beats?.items[0]?.prompt).toBe("a red door");
	});

	it("should refuse a field on a tool that takes none", async () => {
		// GIVEN the server
		const ctx = testContext();

		// WHEN a client calls config_show with a field it doesn't take
		const text = await withClient(ctx, fakePorts(), (client) =>
			client.callTool({ name: "config_show", arguments: { verbose: true } }).pipe(
				Effect.map((result) => {
					expect(result.isError).toBe(true);
					const [content] = result.content;
					return content?.type === "text" ? content.text : "";
				}),
				Effect.catch((error) => Effect.succeed(error.message)),
			),
		);

		// THEN the error names the field and says the tool takes nothing
		expect(text).toContain("verbose");
		expect(text).toContain("It takes: nothing");
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

describe("beat_set over MCP, with the beats as text", () => {
	it("should take the beats as JSON text as well as a list", async () => {
		// GIVEN a post with beats
		const ctx = testContext();
		await seedPost(ctx, "2026-11-04-text", readyForImages());

		// WHEN a client passes the beats as the JSON text the step's note shows
		const result = await Effect.runPromise(
			Effect.scoped(
				McpTest.makeClient(mcpRegistrations(operations, ctx).pipe(Layer.provide(fakePorts())), {
					protocols: MCP_PROTOCOLS,
					protocolVersion: VERSIONS[0],
				}).pipe(
					Effect.flatMap((client) =>
						client.callTool({
							name: "beat_set",
							arguments: {
								post: "2026-11-04-text",
								beats: '[{"beat": 0, "prompt": "a green door"}]',
							},
						}),
					),
				),
			),
		);

		// THEN beat 0 has that prompt
		expect(result.isError).not.toBe(true);
		const post = await Effect.runPromise(readPost(ctx, "2026-11-04-text"));
		expect(post.beats?.items[0]?.prompt).toBe("a green door");
	});
});
