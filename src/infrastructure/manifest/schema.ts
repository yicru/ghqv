import { z } from 'zod';

const mode = z.literal('link');

export const repositorySpecSchema = z.object({
  source: z.string().min(1),
  path: z.string().optional(),
  role: z.string().optional(),
  tech: z.array(z.string()).optional(),
  depends_on: z.array(z.string()).optional(),
  mode: mode.optional(),
});

export const manifestSchema = z.object({
  version: z.literal(1),
  workspace: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    default_mode: mode.optional(),
    auto_get: z.boolean().optional(),
  }),
  repositories: z.record(z.string(), repositorySpecSchema),
});
