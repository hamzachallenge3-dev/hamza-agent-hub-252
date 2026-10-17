import { defineEval } from "@cursor/bdk/evals";

export default defineEval({
  tags: ["smoke"],
  description: "A request to remember a fact calls remember and skips recall.",
  async test(t) {
    await t.send("Remember that the launch code name is Harbor.");
    t.succeeded();
    t.calledTool("remember");
    t.notCalledTool("recall");
  },
});
