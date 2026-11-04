/**
 * A local stand-in for FAL's queue API (submit → status → result → image download), so tests
 * and demos run without a key or spending anything. It counts submits, which is how tests prove
 * that a resumed run didn't pay twice.
 *
 * Run it by itself for a demo: `node test/support/fake-fal.ts` prints the base URL to put in
 * SHORTS_FAL_URL; images are flat colour cards made by ffmpeg, one colour per request.
 */

import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeFal {
	readonly url: string;
	/** Prompts in the order they were submitted. */
	readonly submits: Array<{
		readonly endpoint: string;
		readonly prompt: string;
		readonly seed: number;
	}>;
	readonly close: () => Promise<void>;
}

export interface FakeFalOptions {
	/** How many status polls answer IN_PROGRESS before COMPLETED; read on every poll. */
	pollsBeforeDone?: number;
	/** Bytes served as the image for a request. */
	readonly image?: (prompt: string, index: number) => Uint8Array;
	/** Status to end with instead of COMPLETED, to test failed requests. */
	readonly finalStatus?: string;
}

const PLACEHOLDER = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

export const startFakeFal = (options: FakeFalOptions = {}): Promise<FakeFal> => {
	const submits: FakeFal["submits"] = [];
	const polls = new Map<string, number>();
	const prompts = new Map<string, { prompt: string; index: number }>();
	let base = "";

	const server: Server = createServer((req, res) => {
		const path = req.url ?? "/";
		const json = (status: number, body: unknown) => {
			res.writeHead(status, { "content-type": "application/json" });
			res.end(JSON.stringify(body));
		};
		if (req.method === "POST") {
			let body = "";
			req.on("data", (chunk) => {
				body += chunk;
			});
			req.on("end", () => {
				const input = JSON.parse(body) as { prompt: string; seed: number };
				const id = `req-${submits.length + 1}`;
				submits.push({ endpoint: path.slice(1), prompt: input.prompt, seed: input.seed });
				prompts.set(id, { prompt: input.prompt, index: submits.length - 1 });
				json(200, {
					request_id: id,
					status_url: `${base}/requests/${id}/status`,
					response_url: `${base}/requests/${id}`,
				});
			});
			return;
		}
		const status = /^\/requests\/([^/]+)\/status$/.exec(path);
		if (status?.[1] !== undefined) {
			const id = status[1];
			const count = (polls.get(id) ?? 0) + 1;
			polls.set(id, count);
			const done = count > (options.pollsBeforeDone ?? 0);
			return json(200, { status: done ? (options.finalStatus ?? "COMPLETED") : "IN_PROGRESS" });
		}
		const result = /^\/requests\/([^/]+)$/.exec(path);
		if (result?.[1] !== undefined) {
			return json(200, { images: [{ url: `${base}/images/${result[1]}.jpg` }] });
		}
		const image = /^\/images\/([^/]+)\.jpg$/.exec(path);
		if (image?.[1] !== undefined) {
			const request = prompts.get(image[1]);
			res.writeHead(200, { "content-type": "image/jpeg" });
			res.end(
				request && options.image ? options.image(request.prompt, request.index) : PLACEHOLDER,
			);
			return;
		}
		json(404, { detail: "not found" });
	});

	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
			resolve({
				url: base,
				submits,
				close: () => new Promise((done) => server.close(() => done())),
			});
		});
	});
};

/** A 1248×2224 flat colour card from ffmpeg, a different hue per request. */
export const colourCard = (_prompt: string, index: number): Uint8Array => {
	const hue = (index * 47) % 360;
	return execFileSync("ffmpeg", [
		"-hide_banner",
		"-loglevel",
		"error",
		"-f",
		"lavfi",
		"-i",
		`color=c=black:s=1248x2224,geq=r='128+100*sin(${hue}*PI/180+X/300)':g='128+100*sin(${hue}*PI/180+Y/300)':b='128+100*cos(${hue}*PI/180)'`,
		"-frames:v",
		"1",
		"-f",
		"mjpeg",
		"pipe:1",
	]);
};

if (import.meta.url === `file://${process.argv[1]}`) {
	const fake = await startFakeFal({ image: colourCard });
	console.log(fake.url);
}
