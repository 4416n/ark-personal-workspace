import assert from "node:assert/strict";
import { sandboxAvailable } from "../server/project-sandbox.mjs";

const capability = await sandboxAvailable();
assert.equal(capability.available, true, capability.reason);
console.log(`Real sandbox ready: ${capability.reason}`);
