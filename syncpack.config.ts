/**
 * Keeps every package.json in the workspace in step: one version of each shared dependency,
 * and the same field order everywhere.
 */
export default {
	indent: "  ",
	versionGroups: [
		{
			// A package's own `version` isn't a dependency: the CLI's is its release, the rest are 0.0.0.
			label: "Own versions",
			dependencyTypes: ["local"],
			isIgnored: true,
		},
		{
			label: "shorts-studio packages, always the local copy",
			dependencies: ["@shorts-studio/*", "shorts-studio"],
			pinVersion: "workspace:*",
		},
		{
			// A wildcard, so a new `@effect/*` package joins the group without being listed.
			label: "Effect",
			dependencies: ["effect", "@effect/*"],
			policy: "sameRange",
		},
		{
			label: "TypeScript and Node types",
			dependencies: ["typescript", "@types/node"],
			policy: "sameRange",
		},
		{
			label: "Testing",
			dependencies: ["vitest", "@vitest/*"],
			policy: "sameRange",
		},
	],
	sortAz: ["dependencies", "devDependencies", "peerDependencies"],
	sortFirst: [
		"name",
		"version",
		"description",
		"license",
		"author",
		"homepage",
		"bugs",
		"repository",
		"keywords",
		"type",
		"bin",
		"exports",
		"files",
		"engines",
		"scripts",
		"dependencies",
		"devDependencies",
		"private",
	],
	source: ["package.json", "apps/*/package.json", "packages/*/package.json"],
};
