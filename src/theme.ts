import chalk from "chalk";

/** Terminal width to render against; falls back to 80 only when the terminal reports nothing usable. */
export function getWidth(): number {
    const columns = process.stdout.columns;
    return columns && columns > 0 ? columns : 80;
}

const headingStyles = [
    chalk.bold.whiteBright,   // h1 (rendered with rules, see renderer.ts)
    chalk.bold.cyanBright,    // h2
    chalk.bold.cyan,          // h3
    chalk.bold.blueBright,    // h4
    chalk.bold.blue,          // h5
    chalk.bold.gray,          // h6
];

export const theme = {
    h1: headingStyles[0],
    heading: (depth: number) => headingStyles[Math.min(Math.max(depth, 1), headingStyles.length) - 1],

    body: chalk.rgb(210, 210, 210),
    dim: chalk.gray,
    bold: chalk.bold.white,
    italic: chalk.italic,
    strike: chalk.strikethrough.gray,

    code: chalk.black.bgWhite,
    link: chalk.cyan.underline,
    math: chalk.cyanBright,

    bullet: chalk.cyan("•"),
    number: chalk.cyan,
    checkboxOn: chalk.green("✔"),
    checkboxOff: chalk.gray("☐"),

    quoteBar: chalk.gray("│"),
    quoteText: chalk.italic.gray,

    tableBorder: chalk.gray,
    tableHeader: chalk.bold.whiteBright,

    rule: (width = getWidth()) => chalk.gray("─".repeat(width)),
};
