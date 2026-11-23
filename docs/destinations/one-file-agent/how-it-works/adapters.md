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
  native: boolean;
  toWire(messages: Message[], tools: ToolDef[]): object;
  fromWire(response: unknown): Message;
}
```

- `native` says whether the model calls tools natively, which picks how a run finishes.
- `toWire` turns Keel's messages into the request body your API expects.
- `fromWire` turns the API's response back into a Keel message.

## The built-in adapters

Keel ships with two, and `ADAPTER` picks between them.

**`nativeAdapter`** is the default. It sends the tools in the OpenAI-style `tools` field and reads `tool_calls` from each reply. Results go back as `tool` messages, each with the id of the call it answers. Arguments that aren't valid JSON become an error result, so the model can try again.

**`textAdapter`** (`ADAPTER=text`) is the original. It sends plain chat messages and reads one fenced `bash` block from each reply. When it sends history back, it writes earlier commands as `bash` blocks and shows their results as user messages. It offers only `bash`.

To try a different API, copy `nativeAdapter` in `agent.ts`, change the request and response shapes, and return your adapter from `adapterFor`.
