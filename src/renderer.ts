import { Marked, Renderer, type Tokens, type Token } from "marked";
import { highlight, supportsLanguage } from "cli-highlight";
import boxen from "boxen";
import wrapAnsi from "wrap-ansi";
import stringWidth from "string-width";
import { theme, getWidth } from "./theme.js";
import { convertMathExpression } from "./math.js";

const mathExtensions = [
    {
        name: "displayMath",
        level: "block" as const,
        start: (src: string) => src.indexOf("$$"),
        tokenizer(src: string) {
            const match = /^(?: {0,3})\$\$([^\n]+?)\$\$[ \t]*(?:\n|$)/.exec(src)
                ?? /^(?: {0,3})\$\$[ \t]*\n([\s\S]+?)\n[ \t]*\$\$[ \t]*(?:\n|$)/.exec(src);
            if (match) return { type: "displayMath", raw: match[0], text: match[1] };
        },
        renderer(token: Tokens.Generic) {
            return theme.math(convertMathExpression(String(token.text))) + "\n\n";
        },
    },
    {
        name: "inlineMath",
        level: "inline" as const,
        start: (src: string) => src.indexOf("$"),
        tokenizer(src: string) {
            if (src[0] !== "$" || src[1] === "$" || !src[1] || /\s/.test(src[1])) return;
            for (let i = 2; i < src.length && src[i] !== "\n"; i++) {
                if (src[i] === "`") return;
                if (src[i] !== "$") continue;
                // A later dollar cannot close an invalid pair: doing so would
                // swallow currency and escaped dollars between the two.
                if (src[i - 1] === "\\" || src[i - 1] === "$" || /\s/.test(src[i - 1])) return;
                return { type: "inlineMath", raw: src.slice(0, i + 1), text: src.slice(1, i) };
            }
        },
        renderer(token: Tokens.Generic) {
            return theme.math(convertMathExpression(String(token.text)));
        },
    },
];

/**
 * Renders markdown straight to ANSI terminal output.
 *
 * Extends marked's Renderer so block/inline dispatch and recursion
 * (nested lists, blockquotes, table cells, ...) come from marked itself
 * instead of being reimplemented by hand.
 */
class TerminalRenderer extends Renderer {

    private width: number;
    private listDepth = 0;
    private codeBlockIndex = 0;
    private totalCodeBlocks: number;

    constructor(width: number, totalCodeBlocks = 0) {
        super();
        this.width = width;
        this.totalCodeBlocks = totalCodeBlocks;
    }

    // ---- block level -----------------------------------------------------

    space(): string {
        return "";
    }

    heading({ tokens, depth }: Tokens.Heading): string {

        const text = wrapAnsi(cleanInlineBreaks(this.parser.parseInline(tokens)), this.width, { trim: false, hard: true });

        if (depth === 1) {
            const rule = theme.rule(this.width);
            return `${rule}\n${theme.h1(text)}\n${rule}\n\n`;
        }

        return `${theme.heading(depth)(text)}\n\n`;
    }

    paragraph({ tokens }: Tokens.Paragraph): string {
        const text = theme.body(cleanInlineBreaks(this.parser.parseInline(tokens)));
        return wrapAnsi(text, this.width, { trim: false, hard: true }) + "\n\n";
    }

    hr(): string {
        return theme.rule(this.width) + "\n\n";
    }

    code({ text, lang }: Tokens.Code): string {

        this.codeBlockIndex++;

        const language = (lang || "").trim().split(/\s+/)[0];

        let body: string;

        try {
            body = language && supportsLanguage(language)
                ? highlight(text, { language, ignoreIllegals: true })
                : theme.body(text);
        } catch {
            body = theme.body(text);
        }

        // Only pin an explicit width when we're rendering inside a narrowed context
        // (a list item or blockquote) — otherwise let boxen hug the content's own width.
        const nested = this.width < getWidth();

        // Label each box with its index when there's more than one code block in
        // the document, so it lines up with `tg snip <n>` for grabbing a specific one.
        const title = this.totalCodeBlocks > 1
            ? `${language || "text"} [${this.codeBlockIndex}]`
            : (language || undefined);

        const box = boxen(body, {
            padding: { top: 0, bottom: 0, left: 1, right: 1 },
            borderStyle: "round",
            borderColor: "gray",
            title,
            titleAlignment: "left",
            ...(nested ? { width: this.width } : {}),
        });

        return box + "\n\n";
    }

    blockquote({ tokens }: Tokens.Blockquote): string {

        const savedWidth = this.width;
        this.width = Math.max(4, this.width - 2);

        const inner = this.parser.parse(tokens).replace(/\n+$/, "");

        this.width = savedWidth;

        const prefix = theme.quoteBar + " ";
        const body = inner
            .split("\n")
            .map(line => prefix + theme.quoteText(line))
            .join("\n");

        return body + "\n\n";
    }

    list(token: Tokens.List): string {

        this.listDepth++;
        const indent = "  ".repeat(this.listDepth - 1);

        const items = token.items
            .map((item, index) => this.listItem(token, item, index, indent))
            .join(token.loose ? "\n\n" : "\n");

        this.listDepth--;

        return items + (this.listDepth === 0 ? "\n\n" : "");
    }

    /** Not part of the marked dispatch table for our flow — list() renders items itself. */
    private listItem(token: Tokens.List, item: Tokens.ListItem, index: number, indent: string): string {

        const ownTokens = item.tokens.filter(t => t.type !== "list" && t.type !== "space" && t.type !== "checkbox");
        const nestedLists = item.tokens.filter((t): t is Tokens.List => t.type === "list");

        const marker = item.task
            ? (item.checked ? theme.checkboxOn : theme.checkboxOff)
            : token.ordered
                ? theme.number(`${(typeof token.start === "number" ? token.start : 1) + index}.`)
                : theme.bullet;

        const prefix = `${indent}${marker} `;
        const prefixWidth = stringWidth(prefix);
        const hangingIndent = " ".repeat(prefixWidth);
        const bodyWidth = Math.max(4, this.width - prefixWidth);

        const body = ownTokens
            .map(t => this.renderListItemToken(t, bodyWidth))
            .filter(Boolean)
            .join("\n\n");

        let out = prefix + body.split("\n")
            .map((line, i) => i === 0 || line === "" ? line : hangingIndent + line)
            .join("\n");

        if (nestedLists.length) {
            const nested = nestedLists.map(t => this.list(t)).join("\n");
            out += "\n" + nested;
        }

        return out;
    }

    private renderListItemToken(token: Token, bodyWidth: number): string {

        if (token.type === "text" || token.type === "paragraph") {
            const t = token as Tokens.Text | Tokens.Paragraph;
            const text = theme.body(cleanInlineBreaks("tokens" in t && t.tokens ? this.parser.parseInline(t.tokens) : t.text));
            return wrapAnsi(text, bodyWidth, { trim: false, hard: true });
        }

        // Fallback for less common block content inside a list item (code, blockquote, ...).
        const savedWidth = this.width;
        this.width = bodyWidth;
        const rendered = this.parser.parse([token]).replace(/\n+$/, "");
        this.width = savedWidth;
        return rendered;
    }

    checkbox({ checked }: Tokens.Checkbox): string {
        return checked ? theme.checkboxOn : theme.checkboxOff;
    }

    table(token: Tokens.Table): string {

        const columns = token.header.length;
        const renderCell = (cell: Tokens.TableCell) => cleanInlineBreaks(this.parser.parseInline(cell.tokens));

        const header = token.header.map(renderCell);
        const rows = token.rows.map(row => row.map(renderCell));

        const naturalWidths = Array.from({ length: columns }, (_, i) =>
            Math.max(
                stringWidth(header[i] ?? ""),
                ...rows.map(row => stringWidth(row[i] ?? "")),
            ),
        );

        const budget = Math.max(columns, this.width - (3 * columns + 1));
        const colWidths = fitColumnWidths(naturalWidths, budget, header.map(cell => stringWidth(cell)));

        const border = (left: string, mid: string, right: string, fill: string) =>
            theme.tableBorder(left + colWidths.map(w => fill.repeat(w + 2)).join(mid) + right);

        const renderRow = (cells: string[], align: Tokens.Table["align"], isHeader: boolean): string => {

            const wrapped = cells.map((cell, i) => wrapAnsi(cell, colWidths[i], { trim: false, hard: true }).split("\n"));
            const height = Math.max(1, ...wrapped.map(lines => lines.length));

            const lines: string[] = [];

            for (let row = 0; row < height; row++) {
                const rendered = wrapped.map((lines_, i) => {
                    const line = lines_[row] ?? "";
                    const styled = isHeader ? theme.tableHeader(line) : theme.body(line);
                    return padCell(styled, colWidths[i], align[i]);
                });
                lines.push(theme.tableBorder("│ ") + rendered.join(theme.tableBorder(" │ ")) + theme.tableBorder(" │"));
            }

            return lines.join("\n");
        };

        const out = [
            border("┌", "┬", "┐", "─"),
            renderRow(header, token.align, true),
            border("├", "┼", "┤", "─"),
            ...rows.map(row => renderRow(row, token.align, false)),
            border("└", "┴", "┘", "─"),
        ];

        return out.join("\n") + "\n\n";
    }

    html({ text }: Tokens.HTML | Tokens.Tag): string {
        if (/^<br\s*\/?\s*>$/i.test(text)) return "\n";
        return theme.dim(text);
    }

    def(): string {
        return "";
    }

    text(token: Tokens.Text | Tokens.Escape | Tokens.Tag): string {
        // Left uncolored: callers (paragraph, list items, table cells, ...) apply the
        // body tint themselves as an outer wrap so nested bold/italic/link/code accents
        // still show through instead of being overwritten by this leaf's own color.
        if ("tokens" in token && token.tokens?.length) {
            return this.parser.parseInline(token.tokens);
        }
        return decodeEntities(token.text);
    }

    // ---- inline level ------------------------------------------------------

    strong({ tokens }: Tokens.Strong): string {
        return theme.bold(this.parser.parseInline(tokens));
    }

    em({ tokens }: Tokens.Em): string {
        return theme.italic(this.parser.parseInline(tokens));
    }

    del({ tokens }: Tokens.Del): string {
        return theme.strike(this.parser.parseInline(tokens));
    }

    codespan({ text }: Tokens.Codespan): string {
        return theme.code(` ${text} `);
    }

    br(): string {
        return "\n";
    }

    link({ href, tokens }: Tokens.Link): string {
        const label = theme.link(this.parser.parseInline(tokens));
        return hyperlink(label, decodeEntities(href));
    }

    image({ href, text }: Tokens.Image): string {
        return hyperlink(theme.dim(`[image: ${decodeEntities(text || href)}]`), decodeEntities(href));
    }
}

/**
 * Shrinks natural column widths to fit `budget`, preferring a floor of 4 chars
 * per column but guaranteeing the sum never exceeds budget even at pathologically
 * narrow terminal widths (trims from the widest columns first).
 */
function fitColumnWidths(naturalWidths: number[], budget: number, headerWidths: number[]): number[] {

    const total = naturalWidths.reduce((a, b) => a + b, 0);
    if (total <= budget) return naturalWidths;

    // Preserve short headers when they fit, then give remaining room to data.
    const headerFloor = headerWidths.map(w => Math.max(1, w));
    const headerTotal = headerFloor.reduce((a, b) => a + b, 0);
    if (headerTotal <= budget) {
        const widths = [...headerFloor];
        let remaining = budget - headerTotal;
        while (remaining > 0) {
            const deficits = naturalWidths.map((w, i) => w - widths[i]);
            const largest = Math.max(...deficits);
            if (largest <= 0) break;
            widths[deficits.indexOf(largest)]++;
            remaining--;
        }
        return widths;
    }

    const shrink = total > budget && total > 0 ? budget / total : 1;

    const preferredFloor = Math.min(4, Math.max(1, Math.floor(budget / naturalWidths.length)));
    const widths = naturalWidths.map(w => Math.max(preferredFloor, Math.floor(w * shrink)));

    let over = widths.reduce((a, b) => a + b, 0) - budget;

    while (over > 0) {
        const i = widths.indexOf(Math.max(...widths));
        if (widths[i] <= 1) break;
        widths[i]--;
        over--;
    }

    return widths;
}

function padCell(text: string, width: number, align: "left" | "right" | "center" | null): string {

    const pad = Math.max(0, width - stringWidth(text));

    if (align === "right") return " ".repeat(pad) + text;
    if (align === "center") {
        const left = Math.floor(pad / 2);
        return " ".repeat(left) + text + " ".repeat(pad - left);
    }
    return text + " ".repeat(pad);
}

function cleanInlineBreaks(text: string): string {
    return text.replace(/[ \t]*\n[ \t]*/g, "\n");
}

const NAMED_ENTITIES: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0",
};

/** Decode the entities most often emitted in Markdown text and link targets. */
function decodeEntities(text: string): string {
    return text.replace(/&(#(?:x[0-9a-f]+|[0-9]+)|amp|lt|gt|quot|apos|nbsp);/gi, (original, entity: string) => {
        if (entity[0] !== "#") return NAMED_ENTITIES[entity.toLowerCase()] ?? original;
        const hex = entity[1]?.toLowerCase() === "x";
        const value = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
        return value >= 0x20 && value <= 0x10ffff
            && !(value >= 0x7f && value <= 0x9f)
            && !(value >= 0xd800 && value <= 0xdfff)
            ? String.fromCodePoint(value)
            : "\ufffd";
    });
}

/** OSC 8 hyperlink escape — clickable link text in terminals that support it, plain text elsewhere. */
function hyperlink(label: string, url: string): string {
    return `]8;;${url}${label}]8;;`;
}

/** Recursively counts fenced code blocks anywhere in the token tree (including
 *  inside lists and blockquotes), so the renderer knows up front whether box
 *  titles need a [n] label at all. */
function countCodeBlocks(tokens: unknown): number {
    if (!Array.isArray(tokens)) return 0;
    let count = 0;
    for (const t of tokens) {
        if (!t || typeof t !== "object") continue;
        const token = t as Record<string, unknown>;
        if (token.type === "code") count++;
        if (Array.isArray(token.tokens)) count += countCodeBlocks(token.tokens);
        if (Array.isArray(token.items)) count += countCodeBlocks(token.items);
    }
    return count;
}

export function render(md: string): string {

    const width = getWidth();
    const marked = new Marked({ gfm: true, breaks: false, extensions: mathExtensions });
    const totalCodeBlocks = countCodeBlocks(marked.lexer(md));
    const renderer = new TerminalRenderer(width, totalCodeBlocks);

    const out = marked.parse(md, { renderer }) as string;

    return out
        .replace(/\n{3,}/g, "\n\n")
        .trim() + "\n";
}
