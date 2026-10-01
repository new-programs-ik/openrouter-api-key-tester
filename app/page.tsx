import KeyChecker from "@/components/KeyChecker";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col font-sans">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-3">
          <p className="font-heading text-sm font-extrabold uppercase leading-tight tracking-wide">
            <span className="block text-brand-strong">Interview</span>
            <span className="block text-ink">Kickstart</span>
          </p>
          <span className="rounded-md bg-brand-tint px-3 py-1.5 text-xs font-semibold text-brand-strong">
            Learner tools
          </span>
        </div>
      </header>

      <div className="flex-1 bg-linear-to-b from-brand-tint via-white to-white">
        <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:py-12">
          <div className="mb-8 text-center">
            <h1 className="font-heading text-3xl tracking-tight text-ink sm:text-4xl">
              <span className="font-bold">OpenRouter</span> Key Tester
            </h1>
            <p className="mx-auto mt-3 max-w-2xl text-sm text-muted sm:text-base">
              Paste your OpenRouter API key to check that it works, see how much
              credit you have used, and run a quick test call.
            </p>
          </div>
          <KeyChecker />
        </main>
      </div>

      <footer className="mx-auto w-full max-w-5xl px-4 pb-8 text-center text-xs text-subtle">
        Your key is never stored. It&apos;s sent only to OpenRouter to fetch
        your data.
      </footer>
    </div>
  );
}
