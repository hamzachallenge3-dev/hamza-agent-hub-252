import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod";
import { FACTS_KEY, readJournal, toJournal, type Fact } from "../lib/facts.js";

export default defineTool({
  description:
    "Save one fact the user asked you to remember. Call once per fact. The same text is stored only once.",
  execution: "server",
  effect: "write",
  inputSchema: z.object({
    text: z
      .string()
      .min(1)
      .max(500)
      .describe("The fact, in the user's words."),
  }),
  async execute({ text }, ctx) {
    const trimmed = text.trim();
    if (trimmed === "") {
      return { saved: false, duplicate: false, text: "", count: 0, error: "empty" };
    }
    const facts = readJournal(await ctx.host.kv.get(FACTS_KEY));
    if (facts.some((fact) => fact.text === trimmed)) {
      return { saved: false, duplicate: true, text: trimmed, count: facts.length };
    }
    const saved: Fact = { text: trimmed, savedAt: new Date().toISOString() };
    const next = toJournal([...facts, saved]).facts;
    await ctx.host.kv.put(FACTS_KEY, toJournal(next));
    return { saved: true, duplicate: false, text: trimmed, count: next.length };
  },
});
