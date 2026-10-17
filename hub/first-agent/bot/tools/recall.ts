import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod";
import { FACTS_KEY, MAX_FACTS, readJournal } from "../lib/facts.js";

export default defineTool({
  description:
    "List facts saved with remember, oldest first. Call this before answering from the notebook.",
  execution: "server",
  effect: "read",
  inputSchema: z.object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_FACTS)
      .optional()
      .describe("How many of the newest facts to return. Omit to return every stored fact."),
  }),
  async execute({ limit }, ctx) {
    const facts = readJournal(await ctx.host.kv.get(FACTS_KEY));
    const shown = limit === undefined ? facts : facts.slice(-limit);
    return {
      count: facts.length,
      facts: shown.map((fact) => ({ text: fact.text, savedAt: fact.savedAt })),
    };
  },
});
