// Runs a built shorts-studio through the commands that lean on its runtime: the CLI, the MCP
// server over stdio, Ctrl-C, time zones and, when ffmpeg is installed, child processes. The tests
// run on Node, but the release binaries are compiled by Bun, so this is where a gap between the
// two shows up, before a release instead of in someone's install. It needs no keys and spends
// nothing: paid services point at a closed port, and nothing is approved.
//   node scripts/smoke-binary.ts <the binary, or bin/shorts-studio>

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const binaryArg = process.argv[2];
if (binaryArg === undefined) {
	console.error("Usage: node scripts/smoke-binary.ts <the binary, or bin/shorts-studio>");
	process.exit(2);
}
const binary = resolve(binaryArg);

const ZONE = "Europe/Madrid";
const root = mkdtempSync(join(tmpdir(), "shorts-smoke-"));
const data = join(root, "data");

// The caller's environment without its keys or shorts-studio settings. Paid services point at a
// port where nothing answers, so a key still found in the macOS Keychain can't spend anything.
const env: NodeJS.ProcessEnv = {
	...Object.fromEntries(
		Object.entries(process.env).filter(([name]) => !/KEY$|^SHORTS_/.test(name)),
	),
	TZ: ZONE,
	SHORTS_DATA_DIR: data,
	SHORTS_POSTS_DIR: join(root, "posts"),
	SHORTS_FAL_URL: "http://127.0.0.1:1",
	SHORTS_TOGETHER_URL: "http://127.0.0.1:1",
};

interface Run {
	readonly status: number | null;
	readonly stdout: string;
	readonly stderr: string;
}

const run = (args: ReadonlyArray<string>): Run => {
	const result = spawnSync(binary, args, { env, encoding: "utf8", timeout: 60_000 });
	return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
};

/** A `--json` run's one object, or undefined when stdout isn't JSON. */
const jsonOf = (result: Run): Record<string, unknown> | undefined => {
	try {
		return JSON.parse(result.stdout) as Record<string, unknown>;
	} catch {
		return undefined;
	}
};

const field = (value: unknown, path: ReadonlyArray<string>): unknown =>
	path.reduce<unknown>(
		(at, key) =>
			typeof at === "object" && at !== null ? (at as Record<string, unknown>)[key] : undefined,
		value,
	);

const failures: Array<string> = [];

/** One check: prints ✓ or ✗, and for ✗ what the binary printed. */
const check = (name: string, ok: boolean, result?: Run): void => {
	console.log(`${ok ? "✓" : "✗"} ${name}`);
	if (ok) return;
	failures.push(name);
	if (result !== undefined) {
		console.log(`    exit ${result.status}`);
		for (const [label, text] of [
			["stdout", result.stdout],
			["stderr", result.stderr],
		] as const) {
			if (text.trim() !== "") console.log(`    ${label}: ${text.trim().slice(0, 600)}`);
		}
	}
};

// The day the binary should see, worked out here with Node's own Intl.
const localDay = new Intl.DateTimeFormat("en-CA", {
	timeZone: ZONE,
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
});

/** Runs a command, with the local day just before and just after, since a run can cross midnight. */
const runAroundDay = (args: ReadonlyArray<string>) => {
	const before = localDay.format(new Date());
	const result = run(args);
	return { result, days: [before, localDay.format(new Date())] };
};

// --- The CLI ------------------------------------------------------------------------------------

const version = run(["--version"]);
check(
	"--version prints a version",
	version.status === 0 && /\d+\.\d+\.\d+/.test(version.stdout),
	version,
);

const help = run(["--help"]);
check("--help lists the commands", help.status === 0 && help.stdout.includes("image"), help);

const schema = run(["schema", "show", "--name", "config", "--json"]);
check(
	"schema show prints config.json's schema",
	schema.status === 0 && JSON.stringify(jsonOf(schema)).includes("monthlyUsd"),
	schema,
);

const models = run(["models", "list", "--json"]);
check(
	"models list names each job's models with their prices",
	models.status === 0 &&
		JSON.stringify(field(jsonOf(models), ["result", "models"])).includes("usdPerUnit"),
	models,
);

const config = run(["config", "show", "--json"]);
check(
	`config show follows TZ (${ZONE})`,
	config.status === 0 && field(jsonOf(config), ["result", "timeZone"]) === ZONE,
	config,
);

// On a machine with every key and tool doctor passes; anywhere else it fails the documented way.
const doctor = run(["config", "check", "--json"]);
const doctorCode = field(jsonOf(doctor), ["error", "code"]);
check(
	"doctor passes, or fails with missing-key or missing-tool",
	(doctor.status === 0 && field(jsonOf(doctor), ["ok"]) === true) ||
		(doctor.status === 1 && (doctorCode === "missing-key" || doctorCode === "missing-tool")),
	doctor,
);

const created = runAroundDay(["post", "create", "--post", "smoke", "--json"]);
const slug = field(jsonOf(created.result), ["result", "slug"]);
check(
	`post create dates the post by TZ (${created.days[0]})`,
	created.days.some((day) => slug === `${day}-smoke`),
	created.result,
);

const budget = runAroundDay(["budget", "show", "--json"]);
const budgetDay = String(field(jsonOf(budget.result), ["result", "day"]));
check(
	"budget show reports today and this month in TZ, with nothing spent",
	budget.result.status === 0 &&
		budget.days.includes(budgetDay) &&
		field(jsonOf(budget.result), ["result", "month"]) === budgetDay.slice(0, 7) &&
		field(jsonOf(budget.result), ["result", "todayUsd"]) === 0,
	budget.result,
);

const images = run(["image", "generate", "--post", String(slug), "--json"]);
check(
	"image generate spends nothing before approval and exits 3",
	images.status === 3 && !existsSync(join(data, "ledger.jsonl")),
	images,
);

const usage = run(["post", "list", "--no-such-flag"]);
check("an unknown flag is a usage error, exit 2", usage.status === 2, usage);

// --- The MCP server over stdio, and Ctrl-C --------------------------------------------------------

/** Waits for `child` to print a JSON-RPC reply with this id, or gives up after `ms`. */
const reply = (child: ChildProcess, id: number, ms: number) =>
	new Promise<Record<string, unknown> | undefined>((done) => {
		let buffered = "";
		const finish = (message: Record<string, unknown> | undefined) => {
			clearTimeout(timer);
			child.stdout?.off("data", onData);
			done(message);
		};
		const onData = (chunk: Buffer) => {
			buffered += chunk.toString("utf8");
			const lines = buffered.split("\n");
			// The last piece may be a line still arriving; keep it for the next chunk.
			buffered = lines.pop() ?? "";
			for (const line of lines) {
				try {
					const message = JSON.parse(line) as Record<string, unknown>;
					if (message["id"] === id) return finish(message);
				} catch {
					// Something else on stdout, not a JSON-RPC message.
				}
			}
		};
		const timer = setTimeout(() => finish(undefined), ms);
		child.stdout?.on("data", onData);
	});

const exitOf = (child: ChildProcess, ms: number) =>
	new Promise<number | string | undefined>((done) => {
		const timer = setTimeout(() => done(undefined), ms);
		child.on("exit", (code, signal) => {
			clearTimeout(timer);
			done(code ?? signal ?? undefined);
		});
	});

const server = spawn(binary, ["mcp", "serve"], { env, stdio: ["pipe", "pipe", "pipe"] });
const send = (message: object) => server.stdin.write(`${JSON.stringify(message)}\n`);
const initialized = reply(server, 1, 20_000);
send({
	jsonrpc: "2.0",
	id: 1,
	method: "initialize",
	params: {
		protocolVersion: "2025-06-18",
		capabilities: {},
		clientInfo: { name: "smoke-test", version: "1" },
	},
});
const hello = await initialized;
check(
	"mcp serve answers initialize over stdio",
	field(hello, ["result", "serverInfo"]) !== undefined,
);

const listed = reply(server, 2, 20_000);
send({ jsonrpc: "2.0", method: "notifications/initialized" });
send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
const tools = (field(await listed, ["result", "tools"]) ?? []) as Array<{ name: string }>;
const names = tools.map((tool) => tool.name);
check(
	"mcp serve lists the tools, without the user's own decisions",
	names.includes("image_generate") && !names.includes("script_approve"),
);

// Windows has no SIGINT to send; there the server is only stopped.
if (process.platform === "win32") {
	server.kill();
	await exitOf(server, 10_000);
} else {
	const exited = exitOf(server, 10_000);
	server.kill("SIGINT");
	const code = await exited;
	check(`Ctrl-C stops mcp serve with exit 130 (got ${code})`, code === 130);
}

// --- Child processes: ffmpeg ----------------------------------------------------------------------

const ffmpeg = spawnSync("ffmpeg", ["-version"], { env });
if (ffmpeg.status !== 0) {
	console.log("- ffmpeg isn't installed: skipped source import and transcription");
} else {
	const tone = join(root, "tone.wav");
	spawnSync(
		"ffmpeg",
		["-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", tone],
		{
			env,
		},
	);
	const imported = run([
		"source",
		"import",
		"--post",
		String(slug),
		"--file",
		tone,
		"--origin",
		"mine",
		"--kind",
		"speech",
		"--json",
	]);
	const seconds = Number(field(jsonOf(imported), ["result", "durationSec"]));
	check(
		`source import converts the audio with ffmpeg (${seconds.toFixed(1)} s)`,
		imported.status === 0 && Math.abs(seconds - 2) < 0.2,
		imported,
	);

	const estimate = run(["audio", "transcribe", "--post", String(slug), "--dry-run", "--json"]);
	check(
		"audio transcribe --dry-run estimates a price and sends nothing",
		estimate.status === 0 &&
			Number(field(jsonOf(estimate), ["result", "estimateUsd"])) > 0 &&
			!existsSync(join(data, "ledger.jsonl")),
		estimate,
	);
}

rmSync(root, { recursive: true, force: true });
if (failures.length > 0) {
	console.log(`\n${failures.length} check${failures.length === 1 ? "" : "s"} failed.`);
	process.exit(1);
}
console.log("\nThe binary works.");
