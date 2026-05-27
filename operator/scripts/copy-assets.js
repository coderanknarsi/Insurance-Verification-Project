// Copies static assets (index.html) from src/renderer to dist/renderer.
const fs = require("node:fs");
const path = require("node:path");

const SRC = path.resolve(__dirname, "..", "src", "renderer");
const DEST = path.resolve(__dirname, "..", "dist", "renderer");

fs.mkdirSync(DEST, { recursive: true });

for (const entry of fs.readdirSync(SRC, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) continue;
  fs.copyFileSync(path.join(SRC, entry.name), path.join(DEST, entry.name));
}

console.log("Renderer assets copied to", DEST);
