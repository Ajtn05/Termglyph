import { writeFileSync } from "node:fs";

let calls = [];
globalThis.fetch = async (url, options) => {
    calls.push({
        url,
        headers: options.headers,
        body: JSON.parse(options.body),
    });
    writeFileSync(process.env.MOCK_CAPTURE_PATH, JSON.stringify(calls));
    if (process.env.MOCK_TOOL_PATH && calls.length === 1) {
        return new Response(JSON.stringify({
            choices: [{ message: {
                role: "assistant",
                content: null,
                tool_calls: [{
                    id: "call_1",
                    type: "function",
                    function: { name: "read_file", arguments: JSON.stringify({ path: process.env.MOCK_TOOL_PATH }) },
                }],
            } }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "# From a different model" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
};
