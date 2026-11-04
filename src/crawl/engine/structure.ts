/**
 * A deliberately small reference-schema vocabulary for normalized observations.
 *
 * This module checks whether already-observed fields match one of SiteForge's
 * documented shapes. It does not infer a schema from arbitrary pages and does
 * not use fixture source data as a substitute for crawler observations.
 *
 * Policy:
 * - required fields must be present as own properties;
 * - optional fields may be absent, but must have the declared type when present;
 * - values use exact JavaScript primitive types (boxed strings do not match);
 * - empty strings are structurally valid because semantic validation is outside
 *   the scope of structure clustering; and
 * - unknown own enumerable string fields are rejected.
 */

export interface FieldDefinition {
  readonly type: "string";
  readonly optional?: true;
}

export interface ReferenceSchema {
  readonly id: string;
  readonly fields: Readonly<Record<string, FieldDefinition>>;
  readonly additionalProperties: false;
}

export interface BookFields {
  title: string;
  publicationDate: string;
  description: string;
  coverImage?: string;
}

export interface AuthorFields {
  name: string;
  biography: string;
}

export type ConformanceIssueCode =
  | "invalid_record"
  | "missing_required"
  | "type_mismatch"
  | "unsupported_field";

export interface ConformanceIssue {
  readonly code: ConformanceIssueCode;
  readonly field?: string;
  readonly expected?: "object" | "string";
  readonly actual?: string;
}

export interface ConformanceResult {
  readonly conforms: boolean;
  readonly issues: readonly ConformanceIssue[];
}

const requiredString = Object.freeze({ type: "string" as const });
const optionalString = Object.freeze({
  type: "string" as const,
  optional: true as const,
});

export const BOOK_SCHEMA: ReferenceSchema = Object.freeze({
  id: "book",
  fields: Object.freeze({
    title: requiredString,
    publicationDate: requiredString,
    description: requiredString,
    coverImage: optionalString,
  }),
  additionalProperties: false,
});

export const AUTHOR_SCHEMA: ReferenceSchema = Object.freeze({
  id: "author",
  fields: Object.freeze({
    name: requiredString,
    biography: requiredString,
  }),
  additionalProperties: false,
});

export const REFERENCE_SCHEMAS: readonly ReferenceSchema[] = Object.freeze([
  BOOK_SCHEMA,
  AUTHOR_SCHEMA,
]);

function actualType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateSchema(
  value: unknown,
  schema: ReferenceSchema,
): ConformanceResult {
  if (!isRecord(value)) {
    return {
      conforms: false,
      issues: [
        {
          code: "invalid_record",
          expected: "object",
          actual: actualType(value),
        },
      ],
    };
  }

  const issues: ConformanceIssue[] = [];
  const fieldNames = new Set(Object.keys(schema.fields));

  for (const [field, definition] of Object.entries(schema.fields)) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      if (definition.optional !== true) {
        issues.push({ code: "missing_required", field });
      }
      continue;
    }

    const fieldValue = value[field];
    if (typeof fieldValue !== definition.type) {
      issues.push({
        code: "type_mismatch",
        field,
        expected: definition.type,
        actual: actualType(fieldValue),
      });
    }
  }

  if (!schema.additionalProperties) {
    for (const field of Object.keys(value)) {
      if (!fieldNames.has(field)) {
        issues.push({ code: "unsupported_field", field });
      }
    }
  }

  return { conforms: issues.length === 0, issues };
}

export function conformsToSchema(
  value: unknown,
  schema: ReferenceSchema,
): value is Record<string, string> {
  return validateSchema(value, schema).conforms;
}

export function matchingSchemas(
  value: unknown,
  schemas: readonly ReferenceSchema[] = REFERENCE_SCHEMAS,
): readonly ReferenceSchema[] {
  return schemas.filter((schema) => conformsToSchema(value, schema));
}

/**
 * Two observations are compatible when they both conform to at least one of
 * the same declared reference schemas. No schema is synthesized from their
 * coincidental keys.
 */
export function shareReferenceStructure(
  left: unknown,
  right: unknown,
  schemas: readonly ReferenceSchema[] = REFERENCE_SCHEMAS,
): boolean {
  return schemas.some(
    (schema) =>
      conformsToSchema(left, schema) && conformsToSchema(right, schema),
  );
}
