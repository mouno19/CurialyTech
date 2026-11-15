// Writes the motion library (server/agent/design/knowledge/motion.ts, the one source) for the
// component library's importer: component-library/motion-components/catalog.json.
//   node node_modules/tsx/dist/cli.mjs scripts/components/export-motion.mts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MOTION_FAMILIES, MOTION_KIT, MOTION_PIECES } from "../../server/agent/design/knowledge/motion";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, "../../component-library/motion-components/catalog.json");
fs.writeFileSync(OUT, `${JSON.stringify({ families: MOTION_FAMILIES, pieces: MOTION_PIECES, kit: MOTION_KIT }, null, 2)}\n`);
console.log(`${MOTION_FAMILIES.length} motion families, ${MOTION_PIECES.length} pieces written`);
