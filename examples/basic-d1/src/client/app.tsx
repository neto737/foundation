import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes } from "react-router";
import { authClient } from "./auth-client.js";
import { AuthPage, ResetPassword, Verification } from "./auth-pages.js";
import { BookmarkEditor } from "./bookmark-editor.js";
import { BookmarkLibrary } from "./bookmark-library.js";

export function App() {
  const session = authClient.useSession();
  const [expired, setExpired] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  useEffect(() => {
    function unauthorized() {
      setExpired(true);
      void session.refetch();
    }
    window.addEventListener("links:unauthorized", unauthorized);
    return () => window.removeEventListener("links:unauthorized", unauthorized);
  }, [session.refetch]);
  const user = !expired ? session.data?.user : undefined;
  async function signOut() {
    setSigningOut(true);
    setLogoutError("");
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error(result.error.message);
      setExpired(true);
      await session.refetch();
    } catch {
      setLogoutError("Could not sign out. Please try again.");
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <main className="shell">
      <header className="app-header">
        <Link to="/" className="brand">
          Links
        </Link>
        <span className="eyebrow">FOUNDATION / BASIC D1</span>
        {user ? (
          <div className="account">
            <span>{user.name}</span>
            <button disabled={signingOut} onClick={() => void signOut()}>
              {signingOut ? "Signing out..." : "Sign out"}
            </button>
          </div>
        ) : null}
      </header>
      {logoutError ? <p role="alert">{logoutError}</p> : null}
      {session.isPending || signingOut ? (
        <p role="status">
          {signingOut ? "Signing out..." : "Loading your session..."}
        </p>
      ) : session.error && !expired ? (
        <section>
          <h1>Unable to load your session</h1>
          <p role="alert">Please check your connection.</p>
          <button onClick={() => void session.refetch()}>Try again</button>
        </section>
      ) : (
        <Routes key={user?.id ?? "anonymous"}>
          <Route
            path="/login"
            element={
              user ? (
                <Navigate to="/" replace />
              ) : (
                <AuthPage mode="login" onSignedIn={() => setExpired(false)} />
              )
            }
          />
          <Route
            path="/signup"
            element={
              user ? (
                <Navigate to="/" replace />
              ) : (
                <AuthPage mode="signup" onSignedIn={() => setExpired(false)} />
              )
            }
          />
          <Route
            path="/magic-link"
            element={
              <AuthPage mode="magic" onSignedIn={() => setExpired(false)} />
            }
          />
          <Route
            path="/forgot-password"
            element={
              <AuthPage mode="recover" onSignedIn={() => setExpired(false)} />
            }
          />
          <Route path="/verify-email" element={<Verification />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route
            path="/"
            element={
              user ? <BookmarkLibrary /> : <Navigate to="/login" replace />
            }
          />
          <Route
            path="/bookmarks/new"
            element={
              user ? (
                <BookmarkEditor key="new" />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />
          <Route
            path="/bookmarks/:id/edit"
            element={
              user ? <BookmarkEditor /> : <Navigate to="/login" replace />
            }
          />
          <Route
            path="*"
            element={<Navigate to={user ? "/" : "/login"} replace />}
          />
        </Routes>
      )}
    </main>
  );
}
