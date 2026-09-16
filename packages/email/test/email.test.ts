import { afterEach, describe, expect, it, vi } from "vitest";

import { createResendEmail, EmailDeliveryError } from "../src/index.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createResendEmail", () => {
  it("sends the documented Resend request using the default sender", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetch);
    const email = createResendEmail({
      apiKey: "resend-key",
      defaultFrom: "App <noreply@example.com>",
    });

    await email.send({
      subject: "Welcome",
      text: "Hello",
      to: "person@example.com",
    });

    expect(fetch).toHaveBeenCalledWith("https://api.resend.com/emails", {
      body: JSON.stringify({
        from: "App <noreply@example.com>",
        subject: "Welcome",
        text: "Hello",
        to: ["person@example.com"],
      }),
      headers: {
        "Authorization": "Bearer resend-key",
        "Content-Type": "application/json",
      },
      method: "POST",
    });
  });

  it("honors an explicit sender and exposes provider rejection status", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(null, { status: 429 }));
    vi.stubGlobal("fetch", fetch);
    const email = createResendEmail({
      apiKey: "resend-key",
      defaultFrom: "noreply@example.com",
    });

    const delivery = email.send({
      from: "support@example.com",
      subject: "Support",
      text: "Reply",
      to: "person@example.com",
    });

    await expect(delivery).rejects.toBeInstanceOf(EmailDeliveryError);
    await expect(delivery).rejects.toThrow(
      "Email provider rejected the request with status 429",
    );
    expect(fetch).toHaveBeenCalledWith("https://api.resend.com/emails", {
      body: JSON.stringify({
        from: "support@example.com",
        subject: "Support",
        text: "Reply",
        to: ["person@example.com"],
      }),
      headers: {
        "Authorization": "Bearer resend-key",
        "Content-Type": "application/json",
      },
      method: "POST",
    });
  });
});
