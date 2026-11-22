/** Checks that a next step can be taken as written, over MCP and on the CLI. */

import type { NextStep } from "@shorts-studio/domain/next-step";
import { expect } from "vitest";
import { commandPath, flagName } from "../operation.ts";
import { operations } from "../operations/index.ts";

/** The operations an MCP client can call, by tool name. */
const tools = new Map(
	operations.filter((op) => op.surface === "cli-and-mcp").map((op) => [op.name, op]),
);

/**
 * Expects `step` to be one an agent or the user can take: a step with no tool is the user's or a
 * note; a tool is one the server offers, called with its own fields, with the same command for
 * the terminal. `where` names the step in a failure.
 */
export const expectValidStep = (step: NextStep, where: string): void => {
	if (step.tool === undefined) {
		expect(step.args, where).toBeUndefined();
		return;
	}
	const op = tools.get(step.tool);
	expect(op, where).toBeDefined();
	// Each argument is one of that tool's fields.
	const fieldsOfTool = [...Object.keys(op?.params ?? {}), ...(op?.spends ? ["dryRun"] : [])];
	for (const key of Object.keys(step.args ?? {})) expect(fieldsOfTool, where).toContain(key);
	// Its command is that operation's, with a flag for each argument.
	expect(step.cli?.startsWith(commandPath(step.tool).join(" ")), where).toBe(true);
	for (const key of Object.keys(step.args ?? {})) {
		expect(step.cli, where).toContain(`--${flagName(key)}`);
	}
	// Every value a shell or a tool can't take as it is is a placeholder it lists to fill.
	for (const [key, value] of Object.entries(step.args ?? {})) {
		const placeholder = typeof value === "string" && /^<[^<>]+>$/.test(value);
		expect(step.fill?.includes(key) ?? false, `${where}: ${key}`).toBe(placeholder);
		if (!placeholder) expect(String(value), `${where}: ${key}`).not.toMatch(/[<>|]/);
	}
};
