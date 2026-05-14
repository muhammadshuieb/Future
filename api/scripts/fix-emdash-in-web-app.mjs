/**
 * Replace UTF-8 mojibake for em dash (â€") and similar with real U+2014 in web/js/app.js.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const target = path.join(root, "web", "js", "app.js");
let s = fs.readFileSync(target, "utf8");
const before = s.length;
s = s.replace(/â€"|â€"/g, "\u2014");
fs.writeFileSync(target, s, "utf8");
console.log("fix-emdash-in-web-app:", target, "chars", before, "->", s.length);
