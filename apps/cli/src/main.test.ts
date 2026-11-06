import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "@shorts-studio/usecases/testing";
import { describe, expect, it } from "vitest";

const MAIN = join(import.meta.dirname, "main.ts");

/** Starts `shorts-studio <args>` as a real process, with its data in a temporary folder. */
const start = (args: ReadonlyArray<string>) => {
	const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", MAIN, ...args], {
		stdio: ["pipe", "pipe", "pipe"],
		env: { ...process.env, SHORTS_DATA_DIR: tempDir() },
	});
	let stderr = "";
	child.stderr.on("data", (chunk: Buffer) => {
		stderr += chunk.toString();
	});
	const exited = new Promise<{ code: number | null; stderr: string }>((resolve) =>
		child.on("close", (code) => resolve({ code, stderr })),
	);
	return { child, exited };
};

describe("shorts-studio", () => {
	it("should exit 130 when interrupted with SIGINT", async () => {
		// GIVEN the MCP server running as a real process, waiting for input
		const { child, exited } = start(["mcp", "serve"]);
		await new Promise((resolve) => setTimeout(resolve, 1500));

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
