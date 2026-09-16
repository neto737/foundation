import { authClient } from "./auth-client.js";
import {
  AsyncForm,
  FormField,
  type Feedback,
  type FormValues,
} from "./auth-form.js";

export function App() {
  const session = authClient.useSession();

  if (globalThis.location.pathname === "/reset-password") {
    return <ResetPassword />;
  }

  async function signIn(data: FormValues): Promise<Feedback> {
    const result = await authClient.signIn.email({
      email: field(data, "email"),
      password: field(data, "password"),
    });
    return feedback(result.error, "Signed in");
  }

  async function signUp(data: FormValues): Promise<Feedback> {
    const result = await authClient.signUp.email({
      email: field(data, "email"),
      name: field(data, "name"),
      password: field(data, "password"),
    });
    return feedback(result.error, "Check your email to verify your account");
  }

  async function sendMagicLink(data: FormValues): Promise<Feedback> {
    const result = await authClient.signIn.magicLink({
      email: field(data, "email"),
      callbackURL: "/",
    });
    return feedback(result.error, "Magic link sent");
  }

  async function requestPasswordReset(data: FormValues): Promise<Feedback> {
    const result = await authClient.requestPasswordReset({
      email: field(data, "email"),
      redirectTo: "/reset-password",
    });
    return feedback(
      result.error,
      "If the account exists, a reset link was sent",
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
        <AuthForm title="Create account" action={signUp} includeName />
        <AuthForm title="Sign in" action={signIn} />
        <AsyncForm
          title="Magic link"
          submitLabel="Send link"
          pendingLabel="Sending link..."
          action={sendMagicLink}
        >
          <FormField
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
          />
        </AsyncForm>
        <AsyncForm
          title="Reset password"
          submitLabel="Request reset"
          pendingLabel="Requesting reset..."
          action={requestPasswordReset}
        >
          <FormField
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
          />
        </AsyncForm>
      </section>
    </main>
  );
}

function ResetPassword() {
  async function reset(data: FormValues): Promise<Feedback> {
    const token = new URLSearchParams(globalThis.location.search).get("token");
    if (!token) {
      return { kind: "error", message: "The reset link is invalid" };
    }
    const result = await authClient.resetPassword({
      newPassword: field(data, "password"),
      token,
    });
    return feedback(result.error, "Password updated. You can sign in now.");
  }

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">FOUNDATION / BASIC D1</p>
        <h1>Choose a new password.</h1>
      </section>
      <section className="forms" aria-label="Password reset">
        <AsyncForm
          title="Reset password"
          submitLabel="Update password"
          pendingLabel="Updating password..."
          action={reset}
        >
          <FormField
            label="New password"
            name="password"
            type="password"
            minLength={8}
            autoComplete="new-password"
          />
        </AsyncForm>
      </section>
    </main>
  );
}

function AuthForm(props: {
  action: (data: FormValues) => Promise<Feedback>;
  includeName?: boolean;
  title: string;
}) {
  return (
    <AsyncForm
      title={props.title}
      submitLabel={props.title}
      pendingLabel={props.includeName ? "Creating account..." : "Signing in..."}
      action={props.action}
    >
      {props.includeName ? (
        <FormField label="Name" name="name" autoComplete="name" />
      ) : null}
      <FormField label="Email" name="email" type="email" autoComplete="email" />
      <FormField
        label="Password"
        name="password"
        type="password"
        minLength={8}
        autoComplete={props.includeName ? "new-password" : "current-password"}
      />
    </AsyncForm>
  );
}

function feedback(
  error: { message?: string | undefined } | null | undefined,
  successMessage: string,
): Feedback {
  return error
    ? { kind: "error", message: error.message ?? "The request failed" }
    : { kind: "success", message: successMessage };
}

function field(data: FormValues, name: keyof FormValues): string {
  const value = data[name];
  if (!value) throw new Error(`Missing form field: ${name}`);
  return value;
}
