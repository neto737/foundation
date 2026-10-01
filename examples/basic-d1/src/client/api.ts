import { z } from "zod";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function apiRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (!response.ok) {
    if (response.status === 401)
      window.dispatchEvent(new Event("links:unauthorized"));
    const body: unknown = await response.json().catch(() => null);
    const parsed = z
      .object({ error: z.object({ message: z.string() }) })
      .safeParse(body);
    throw new ApiError(
      response.status,
      parsed.success
        ? parsed.data.error.message
        : "Request failed. Please try again.",
    );
  }
  return schema.parse(
    response.status === 204 ? undefined : await response.json(),
  );
}
