/**
 * Best-effort LaTeX -> Unicode conversion for math tokens recognized by marked.
 * A terminal can't typeset math, so this substitutes common macros with their
 * Unicode equivalents instead of leaving raw LaTeX source in the output.
 *
 * This is intentionally a readable terminal approximation, not a TeX engine.
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

export function convertMathExpression(content: string): string {

    let text = content;

    // Resolve inner groups first so common nested fractions and roots work.
    let previous: string;
    do {
        previous = text;
        text = text.replace(/\\(?:dfrac|tfrac|frac)\{([^{}]*)\}\{([^{}]*)\}/g,
            (_m, a: string, b: string) => `${groupIfNeeded(a)}/${groupIfNeeded(b)}`);
        text = text.replace(/\\sqrt\[([^\]]*)\]\{([^{}]*)\}/g, (_m, n, x) => `${n}√(${x})`);
        text = text.replace(/\\sqrt\{([^{}]*)\}/g, (_m, x) => `√(${x})`);
    } while (text !== previous);

    // text-like wrappers just unwrap to their contents
    text = text.replace(/\\(?:text|mathrm|mathbf|mathit|mathsf|mathtt|operatorname|boldsymbol)\{([^{}]*)\}/g, "$1");

    // sizing / spacing commands that have no visual meaning in a terminal
    text = text.replace(/\\(?:left|right|big|Big|bigg|Bigg)\s*(?=[()[\]{}|.])/g, "");
    text = text.replace(/\\[,;:!]/g, " ");
    text = text.replace(/\\(?:quad|qquad)/g, "  ");

    // superscript / subscript
    text = scriptReplace(text, "^", SUPERSCRIPT);
    text = scriptReplace(text, "_", SUBSCRIPT);

    // known macros, longest name first so `\leq` doesn't half-match inside `\left`-style commands
    const names = Object.keys(SYMBOLS).sort((a, b) => b.length - a.length);
    text = text.replace(new RegExp(`\\\\(${names.join("|")})(?![a-zA-Z])`, "g"), (_m, name) => SYMBOLS[name]);

    // Unknown commands stay visible rather than silently changing their meaning.
    text = text.replace(/\\([^a-zA-Z])/g, "$1");

    // Keep the arguments of unsupported commands visible for later inspection.
    if (!/\\[a-zA-Z]+/.test(text)) text = text.replace(/[{}]/g, "");

    return text.replace(/\s+/g, " ").trim();
}

function groupIfNeeded(value: string): string {
    return /[+\-=/\s]/.test(value) ? `(${value})` : value;
}
