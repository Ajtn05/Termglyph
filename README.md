# Termglyph

Render Markdown as readable terminal output. Use it with a file, a pipe, or as a JavaScript library. I've personally been using it for cleaning up local model output, that's why it exists in the first place but maybe if you like rendering Markdown in terminal, sure go. 
There is an optional `ask` command that can query any server that implements the OpenAI Chat Completions API and render its reply. No model or model server is bundled though so set it up yourself thx.

## Requirements

- Node.js 22 or newer
- A terminal with ANSI support for colors and clickable links
- A model server only if you use `tg ask`

## Install and render

```sh
npm ci
npm run build
printf '# Hello\n\n- one\n- two\n' | npm run tg
npm run tg -- README.md
```

The installed CLI is `tg`. It accepts a Markdown file path or reads standard input. For example, after linking this checkout with `npm link`:

```sh
cat answer.md | tg
tg answer.md
```

Headings, lists, tables, blockquotes, links, fenced code, and common LaTeX math symbols are formatted for the terminal. The input cleanup also handles carriage returns and cursor redraws from streaming CLIs.

## Use from JavaScript

```js
import { render } from "termglyph";

process.stdout.write(render("# Hello\n\n**Markdown** in the terminal.\n"));
```

The library also exports `resolveTerminalOutput()` and `reflowWrappedTableRows()` for callers processing captured CLI output. `render()` returns a string and has no clipboard or filesystem side effects.

## Query a local model

Copy `.env.example` to `.env`, then set `MODEL_API_URL` to the **full** Chat Completions URL and `MODEL_ID` to the ID recognized by your server:

```sh
cp .env.example .env
# Edit .env for your server and installed model.
npm run tg -- ask "Explain this in two sentences."
```

`tg ask` reads the package's `.env` file even when invoked from another directory. Environment variables set by the caller take precedence. `MODEL_API_KEY` is optional and, when set, is sent as a Bearer token. The client makes non-streaming Chat Completions requests. The server must already be running.

`ASK_ENABLE_FILE_TOOLS=false` by default. Set it to `true` only for a server that supports function tools. When enabled, `ask` offers `read_file`, `list_dir`, and `write_file` inside the directory where it was invoked. It refuses hidden paths and paths that resolve outside that directory. Every write shows the exact proposed content and requires a `y` confirmation in an interactive terminal; piped prompts cannot approve writes. This path check is a convenience guard, not an OS sandbox, so use file tools only with a model server you trust. `ASK_MAX_READ_CHARS` controls the amount returned by each file read.

If your local model has only a CLI, pipe its text output into `tg` instead. No API compatibility is needed for rendering:

```sh
your-model-command | tg
```

## Copy code blocks

On a supported terminal, the renderer copies the last fenced code block to the clipboard. Set `TG_NO_CLIPBOARD=1` to disable this. `tg snip` lists code blocks from the most recent render and copies a selected block:

```sh
tg snip
tg snip 2
```

Clipboard support uses `pbcopy` on macOS, `clip` on Windows, or `wl-copy`, `xclip`, or `xsel` on Linux. Rendering works when none is available.

## Development

```sh
npm ci
npm test
npm run build
```

Personal configuration in `.env`, build output, and dependencies are ignored by Git. The project is licensed under [MIT](LICENSE). A provider-specific TurboFieldfare example is in [docs/providers/TURBOFIELDFARE.md](docs/providers/TURBOFIELDFARE.md).
