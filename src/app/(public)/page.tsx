import { ArrowRight, AudioLines, Download, ImageIcon, Sparkles } from "lucide-react";
import Link from "next/link";
import { Brand, DemoBanner } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { getConfig } from "@/lib/config/env";
import { getPreferences } from "@/lib/preferences";

export default async function HomePage() {
  const { dict, theme } = await getPreferences();
  const isDemo = getConfig().mode === "demo";
  const steps = [
    { icon: ImageIcon, title: "1. Un portrait", text: "JPEG, PNG ou WebP, visage bien visible." },
    { icon: AudioLines, title: "2. Une voix", text: "Audio MP3 ou WAV de 30 s maximum, ou texte si la voix est activée." },
    { icon: Sparkles, title: "3. La génération", text: "Coût estimé et confirmé, puis suivi des étapes réelles." },
    { icon: Download, title: "4. La vidéo", text: "Lecture, téléchargement MP4 et galerie personnelle." },
  ];
  return (
    <div className="flex min-h-screen flex-col">
      {isDemo && <DemoBanner text={dict.demoBanner} />}
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Brand />
        <nav className="flex items-center gap-2">
          <ThemeToggle initial={theme} />
          <Button variant="ghost" asChild>
            <Link href="/login">Connexion</Link>
          </Button>
          <Button asChild>
            <Link href="/signup">Créer un compte</Link>
          </Button>
        </nav>
      </header>
      <main className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-10 px-4 py-10 sm:px-6 lg:grid-cols-2">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{dict.landing.tagline}</h1>
          <p className="mt-4 max-w-xl text-lg text-muted">{dict.landing.intro}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button size="lg" asChild>
              <Link href="/signup">
                {dict.landing.cta} <ArrowRight />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/login">{dict.landing.login}</Link>
            </Button>
          </div>
        </div>
        <figure className="overflow-hidden rounded-2xl border border-border bg-surface">
          <video src="/demo/sample.mp4" className="aspect-video w-full bg-black" controls muted loop playsInline preload="metadata" />
          <figcaption className="flex items-center gap-2 px-4 py-3 text-xs text-muted">
            <span className="rounded bg-warning/15 px-1.5 py-0.5 font-semibold text-warning">EXEMPLE</span>
            {dict.landing.exampleLabel}
          </figcaption>
        </figure>
        <section className="lg:col-span-2" aria-labelledby="how">
          <h2 id="how" className="sr-only">
            Fonctionnement
          </h2>
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((s) => (
              <li key={s.title} className="rounded-xl border border-border bg-surface p-4">
                <s.icon className="size-5 text-accent" aria-hidden />
                <p className="mt-3 font-medium">{s.title}</p>
                <p className="mt-1 text-sm text-muted">{s.text}</p>
              </li>
            ))}
          </ol>
        </section>
        <section className="rounded-xl border border-border bg-surface p-5 lg:col-span-2">
          <h2 className="font-semibold">{dict.landing.limitsTitle}</h2>
          <ul className="mt-3 grid list-disc gap-1 pl-5 text-sm text-muted sm:grid-cols-2">
            {dict.landing.limits.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </section>
      </main>
      <footer className="border-t border-border px-4 py-6 text-center text-xs text-muted">
        Animation Studio · projet en développement · <Link href="/privacy" className="underline">Confidentialité (brouillon)</Link>
      </footer>
    </div>
  );
}
