#!/usr/bin/env node

const command = process.argv[2];

if (command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(
        "Usage: tg [file]\n" +
        "       command | tg\n" +
        "       tg render [file]\n" +
        "       tg ask <prompt>\n" +
        "       tg snip [number]\n\n" +
        "Render Markdown from a file or standard input.\n" +
        "Use `tg ask` with an OpenAI-compatible model server.\n"
    );
} else if (command === "ask") {
    process.argv.splice(2, 1);
    await import("./ask.mjs");
} else if (command === "snip") {
    process.argv.splice(2, 1);
    await import("./snip.mjs");
} else {
    if (command === "render") process.argv.splice(2, 1);
    await import("../dist/index.js");
}
