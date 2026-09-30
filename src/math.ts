/**
 * Best-effort LaTeX -> Unicode conversion for inline/display math that LLMs
 * frequently emit assuming a KaTeX-capable renderer (`$\rightarrow$`, `$$...$$`).
 * A terminal can't typeset math, so this substitutes common macros with their
 * Unicode equivalents instead of leaving raw LaTeX source in the output.
 *
 * Only spans that contain a `\command` are touched, so plain currency like
 * "$5 to $10" is never mistaken for math.
 */

const SYMBOLS: Record<string, string> = {
    // arrows
    rightarrow: "→", to: "→", longrightarrow: "→", leftarrow: "←", longleftarrow: "←",
    leftrightarrow: "↔", Rightarrow: "⇒", implies: "⇒", Leftarrow: "⇐", Leftrightarrow: "⇔", iff: "⇔",
    mapsto: "↦", uparrow: "↑", downarrow: "↓", nearrow: "↗", searrow: "↘", nwarrow: "↖", swarrow: "↙",

    // relations
    leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠", ne: "≠", approx: "≈", equiv: "≡",
    sim: "∼", simeq: "≃", cong: "≅", propto: "∝", ll: "≪", gg: "≫", doteq: "≐",

    // operators
    times: "×", div: "÷", pm: "±", mp: "∓", cdot: "·", ast: "∗", star: "⋆", circ: "∘",
    bullet: "•", oplus: "⊕", ominus: "⊖", otimes: "⊗", oslash: "⊘", odot: "⊙",

    // sets / logic
    in: "∈", notin: "∉", ni: "∋", subset: "⊂", subseteq: "⊆", supset: "⊃", supseteq: "⊇",
    cup: "∪", cap: "∩", setminus: "∖", emptyset: "∅", varnothing: "∅", forall: "∀",
    exists: "∃", nexists: "∄", neg: "¬", lnot: "¬", land: "∧", wedge: "∧", lor: "∨", vee: "∨",
    top: "⊤", bot: "⊥",

    // calculus / big operators
    partial: "∂", nabla: "∇", infty: "∞", sum: "∑", prod: "∏", coprod: "∐",
    int: "∫", iint: "∬", iiint: "∭", oint: "∮",

    // misc
    angle: "∠", perp: "⊥", parallel: "∥", therefore: "∴", because: "∵",
    dots: "…", ldots: "…", cdots: "⋯", vdots: "⋮", ddots: "⋱", prime: "′",
    hbar: "ℏ", ell: "ℓ", Re: "ℜ", Im: "ℑ", aleph: "ℵ", wp: "℘", degree: "°", checkmark: "✓",

    // greek (lowercase)
    alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε",
    zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ", lambda: "λ",
    mu: "μ", nu: "ν", xi: "ξ", pi: "π", varpi: "ϖ", rho: "ρ", varrho: "ϱ", sigma: "σ",
    varsigma: "ς", tau: "τ", upsilon: "υ", phi: "φ", varphi: "ϕ", chi: "χ", psi: "ψ", omega: "ω",

    // greek (uppercase)
    Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ",
    Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
};

const SUPERSCRIPT: Record<string, string> = {
    "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
    "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾",
    a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ", f: "ᶠ", g: "ᵍ", h: "ʰ", i: "ⁱ", j: "ʲ",
    k: "ᵏ", l: "ˡ", m: "ᵐ", n: "ⁿ", o: "ᵒ", p: "ᵖ", r: "ʳ", s: "ˢ", t: "ᵗ", u: "ᵘ",
    v: "ᵛ", w: "ʷ", x: "ˣ", y: "ʸ", z: "ᶻ",
};

const SUBSCRIPT: Record<string, string> = {
    "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
    "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎",
    a: "ₐ", e: "ₑ", h: "ₕ", i: "ᵢ", j: "ⱼ", k: "ₖ", l: "ₗ", m: "ₘ", n: "ₙ", o: "ₒ",
    p: "ₚ", r: "ᵣ", s: "ₛ", t: "ₜ", u: "ᵤ", v: "ᵥ", x: "ₓ",
};

function mapChars(text: string, table: Record<string, string>): string | null {
    let out = "";
    for (const ch of text) {
        const mapped = table[ch];
        if (!mapped) return null;
        out += mapped;
    }
    return out;
}

function scriptReplace(text: string, marker: "^" | "_", table: Record<string, string>): string {
    const braced = new RegExp(`\\${marker}\\{([^{}]+)\\}`, "g");
    const bare = new RegExp(`\\${marker}([a-zA-Z0-9])`, "g");

    return text
        .replace(braced, (m, group) => mapChars(group, table) ?? `${marker}(${group})`)
        .replace(bare, (m, ch) => table[ch] ?? `${marker}${ch}`);
}

function convertSpan(content: string): string {

    let text = content;

    // \frac{a}{b} -> a/b
    text = text.replace(/\\d?frac\{([^{}]*)\}\{([^{}]*)\}/g, (_m, a, b) => `${a}/${b}`);

    // \sqrt[n]{x} / \sqrt{x} -> the radical sign, root index kept as a prefix note
    text = text.replace(/\\sqrt\[([^\]]*)\]\{([^{}]*)\}/g, (_m, n, x) => `${n}√(${x})`);
    text = text.replace(/\\sqrt\{([^{}]*)\}/g, (_m, x) => `√(${x})`);

    // text-like wrappers just unwrap to their contents
    text = text.replace(/\\(?:text|mathrm|mathbf|mathit|mathsf|mathtt|operatorname|boldsymbol)\{([^{}]*)\}/g, "$1");

    // sizing / spacing commands that have no visual meaning in a terminal
    text = text.replace(/\\(?:left|right|big|Big|bigg|Bigg)([({[\]|])/g, "$1");
    text = text.replace(/\\[,;:!]/g, " ");
    text = text.replace(/\\(?:quad|qquad)/g, "  ");

    // superscript / subscript
    text = scriptReplace(text, "^", SUPERSCRIPT);
    text = scriptReplace(text, "_", SUBSCRIPT);

    // known macros, longest name first so `\leq` doesn't half-match inside `\left`-style commands
    const names = Object.keys(SYMBOLS).sort((a, b) => b.length - a.length);
    text = text.replace(new RegExp(`\\\\(${names.join("|")})(?![a-zA-Z])`, "g"), (_m, name) => SYMBOLS[name]);

    // anything left over: drop the backslash rather than show raw LaTeX source
    text = text.replace(/\\([a-zA-Z]+)/g, "$1");
    text = text.replace(/\\([^a-zA-Z])/g, "$1");

    // leftover grouping braces are LaTeX noise at this point
    text = text.replace(/[{}]/g, "");

    return text.replace(/\s+/g, " ").trim();
}

// Require a real math signal before touching a `$...$` span — a LaTeX command,
// or a `^`/`_` script — so plain currency ("$5 to $10") is never mistaken for math.
const LOOKS_LIKE_MATH = /\\[a-zA-Z]|[\^_]\{?[a-zA-Z0-9]/;

export function convertMath(text: string): string {

    if (!text.includes("$")) return text;

    text = text.replace(/\$\$([\s\S]+?)\$\$/g, (m, inner) =>
        LOOKS_LIKE_MATH.test(inner) ? convertSpan(inner) : m);

    text = text.replace(/\$(?!\s)((?:\\\$|[^$\n])+?)(?<!\\)\$/g, (m, inner) =>
        LOOKS_LIKE_MATH.test(inner) ? convertSpan(inner) : m);

    return text;
}
