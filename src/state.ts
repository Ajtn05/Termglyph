import { createHash } from "node:crypto";
import { closeSync, constants, fchmodSync, openSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const userId = createHash("sha256").update(homedir()).digest("hex").slice(0, 12);
export const BLOCKS_STATE_PATH = join(tmpdir(), `termglyph-blocks-${userId}.json`);

export function saveCodeBlocks(blocks: unknown): void {
    const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0);
    const fd = openSync(BLOCKS_STATE_PATH, flags, 0o600);
    try {
        if (process.platform !== "win32") fchmodSync(fd, 0o600);
        writeFileSync(fd, JSON.stringify(blocks));
    } finally {
        closeSync(fd);
    }
}
