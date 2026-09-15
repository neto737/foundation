import { useState, type FormEvent } from "react";
import { authClient } from "./auth-client.js";

export function App() {
  const session = authClient.useSession();
  const [message, setMessage] = useState("");

  if (globalThis.location.pathname === "/reset-password") {
    return <ResetPassword />;
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const result = await authClient.signIn.email({
      email: field(data, "email"),
      password: field(data, "password"),
    });
    setMessage(result.error?.message ?? "Signed in");
  }

  async function signUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const result = await authClient.signUp.email({
      email: field(data, "email"),
      name: field(data, "name"),
      password: field(data, "password"),
    });
    setMessage(
      result.error?.message ?? "Check your email to verify your account",
    );
  }

  async function sendMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const result = await authClient.signIn.magicLink({
      email: field(data, "email"),
      callbackURL: "/",
    });
    setMessage(result.error?.message ?? "Magic link sent");
  }

  async function requestPasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const result = await authClient.requestPasswordReset({
      email: field(data, "email"),
      redirectTo: "/reset-password",
    });
    setMessage(
      result.error?.message ?? "If the account exists, a reset link was sent",
    );
  }

  if (session.data?.user) {
    return (
      <main className="shell">
        <section className="hero">
          <p className="eyebrow">FOUNDATION / BASIC D1</p>
          <h1>Hello, {session.data.user.name}</h1>
          <p>
            You are authenticated through Better Auth backed by Cloudflare D1.
          </p>
          <button onClick={() => void authClient.signOut()}>Sign out</button>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">FOUNDATION / BASIC D1</p>
        <h1>A small path to a production-shaped Worker.</h1>
        <p>
          React assets and a Hono API share one origin. Auth data stays in D1.
        </p>
      </section>
      <section className="forms" aria-label="Authentication">
        <AuthForm title="Create account" onSubmit={signUp} includeName />
        <AuthForm title="Sign in" onSubmit={signIn} />
        <form onSubmit={(event) => void sendMagicLink(event)}>
          <h2>Magic link</h2>
          <label>
            Email
            <input required name="email" type="email" autoComplete="email" />
          </label>
          <button type="submit">Send link</button>
        </form>
        <form onSubmit={(event) => void requestPasswordReset(event)}>
          <h2>Reset password</h2>
          <label>
            Email
            <input required name="email" type="email" autoComplete="email" />
          </label>
          <button type="submit">Request reset</button>
        </form>
      </section>
      <p className="message" role="status">
        {message}
      </p>
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
    const data = new FormData(event.currentTarget);
    const result = await authClient.resetPassword({
      newPassword: field(data, "password"),
      token,
    });
    setMessage(
      result.error?.message ?? "Password updated. You can sign in now.",
    );
  }

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">FOUNDATION / BASIC D1</p>
        <h1>Choose a new password.</h1>
      </section>
      <section className="forms">
        <form onSubmit={(event) => void reset(event)}>
          <label>
            New password
            <input
              required
              minLength={8}
              name="password"
              type="password"
              autoComplete="new-password"
            />
          </label>
          <button type="submit">Update password</button>
        </form>
      </section>
      <p className="message" role="status">
        {message}
      </p>
    </main>
  );
}

function field(data: FormData, name: string): string {
  const value = data.get(name);
  if (typeof value !== "string") throw new Error(`Missing form field: ${name}`);
  return value;
}

function AuthForm(props: {
  includeName?: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  title: string;
}) {
  return (
    <form onSubmit={(event) => void props.onSubmit(event)}>
      <h2>{props.title}</h2>
      {props.includeName ? (
        <label>
          Name
          <input required name="name" autoComplete="name" />
        </label>
      ) : null}
      <label>
        Email
        <input required name="email" type="email" autoComplete="email" />
      </label>
      <label>
        Password
        <input
          required
          minLength={8}
          name="password"
          type="password"
          autoComplete={props.includeName ? "new-password" : "current-password"}
        />
      </label>
      <button type="submit">{props.title}</button>
    </form>
  );
}
