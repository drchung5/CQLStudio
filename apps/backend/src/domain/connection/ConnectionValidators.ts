import { z } from "zod";

const contactPointSchema = z
  .string()
  .min(1, "Contact point is required")
  .transform((value) => value.trim());

export const connectionRequestSchema = z.object({
  connectionName: z.string().min(1, "Connection name is required").max(120),
  contactPoints: z.array(contactPointSchema).min(1, "At least one contact point is required"),
  port: z.number().int().min(1).max(65535).default(9042),
  localDataCenter: z.string().min(1, "Local data center is required"),
  username: z.string().optional(),
  password: z.string().optional()
});

export const disconnectRequestSchema = z.object({
  sessionId: z.string().min(1)
});

export const sessionIdQuerySchema = z.object({
  sessionId: z.string().min(1)
});
