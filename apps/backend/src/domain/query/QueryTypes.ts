import { z } from "zod";

export const queryExecuteSchema = z.object({
  sessionId: z.string().min(1),
  cql: z.string().min(1, "CQL statement is required")
});
