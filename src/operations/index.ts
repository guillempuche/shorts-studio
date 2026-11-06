/**
 * Every operation, in the order `--help` lists them. Adding one here exposes it on both the
 * CLI and MCP; the parity test checks they agree.
 */

import type { Operation } from "../core/operation.ts";
import { audioTranscribe } from "./audio.ts";
import { beatPlan, beatSet } from "./beat.ts";
import { budgetShow } from "./budget.ts";
import { capcutExport } from "./capcut.ts";
import { configCheck, configShow } from "./config.ts";
import { draftRender } from "./draft.ts";
import { imageGenerate } from "./image.ts";
import { imageImport } from "./image-import.ts";
import { postArchive, postFinalize, postPublish, postReview } from "./lifecycle.ts";
import { postCreate, postList, postShow } from "./post.ts";
import { makeSchemaShow } from "./schema.ts";
import { scriptApprove, scriptSet } from "./script.ts";
import { sourceImport } from "./source.ts";
import { sourceAdopt, sourceDownload, sourceTranscribe } from "./source-download.ts";

const all: Array<Operation> = [
	configShow,
	configCheck,
	postCreate,
	postList,
	postShow,
	scriptSet,
	scriptApprove,
	sourceImport,
	sourceDownload,
	sourceAdopt,
	sourceTranscribe,
	audioTranscribe,
	beatPlan,
	beatSet,
	imageGenerate,
	imageImport,
	draftRender,
	postReview,
	capcutExport,
	postFinalize,
	postPublish,
	postArchive,
	budgetShow,
];
// `schema show` describes every operation, itself included.
all.push(makeSchemaShow(() => all));

export const operations: ReadonlyArray<Operation> = all;
