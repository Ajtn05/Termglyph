#!/usr/bin/env node
// Copies a specific code block from the most recent Termglyph output to the
// clipboard. The renderer can't prompt you to pick one interactively —
// it's almost always the tail end of a pipe, so its stdin is already spent
// reading the markdown by the time there'd be anything to ask. This is a
// separate command instead: tg writes every code block it saw to a
// small state file each time it runs, and `tg snip` reads that back.
//
// Usage:
//   tg snip           list the code blocks from the last Termglyph output
//   tg snip <n>       copy block <n> to the clipboard
//
// The box titles tg prints are numbered to match (e.g. "python [2]")
// whenever a document has more than one code block.

import { readFileSync } from "node:fs";
import { copyToClipboard } from "../dist/clipboard.js";
import { BLOCKS_STATE_PATH } from "../dist/state.js";

function loadBlocks() {
    try {
        const parsed = JSON.parse(readFileSync(BLOCKS_STATE_PATH, "utf8"));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return null; // no state file yet — nothing has rendered anything
    }
}

async function main() {
    const blocks = loadBlocks();

    if (blocks === null) {
        process.stderr.write("tg snip: nothing rendered yet — pipe some markdown through tg first.\n");
        process.exit(1);
    }

    if (blocks.length === 0) {
        process.stderr.write("tg snip: the last Termglyph output had no code blocks.\n");
        process.exit(1);
    }

    const arg = process.argv[2];

    if (!arg) {
        for (let i = 0; i < blocks.length; i++) {
            const lines = blocks[i].text.split("\n").length;
            const lang = blocks[i].lang || "text";
            process.stderr.write(`[${i + 1}] ${lang} (${lines} lines)\n`);
        }
        process.stderr.write(`\nrun: tg snip <n>\n`);
        return;
    }

    const idx = Number(arg) - 1;
    const block = blocks[idx];

    if (!Number.isInteger(idx) || !block) {
        process.stderr.write(`tg snip: no block #${arg} (have 1-${blocks.length})\n`);
        process.exit(1);
    }

    const ok = await copyToClipboard(block.text);
    if (!ok) {
        process.stderr.write("tg snip: clipboard copy failed (no supported clipboard command found?)\n");
        process.exit(1);
    }

    const lines = block.text.split("\n").length;
    process.stderr.write(`copied ${block.lang || "code"} block [${arg}] (${lines} lines) to clipboard\n`);
}

main();
