import { readFileSync } from "node:fs";
import { renderAndAssist } from "./output.js";
import { resolveTerminalOutput, reflowWrappedTableRows } from "./sanitize.js";

function readStdin(): Promise<string> {
    return new Promise((resolve, reject) => {
        let data = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", chunk => { data += chunk; });
        process.stdin.on("end", () => resolve(data));
        process.stdin.on("error", reject);
    });
}

async function main() {

    const filePath = process.argv[2];
    const raw = filePath ? readFileSync(filePath, "utf8") : await readStdin();

    if (!raw.trim()) {
        return;
    }

    // Streaming CLIs (e.g. `ollama run`) often redraw the current line with raw
    // cursor-movement bytes as they word-wrap live output. Resolve those before
    // markdown parsing ever sees them, or they show up as literal garbage text.
    const input = reflowWrappedTableRows(resolveTerminalOutput(raw));

    await renderAndAssist(input);
}

main();
