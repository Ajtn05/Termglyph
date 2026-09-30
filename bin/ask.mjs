#!/usr/bin/env node
// Queries any OpenAI-compatible Chat Completions server and renders its reply.
//
// When ASK_ENABLE_FILE_TOOLS=true, the model can call three file tools —
// read_file, list_dir, write_file — all
// resolved relative to the directory `tg ask` was run from and unable to escape it
// (no absolute paths, no ../ past the root). Writes always require an explicit
// y/N confirmation showing the exact content before anything touches disk.
//
// Tool calls make this a multi-turn, non-streaming conversation (the server's
// tool-call responses aren't safe to parse incrementally), so instead of live
// token-by-token output you get a status line per network round-trip plus an
// explicit line for every tool call as it happens — arguably clearer than raw
// streaming for anything that touches files.
//
// Usage:
//   tg ask "your prompt here"
//   echo "your prompt" | tg ask             (piped prompts can't confirm
//                                                  writes interactively — see below)
//
// Set MODEL_API_URL and MODEL_ID in the package's .env (see .env.example).

import { renderAndAssist } from "../dist/output.js";
import { render } from "../dist/renderer.js";
import { readFile, writeFile, readdir, realpath } from "node:fs/promises";
import { resolve, sep, relative, dirname, basename } from "node:path";
import readline from "node:readline";
import { setting, enabled } from "./config.mjs";

const SERVER_URL = setting("MODEL_API_URL");
const MODEL = setting("MODEL_ID");
const API_KEY = setting("MODEL_API_KEY");
const FILE_TOOLS_ENABLED = enabled("ASK_ENABLE_FILE_TOOLS");
const ROOT = process.cwd();
const MAX_ROUNDS = FILE_TOOLS_ENABLED ? 8 : 1;
const MAX_READ_CHARS = Number(setting("ASK_MAX_READ_CHARS")) || 20_000;

const BINARY_EXTENSIONS = new Set([
    "pdf", "png", "jpg", "jpeg", "gif", "webp", "heic", "bmp", "tiff", "ico",
    "zip", "gz", "tar", "7z", "rar",
    "mp3", "mp4", "mov", "wav", "m4a", "flac",
    "exe", "dylib", "so", "dll", "bin", "wasm",
    "doc", "docx", "xls", "xlsx", "ppt", "pptx",
]);

// For syntax-highlighting the write confirmation preview — best-effort, not
// exhaustive. cli-highlight (inside render()) falls back to a plain themed
// block for anything it doesn't recognize, so an unmapped extension still
// looks fine, just uncolored.
const LANGUAGE_BY_EXTENSION = {
    py: "python", js: "javascript", mjs: "javascript", cjs: "javascript",
    ts: "typescript", tsx: "typescript", jsx: "javascript",
    sh: "bash", bash: "bash", zsh: "bash",
    json: "json", yaml: "yaml", yml: "yaml", toml: "ini",
    html: "html", css: "css", scss: "scss",
    md: "markdown", sql: "sql",
    go: "go", rs: "rust", rb: "ruby", java: "java",
    c: "c", h: "c", cpp: "cpp", hpp: "cpp",
    swift: "swift", php: "php",
};

// A fence made of exactly 3 backticks would break if the file content itself
// contains a ``` run (e.g. writing a markdown file with its own code blocks
// inside it) — use a fence longer than the longest backtick run present.
function fenceFor(content) {
    const runs = content.match(/`+/g) ?? [];
    const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
    return "`".repeat(Math.max(3, longest + 1));
}

// Confirmation prompts need real interactive stdin. If the prompt itself came
// in via a pipe, stdin is already consumed and there's nothing to prompt on.
const CAN_CONFIRM = process.stdin.isTTY === true;

// ---------------------------------------------------------------------------
// stderr status line — single updating line, cleared before any discrete
// message (tool announcements, confirmation prompts, the final render) so
// nothing gets garbled. Only active on a real terminal; redirecting stderr to
// a file skips the carriage-return spam entirely.
// ---------------------------------------------------------------------------

function statusLine(text) {
    if (!process.stderr.isTTY) return;
    process.stderr.write(`\r\x1b[K${text}`);
}

function clearStatusLine() {
    if (!process.stderr.isTTY) return;
    process.stderr.write(`\r\x1b[K`);
}

function note(text) {
    clearStatusLine();
    process.stderr.write(text.endsWith("\n") ? text : text + "\n");
}

// ---------------------------------------------------------------------------
// Safe path resolution — everything stays inside ROOT (where `tg ask` was run
// from). No absolute paths, no home-directory shortcuts, no ../ escapes.
// ---------------------------------------------------------------------------

function resolveSafePath(rawPath) {
    if (typeof rawPath !== "string" || rawPath.trim() === "") {
        throw new Error("path is required");
    }
    if (rawPath.startsWith("/") || rawPath.startsWith("~")) {
        throw new Error(`absolute or home-relative paths are not allowed: ${rawPath}`);
    }
    const resolved = resolve(ROOT, rawPath);
    if (resolved !== ROOT && !resolved.startsWith(ROOT + sep)) {
        throw new Error(`path escapes the working directory (${ROOT}): ${rawPath}`);
    }
    if (relative(ROOT, resolved).split(sep).some(part => part.startsWith("."))) {
        throw new Error(`hidden paths are not available to file tools: ${rawPath}`);
    }
    return resolved;
}

async function assertPhysicalPath(abs, forWrite = false) {
    const realRoot = await realpath(ROOT);
    const realTarget = forWrite
        ? resolve(await realpath(dirname(abs)), basename(abs))
        : await realpath(abs);
    const inside = realTarget === realRoot || realTarget.startsWith(realRoot + sep);
    if (!inside) throw new Error("path resolves outside the working directory");
    if (relative(realRoot, realTarget).split(sep).some(part => part.startsWith("."))) {
        throw new Error("hidden paths are not available to file tools");
    }
    if (forWrite) {
        try {
            const existing = await realpath(abs);
            if (existing !== realRoot && !existing.startsWith(realRoot + sep)) {
                throw new Error("path resolves outside the working directory");
            }
            if (relative(realRoot, existing).split(sep).some(part => part.startsWith("."))) {
                throw new Error("hidden paths are not available to file tools");
            }
        } catch (err) {
            if (err.code !== "ENOENT") throw err;
        }
    }
}

function displayPath(absPath) {
    const rel = relative(ROOT, absPath);
    return rel === "" ? "." : rel;
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

// Legitimate UTF-8 text essentially never contains a raw null byte; binary
// formats (PDF, images, archives, ...) almost always do within the first
// few KB. Combined with the extension check, this catches binaries that
// don't have one of the known extensions too.
function looksBinary(buffer) {
    return buffer.subarray(0, 8000).includes(0);
}

async function toolReadFile(args) {
    const abs = resolveSafePath(args.path);
    await assertPhysicalPath(abs);
    const ext = abs.split(".").pop()?.toLowerCase() ?? "";
    const buf = await readFile(abs);

    if (BINARY_EXTENSIONS.has(ext) || looksBinary(buf)) {
        return (
            `Error: ${displayPath(abs)} looks like a binary file, not plain text. ` +
            `This file reader accepts plain text only; it cannot pass PDFs, images, or other ` +
            `binary formats directly — reading the raw bytes as text could overflow the context window. ` +
            `Convert the file to plain text first.`
        );
    }

    const data = buf.toString("utf8");
    if (data.length > MAX_READ_CHARS) {
        return (
            `${data.slice(0, MAX_READ_CHARS)}\n\n` +
            `[...truncated at ${MAX_READ_CHARS} chars (file is ${data.length} chars total) to stay inside ` +
            `the server's configured context window — ask about a smaller excerpt if you need the rest]`
        );
    }
    return data;
}

async function toolListDir(args) {
    const abs = resolveSafePath(args.path ?? ".");
    await assertPhysicalPath(abs);
    const entries = await readdir(abs, { withFileTypes: true });
    if (entries.length === 0) return "(empty directory)";
    return entries
        .filter(e => !e.name.startsWith("."))
        .map(e => `${e.isDirectory() ? "d" : "-"} ${e.name}`)
        .sort()
        .join("\n");
}

function askYesNo(question) {
    return new Promise(resolvePromise => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
        rl.question(question, answer => {
            rl.close();
            resolvePromise(/^y(es)?$/i.test(answer.trim()));
        });
    });
}

// Paths successfully written this session — lets us flag it in the
// confirmation prompt if the model tries to rewrite something it already
// just wrote, instead of silently prompting again with no context.
const writtenThisSession = new Set();

async function toolWriteFile(args) {
    const abs = resolveSafePath(args.path);
    await assertPhysicalPath(abs, true);
    const content = args.content ?? "";

    if (!CAN_CONFIRM) {
        return "Write skipped: no interactive terminal available to confirm (prompt was piped in). Run `tg ask` directly in a terminal to allow writes.";
    }

    clearStatusLine();
    if (writtenThisSession.has(abs)) {
        process.stderr.write(`\n(note: ${displayPath(abs)} was already written earlier in this session)\n`);
    }

    const ext = abs.split(".").pop()?.toLowerCase() ?? "";
    const lang = LANGUAGE_BY_EXTENSION[ext] ?? "";
    const fence = fenceFor(content);
    const preview = `tg ask wants to write **${displayPath(abs)}** (${content.length} chars):\n\n${fence}${lang}\n${content}\n${fence}\n`;

    try {
        process.stderr.write(render(preview));
    } catch {
        // Rendering is a nicety here — never let it block the actual confirmation.
        process.stderr.write(`tg ask wants to write ${displayPath(abs)} (${content.length} chars):\n`);
        process.stderr.write("─".repeat(60) + "\n");
        process.stderr.write(content + (content.endsWith("\n") ? "" : "\n"));
        process.stderr.write("─".repeat(60) + "\n");
    }

    const ok = await askYesNo("Write this file? [y/N] ");
    if (!ok) {
        return "User declined the write. File was not modified.";
    }

    await writeFile(abs, content, "utf8");
    writtenThisSession.add(abs);
    return `Wrote ${content.length} chars to ${displayPath(abs)}. This file is done — do not rewrite it again unless the user asks for a further change.`;
}

const TOOLS = [
    {
        type: "function",
        function: {
            name: "read_file",
            description: `Read the contents of a plain-text file. Path is relative to ${ROOT} and cannot go outside it. Text-only — PDFs, images, and other binary files will be refused.`,
            parameters: {
                type: "object",
                properties: { path: { type: "string", description: "Relative file path" } },
                required: ["path"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "list_dir",
            description: `List files and folders in a directory. Path is relative to ${ROOT}; defaults to the root itself.`,
            parameters: {
                type: "object",
                properties: { path: { type: "string", description: "Relative directory path" } },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "write_file",
            description: `Write (create or overwrite) a text file. Path is relative to ${ROOT} and cannot go outside it. The user is always asked to confirm the exact content before anything is written.`,
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string", description: "Relative file path" },
                    content: { type: "string", description: "Full file contents to write" },
                },
                required: ["path", "content"],
            },
        },
    },
];

// One-line summary for the "→ tool(...)" announcement — dumping the raw
// tool-call JSON (escaped \n's, quoted file contents and all) is unreadable
// for anything that carries real file content, so this shows just the shape
// of the call instead. The full content still gets shown in toolWriteFile's
// own confirmation box, so nothing meaningful is lost.
function summarizeCall(name, args) {
    if (name === "read_file") return `read_file(${args.path ?? "?"})`;
    if (name === "list_dir") return `list_dir(${args.path ?? "."})`;
    if (name === "write_file") {
        const len = typeof args.content === "string" ? args.content.length : 0;
        return `write_file(${args.path ?? "?"}, ${len} chars)`;
    }
    return `${name}(${JSON.stringify(args)})`;
}

async function runTool(name, argsJson) {
    let args;
    try {
        args = JSON.parse(argsJson || "{}");
    } catch {
        return `Error: could not parse arguments as JSON: ${argsJson}`;
    }

    try {
        if (name === "read_file") return await toolReadFile(args);
        if (name === "list_dir") return await toolListDir(args);
        if (name === "write_file") return await toolWriteFile(args);
        return `Error: unknown tool ${name}`;
    } catch (err) {
        return `Error: ${err.message}`;
    }
}

// ---------------------------------------------------------------------------
// stdin (for prompt, when not given as CLI args)
// ---------------------------------------------------------------------------

function readStdin() {
    return new Promise((resolvePromise, reject) => {
        if (process.stdin.isTTY) return resolvePromise("");
        let data = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", chunk => { data += chunk; });
        process.stdin.on("end", () => resolvePromise(data));
        process.stdin.on("error", reject);
    });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// Distinguishes "the server responded, but rejected the request" (bad prompt,
// context overflow, malformed tool schema, ...) from "nothing answered at
// all" (server not running) — these need very different error messages.
class ServerHttpError extends Error {
    constructor(status, body) {
        super(`server error ${status}: ${body}`);
        this.status = status;
        this.body = body;
    }
}

async function callServer(messages) {
    const body = { model: MODEL, messages, stream: false };
    if (FILE_TOOLS_ENABLED) {
        body.tools = TOOLS;
        body.tool_choice = "auto";
    }
    const res = await fetch(SERVER_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
        },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        throw new ServerHttpError(res.status, await res.text());
    }

    return res.json();
}

async function main() {
    if (!SERVER_URL || !MODEL) {
        process.stderr.write("tg ask: set MODEL_API_URL and MODEL_ID in .env (see .env.example).\n");
        process.exit(1);
    }

    const argPrompt = process.argv.slice(2).join(" ").trim();
    const prompt = argPrompt || (await readStdin()).trim();

    if (!prompt) {
        process.stderr.write('Usage: tg ask "<prompt>"  (or pipe a prompt via stdin)\n');
        process.exit(1);
    }

    const started = Date.now();
    const messages = FILE_TOOLS_ENABLED ? [
        {
            role: "system",
            content:
                "You can read, list, and write files in the user's current directory with the provided tools. " +
                "Once a tool call succeeds — especially write_file — treat that as the task being done. " +
                "Do not re-read, re-write, or 'double check' a file you already successfully wrote in this " +
                "conversation unless the user's message explicitly asks for a change to it.",
        },
        { role: "user", content: prompt },
    ] : [{ role: "user", content: prompt }];

    let finalContent = "";
    let lastUsage = null;
    let lastRoundSeconds = null; // this round's own request time — excludes any earlier
                                  // tool execution or y/N confirmation wait, so the tok/s
                                  // figure isn't dragged down by how long a human took to click y

    for (let round = 0; round < MAX_ROUNDS; round++) {
        const roundStarted = Date.now();
        const ticker = setInterval(() => {
            const elapsed = ((Date.now() - started) / 1000).toFixed(1);
            statusLine(round === 0
                ? `waiting on model… ${elapsed}s`
                : `waiting on model (round ${round + 1})… ${elapsed}s`);
        }, 200);

        let data;
        try {
            data = await callServer(messages);
        } catch (err) {
            clearInterval(ticker);
            clearStatusLine();

            if (err instanceof ServerHttpError) {
                let detail = err.body;
                let code = null;
                try {
                    const parsed = JSON.parse(err.body);
                    detail = parsed.error?.message ?? err.body;
                    code = parsed.error?.code ?? null;
                } catch {
                    // body wasn't JSON — fall back to the raw text already in `detail`
                }

                process.stderr.write(`tg ask: model server rejected the request (HTTP ${err.status}): ${detail}\n`);

                if (code === "context_length_exceeded") {
                    process.stderr.write(
                        "This means something in the conversation (often a file read) is too large for the " +
                        "server's configured context. Try a smaller file/excerpt or increase the server's context limit.\n"
                    );
                }
            } else {
                process.stderr.write(
                    `tg ask: could not reach the model server at ${SERVER_URL} (${err.message}).\n` +
                    "Check MODEL_API_URL in .env and confirm the server is running.\n"
                );
            }
            process.exit(1);
        }

        clearInterval(ticker);
        clearStatusLine();

        lastRoundSeconds = (Date.now() - roundStarted) / 1000;

        const choice = data.choices?.[0];
        if (!choice?.message) {
            throw new Error("model server returned no message in choices[0]");
        }
        const message = choice?.message ?? {};
        if (data.usage) lastUsage = data.usage;

        const toolCalls = message.tool_calls ?? [];

        if (toolCalls.length === 0) {
            finalContent = message.content ?? "";
            break;
        }

        // Echo the assistant's tool-call turn back into history unchanged, then
        // run each tool and append its result before looping.
        messages.push(message);

        for (const call of toolCalls) {
            const fnName = call.function?.name ?? "?";
            const fnArgs = call.function?.arguments ?? "{}";

            let parsedArgs = {};
            try { parsedArgs = JSON.parse(fnArgs || "{}"); } catch { /* runTool below will report the parse error */ }
            note(`→ ${summarizeCall(fnName, parsedArgs)}`);

            const result = await runTool(fnName, fnArgs);
            const preview = result.length > 200 ? result.slice(0, 200) + "…" : result;
            note(`  ${preview.replace(/\n/g, "\n  ")}`);

            messages.push({
                role: "tool",
                tool_call_id: call.id,
                content: result,
            });
        }
    }

    if (!finalContent && FILE_TOOLS_ENABLED) {
        throw new Error(`model did not provide a final reply within ${MAX_ROUNDS} rounds`);
    }

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    const cached = lastUsage?.prompt_tokens_details?.cached_tokens;
    const completionTokens = lastUsage?.completion_tokens;
    // Requests aren't streamed (see the file header), so there's no clean split
    // between prefill and decode time to compute a pure decode rate the way
    // decode-only benchmarks do — this is completion_tokens over the
    // whole round-trip, prefill included, and will read lower than their
    // published decode-only numbers for the same reason.
    const rate = completionTokens && lastRoundSeconds ? completionTokens / lastRoundSeconds : null;
    process.stderr.write(
        `done in ${elapsed}s` +
        (completionTokens ? ` — ${completionTokens} tokens generated` : "") +
        (rate ? ` (~${rate.toFixed(1)} tok/s incl. prefill)` : "") +
        (cached ? `, ${cached} prompt tokens reused` : "") +
        "\n"
    );

    await renderAndAssist(finalContent);
}

main().catch(err => {
    process.stderr.write(`tg ask: ${err.message}\n`);
    process.exit(1);
});
