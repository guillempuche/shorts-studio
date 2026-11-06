// Writes schemas/post.schema.json from the Post Schema. A test fails when it's out of date.
//   node scripts/schemas.ts

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { postSchemaFile } from "../src/operations/schema.ts";

const file = join(import.meta.dirname, "..", "schemas", "post.schema.json");
writeFileSync(file, `${JSON.stringify(postSchemaFile(), null, 2)}\n`);
console.log(`Wrote ${file}`);
