import { marked } from "marked";
import { render } from "./renderer.js";
import { copyToClipboard } from "./clipboard.js";
import { saveCodeBlocks } from "./state.js";

// Shared by every entry point that produces rendered output — the tg
// CLI itself, and ask.mjs (which calls this directly rather than piping
// through a second `node dist/index.js` process). Anything that renders
// markdown through this function gets the same clipboard/snip behavior, with
// no special-casing per caller.

type CodeBlock = { text: string; lang?: string };

// The boxen border around a rendered code block is what makes it read nicely,
// but it's also what makes a plain click-drag copy in the terminal pick up
// border glyphs and padding along with the code. Rather than fight terminal
// selection, pull the raw (un-highlighted, un-boxed) code straight out of the
// markdown and put it on the clipboard directly.
function collectCodeBlocks(tokens: unknown, out: CodeBlock[] = []): CodeBlock[] {
    if (!Array.isArray(tokens)) return out;
    for (const t of tokens) {
        if (!t || typeof t !== "object") continue;
        const token = t as Record<string, unknown>;
        if (token.type === "code" && typeof token.text === "string") {
            out.push({ text: token.text, lang: typeof token.lang === "string" ? token.lang : undefined });
        }
        if (Array.isArray(token.tokens)) collectCodeBlocks(token.tokens, out);
        if (Array.isArray(token.items)) collectCodeBlocks(token.items, out);
    }
    return out;
}

/**
 * Renders markdown to stdout, persists its code blocks for `tg snip`, and
 * auto-copies the last one to the clipboard on a real terminal. Every caller
 * that produces final markdown output (the tg CLI, ask.mjs, ...)
 * should go through this instead of calling render() directly, or `tg snip` and
 * the clipboard behavior silently won't apply to it.
 */
export async function renderAndAssist(markdown: string): Promise<void> {
    const blocks = collectCodeBlocks(marked.lexer(markdown, { gfm: true }));

    // Persist regardless of TTY/clipboard state — `tg snip` is a separate command
    // run afterward, in its own fresh invocation, so it always has somewhere
    // free to read a choice from even when this process's stdin didn't.
    try {
        saveCodeBlocks(blocks);
    } catch {
        // best-effort; `tg snip` just reports nothing to grab if this failed
    }

    try {
        process.stdout.write(render(markdown));
    } catch (err) {
        // Never let a rendering bug eat the model's actual output.
        process.stderr.write(`tg: failed to render (${(err as Error).message}), printing raw output\n`);
        process.stdout.write(markdown);
    }

    // Auto-copy the last code block to the clipboard so the pretty box never
    // has to be selected by hand. Only when there's somewhere to paste it
    // (a real terminal) and nobody's asked us not to.
    if (process.stdout.isTTY && !process.env.TG_NO_CLIPBOARD && blocks.length > 0) {
        try {
            const last = blocks[blocks.length - 1];
            const copied = await copyToClipboard(last.text);
            if (copied) {
                const lines = last.text.split("\n").length;
                const lang = (last.lang ?? "").trim().split(/\s+/)[0] || "code";
                const rest = blocks.length - 1;
                const others = rest > 0
                    ? ` (${rest} other code block${rest > 1 ? "s" : ""} — \`tg snip\` to list, \`tg snip <n>\` to grab one)`
                    : "";
                process.stderr.write(`\ncopied ${lang} block (${lines} lines) to clipboard${others}\n`);
            }
        } catch {
            // Clipboard support is a nicety layered on top of rendering, never
            // let it take the process down.
        }
    }
}
