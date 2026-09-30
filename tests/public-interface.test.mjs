import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "../dist/lib.js";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));

test("library renders Markdown without printing or reading files", () => {
    const output = render("# Heading\n\n- item\n\n```js\nconsole.log(1)\n```\n");
    assert.match(output, /Heading/);
    assert.match(output, /• item/);
    assert.match(output, /console\.log\(1\)/);
});

test("tg renders piped Markdown and shows its command help", () => {
    const cli = join(packageRoot, "bin/tg.mjs");
    const rendered = spawnSync(process.execPath, [cli], {
        input: "# From stdin\n",
        encoding: "utf8",
    });
    assert.equal(rendered.status, 0, rendered.stderr);
    assert.match(rendered.stdout, /From stdin/);

    const help = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /tg ask <prompt>/);
    assert.match(help.stdout, /tg snip \[number\]/);
});

test("ask sends a generic Chat Completions request without optional tools", () => {
    const directory = mkdtempSync(join(tmpdir(), "termglyph-test-"));
    try {
        const capture = join(directory, "request.json");
        const preload = join(packageRoot, "tests/mock-fetch.mjs");
        const result = spawnSync(process.execPath, [join(packageRoot, "bin/tg.mjs"), "ask", "hello"], {
            cwd: directory,
            encoding: "utf8",
            env: {
                ...process.env,
                NODE_OPTIONS: `--import=${preload}`,
                MOCK_CAPTURE_PATH: capture,
                MODEL_API_URL: "http://127.0.0.1:9999/v1/chat/completions",
                MODEL_ID: "another-model",
                MODEL_API_KEY: "test-key",
                ASK_ENABLE_FILE_TOOLS: "false",
            },
        });
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /From a different model/);
        const request = JSON.parse(readFileSync(capture, "utf8"))[0];
        assert.equal(request.url, "http://127.0.0.1:9999/v1/chat/completions");
        assert.equal(request.body.model, "another-model");
        assert.equal(request.body.messages[0].content, "hello");
        assert.equal(request.body.tools, undefined);
        assert.equal(request.headers.Authorization, "Bearer test-key");
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test("optional file tools cannot read hidden configuration", () => {
    const directory = mkdtempSync(join(tmpdir(), "termglyph-test-"));
    try {
        const capture = join(directory, "request.json");
        const result = spawnSync(process.execPath, [join(packageRoot, "bin/tg.mjs"), "ask", "read config"], {
            cwd: directory,
            encoding: "utf8",
            env: {
                ...process.env,
                NODE_OPTIONS: `--import=${join(packageRoot, "tests/mock-fetch.mjs")}`,
                MOCK_CAPTURE_PATH: capture,
                MOCK_TOOL_PATH: ".env",
                MODEL_API_URL: "http://127.0.0.1:9999/v1/chat/completions",
                MODEL_ID: "another-model",
                ASK_ENABLE_FILE_TOOLS: "true",
            },
        });
        assert.equal(result.status, 0, result.stderr);
        const requests = JSON.parse(readFileSync(capture, "utf8"));
        assert.equal(requests.length, 2);
        assert.equal(requests[0].body.tools.length, 3);
        assert.match(requests[1].body.messages.at(-1).content, /hidden paths are not available/);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});
