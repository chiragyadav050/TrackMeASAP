"use client";

import { useEffect } from "react";

import "./globals.css";

/**
 * Last-resort boundary for a failure in the root layout itself.
 *
 * It replaces the entire document, so it cannot use the app shell, the theme
 * provider or anything else from the layout that just failed — hence the
 * hand-written markup and the inline system font stack.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global error boundary caught an error", {
      digest: error.digest,
    });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          margin: 0,
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
          background: "#0e0f13",
          color: "#f4f4f6",
        }}
      >
        <main style={{ maxWidth: "28rem", textAlign: "center" }}>
          <h1
            style={{
              fontSize: "1.25rem",
              fontWeight: 600,
              letterSpacing: "-0.02em",
              margin: 0,
            }}
          >
            Life OS could not start
          </h1>

          <p
            style={{
              marginTop: "0.75rem",
              fontSize: "0.875rem",
              lineHeight: 1.6,
              color: "#a7a8b3",
            }}
          >
            An unexpected error stopped the application from loading. The
            details have been logged.
          </p>

          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1.5rem",
              height: "2.25rem",
              padding: "0 1rem",
              borderRadius: "0.5rem",
              border: "none",
              background: "#4f46e5",
              color: "#ffffff",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Reload
          </button>

          {error.digest ? (
            <p
              style={{
                marginTop: "1.5rem",
                fontSize: "0.75rem",
                fontFamily: "ui-monospace, monospace",
                color: "#7c7d8a",
              }}
            >
              Reference: {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
