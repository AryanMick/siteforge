import assert from "node:assert/strict";

import {
  Given,
  Then,
  When,
  World,
  setWorldConstructor,
  type IWorldOptions,
} from "@cucumber/cucumber";

import {
  AUTHOR_SCHEMA,
  BOOK_SCHEMA,
  matchingSchemas,
  shareReferenceStructure,
  validateSchema,
  type ConformanceIssueCode,
  type ConformanceResult,
  type ReferenceSchema,
} from "../../src/crawl/engine/structure.js";
import {
  createBookHtmlFixture,
  extractObservedBookFields,
  type BookHtmlVariant,
} from "../../src/crawl/engine/book-html.js";
import type { BookFields } from "../../src/crawl/engine/structure.js";

const completeBook: BookFields = {
  title: "The Glass Library",
  publicationDate: "2026-09-25",
  description: "First paragraph.\n\nSecond paragraph.",
  coverImage: "/covers/glass.jpg",
};

const completeAuthor = {
  name: "Octavia Vale",
  biography: "Writes about impossible archives.",
};

class StructureWorld extends World {
  schema?: ReferenceSchema;
  candidate: unknown;
  result?: ConformanceResult;
  left: unknown;
  right: unknown;
  compatibility?: boolean;
  html?: string;
  expectedBook?: BookFields;
  observed?: Partial<BookFields>;

  constructor(options: IWorldOptions) {
    super(options);
  }
}

setWorldConstructor(StructureWorld);

function schemaNamed(name: string): ReferenceSchema {
  if (name === "book") return BOOK_SCHEMA;
  if (name === "author") return AUTHOR_SCHEMA;
  throw new Error(`Unknown reference schema: ${name}`);
}

function requireResult(world: StructureWorld): ConformanceResult {
  assert.ok(world.result, "schema conformance has not been checked");
  return world.result;
}

function requireObserved(world: StructureWorld): Partial<BookFields> {
  assert.ok(world.observed, "book fields have not been extracted");
  return world.observed;
}

Given(
  "the {string} reference schema",
  function (this: StructureWorld, name: string) {
    this.schema = schemaNamed(name);
  },
);

Given("the candidate JSON:", function (this: StructureWorld, json: string) {
  this.candidate = JSON.parse(json);
});

Given(
  "the candidate is JSON {string}",
  function (this: StructureWorld, json: string) {
    this.candidate = JSON.parse(json);
  },
);

Given(
  "a complete book candidate without the {string} field",
  function (this: StructureWorld, field: string) {
    const candidate: Record<string, unknown> = { ...completeBook };
    delete candidate[field];
    this.candidate = candidate;
  },
);

Given(
  "a complete author candidate without the {string} field",
  function (this: StructureWorld, field: string) {
    const candidate: Record<string, unknown> = { ...completeAuthor };
    delete candidate[field];
    this.candidate = candidate;
  },
);

Given(
  "a complete book candidate with {string} set to JSON {string}",
  function (this: StructureWorld, field: string, json: string) {
    this.candidate = { ...completeBook, [field]: JSON.parse(json) };
  },
);

When("I check schema conformance", function (this: StructureWorld) {
  assert.ok(this.schema, "a reference schema must be selected");
  this.result = validateSchema(this.candidate, this.schema);
});

Then("the candidate conforms", function (this: StructureWorld) {
  assert.deepEqual(requireResult(this), { conforms: true, issues: [] });
});

Then(
  "conformance fails with {string}",
  function (this: StructureWorld, code: ConformanceIssueCode) {
    const result = requireResult(this);
    assert.equal(result.conforms, false);
    assert.ok(result.issues.some((issue) => issue.code === code));
  },
);

Then(
  "conformance fails with {string} at {string}",
  function (
    this: StructureWorld,
    code: ConformanceIssueCode,
    field: string,
  ) {
    const result = requireResult(this);
    assert.equal(result.conforms, false);
    assert.ok(
      result.issues.some(
        (issue) => issue.code === code && issue.field === field,
      ),
      `expected ${code} at ${field}; received ${JSON.stringify(result.issues)}`,
    );
  },
);

Then(
  "conformance fails with {string} at {string}, expecting {string} but finding {string}",
  function (
    this: StructureWorld,
    code: ConformanceIssueCode,
    field: string,
    expected: string,
    actual: string,
  ) {
    assert.deepEqual(requireResult(this), {
      conforms: false,
      issues: [{ code, field, expected, actual }],
    });
  },
);

Then(
  "conformance fails with {string}, expecting {string} but finding {string}",
  function (
    this: StructureWorld,
    code: ConformanceIssueCode,
    expected: string,
    actual: string,
  ) {
    assert.deepEqual(requireResult(this), {
      conforms: false,
      issues: [{ code, expected, actual }],
    });
  },
);

Then(
  "its matching schema ids are {string}",
  function (this: StructureWorld, commaSeparatedIds: string) {
    const expected = commaSeparatedIds.split(",").map((item) => item.trim());
    assert.deepEqual(
      matchingSchemas(this.candidate).map((schema) => schema.id),
      expected,
    );
  },
);

Given(
  "two complete book observations with different values",
  function (this: StructureWorld) {
    this.left = { ...completeBook };
    this.right = {
      title: "Another Shelf",
      publicationDate: "1984",
      description: "Different values, same declared structure.",
    };
  },
);

Given(
  "a complete book observation and a complete author observation",
  function (this: StructureWorld) {
    this.left = { ...completeBook };
    this.right = { ...completeAuthor };
  },
);

When("I compare their reference structure", function (this: StructureWorld) {
  this.compatibility = shareReferenceStructure(this.left, this.right);
});

Then("they share a reference structure", function (this: StructureWorld) {
  assert.equal(this.compatibility, true);
});

Then("they do not share a reference structure", function (this: StructureWorld) {
  assert.equal(this.compatibility, false);
});

Given(
  "a {string} book HTML fixture with a cover",
  function (this: StructureWorld, variant: BookHtmlVariant) {
    this.expectedBook = { ...completeBook };
    this.html = createBookHtmlFixture(this.expectedBook, variant);
  },
);

Given(
  "a {string} book HTML fixture without a cover",
  function (this: StructureWorld, variant: BookHtmlVariant) {
    const { coverImage: _omitted, ...bookWithoutCover } = completeBook;
    this.expectedBook = bookWithoutCover;
    this.html = createBookHtmlFixture(this.expectedBook, variant);
  },
);

Given("the raw book HTML:", function (this: StructureWorld, html: string) {
  this.html = html;
});

When(
  "I extract observed book fields from the HTML",
  function (this: StructureWorld) {
    assert.ok(typeof this.html === "string", "book HTML must be supplied");
    this.observed = extractObservedBookFields(this.html);
  },
);

Then(
  "the observed book fields equal the fixture fields",
  function (this: StructureWorld) {
    assert.ok(this.expectedBook, "fixture fields must be supplied");
    assert.deepEqual(requireObserved(this), this.expectedBook);
  },
);

Then(
  "the observed fields do not contain {string}",
  function (this: StructureWorld, field: string) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(requireObserved(this), field),
      false,
    );
  },
);

Then(
  "the observed fields conform to the book schema",
  function (this: StructureWorld) {
    assert.deepEqual(validateSchema(requireObserved(this), BOOK_SCHEMA), {
      conforms: true,
      issues: [],
    });
  },
);

Then(
  "the observed fields fail the book schema with {string} at {string}",
  function (
    this: StructureWorld,
    code: ConformanceIssueCode,
    field: string,
  ) {
    const result = validateSchema(requireObserved(this), BOOK_SCHEMA);
    assert.equal(result.conforms, false);
    assert.ok(
      result.issues.some(
        (issue) => issue.code === code && issue.field === field,
      ),
      `expected ${code} at ${field}; received ${JSON.stringify(result.issues)}`,
    );
  },
);
