import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "@shorts-studio/usecases/test/context";
import { describe, expect, it } from "vitest";

const MAIN = join(import.meta.dirname, "main.ts");

/** Starts `shorts-studio <args>` as a real process, with its data in a temporary folder. */
const start = (args: ReadonlyArray<string>) => {
	const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", MAIN, ...args], {
		stdio: ["pipe", "pipe", "pipe"],
		env: { ...process.env, SHORTS_DATA_DIR: tempDir() },
	});
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (chunk: Buffer) => {
		stdout += chunk.toString();
	});
	child.stderr.on("data", (chunk: Buffer) => {
		stderr += chunk.toString();
	});
	const exited = new Promise<{ code: number | null; stderr: string }>((resolve) =>
		child.on("close", (code) => resolve({ code, stderr })),
	);
	/** Resolves once stdout contains `text`. */
	const printed = (text: string) =>
		new Promise<void>((resolve) => {
			const check = () => {
				if (!stdout.includes(text)) return;
				child.stdout.off("data", check);
				resolve();
			};
			child.stdout.on("data", check);
			check();
		});
	return { child, exited, printed };
};

/** An MCP `initialize` request: the server answers it only once it's fully running. */
const INITIALIZE = `${JSON.stringify({
	jsonrpc: "2.0",
	id: 1,
	method: "initialize",
	params: {
		protocolVersion: "2025-11-25",
		capabilities: {},
		clientInfo: { name: "test", version: "0" },
	},
})}\n`;

describe("shorts-studio", () => {
	it("should exit 130 when interrupted with SIGINT", async () => {
		// GIVEN the MCP server running as a real process, which has answered a first request
		const { child, exited, printed } = start(["mcp", "serve"]);
		child.stdin.write(INITIALIZE);
		await printed('"id":1');

		// WHEN it receives SIGINT
		child.kill("SIGINT");

		// THEN it stops cleanly with the interrupted exit code
		expect((await exited).code).toBe(130);
	}, 15_000);

	it("should exit 2 when a command is called with a flag it doesn't have", async () => {
		// GIVEN no running process
		// WHEN a command is given an unknown flag
		const { exited } = start(["post", "list", "--colour", "red"]);

		// THEN it exits with the usage code
		expect((await exited).code).toBe(2);
	}, 15_000);

	it("should exit 2 with one JSON object when a group of commands gets no command, with --json", async () => {
		// GIVEN no running process
		// WHEN `post` is run with no command after it, asking for JSON
		const { exited, child } = start(["post", "--json"]);
		let stdout = "";
		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});

		// THEN it exits with the usage code, and stdout is one usage error object
		expect((await exited).code).toBe(2);
		expect((JSON.parse(stdout) as { error: { code: string } }).error.code).toBe("usage");
	}, 15_000);

	it("should report the version package.json declares", () => {
		// GIVEN the package's version and the CLI's version constant
		const pkg = JSON.parse(
			readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8"),
		) as {
			version: string;
		};
		const main = readFileSync(MAIN, "utf8");

		// THEN they are the same (main.ts can't be imported: it runs the CLI)
		expect(main).toContain(`export const VERSION = "${pkg.version}";`);
	});
});
