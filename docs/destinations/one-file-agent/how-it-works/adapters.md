# Adapters

Inside, Keel keeps every conversation in one simple format. An **adapter** translates between that format and whatever your model's API expects. To support a new API, you write one small adapter and the rest of Keel stays the same.

## The message format

A conversation is a list of messages. Each message has a role and a list of parts.

```ts
type Part =
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; args: unknown }
  | { type: "tool_result"; callId: string; output: string; isError?: boolean }
  | { type: "reasoning"; text?: string; opaque?: unknown };

type Message = {
  role: "system" | "user" | "assistant" | "tool";
  parts: Part[];
  provider?: string;
  raw?: unknown;
};
```

- **text** is ordinary words.
- **tool_call** is the model asking to run a command.
- **tool_result** is what the command printed.
- **reasoning** holds a model's thinking, when it shares it.

The optional `provider` and `raw` fields let an adapter keep the original reply from the API, so nothing is lost when it needs to send the conversation back.

## The adapter interface

```ts
interface Adapter {
  toWire(messages: Message[], tools: ToolDef[]): object;
  fromWire(response: unknown): Message;
}
```

- `toWire` turns Keel's messages into the request body your API expects.
- `fromWire` turns the API's response back into a Keel message.

## The built-in text adapter

`textAdapter` is the adapter Keel uses by default. It sends plain chat messages and reads one fenced `bash` block from each reply. When it sends history back, it writes earlier commands as `bash` blocks and shows their results as user messages.

To try a different API, copy `textAdapter` in `agent.ts`, change the request and response shapes, and pass your adapter to `agent()` at the bottom of the file.
