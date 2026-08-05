import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataset = JSON.parse(await readFile(path.join(root, "training/dataset.json"), "utf8"));
const canonical = JSON.parse(
  await readFile(path.join(root, "public/models/mobs-canonical-directions/manifest.json"), "utf8"),
);

assert.equal(dataset.schemaVersion, 1);
assert.deepEqual(dataset.directions, Object.keys(canonical.directions));
assert.ok(dataset.samples.length > 0, "dataset needs at least one approved sample");

for (const sample of dataset.samples) {
  assert.equal(sample.approval, "approved", `${sample.id} is not approved`);
  assert.equal(sample.rights, "user-authored", `${sample.id} lacks user-authored rights`);
  await readFile(path.join(root, sample.input));
  for (const direction of dataset.directions) {
    const relativePath = sample.targets[direction];
    assert.ok(relativePath, `${sample.id} is missing ${direction}`);
    const bytes = await readFile(path.join(root, relativePath));
    assert.equal(bytes.subarray(1, 4).toString("ascii"), "PNG", `${relativePath} is not PNG`);
    assert.equal(bytes.readUInt32BE(16), canonical.canvas.width, `${relativePath} has wrong width`);
    assert.equal(bytes.readUInt32BE(20), canonical.canvas.height, `${relativePath} has wrong height`);
    const hash = createHash("sha256").update(bytes).digest("hex").toUpperCase();
    assert.equal(hash, canonical.directions[direction], `${relativePath} changed after approval`);
  }
}

console.log(`dataset ok: ${dataset.samples.length} approved sample, ${dataset.directions.length} directions`);
