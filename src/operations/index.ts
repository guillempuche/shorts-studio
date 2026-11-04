// Each operation is typed by its own parameters; the registry only needs their common shape.
/**
 * Every operation, in the order `--help` lists them. Adding one here exposes it on both the
 * CLI and MCP; the parity test checks they agree.
 */

import type { Operation } from "../core/operation.ts";
import { audioTranscribe } from "./audio.ts";
import { beatPlan, beatSet } from "./beat.ts";
import { configShow } from "./config.ts";
import { draftRender } from "./draft.ts";
import { imageGenerate } from "./image.ts";
import { postCreate, postList, postShow } from "./post.ts";
import { scriptApprove, scriptSet } from "./script.ts";
import { sourceImport } from "./source.ts";

export const operations: ReadonlyArray<Operation> = [
	configShow,
	postCreate,
	postList,
	postShow,
	scriptSet,
	scriptApprove,
	sourceImport,
	audioTranscribe,
	beatPlan,
	beatSet,
	imageGenerate,
	draftRender,
] as unknown as ReadonlyArray<Operation>;
