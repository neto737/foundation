export interface SendEmailInput {
  from?: string;
  to: string;
  subject: string;
  text: string;
}

export interface EmailProvider {
  send(input: SendEmailInput): Promise<void>;
}

export function createResendEmail(options: {
  apiKey: string;
  defaultFrom: string;
}): EmailProvider {
  return {
    async send(input): Promise<void> {
      const response = await fetch("https://api.resend.com/emails", {
        body: JSON.stringify({
          from: input.from ?? options.defaultFrom,
          subject: input.subject,
          text: input.text,
          to: [input.to],
        }),
        headers: {
          "Authorization": `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      if (!response.ok) {
        throw new EmailDeliveryError(response.status);
      }
    },
  };
}

export class EmailDeliveryError extends Error {
  constructor(status: number) {
    super(`Email provider rejected the request with status ${status}`);
    this.name = "EmailDeliveryError";
  }
}
