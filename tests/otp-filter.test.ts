import { expect, test } from "bun:test";
import { matchOtpFilter, resolveOtpFilter } from "@/services/otpFilter";

const filter = resolveOtpFilter({
  enabled: true,
  ignoredSenders: ["628123456789", "120363000000000000@g.us"],
  keywordFilter: true,
  keywords: ["verification code", "otp code"],
  excludeKeywords: ["not received"],
});

test("ignored sender matches a phone or JID, including group participants", () => {
  expect(
    matchOtpFilter({ remoteJid: "628123456789:4@s.whatsapp.net", text: "hello" }, filter).ignored,
  ).toBe(true);
  expect(
    matchOtpFilter({ remoteJid: "120363000000000000@g.us", text: "group message" }, filter).ignored,
  ).toBe(true);
  expect(
    matchOtpFilter(
      {
        remoteJid: "120363000000000000@g.us",
        participant: "628123456789@s.whatsapp.net",
        text: "group message",
      },
      filter,
    ).ignored,
  ).toBe(true);
  expect(
    matchOtpFilter({ remoteJid: "628987654321@s.whatsapp.net", text: "hello" }, filter).ignored,
  ).toBe(false);
});

test("keyword filter is case-insensitive and exclude keywords win", () => {
  expect(
    matchOtpFilter(
      { remoteJid: "628987654321@s.whatsapp.net", text: "YOUR VERIFICATION CODE: 1234" },
      filter,
    ).ignored,
  ).toBe(true);
  expect(
    matchOtpFilter(
      { remoteJid: "628987654321@s.whatsapp.net", text: "verification code not received" },
      filter,
    ).ignored,
  ).toBe(false);
});

test("master switch and empty operator lists do not filter anything", () => {
  expect(
    matchOtpFilter(
      { remoteJid: "628123456789@s.whatsapp.net", text: "verification code" },
      resolveOtpFilter({
        enabled: false,
        ignoredSenders: ["628123456789"],
        keywordFilter: true,
        keywords: ["verification code"],
      }),
    ).ignored,
  ).toBe(false);
  expect(
    matchOtpFilter(
      { remoteJid: "628123456789@s.whatsapp.net", text: "verification code" },
      resolveOtpFilter({ enabled: true }),
    ).ignored,
  ).toBe(false);
  expect(resolveOtpFilter({ enabled: true }).keywords).toEqual([]);
});

function smartFilter(sensitivity: "conservative" | "balanced" | "aggressive" = "balanced") {
  return resolveOtpFilter({
    enabled: true,
    detectionMode: "smart",
    sensitivity,
    keywords: ["verification code", "kode otp", "code"],
    excludeKeywords: ["promo", "not received", "order"],
  });
}

test("smart OTP requires an operator phrase and a nearby code", () => {
  expect(
    matchOtpFilter(
      { remoteJid: "628987654321@s.whatsapp.net", text: "Your verification code is 123456" },
      smartFilter(),
    ).ignored,
  ).toBe(true);
  expect(
    matchOtpFilter(
      { remoteJid: "628987654321@s.whatsapp.net", text: "Kode OTP 482913" },
      smartFilter(),
    ).ignored,
  ).toBe(true);
  expect(
    matchOtpFilter(
      { remoteJid: "628987654321@s.whatsapp.net", text: "Your verification code is ready" },
      smartFilter(),
    ).ignored,
  ).toBe(false);
  expect(
    matchOtpFilter({ remoteJid: "628987654321@s.whatsapp.net", text: "123456" }, smartFilter())
      .ignored,
  ).toBe(false);
  expect(
    matchOtpFilter(
      { remoteJid: "628987654321@s.whatsapp.net", text: "Order 12345678 shipped" },
      smartFilter(),
    ).ignored,
  ).toBe(false);
});

test("smart OTP sensitivity controls proximity evidence and exclude keywords subtract", () => {
  const farCode = `verification code ${"x".repeat(50)} 1234`;
  const proximityFilter = (sensitivity: "conservative" | "balanced" | "aggressive") =>
    resolveOtpFilter({
      enabled: true,
      detectionMode: "smart",
      sensitivity,
      keywords: ["verification code"],
    });
  expect(
    matchOtpFilter(
      { remoteJid: "628987654321@s.whatsapp.net", text: farCode },
      proximityFilter("conservative"),
    ).ignored,
  ).toBe(false);
  expect(
    matchOtpFilter(
      { remoteJid: "628987654321@s.whatsapp.net", text: farCode },
      proximityFilter("balanced"),
    ).ignored,
  ).toBe(true);
  expect(
    matchOtpFilter(
      { remoteJid: "628987654321@s.whatsapp.net", text: "verification code 123456 promo" },
      smartFilter(),
    ).ignored,
  ).toBe(false);
  expect(
    matchOtpFilter(
      { remoteJid: "628987654321@s.whatsapp.net", text: "verification code not received" },
      smartFilter(),
    ).ignored,
  ).toBe(false);
});

test("smart OTP is the default mode and migrates legacy keyword configs", () => {
  expect(resolveOtpFilter({ enabled: true }).detectionMode).toBe("smart");
  expect(resolveOtpFilter({ enabled: true }).sensitivity).toBe("balanced");
  expect(resolveOtpFilter({ enabled: true, keywordFilter: true }).detectionMode).toBe("keywords");
  expect(
    matchOtpFilter(
      { remoteJid: "628987654321@s.whatsapp.net", text: "Verification code A1B2C3" },
      resolveOtpFilter({
        enabled: true,
        detectionMode: "smart",
        keywords: ["verification code"],
      }),
    ).ignored,
  ).toBe(true);
  expect(
    matchOtpFilter(
      { remoteJid: "628987654321@s.whatsapp.net", text: "verification code" },
      resolveOtpFilter({
        enabled: true,
        detectionMode: "keywords",
        keywords: ["verification code"],
      }),
    ).ignored,
  ).toBe(true);
});
