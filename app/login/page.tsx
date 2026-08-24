import Image from "next/image";
import { AudioLines } from "lucide-react";
import { LobbyPlayer } from "@/components/LobbyPlayer";

export const metadata = { title: "Sign in — Tracklist Scanner" };

const ERROR_MESSAGES: Record<string, string> = {
  denied: "This Google account is not allowed to use this app.",
  unverified: "This Google account's email is not verified.",
  state: "Sign-in session expired. Please try again.",
  failed: "Sign-in failed. Please try again.",
  config: "Google sign-in is not configured on the server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).",
};

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const errorMessage = error ? (ERROR_MESSAGES[error] ?? ERROR_MESSAGES.failed) : null;

  return (
    <div className="relative min-h-dvh overflow-hidden lg:h-dvh">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute -top-40 right-0 h-[600px] w-[600px] rounded-full bg-accent/20 blur-[160px]" />
      <div className="pointer-events-none absolute bottom-0 left-1/3 h-[400px] w-[400px] rounded-full bg-[#8b12f0]/15 blur-[140px]" />

      {/* Right: hero (full-bleed) */}
      <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[55%] lg:block">
        <div className="absolute inset-x-12 inset-y-24 rounded-[40px] bg-accent-gradient opacity-20 blur-3xl" />
        <Image
          src="/login-hero.png"
          alt=""
          fill
          priority
          sizes="55vw"
          className="object-cover object-[center_top] drop-shadow-[0_20px_60px_rgba(139,18,240,0.35)]"
        />
      </div>

      <div className="mx-auto grid h-full max-w-6xl grid-cols-1 items-center gap-8 px-6 lg:grid-cols-2 lg:px-8">
        {/* Left: brand + sign in */}
        <div className="relative z-10 py-16 lg:py-0">
          <div className="mb-10 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-gradient text-white">
              <AudioLines size={22} />
            </div>
            <span className="text-lg font-semibold">Tracklist Scanner</span>
          </div>

          <h1 className="max-w-md text-4xl font-bold leading-tight lg:text-5xl">
            Find every track.
            <br />
            <span className="text-accent-gradient">Grab it DJ-ready.</span>
          </h1>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted">
            Scan any mix or set, identify every song inside, then download
            clean, high-quality versions for your next gig.
          </p>

          <a
            href="/api/auth/google"
            className="mt-10 inline-flex items-center gap-3 rounded-xl bg-white px-6 py-3.5 text-sm font-semibold text-gray-800 shadow-lg shadow-black/30 transition-transform hover:scale-[1.02]"
          >
            <GoogleIcon />
            Sign in with Google
          </a>

          {errorMessage && (
            <p className="mt-5 max-w-sm rounded-lg border border-danger/30 bg-danger/10 px-4 py-2.5 text-xs text-danger">
              {errorMessage}
            </p>
          )}
        </div>

        {/* Right column spacer (image is full-bleed above) */}
        <div className="hidden lg:block" />
      </div>

      <LobbyPlayer />
    </div>
  );
}
