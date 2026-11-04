import { z } from 'zod';
import {
  artifactSchema,
  contractSchema,
  mappingSchema,
  profileSchema,
  roles,
} from '@platform/contracts';
export { artifactSchema, profileSchema };
export const userSchema = z.object({ id: z.string(), email: z.string(), role: roles });
export const datasetSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  contract: contractSchema,
  proposalId: z.string().nullable(),
  verification: z.unknown(),
  createdAt: z.string(),
});
export const proposalSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  version: z.number(),
  contract: contractSchema,
  profile: profileSchema.nullable(),
  uploadId: z.string().nullable(),
  createdAt: z.string(),
});
export const uploadSchema = z.object({
  id: z.string(),
  originalName: z.string(),
  bytes: z.number(),
  profile: profileSchema.nullable(),
  createdAt: z.string(),
});
export const rowErrorSchema = z.object({
  row: z.number(),
  field: z.string(),
  value: z.string().nullable(),
  reason: z.string(),
});
export const jobSchema = z.object({
  id: z.string(),
  datasetId: z.string(),
  uploadId: z.string(),
  status: z.string(),
  mapping: mappingSchema,
  counts: z.object({
    received: z.number(),
    valid: z.number(),
    rejected: z.number(),
    inserted: z.number(),
    updated: z.number(),
    unchanged: z.number(),
  }),
  errors: z.array(rowErrorSchema),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
  failure: z.string().nullable(),
});
export const handoffSchema = z.object({
  id: z.string(),
  proposalId: z.string(),
  proposalVersion: z.number(),
  artifacts: z.array(artifactSchema),
  createdAt: z.string().optional(),
});
export const auditSchema = z.object({
  id: z.string(),
  action: z.string(),
  actorId: z.string().nullable(),
  details: z.unknown(),
  createdAt: z.string(),
});
export const compatibilitySchema = z.object({
  compatible: z.boolean(),
  missingRequired: z.array(z.object({ column: z.string(), source: z.string() })),
  missingOptional: z.array(z.object({ column: z.string(), source: z.string() })),
  unexpectedHeaders: z.array(z.string()),
  typeConflicts: z.array(
    z.object({
      column: z.string(),
      source: z.string(),
      expected: z.string(),
      observed: z.string(),
    }),
  ),
  sampled: z.boolean(),
});
export type DatasetView = z.infer<typeof datasetSchema>;
export type ProposalView = z.infer<typeof proposalSchema>;
export type UploadView = z.infer<typeof uploadSchema>;
export type JobView = z.infer<typeof jobSchema>;
export async function api<T, I>(
  path: string,
  schema: z.ZodType<T, z.ZodTypeDef, I>,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetch(`/api${path}`, { ...options, credentials: 'include', headers });
  const body: unknown = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    const err = z.object({ message: z.union([z.string(), z.array(z.string())]) }).safeParse(body);
    throw new Error(
      err.success
        ? Array.isArray(err.data.message)
          ? err.data.message.join('; ')
          : err.data.message
        : `Request failed (${response.status})`,
    );
  }
  return schema.parse(body);
}
export function post<T, I>(
  path: string,
  schema: z.ZodType<T, z.ZodTypeDef, I>,
  body: unknown = {},
): Promise<T> {
  return api(path, schema, { method: 'POST', body: JSON.stringify(body) });
}
export function put<T, I>(
  path: string,
  schema: z.ZodType<T, z.ZodTypeDef, I>,
  body: unknown,
): Promise<T> {
  return api(path, schema, { method: 'PUT', body: JSON.stringify(body) });
}
export const unknownSchema = z.unknown();
