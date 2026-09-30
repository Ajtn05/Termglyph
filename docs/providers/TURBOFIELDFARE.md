# TurboFieldfare example

TurboFieldfare is one possible OpenAI-compatible local model server. It is optional; Termglyph itself does not require it or any model.

If you already have TurboFieldfareServer running, copy `.env.example` to `.env` in this package and set:

```dotenv
MODEL_API_URL=http://127.0.0.1:8080/v1/chat/completions
MODEL_ID=gemma-4-26b-a4b-it
MODEL_API_KEY=
ASK_ENABLE_FILE_TOOLS=true
```

Then run `tg ask "your question"` (or `npm run tg -- ask "your question"` from the checkout). The file tools are optional and can be disabled if you only want text replies. The server has to be started separately; see the [TurboFieldfare project](https://github.com/drumih/turbo-fieldfare) for installation and server instructions.

For a one-off CLI invocation, you can instead pipe the model's plain text output into `tg` without configuring `tg ask`:

```sh
your-turbofieldfare-command | tg
```
