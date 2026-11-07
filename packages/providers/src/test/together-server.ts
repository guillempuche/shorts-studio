/**
 * A local stand-in for Together's transcription endpoint, so tests run without a key or
 * spending anything. It answers every upload with the same words, or refuses with `status`.
 * Only tests import this file.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeTogether {
	readonly url: string;
	/** The Authorization header of each request, in order. */
	readonly authorizations: Array<string | undefined>;
	readonly close: () => Promise<void>;
}

/** What Together's verbose_json returns for a short clip. */
export const FAKE_TRANSCRIPT = {
	language: "english",
	text: " Hello there.",
	words: [
		{ word: "Hello", start: 0, end: 0.4 },
		{ word: "there.", start: 0.5, end: 0.9 },
	],
};

export const startFakeTogether = (
	options: { readonly status?: number } = {},
): Promise<FakeTogether> => {
	const authorizations: FakeTogether["authorizations"] = [];
	const server: Server = createServer((req, res) => {
		// Read the whole upload before answering, as the real service does.
		req.resume();
		req.on("end", () => {
			authorizations.push(req.headers.authorization);
			const ok = req.method === "POST" && req.url === "/v1/audio/transcriptions";
			const status = ok ? (options.status ?? 200) : 404;
			res.writeHead(status, { "content-type": "application/json" });
			res.end(JSON.stringify(status === 200 ? FAKE_TRANSCRIPT : { error: "refused" }));
		});
	});
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			resolve({
				url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
				authorizations,
				close: () => new Promise((done) => server.close(() => done())),
			});
		});
	});
};
