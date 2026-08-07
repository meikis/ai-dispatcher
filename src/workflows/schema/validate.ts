// schema/validate.ts — ajv wrapper, --json-schema arg building, safety-net validate
// schema/validate.ts —— ajv 封装、构造 --json-schema 参数、兜底校验

import { Ajv } from "ajv";
import type { ValidateFunction } from "ajv";
import type { JsonSchema } from "../types.js";

const ajv = new Ajv({ allErrors: true, strict: false });
const validatorCache = new Map<string, ValidateFunction>();

export function schemaToCliArg(schema: JsonSchema): string {
  return JSON.stringify(schema);
}

export interface ValidationResult {
  ok: boolean;
  errors?: string;
}

function getValidator(schema: JsonSchema): ValidateFunction {
  const cacheKey = JSON.stringify(schema);
  const existing = validatorCache.get(cacheKey);
  if (existing) return existing;
  const compiled = ajv.compile(schema);
  validatorCache.set(cacheKey, compiled);
  return compiled;
}

export function validateAgainstSchema(schema: JsonSchema, value: unknown): ValidationResult {
  const validate = getValidator(schema);
  const valid = validate(value);
  if (valid) return { ok: true };
  const errors = ajv.errorsText(validate.errors, { separator: "; " });
  return { ok: false, errors };
}

export function assertObjectRootSchema(schema: JsonSchema): void {
  if (schema["type"] !== "object") {
    throw new Error(
      `structured-output schema root must be type:"object" (got ${JSON.stringify(
        schema["type"],
      )}); discriminated unions must be expressed flat (enum discriminant + optional fields), not a root oneOf`,
    );
  }
}
