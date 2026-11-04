// Each operation is typed by its own parameters; the registry only needs their common shape.
/**
 * Every operation, in the order `--help` lists them. Adding one here exposes it on both the
 * CLI and MCP; the parity test checks they agree.
 */

import type { Operation } from "../core/operation.ts";
import { postCreate, postList, postShow } from "./post.ts";

export const operations: ReadonlyArray<Operation> = [
	postCreate,
	postList,
	postShow,
] as unknown as ReadonlyArray<Operation>;
