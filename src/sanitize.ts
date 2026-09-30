/**
 * Resolves raw terminal control sequences into their final rendered text.
 *
 * CLIs that stream to an interactive terminal (like `ollama run`) often
 * redraw the current line as they go — reflowing word-wrap by moving the
 * cursor back and erasing to end-of-line before retyping — using raw ANSI
 * cursor codes. That's invisible on a real terminal, but when the output is
 * piped into another program, those control bytes arrive as literal data
 * mixed into the text: the in-progress and corrected versions of a line
 * both show up unless something replays the cursor movements.
 *
 * This simulates just enough of a terminal (a per-line character buffer with
 * a cursor) to collapse that stream down to what would actually have been
 * visible on screen, before markdown parsing ever sees it.
 */
export function resolveTerminalOutput(input: string): string {

    if (!input.includes("\x1b") && !input.includes("\r")) return input;

    const lines: string[] = [];
    let buf: string[] = [];
    let cursor = 0;

    const flush = () => {
        lines.push(buf.join(""));
        buf = [];
        cursor = 0;
    };

    let i = 0;
    while (i < input.length) {
        const ch = input[i];

        if (ch === "\x1b" && input[i + 1] === "[") {
            let j = i + 2;
            let params = "";
            while (j < input.length && /[0-9;]/.test(input[j])) { params += input[j]; j++; }
            const final = input[j];
            const n = params === "" ? 1 : parseInt(params.split(";")[0] ?? "1", 10) || 1;

            if (final === "D") cursor = Math.max(0, cursor - n);
            else if (final === "C") cursor = Math.min(buf.length, cursor + n);
            else if (final === "G") cursor = Math.max(0, n - 1);
            else if (final === "K") {
                const mode = params === "" ? 0 : n;
                if (mode === 0) buf.length = cursor;
                else if (mode === 1) for (let k = 0; k < cursor && k < buf.length; k++) buf[k] = " ";
                else { buf.length = 0; cursor = 0; }
            }
            // any other CSI sequence (color, etc.) carries no content of its own — drop it,
            // the renderer applies its own colors downstream anyway.

            i = (final === undefined) ? input.length : j + 1;
            continue;
        }

        if (ch === "\r" && input[i + 1] !== "\n") {
            cursor = 0;
            i++;
            continue;
        }

        if (ch === "\n" || (ch === "\r" && input[i + 1] === "\n")) {
            flush();
            i += ch === "\r" ? 2 : 1;
            continue;
        }

        buf[cursor] = ch;
        cursor++;
        i++;
    }

    flush();

    return lines.join("\n");
}

const TABLE_DELIMITER_ROW = /^[\s|:-]+$/;

/**
 * Rejoins markdown table rows that a streaming terminal hard-wrapped across
 * multiple physical lines. Ordinary prose survives that unscathed — CommonMark
 * already treats a bare newline inside a paragraph as a soft space — but a GFM
 * table row must be a single physical line, so a wrapped row breaks the table
 * parser outright (cells drift into the wrong column, or the table cuts off).
 *
 * Once inside a detected table (a row line immediately followed by a
 * delimiter row like `| :--- | :--- |`), any following non-blank line that
 * doesn't itself start a new row (`|`) is assumed to be a wrapped
 * continuation of the previous row and gets folded back in.
 */
export function reflowWrappedTableRows(text: string): string {

    const lines = text.split("\n");
    const out: string[] = [];
    let i = 0;

    while (i < lines.length) {

        const line = lines[i];
        const next = lines[i + 1];
        const startsTable = line.includes("|") && line.trim() !== ""
            && next !== undefined && next.includes("|") && next.includes("-") && TABLE_DELIMITER_ROW.test(next);

        if (!startsTable) {
            out.push(line);
            i++;
            continue;
        }

        out.push(line, next);
        i += 2;

        while (i < lines.length && lines[i].trim() !== "") {
            let row = lines[i];
            i++;
            while (i < lines.length && lines[i].trim() !== "" && !lines[i].trimStart().startsWith("|")) {
                row += " " + lines[i].trim();
                i++;
            }
            out.push(row);
        }
    }

    return out.join("\n");
}
