/**
 * Saved collections: reels and TikToks you saved from others, kept under `<posts>/saved/<name>/`
 * (urls.txt, downloaded.txt, audio/, transcripts/), and single reels downloaded into a post.
 *
 * Downloads keep a list of what was downloaded, so running again fetches only new posts. They
 * are CLI-only: an agent shouldn't fetch from platforms with your browser session. Platform
 * terms and rights are your responsibility.
 */

import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { fail, type ShortsError } from "@shorts-studio/domain/errors";
import { audioAmount } from "@shorts-studio/domain/models";
import { Kind, Origin, Transcript } from "@shorts-studio/domain/post";
import { Effect, Schema } from "effect";
import type { Context } from "../context.ts";
import { ensureDir, fileStep, readText, writeFileAtomic, writeJsonFile } from "../files.ts";
import { checkLanguage, requireKey } from "../inputs.ts";
import { paidCall } from "../ledger.ts";
import { chooseModel, costOf } from "../models.ts";
import { defineOperation, p, type RunMode } from "../operation.ts";
import { Downloader, MediaTools, Transcriber } from "../ports.ts";
import { postDir, readPost } from "../post-store.ts";
import { sourceImport } from "./source.ts";

const COLLECTION_NAME = /^[a-z0-9][a-z0-9-]{0,99}$/;

/** A saved collection's transcript also says which model made it, so old ones can be found. */
const SavedTranscript = Schema.Struct({ ...Transcript.fields, model: Schema.String });

export const savedPath = (ctx: Context, collection: string): string =>
	join(ctx.paths.posts, "saved", collection);

const checkCollection = (name: string): Effect.Effect<string, ShortsError> =>
	COLLECTION_NAME.test(name)
		? Effect.succeed(name)
		: Effect.fail(
				fail(
					"usage",
					`"${name}" isn't a valid collection name.`,
					"Use lowercase letters, digits and dashes, e.g. sm-awareness.",
				),
			);

const downloadFix =
	"Common causes: not logged in to the platform in the browser named in download.cookiesFromBrowser, a private or deleted post, a photo post with no audio, a rate limit (wait, then run it again), or an old yt-dlp (pip install -U yt-dlp).";

const countDownloaded = (dir: string): Effect.Effect<number, ShortsError> => {
	const file = join(dir, "downloaded.txt");
	return Effect.suspend(() =>
		existsSync(file) ? readText(file, "Run the download again.") : Effect.succeed(""),
	).pipe(Effect.map((text) => text.split("\n").filter((line) => line.trim() !== "").length));
};

export const sourceDownload = defineOperation({
	name: "source_download",
	description:
		"Download audio with yt-dlp: every URL in a saved collection's urls.txt (--collection), or one URL into a post (--url with --post). Running it again fetches only what's new. CLI only.",
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
			const downloader = yield* Downloader;
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
				const before = yield* countDownloaded(dir);
				ctx.log(`Downloading ${name} (pausing 5–15 s between posts)…`);
				const result = yield* downloader.downloadList({
					cwd: dir,
					urlsFile: "urls.txt",
					archiveFile: "downloaded.txt",
					output: "audio/%(id)s.%(ext)s",
				});
				if (!result.ok) ctx.log(result.errors);
				return {
					downloaded: (yield* countDownloaded(dir)) - before,
					failed: !result.ok,
					dir,
					next: result.ok
						? `source transcribe --collection ${name}`
						: `${downloadFix} Then run it again to retry.`,
				};
			}

			if (input.url !== undefined && input.post !== undefined) {
				yield* readPost(ctx, input.post);
				const audioDir = join(postDir(ctx, input.post), "audio");
				yield* ensureDir(audioDir);
				const dir = yield* fileStep(
					() => mkdtempSync(join(audioDir, "download-")),
					`Check that ${audioDir} is writable, then run it again.`,
				);
				const result = yield* downloader.downloadOne({
					cwd: dir,
					url: input.url,
					output: "%(id)s.%(ext)s",
				});
				const file = (yield* fileStep(
					() => readdirSync(dir),
					`Check that ${dir} is readable, then run it again.`,
				)).find((name) => name.endsWith(".mp3"));
				if (!result.ok || file === undefined) {
					return yield* fail("provider", `Couldn't download ${input.url}.`, downloadFix);
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

export const sourceTranscribe = defineOperation({
	name: "source_transcribe",
	description:
		"Transcribe every downloaded audio file in a saved collection, with a time for each word (transcripts/<id>.json and .txt). Skips files already transcribed. Detects the language unless you pass one. Its cost, by the minute of audio, counts toward the spending caps as saved/<collection>.",
	params: {
		collection: p.string("Saved collection under <posts>/saved/"),
		language: p.optional(p.string("Two-letter language code to force (es, en, ca…)")),
	},
	output: Schema.Struct({
		transcribed: Schema.Int,
		skipped: Schema.Int,
		failed: Schema.Array(Schema.String),
		/** Files left to transcribe; on a dry run, the ones the estimate covers. */
		toTranscribe: Schema.Int,
		estimateUsd: Schema.Finite,
		dryRun: Schema.Boolean,
	}),
	surface: "cli-and-mcp",
	spends: true,
	needsYes: false,
	hints: { readonly: false, destructive: false, idempotent: true, openWorld: true },
	run: (input, ctx, mode: RunMode) =>
		Effect.gen(function* () {
			const name = yield* checkCollection(input.collection);
			yield* checkLanguage(input.language);
			const dir = savedPath(ctx, name);
			const audioDir = join(dir, "audio");
			if (!existsSync(audioDir)) {
				return yield* fail(
					"not-found",
					`No audio in ${dir}.`,
					`Download it first: source download --collection ${name}`,
				);
			}

			const transcriber = yield* Transcriber;
			const media = yield* MediaTools;
			const model = yield* chooseModel(ctx, transcriber, "transcribe");
			const files = (yield* fileStep(
				() => readdirSync(audioDir),
				`Check that ${audioDir} is a folder you can read.`,
			))
				.filter((f) => /\.(mp3|m4a|wav)$/i.test(f))
				.sort();
			const transcriptOf = (file: string, ext: string) =>
				join(dir, "transcripts", `${basename(file).replace(/\.[^.]+$/, "")}.${ext}`);
			const todo = files.filter((file) => !existsSync(transcriptOf(file, "json")));
			const costOfFile = (file: string) =>
				media
					.duration(join(audioDir, file))
					.pipe(Effect.map((seconds) => costOf(model, audioAmount(model, seconds))));

			if (mode.dryRun) {
				const costs = yield* Effect.forEach(todo, costOfFile);
				return {
					transcribed: 0,
					skipped: files.length - todo.length,
					failed: [],
					toTranscribe: todo.length,
					estimateUsd: costs.reduce((sum, cost) => sum + cost.usd, 0),
					dryRun: true,
				};
			}

			yield* ensureDir(join(dir, "transcripts"));
			if (todo.length > 0) {
				// Fail on a missing key before anything is reserved.
				yield* Effect.forEach(transcriber.keys, (key) => requireKey(ctx, key), { discard: true });
			}

			const transcribeOne = Effect.fn("transcribeOne")(function* (file: string) {
				ctx.log(`Transcribing ${file}…`);
				const audio = join(audioDir, file);
				const cost = yield* costOfFile(file);
				const transcript = yield* paidCall(
					ctx,
					{ ...cost, post: `saved/${name}`, note: file },
					transcriber.transcribe(model, audio, input.language),
				);
				yield* writeJsonFile(transcriptOf(file, "json"), SavedTranscript, {
					...transcript,
					model: model.name,
				});
				yield* writeFileAtomic(transcriptOf(file, "txt"), `${transcript.text}\n`);
				return cost.usd;
			});

			// Every file is tried. A failed one is listed, and the next run tries it again. Past a
			// spending cap every later file would fail the same way, so the run stops there instead.
			// The transcripts already written stay.
			const outcomes = yield* Effect.forEach(todo, (file) =>
				transcribeOne(file).pipe(
					Effect.map((usd) => ({ usd })),
					Effect.catch((error) =>
						error.code === "over-budget"
							? Effect.fail(error)
							: Effect.succeed({ failure: `${file}: ${error.message}` }),
					),
				),
			);
			const failed = outcomes.flatMap((outcome) => ("failure" in outcome ? [outcome.failure] : []));
			return {
				transcribed: todo.length - failed.length,
				skipped: files.length - todo.length,
				failed,
				toTranscribe: failed.length,
				estimateUsd: outcomes.reduce(
					(sum, outcome) => sum + ("usd" in outcome ? outcome.usd : 0),
					0,
				),
				dryRun: false,
			};
		}),
	render: (o) =>
		o.dryRun
			? `Would transcribe ${o.toTranscribe} file${o.toTranscribe === 1 ? "" : "s"} (~$${o.estimateUsd.toFixed(3)}), already done ${o.skipped}; nothing was spent.`
			: [
					`Transcribed ${o.transcribed}, already done ${o.skipped}, failed ${o.failed.length}.`,
					...o.failed.map((line) => `  ✗ ${line}`),
					...(o.failed.length > 0 ? ["Run it again to retry only the failed files."] : []),
				].join("\n"),
});
