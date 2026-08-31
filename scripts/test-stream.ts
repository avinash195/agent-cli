import { streamMessage } from "../src/services/api/streaming.js";
import type { Message } from "../src/types/message.js";

async function main() {
  const messages: Message[] = [
    { role: "user", content: "What is 2 + 2? Answer in one sentence." },
  ];

  const generator = streamMessage(messages);
  let result = await generator.next();

  while (!result.done) {
    const event = result.value;

    switch (event.type) {
      case "message_start":
        process.stdout.write("\n[Stream started]\n\n");
        break;
      case "text":
        process.stdout.write(event.text);
        break;
      case "tool_use_start":
        process.stdout.write(`\n[Tool: ${event.name}]\n`);
        break;
      case "message_done":
        process.stdout.write("\n\n[Stream complete]\n");
        break;
    }

    result = await generator.next();
  }

  const streamResult = result.value;
  console.log(
    `\nTokens: ${streamResult.usage.inputTokens} in / ${streamResult.usage.outputTokens} out / ${streamResult.usage.cacheReadTokens} cached`
  );
  console.log(`Stop reason: ${streamResult.stopReason}`);
}

main().catch(console.error);
