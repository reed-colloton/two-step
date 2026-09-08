# Two Step

A chat app that works in two steps: **Fable 5.1** rewrites your prompt to make it clearer, then **GPT-6 Astra** answers it. You can read the rewritten prompt with the answer.

![Two Step](docs/screenshot.jpg)

Type a message to start. Use **Settings** to change either model or its instructions, and turn **Search** on when you want web search. Chats are saved in your browser.

## Run locally

You need Node.js 22.18+ and an OpenRouter API key.

```sh
npm install
export OPENROUTER_API_KEY="your-key-here"
npm run dev
```

Open the local URL printed in your terminal. Usage is billed to your OpenRouter account.
