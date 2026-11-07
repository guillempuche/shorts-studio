// Writes schemas/<name>.schema.json for post.json, config.json and brand.json from their Effect
// Schemas. A test fails when one is out of date.
//   node scripts/schemas.ts

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { FILE_SCHEMAS, fileSchema } from "../packages/usecases/src/operations/schema.ts";

for (const name of Object.keys(FILE_SCHEMAS) as Array<keyof typeof FILE_SCHEMAS>) {
	const file = join(import.meta.dirname, "..", "schemas", `${name}.schema.json`);
	writeFileSync(file, `${JSON.stringify(fileSchema(name), null, 2)}\n`);
	console.log(`Wrote ${file}`);
}
