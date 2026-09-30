import { spawn } from "node:child_process";

function tryCommand(command: string, args: string[], content: string): Promise<boolean> {
    return new Promise(resolve => {
        let settled = false;
        const finish = (ok: boolean) => {
            if (!settled) { settled = true; resolve(ok); }
        };
        try {
            const proc = spawn(command, args, { stdio: ["pipe", "ignore", "ignore"] });
            proc.on("error", () => finish(false));
            proc.on("close", code => finish(code === 0));
            proc.stdin.on("error", () => finish(false));
            proc.stdin.end(content);
        } catch {
            finish(false);
        }
    });
}

export async function copyToClipboard(content: string): Promise<boolean> {
    const commands: Array<[string, string[]]> = process.platform === "darwin"
        ? [["pbcopy", []]]
        : process.platform === "win32"
            ? [["clip", []]]
            : [["wl-copy", []], ["xclip", ["-selection", "clipboard"]], ["xsel", ["--clipboard", "--input"]]];
    for (const [command, args] of commands) {
        if (await tryCommand(command, args, content)) return true;
    }
    return false;
}
