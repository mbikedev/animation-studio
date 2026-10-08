"use client";

import { AudioLines, FileAudio, ImagePlus, Loader2, Plus, Sparkles, Upload } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GenerationProgress, VideoResult } from "@/components/generation-status";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { FieldError, FieldHint, Input, Label, Select, Textarea } from "@/components/ui/fields";
import { api, ApiError, uploadFile, type UploadedAsset } from "@/lib/client/api";
import type { PresentedGeneration } from "@/lib/generation/presenter";
import { cn, formatDuration } from "@/lib/utils";

interface ProjectOption {
  id: string;
  title: string;
}

interface Capabilities {
  aspectRatios: string[];
  resolutions: string[];
  maxOutputDurationMs: number;
}

interface EstimateResponse {
  estimate: { credits: number; estimatedCostMinor: number; currency: string; billableSeconds: number; priceVersion: string; quoteId: string };
  durationMs: number;
  availableCredits: number;
  enoughCredits: boolean;
}

const RES_LABEL: Record<string, string> = { "540p": "540p", "720p": "720p (HD)", "1080p": "1080p (Full HD)" };
const ASPECT_LABEL: Record<string, string> = { "16:9": "16:9 paysage", "9:16": "9:16 portrait", "1:1": "1:1 carré" };

export function StudioClient(props: {
  projects: ProjectOption[];
  initialProjectId: string | null;
  enabled: boolean;
  blockers: string[];
  capabilities: Capabilities | null;
  voiceEnabled: boolean;
  isDemo: boolean;
  maxDurationSeconds: number;
}) {
  const [projects, setProjects] = useState(props.projects);
  const [projectId, setProjectId] = useState(props.initialProjectId ?? props.projects[0]?.id ?? "");
  const [newTitle, setNewTitle] = useState("");
  const [image, setImage] = useState<UploadedAsset | null>(null);
  const [audio, setAudio] = useState<UploadedAsset | null>(null);
  const [audioMode, setAudioMode] = useState<"upload" | "voice">("upload");
  const [voiceText, setVoiceText] = useState("");
  const [aspectRatio, setAspectRatio] = useState(props.capabilities?.aspectRatios[0] ?? "16:9");
  const [resolution, setResolution] = useState(props.capabilities?.resolutions.includes("720p") ? "720p" : (props.capabilities?.resolutions[0] ?? "720p"));
  const [prompt, setPrompt] = useState("");
  const [simulateFailure, setSimulateFailure] = useState(false);
  const [busy, setBusy] = useState<null | "image" | "audio" | "project">(null);
  const [error, setError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<EstimateResponse | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [generation, setGeneration] = useState<PresentedGeneration | null>(null);
  const submissionId = useRef<string>(crypto.randomUUID());

  const options = useMemo(() => {
    if (!projectId || !image) return null;
    if (audioMode === "upload" && !audio) return null;
    if (audioMode === "voice" && voiceText.trim().length < 2) return null;
    return {
      projectId,
      imageAssetId: image.asset.id,
      audioAssetId: audioMode === "upload" ? (audio?.asset.id ?? null) : null,
      voiceText: audioMode === "voice" ? voiceText.trim() : undefined,
      prompt: prompt.trim(),
      aspectRatio,
      resolution,
      simulateFailure: props.isDemo ? simulateFailure : undefined,
    };
  }, [projectId, image, audio, audioMode, voiceText, prompt, aspectRatio, resolution, simulateFailure, props.isDemo]);

  // Estimate whenever the inputs are complete (server-side computation).
  useEffect(() => {
    if (!options || !props.enabled) {
      setEstimate(null);
      return;
    }
    const controller = new AbortController();
    const t = setTimeout(async () => {
      setEstimating(true);
      try {
        setEstimate(await api<EstimateResponse>("/api/generations/estimate", { method: "POST", json: options, signal: controller.signal }));
        setError(null);
      } catch (e) {
        if (!controller.signal.aborted) {
          setEstimate(null);
          setError(e instanceof Error ? e.message : "Estimation impossible.");
        }
      } finally {
        if (!controller.signal.aborted) setEstimating(false);
      }
    }, 300);
    return () => {
      controller.abort();
      clearTimeout(t);
    };
  }, [options, props.enabled]);

  // Poll the current generation until it reaches a final state.
  useEffect(() => {
    if (!generation || ["succeeded", "failed", "canceled", "needs_reconciliation"].includes(generation.status)) return;
    const t = setTimeout(async () => {
      try {
        const { generation: next } = await api<{ generation: PresentedGeneration }>(`/api/generations/${generation.id}`);
        setGeneration(next);
      } catch {
        // transient; the next tick retries
        setGeneration({ ...generation });
      }
    }, 2000);
    return () => clearTimeout(t);
  }, [generation]);

  const createProject = useCallback(async () => {
    if (!newTitle.trim()) return;
    setBusy("project");
    setError(null);
    try {
      const { project } = await api<{ project: ProjectOption }>("/api/projects", { method: "POST", json: { title: newTitle.trim() } });
      setProjects((p) => [project, ...p]);
      setProjectId(project.id);
      setNewTitle("");
      setImage(null);
      setAudio(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Création impossible.");
    } finally {
      setBusy(null);
    }
  }, [newTitle]);

  async function onFile(kind: "image" | "audio", file: File | undefined) {
    if (!file || !projectId) return;
    setBusy(kind);
    setError(null);
    try {
      const uploaded = await uploadFile(file, kind, projectId);
      if (kind === "image") setImage(uploaded);
      else setAudio(uploaded);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Envoi impossible.");
    } finally {
      setBusy(null);
    }
  }

  async function launch() {
    if (!options || !estimate) return;
    setLaunching(true);
    setError(null);
    try {
      const res = await api<{ generation: PresentedGeneration }>("/api/generations", {
        method: "POST",
        json: { ...options, quoteId: estimate.estimate.quoteId, submissionId: submissionId.current },
      });
      setGeneration(res.generation);
      setConfirmOpen(false);
      submissionId.current = crypto.randomUUID(); // a new click is a new generation
    } catch (e) {
      if (e instanceof ApiError && e.code === "quote_changed" && e.data?.estimate) {
        setEstimate((prev) => (prev ? { ...prev, estimate: e.data!.estimate as EstimateResponse["estimate"] } : prev));
      }
      setError(e instanceof Error ? e.message : "Lancement impossible.");
    } finally {
      setLaunching(false);
    }
  }

  async function cancel() {
    if (!generation) return;
    try {
      const res = await api<{ generation: PresentedGeneration }>(`/api/generations/${generation.id}/cancel`, { method: "POST" });
      setGeneration(res.generation);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Annulation impossible.");
    }
  }

  const running = generation && !["succeeded", "failed", "canceled", "needs_reconciliation"].includes(generation.status);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="grid content-start gap-6">
        {!props.enabled && (
          <Alert tone="warning">
            <p className="font-medium">Génération indisponible</p>
            <ul className="mt-1 list-disc pl-5">
              {props.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </Alert>
        )}

        <Card>
          <CardTitle>1. Projet</CardTitle>
          <div className="mt-4 grid gap-3">
            {projects.length > 0 && (
              <div className="grid gap-1.5">
                <Label htmlFor="project">Projet</Label>
                <Select
                  id="project"
                  value={projectId}
                  onChange={(e) => {
                    setProjectId(e.target.value);
                    setImage(null);
                    setAudio(null);
                  }}
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void createProject();
              }}
            >
              <Label htmlFor="new-project" className="sr-only">
                Nouveau projet
              </Label>
              <Input id="new-project" placeholder="Nouveau projet" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} maxLength={120} />
              <Button type="submit" variant="secondary" disabled={!newTitle.trim() || busy === "project"}>
                <Plus /> Créer
              </Button>
            </form>
          </div>
        </Card>

        <Card aria-disabled={!projectId}>
          <CardTitle>2. Image du personnage</CardTitle>
          <CardDescription>JPEG, PNG ou WebP, 10 Mo maximum. Un visage net, de face, donne de meilleurs résultats.</CardDescription>
          <DropZone
            id="image-input"
            accept="image/jpeg,image/png,image/webp"
            disabled={!projectId || busy !== null}
            busy={busy === "image"}
            icon={<ImagePlus />}
            label={image ? "Remplacer l'image" : "Choisir ou déposer une image"}
            onFile={(f) => onFile("image", f)}
          />
          {image && (
            <p className="mt-2 text-xs text-muted">
              Image validée · {image.asset.width}×{image.asset.height} px · métadonnées EXIF retirées
            </p>
          )}
        </Card>

        <Card aria-disabled={!projectId}>
          <CardTitle>3. Voix</CardTitle>
          <div className="mt-3 inline-flex rounded-lg bg-surface-2 p-1" role="radiogroup" aria-label="Source audio">
            {(["upload", "voice"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={audioMode === mode}
                disabled={mode === "voice" && !props.voiceEnabled}
                onClick={() => setAudioMode(mode)}
                className={cn("rounded-md px-3 py-1.5 text-sm disabled:opacity-40", audioMode === mode ? "bg-surface font-medium shadow-sm" : "text-muted")}
              >
                {mode === "upload" ? "Importer un audio" : "Texte vers voix"}
              </button>
            ))}
          </div>
          {!props.voiceEnabled && <FieldHint className="mt-2">Le texte vers voix est désactivé (option facultative à configurer).</FieldHint>}
          {audioMode === "upload" ? (
            <>
              <DropZone
                id="audio-input"
                accept="audio/mpeg,audio/wav,.mp3,.wav"
                disabled={!projectId || busy !== null}
                busy={busy === "audio"}
                icon={<FileAudio />}
                label={audio ? "Remplacer l'audio" : `Choisir un MP3 ou WAV (${props.maxDurationSeconds} s max)`}
                onFile={(f) => onFile("audio", f)}
              />
              {audio && (
                <div className="mt-3 grid gap-2">
                  <audio controls src={audio.previewUrl} className="w-full" />
                  <p className="text-xs text-muted">Durée mesurée par le serveur : {formatDuration(audio.asset.durationMs)}</p>
                </div>
              )}
            </>
          ) : (
            <div className="mt-3 grid gap-1.5">
              <Label htmlFor="voice-text">Texte à dire</Label>
              <Textarea id="voice-text" maxLength={600} value={voiceText} onChange={(e) => setVoiceText(e.target.value)} />
              <FieldHint>La voix est synthétisée au lancement puis mesurée ; au-delà de {props.maxDurationSeconds} s, la génération s&apos;arrête avant la vidéo et les crédits sont rendus.</FieldHint>
            </div>
          )}
        </Card>

        <Card>
          <CardTitle>4. Options</CardTitle>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="aspect">Format</Label>
              <Select id="aspect" value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} disabled={!props.capabilities}>
                {(props.capabilities?.aspectRatios ?? []).map((a) => (
                  <option key={a} value={a}>
                    {ASPECT_LABEL[a] ?? a}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="resolution">Résolution</Label>
              <Select id="resolution" value={resolution} onChange={(e) => setResolution(e.target.value)} disabled={!props.capabilities}>
                {(props.capabilities?.resolutions ?? []).map((r) => (
                  <option key={r} value={r}>
                    {RES_LABEL[r] ?? r}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="prompt">Indication de jeu (facultatif)</Label>
              <Input id="prompt" maxLength={500} placeholder="Ex. : parle calmement en souriant" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
              <FieldHint>Seules les options documentées pour le moteur sont proposées.</FieldHint>
            </div>
            {props.isDemo && (
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" checked={simulateFailure} onChange={(e) => setSimulateFailure(e.target.checked)} />
                Simuler un échec (démonstration)
              </label>
            )}
          </div>
        </Card>
      </div>

      <div className="grid content-start gap-6 lg:sticky lg:top-6">
        <Card>
          <CardTitle>Aperçu</CardTitle>
          <div className="mt-4 grid place-items-center overflow-hidden rounded-lg bg-surface-2" style={{ aspectRatio: aspectRatio.replace(":", " / ") }}>
            {generation?.videoUrl ? (
              <span className="sr-only">Vidéo prête ci-dessous</span>
            ) : image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image.previewUrl} alt="Image du personnage importée" className="h-full w-full object-contain" />
            ) : (
              <p className="p-6 text-center text-sm text-muted">L&apos;aperçu de votre personnage apparaîtra ici.</p>
            )}
          </div>
        </Card>

        <Card>
          <CardTitle>Coût et lancement</CardTitle>
          {!options ? (
            <CardDescription>Ajoutez une image et un audio (ou un texte) pour obtenir l&apos;estimation.</CardDescription>
          ) : estimating && !estimate ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-muted">
              <Loader2 className="size-4 animate-spin" /> Calcul de l&apos;estimation…
            </p>
          ) : estimate ? (
            <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-muted">Durée de sortie prévue</dt>
              <dd className="text-right">
                {formatDuration(estimate.durationMs)} ({estimate.estimate.billableSeconds} s facturées)
              </dd>
              <dt className="text-muted">Coût</dt>
              <dd className="text-right text-lg font-semibold">{estimate.estimate.credits} crédits</dd>
              <dt className="text-muted">Solde disponible</dt>
              <dd className={cn("text-right", !estimate.enoughCredits && "text-danger")}>{estimate.availableCredits} crédits</dd>
              <dt className="text-xs text-muted">Grille tarifaire</dt>
              <dd className="text-right text-xs text-muted">{estimate.estimate.priceVersion}</dd>
            </dl>
          ) : null}
          {error && <FieldError className="mt-3">{error}</FieldError>}
          {estimate && !estimate.enoughCredits && (
            <p className="mt-3 text-sm">
              <Link href="/credits" className="text-accent underline">
                Acheter des crédits
              </Link>
            </p>
          )}
          <Button className="mt-4 w-full" size="lg" disabled={!estimate || !estimate.enoughCredits || !props.enabled || Boolean(running)} onClick={() => setConfirmOpen(true)}>
            <Sparkles /> Générer la vidéo
          </Button>
        </Card>

        {generation && (
          <Card>
            <div className="mb-4 flex items-center justify-between">
              <CardTitle>Génération</CardTitle>
              {generation.demo && <Badge tone="warning">Démonstration</Badge>}
            </div>
            <GenerationProgress generation={generation} onCancel={cancel} />
            <div className="mt-4">
              <VideoResult generation={generation} />
            </div>
            {["succeeded", "failed"].includes(generation.status) && (
              <p className="mt-3 text-xs text-muted">Relancer crée une nouvelle génération, avec son propre coût affiché avant confirmation.</p>
            )}
          </Card>
        )}
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent
          title="Confirmer la génération"
          description={
            estimate
              ? `${estimate.estimate.credits} crédits seront réservés maintenant, puis consommés si la vidéo est livrée ou rendus en cas d'échec.`
              : undefined
          }
        >
          <ul className="grid gap-1 text-sm text-muted">
            <li>
              <AudioLines className="mr-1 inline size-4" />
              Durée prévue : {estimate ? formatDuration(estimate.durationMs) : "—"}
            </li>
            <li>
              Format {aspectRatio} · {resolution}
            </li>
            <li>Une fois transmise au moteur, la génération ne peut plus être annulée.</li>
          </ul>
          <div className="mt-6 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="outline">Retour</Button>
            </DialogClose>
            <Button onClick={launch} disabled={launching}>
              {launching ? <Loader2 className="animate-spin" /> : <Sparkles />} Confirmer ({estimate?.estimate.credits ?? 0} crédits)
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DropZone(props: { id: string; accept: string; disabled: boolean; busy: boolean; icon: React.ReactNode; label: string; onFile: (file: File | undefined) => void }) {
  const [over, setOver] = useState(false);
  return (
    <label
      htmlFor={props.id}
      onDragOver={(e) => {
        e.preventDefault();
        if (!props.disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!props.disabled) props.onFile(e.dataTransfer.files[0]);
      }}
      className={cn(
        "mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border px-4 py-8 text-center text-sm text-muted transition-colors focus-within:border-accent [&_svg]:size-6",
        over && "border-accent bg-accent-soft",
        props.disabled && "cursor-not-allowed opacity-50",
      )}
    >
      {props.busy ? <Loader2 className="animate-spin" /> : props.icon}
      <span>{props.busy ? "Envoi et vérification…" : props.label}</span>
      <span className="inline-flex items-center gap-1 text-xs">
        <Upload className="size-3" /> glisser-déposer accepté
      </span>
      <input
        id={props.id}
        type="file"
        accept={props.accept}
        className="sr-only"
        disabled={props.disabled}
        onChange={(e) => {
          props.onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </label>
  );
}
