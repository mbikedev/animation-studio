import { z } from "zod";
import { ASPECT_RATIOS, RESOLUTIONS } from "@/lib/domain";

const uuid = z.uuid();

export const projectTitleSchema = z.string().trim().min(1, "Titre requis").max(120, "120 caractères maximum");

export const uploadInitSchema = z.object({
  kind: z.enum(["image", "audio"]),
  projectId: uuid,
  declaredType: z.string().max(100),
  sizeBytes: z.number().int().positive(),
});

export const generationOptionsSchema = z.object({
  projectId: uuid,
  imageAssetId: uuid,
  audioAssetId: uuid.nullable(),
  voiceText: z.string().trim().max(600).optional(),
  prompt: z.string().trim().max(500).default(""),
  aspectRatio: z.enum(ASPECT_RATIOS),
  resolution: z.enum(RESOLUTIONS),
  simulateFailure: z.boolean().optional(),
});

export const launchSchema = generationOptionsSchema.extend({
  quoteId: z.string().min(1).max(300),
  /** Client-generated per-submission key (double-click / retry safe). */
  submissionId: uuid,
});

export const adjustCreditsSchema = z.object({
  userId: uuid,
  delta: z.coerce.number().int().refine((v) => v !== 0 && Math.abs(v) <= 100_000, "Montant invalide"),
  reason: z.string().trim().min(3, "Motif requis").max(300),
  requestId: uuid,
});

export const emailSchema = z.email("Email invalide").max(254).transform((v) => v.trim().toLowerCase());
export const passwordSchema = z.string().min(10, "10 caractères minimum").max(128);
