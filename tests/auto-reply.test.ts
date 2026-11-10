import { expect, test } from "bun:test";
import config from "@/config";
import { normalizeAutoReplyConfig, resolveAutoReplyConfig } from "@/services/autoReply";

test("a blank auto-reply message falls back to the environment default", () => {
  const normalized = normalizeAutoReplyConfig({
    enabled: true,
    type: "always",
    message: "   ",
  });
  expect(normalized?.message).toBe(config.autoReply.message);
  expect(normalized?.message).not.toBe("Halo!");
  expect(resolveAutoReplyConfig({ enabled: true, message: "" }).message).toBe(
    config.autoReply.message,
  );
});

test("a custom auto-reply message is preserved", () => {
  const custom = resolveAutoReplyConfig({
    enabled: true,
    type: "always",
    message: "Custom away message",
  });
  expect(custom.message).toBe("Custom away message");
});
