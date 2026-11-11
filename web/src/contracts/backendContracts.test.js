import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { expect, it } from "vitest";

const rootContracts = resolve(process.cwd(), "../contracts");
it.skipIf(!existsSync(rootContracts))("keeps bundled validation schemas identical to the shared backend contracts", () => {
  const schemas = import.meta.glob("./backend/*.schema.json", { eager: true, import: "default" });
  for (const [path, schema] of Object.entries(schemas)) {
    expect(schema).toEqual(JSON.parse(readFileSync(join(rootContracts, path.split("/").at(-1)), "utf8")));
  }
});
