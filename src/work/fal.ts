/**
 * Image generation on FAL through its queue API (docs.fal.ai, "Queue API").
 *
 * Submitting and collecting are separate calls on purpose: the caller saves the request's
 * status and result URLs before polling, so a run cut short resumes polling the same request
 * instead of paying for a new one.
 */

import type { Context } from "../core/context.ts";

export interface ImageModel {
	readonly endpoint: string;
	/** For estimates only; FAL bills per megapixel for these models. */
	readonly usdPerMegapixel: number;
	readonly steps: number;
}

export const IMAGE_MODELS: Readonly<Record<string, ImageModel>> = {
	"flux-schnell": { endpoint: "fal-ai/flux/schnell", usdPerMegapixel: 0.003, steps: 4 },
	"flux-dev": { endpoint: "fal-ai/flux/dev", usdPerMegapixel: 0.025, steps: 28 },
};
export const DEFAULT_IMAGE_MODEL = "flux-schnell";

/**
 * Larger than the 1080×1920 frame so the slow zoom never reaches an edge, in multiples of 16
 * as the model expects. About 15% over each side.
 */
export const IMAGE_SIZE = { width: 1248, height: 2224 } as const;

export const estimateUsd = (model: ImageModel): number =>
	((IMAGE_SIZE.width * IMAGE_SIZE.height) / 1_000_000) * model.usdPerMegapixel;

export interface Submitted {
	readonly requestId: string;
	readonly statusUrl: string;
	readonly responseUrl: string;
}

export class FalError extends Error {}

const headers = (key: string) => ({
	Authorization: `Key ${key}`,
	"Content-Type": "application/json",
});

const readJson = async (response: Response, what: string): Promise<unknown> => {
	const text = await response.text();
	if (!response.ok)
		throw new FalError(`FAL ${what} failed (HTTP ${response.status}): ${text.slice(0, 300)}`);
	return JSON.parse(text) as unknown;
};

export const submitImage = async (
	ctx: Context,
	key: string,
	model: ImageModel,
	prompt: string,
	seed: number,
	signal?: AbortSignal,
): Promise<Submitted> => {
	const response = await ctx.fetch(`${ctx.endpoints.fal}/${model.endpoint}`, {
		method: "POST",
		headers: headers(key),
		body: JSON.stringify({
			prompt,
			image_size: IMAGE_SIZE,
			seed,
			num_images: 1,
			num_inference_steps: model.steps,
			output_format: "jpeg",
			enable_safety_checker: true,
		}),
		...(signal ? { signal } : {}),
	});
	const body = (await readJson(response, "submit")) as {
		request_id?: string;
		status_url?: string;
		response_url?: string;
	};
	if (!body.request_id || !body.status_url || !body.response_url) {
		throw new FalError(`FAL submit returned no request id: ${JSON.stringify(body).slice(0, 200)}`);
	}
	return { requestId: body.request_id, statusUrl: body.status_url, responseUrl: body.response_url };
};

/** Polls until the request completes, then returns the image's URL. */
export const collectImage = async (
	ctx: Context,
	key: string,
	request: Submitted,
	signal?: AbortSignal,
	pollMs = 1_000,
): Promise<string> => {
	for (;;) {
		const status = (await readJson(
			await ctx.fetch(request.statusUrl, { headers: headers(key), ...(signal ? { signal } : {}) }),
			"status",
		)) as { status?: string };
		if (status.status === "COMPLETED") break;
		if (status.status !== "IN_QUEUE" && status.status !== "IN_PROGRESS") {
			throw new FalError(`FAL request ${request.requestId} ended as ${status.status ?? "unknown"}`);
		}
		await new Promise((resolve) => setTimeout(resolve, pollMs));
	}
	const result = (await readJson(
		await ctx.fetch(request.responseUrl, { headers: headers(key), ...(signal ? { signal } : {}) }),
		"result",
	)) as { images?: ReadonlyArray<{ url?: string }> };
	const url = result.images?.[0]?.url;
	if (url === undefined) throw new FalError(`FAL request ${request.requestId} returned no image`);
	return url;
};

export const download = async (
	ctx: Context,
	url: string,
	signal?: AbortSignal,
): Promise<Uint8Array> => {
	const response = await ctx.fetch(url, signal ? { signal } : {});
	if (!response.ok) throw new FalError(`Downloading ${url} failed (HTTP ${response.status})`);
	return new Uint8Array(await response.arrayBuffer());
};
