import { useState, type FormEvent } from "react";
import { authClient } from "./auth-client.js";

function value(data: FormData, name: string): string {
  const field = data.get(name);
  if (typeof field !== "string") throw new Error(`Missing ${name}`);
  return field;
}

export function App() {
  const session = authClient.useSession();
  const [message, setMessage] = useState("");

  if (globalThis.location.pathname === "/reset-password") {
    return <ResetPassword />;
  }

  async function submit(
    event: FormEvent<HTMLFormElement>,
    action: "sign-in" | "sign-up",
  ) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const result =
      action === "sign-up"
        ? await authClient.signUp.email({
            name: value(data, "name"),
            email: value(data, "email"),
            password: value(data, "password"),
          })
        : await authClient.signIn.email({
            email: value(data, "email"),
            password: value(data, "password"),
          });
    setMessage(
      result.error?.message ??
        (action === "sign-up"
          ? "Check your email to verify your account"
          : "Signed in"),
    );
  }

  async function magicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await authClient.signIn.magicLink({
      email: value(new FormData(event.currentTarget), "email"),
      callbackURL: "/",
    });
    setMessage(result.error?.message ?? "Magic link sent");
  }

  async function requestPasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await authClient.requestPasswordReset({
      email: value(new FormData(event.currentTarget), "email"),
      redirectTo: "/reset-password",
    });
    setMessage(
      result.error?.message ?? "If the account exists, a reset link was sent",
    );
  }

  if (session.data?.user) {
    return (
      <main>
        <p>__PROJECT_NAME__</p>
        <h1>Hello, {session.data.user.name}</h1>
        <p>
          You are authenticated through Better Auth backed by Cloudflare D1.
        </p>
        <button onClick={() => void authClient.signOut()}>Sign out</button>
      </main>
    );
  }

  return (
    <main>
      <p>__PROJECT_NAME__</p>
      <h1>React, Hono, Better Auth, and D1.</h1>
      <section aria-label="Authentication">
        <form onSubmit={(event) => void submit(event, "sign-up")}>
          <h2>Create account</h2>
          <input required name="name" placeholder="Name" autoComplete="name" />
          <input
            required
            name="email"
            placeholder="Email"
            type="email"
            autoComplete="email"
          />
          <input
            required
            minLength={8}
            name="password"
            placeholder="Password"
            type="password"
            autoComplete="new-password"
          />
          <button>Create account</button>
        </form>
        <form onSubmit={(event) => void submit(event, "sign-in")}>
          <h2>Sign in</h2>
          <input
            required
            name="email"
            placeholder="Email"
            type="email"
            autoComplete="email"
          />
          <input
            required
            name="password"
            placeholder="Password"
            type="password"
            autoComplete="current-password"
          />
          <button>Sign in</button>
        </form>
        <form onSubmit={(event) => void magicLink(event)}>
          <h2>Magic link</h2>
          <input
            required
            name="email"
            placeholder="Email"
            type="email"
            autoComplete="email"
          />
          <button>Send link</button>
        </form>
        <form onSubmit={(event) => void requestPasswordReset(event)}>
          <h2>Reset password</h2>
          <input
            required
            name="email"
            placeholder="Email"
            type="email"
            autoComplete="email"
          />
          <button>Request reset</button>
        </form>
      </section>
      <p role="status">{message}</p>
    </main>
  );
}

function ResetPassword() {
  const [message, setMessage] = useState("");

  async function reset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = new URLSearchParams(globalThis.location.search).get("token");
    if (!token) {
      setMessage("The reset link is invalid");
      return;
    }
    const result = await authClient.resetPassword({
      newPassword: value(new FormData(event.currentTarget), "password"),
      token,
    });
    setMessage(
      result.error?.message ?? "Password updated. You can sign in now.",
    );
  }

  return (
    <main>
      <p>__PROJECT_NAME__</p>
      <h1>Choose a new password.</h1>
      <form onSubmit={(event) => void reset(event)}>
        <input
          required
          minLength={8}
          name="password"
          placeholder="New password"
          type="password"
          autoComplete="new-password"
        />
        <button>Update password</button>
      </form>
      <p role="status">{message}</p>
    </main>
  );
}
