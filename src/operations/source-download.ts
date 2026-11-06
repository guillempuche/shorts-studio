/**
 * Saved collections: reels and TikToks you saved from others, kept under `<posts>/saved/<name>/`
 * (urls.txt, downloaded.txt, audio/, transcripts/), and single reels downloaded into a post.
 *
 * Downloads use your own yt-dlp (never bundled: Instagram and TikTok break old versions often),
 * pause between requests so the account isn't rate-limited or flagged, and keep a download
 * archive so re-running fetches only new posts. They are CLI-only: an agent shouldn't fetch
 * from platforms with your browser session. Browser cookies (needed for Instagram) are opt-in
 * through `download.cookiesFromBrowser` in config.json. Platform terms and rights are yours.
 */

import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { Effect, Schema } from "effect";
import { attempt, failWith } from "../core/attempt.ts";
import type { Context } from "../core/context.ts";
import { fail, type ShortsError } from "../core/errors.ts";
import { writeFileAtomic } from "../core/files.ts";
import { requireSecret } from "../core/inputs.ts";
import { defineOperation, p } from "../core/operation.ts";
import { postDir, readPost } from "../core/post-store.ts";
import { Kind, Origin } from "../domain/post.ts";
import { TOGETHER_MODEL, transcribe } from "../work/together.ts";
import { sourceImport } from "./source.ts";

const COLLECTION = /^[a-z0-9][a-z0-9-]{0,99}$/;

export const savedPath = (ctx: Context, collection: string): string =>
	join(ctx.paths.posts, "saved", collection);

const checkCollection = (name: string): Effect.Effect<string, ShortsError> =>
	COLLECTION.test(name)
		? Effect.succeed(name)
		: Effect.fail(
				fail(
					"usage",
					`"${name}" isn't a valid collection name.`,
					"Use lowercase letters, digits and dashes, e.g. sm-awareness.",
				),
			);

/** yt-dlp arguments shared by every download: audio only, mp3, polite pauses. */
const ytDlpArgs = (ctx: Context): ReadonlyArray<string> => [
	...(ctx.config.download?.cookiesFromBrowser !== undefined
		? ["--cookies-from-browser", ctx.config.download.cookiesFromBrowser]
		: []),
	"--extract-audio",
	"--audio-format",
	"mp3",
	"--sleep-interval",
	"5",
	"--max-sleep-interval",
	"15",
	"--no-progress",
];

const ytDlpFix =
	"Common causes: not logged in to the platform in the browser named in download.cookiesFromBrowser, a private or deleted post, a photo post with no audio, a rate limit (wait, then re-run), or an old yt-dlp (pip install -U yt-dlp).";

const countDownloaded = (dir: string): number =>
	existsSync(join(dir, "downloaded.txt"))
		? readFileSync(join(dir, "downloaded.txt"), "utf8")
				.split("\n")
				.filter((line) => line.trim() !== "").length
		: 0;

export const sourceDownload = defineOperation({
	name: "source_download",
	description:
		"Download audio with yt-dlp: every URL in a saved collection's urls.txt (--collection), or one URL into a post (--url with --post). Re-running fetches only what's new. CLI only.",
	params: {
		collection: p.optional(
			p.string("Saved collection under <posts>/saved/ whose urls.txt to download"),
		),
		url: p.optional(p.string("One reel or TikTok URL (with --post)")),
		post: p.optional(p.string("Post to import the downloaded audio into (with --url)")),
		origin: p.optional(
			p.literals(Origin.literals, "Who made the audio, for --url (default: others)"),
		),
		kind: p.optional(p.literals(Kind.literals, "speech or music, for --url (default: speech)")),
	},
	output: Schema.Struct({
		downloaded: Schema.Int,
		failed: Schema.Boolean,
		dir: Schema.String,
		next: Schema.String,
	}),
	surface: "cli-only",
	spends: false,
	hints: { readonly: false, destructive: false, idempotent: true, openWorld: true },
	run: (input, ctx, mode) =>
		Effect.gen(function* () {
			if (input.collection !== undefined) {
				const name = yield* checkCollection(input.collection);
				const dir = savedPath(ctx, name);
				if (!existsSync(join(dir, "urls.txt"))) {
					return yield* fail(
						"not-found",
						`No ${join(dir, "urls.txt")}.`,
						"Collect the post URLs first (see docs/getting-started.md), one per line.",
					);
				}
				const before = countDownloaded(dir);
				ctx.log(`Downloading ${name} (pausing 5–15 s between posts)…`);
				const result = yield* attempt(
					(signal) =>
						ctx.run(
							"yt-dlp",
							[
								...ytDlpArgs(ctx),
								"--download-archive",
								"downloaded.txt",
								"--output",
								"audio/%(id)s.%(ext)s",
								"--batch-file",
								"urls.txt",
							],
							{ signal, cwd: dir },
						),
					failWith("missing-tool", "Install yt-dlp: pip install -U yt-dlp"),
				);
				const downloaded = countDownloaded(dir) - before;
				if (result.code !== 0)
					ctx.log(
						result.stderr
							.split("\n")
							.filter((l) => l.includes("ERROR"))
							.join("\n"),
					);
				return {
					downloaded,
					failed: result.code !== 0,
					dir,
					next:
						result.code !== 0
							? `${ytDlpFix} Then re-run to retry.`
							: `source transcribe --collection ${name}`,
				};
			}
			if (input.url !== undefined && input.post !== undefined) {
				yield* readPost(ctx, input.post);
				const audioDir = join(postDir(ctx, input.post), "audio");
				mkdirSync(audioDir, { recursive: true });
				const dir = mkdtempSync(join(audioDir, "download-"));
				const result = yield* attempt(
					(signal) =>
						ctx.run("yt-dlp", [...ytDlpArgs(ctx), "--output", "%(id)s.%(ext)s", input.url ?? ""], {
							signal,
							cwd: dir,
						}),
					failWith("missing-tool", "Install yt-dlp: pip install -U yt-dlp"),
				);
				const file = readdirSync(dir).find((name) => name.endsWith(".mp3"));
				if (result.code !== 0 || file === undefined) {
					return yield* fail("provider", `yt-dlp couldn't download ${input.url}.`, ytDlpFix);
				}
				const imported = yield* sourceImport.run(
					{
						post: input.post,
						file: join(dir, file),
						origin: input.origin ?? "others",
						kind: input.kind ?? "speech",
					},
					ctx,
					mode,
				);
				return { downloaded: 1, failed: false, dir, next: imported.next };
			}
			return yield* fail(
				"usage",
				"Nothing to download.",
				"Pass --collection <name>, or --url <url> with --post <slug>.",
			);
		}),
	render: (o) =>
		`${o.failed ? "Some downloads failed. " : ""}Downloaded ${o.downloaded} new into ${o.dir}\nNext: ${o.next}`,
});

export const sourceAdopt = defineOperation({
	name: "source_adopt",
	description:
		"Bring an existing download folder (urls.txt, downloaded.txt, audio/, transcripts/, e.g. from the old ig-saved.sh) into <posts>/saved/<collection>. Copies; never overwrites.",
	params: {
		from: p.string("The existing folder"),
		collection: p.string("Name for the saved collection"),
	},
	output: Schema.Struct({ dir: Schema.String, audio: Schema.Int, transcripts: Schema.Int }),
	surface: "cli-and-mcp",
	spends: false,
	hints: { readonly: false, destructive: false, idempotent: false, openWorld: false },
	run: (input, ctx) =>
		Effect.gen(function* () {
			const name = yield* checkCollection(input.collection);
			const from = resolve(input.from);
			const dir = savedPath(ctx, name);
			if (!existsSync(from)) {
				return yield* fail("not-found", `No folder at ${from}.`, "Check the path.");
			}
			if (existsSync(dir)) {
				return yield* fail(
					"conflict",
					`The collection ${name} already exists at ${dir}.`,
					"Pick another name, or move the existing folder away first.",
				);
			}
			mkdirSync(dir, { recursive: true });
			for (const entry of ["urls.txt", "downloaded.txt", "audio", "transcripts"]) {
				if (existsSync(join(from, entry)))
					cpSync(join(from, entry), join(dir, entry), { recursive: true, errorOnExist: true });
			}
			const count = (sub: string) =>
				existsSync(join(dir, sub)) ? readdirSync(join(dir, sub)).length : 0;
			return { dir, audio: count("audio"), transcripts: count("transcripts") };
		}),
	render: (o) => `Adopted into ${o.dir}: ${o.audio} audio files, ${o.transcripts} transcripts.`,
});

export const sourceTranscribe = defineOperation({
	name: "source_transcribe",
	description:
		"Transcribe every downloaded audio file of a saved collection with word timings (transcripts/<id>.json and .txt). Skips files already transcribed; language auto-detected unless given.",
	params: {
		collection: p.string("Saved collection under <posts>/saved/"),
		language: p.optional(p.string("Two-letter language code to force (es, en, ca…)")),
	},
	output: Schema.Struct({
		transcribed: Schema.Int,
		skipped: Schema.Int,
		failed: Schema.Array(Schema.String),
	}),
	surface: "cli-and-mcp",
	spends: false,
	hints: { readonly: false, destructive: false, idempotent: true, openWorld: true },
	run: (input, ctx) =>
		Effect.gen(function* () {
			const name = yield* checkCollection(input.collection);
			const dir = savedPath(ctx, name);
			const audioDir = join(dir, "audio");
			if (!existsSync(audioDir)) {
				return yield* fail(
					"not-found",
					`No audio in ${dir}.`,
					`Download it first: source download --collection ${name}`,
				);
			}
			const key = yield* requireSecret(ctx, "TOGETHER_API_KEY");
			mkdirSync(join(dir, "transcripts"), { recursive: true });
			const files = readdirSync(audioDir)
				.filter((f) => /\.(mp3|m4a|wav)$/i.test(f))
				.sort();
			const transcriptOf = (file: string, ext: string) =>
				join(dir, "transcripts", `${basename(file).replace(/\.[^.]+$/, "")}.${ext}`);
			const todo = files.filter((file) => !existsSync(transcriptOf(file, "json")));
			// Every file is tried; a failed one is listed and retried on the next run.
			const [done, failed] = yield* Effect.partition(todo, (file) =>
				Effect.sync(() => ctx.log(`transcribing ${file}`)).pipe(
					Effect.andThen(
						attempt(
							(signal) => transcribe(ctx, key, join(audioDir, file), input.language, signal),
							failWith("provider", "Check the key and your connection (VPN?), then re-run."),
						),
					),
					Effect.map((transcript) => {
						writeFileAtomic(
							transcriptOf(file, "json"),
							`${JSON.stringify({ ...transcript, model: TOGETHER_MODEL }, null, 2)}\n`,
						);
						writeFileAtomic(transcriptOf(file, "txt"), `${transcript.text}\n`);
						return file;
					}),
					Effect.mapError((error) => `${file}: ${error.message}`),
				),
			);
			return { transcribed: done.length, skipped: files.length - todo.length, failed };
		}),
	render: (o) =>
		[
			`Transcribed ${o.transcribed}, already done ${o.skipped}, failed ${o.failed.length}.`,
			...o.failed.map((line) => `  ✗ ${line}`),
			...(o.failed.length > 0 ? ["Re-run to retry only the failed files."] : []),
		].join("\n"),
});
