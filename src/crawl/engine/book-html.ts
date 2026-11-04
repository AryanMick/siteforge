import { parse, type DefaultTreeAdapterMap } from "parse5";

import type { BookFields } from "./structure.js";

type HtmlNode = DefaultTreeAdapterMap["node"];
type HtmlElement = DefaultTreeAdapterMap["element"];

export type BookHtmlVariant = "clean" | "wrapped" | "table";

export interface RenderBookFixtureOptions {
  readonly layout: BookHtmlVariant;
  readonly cover: boolean;
}

export const DEFAULT_BOOK_FIXTURE: Readonly<BookFields> = Object.freeze({
  title: "The Glass Library",
  publicationDate: "2026-09-25",
  description: "First paragraph.\n\nSecond paragraph.",
  coverImage: "/book-cover.png",
});

function isElement(node: HtmlNode): node is HtmlElement {
  return "tagName" in node;
}

function childrenOf(node: HtmlNode): readonly HtmlNode[] {
  return "childNodes" in node ? node.childNodes : [];
}

function findFirst(
  node: HtmlNode,
  predicate: (element: HtmlElement) => boolean,
): HtmlElement | undefined {
  if (isElement(node) && predicate(node)) return node;

  for (const child of childrenOf(node)) {
    const match = findFirst(child, predicate);
    if (match) return match;
  }
  return undefined;
}

function findAll(
  node: HtmlNode,
  predicate: (element: HtmlElement) => boolean,
  matches: HtmlElement[] = [],
): readonly HtmlElement[] {
  if (isElement(node) && predicate(node)) matches.push(node);
  for (const child of childrenOf(node)) findAll(child, predicate, matches);
  return matches;
}

function attribute(element: HtmlElement, name: string): string | undefined {
  return element.attrs.find((item) => item.name === name)?.value;
}

function hasClass(element: HtmlElement, className: string): boolean {
  const classes = attribute(element, "class")?.split(/\s+/) ?? [];
  return classes.includes(className);
}

function textContent(node: HtmlNode): string {
  if ("value" in node && node.nodeName === "#text") return node.value;
  return childrenOf(node).map(textContent).join("");
}

function normalizedText(node: HtmlNode): string {
  return textContent(node).replace(/\s+/g, " ").trim();
}

/**
 * Extracts only the controlled fields present in a parsed HTML document.
 * Missing DOM signals remain missing so callers can distinguish extraction
 * from reference-schema validation.
 */
export function extractObservedBookFields(
  html: string,
): Partial<BookFields> {
  const document = parse(html);
  const observed: Partial<BookFields> = {};

  const title = findFirst(document, (element) => element.tagName === "h1");
  if (title) observed.title = normalizedText(title);

  const publicationDate = findFirst(document, (element) =>
    hasClass(element, "publishdte"),
  );
  if (publicationDate) {
    observed.publicationDate = normalizedText(publicationDate);
  }

  const contentWrapper = findFirst(document, (element) =>
    hasClass(element, "contentwrapper"),
  );
  if (contentWrapper) {
    const paragraphs = findAll(
      contentWrapper,
      (element) => element.tagName === "p",
    );
    if (paragraphs.length > 0) {
      observed.description = paragraphs.map(normalizedText).join("\n\n");
    }
  }

  const cover = findFirst(
    document,
    (element) => element.tagName === "img" && hasClass(element, "cover"),
  );
  const coverSource = cover ? attribute(cover, "src") : undefined;
  if (coverSource !== undefined) observed.coverImage = coverSource;

  return observed;
}

export const extractBookFieldsFromHtml = extractObservedBookFields;

/** UI-friendly record shape for consumers that do not need the BookFields type. */
export function extractBook(html: string): Record<string, unknown> {
  return extractObservedBookFields(html) as Record<string, unknown>;
}

function escapeText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', "&quot;");
}

function fixtureParts(book: BookFields): {
  title: string;
  publicationDate: string;
  description: string;
  cover: string;
} {
  const paragraphs = book.description
    .split("\n\n")
    .map((paragraph) => `<p>${escapeText(paragraph)}</p>`)
    .join("");
  const cover =
    book.coverImage === undefined
      ? ""
      : `<img class="cover" src="${escapeAttribute(book.coverImage)}" alt="">`;

  return {
    title: `<h1>${escapeText(book.title)}</h1>`,
    publicationDate: `<time class="publishdte">${escapeText(book.publicationDate)}</time>`,
    description: `<div class="contentwrapper">${paragraphs}</div>`,
    cover,
  };
}

/** Creates controlled markup variants for extractor tests; it is not crawler output. */
export function createBookHtmlFixture(
  book: BookFields,
  variant: BookHtmlVariant = "clean",
): string {
  const part = fixtureParts(book);

  switch (variant) {
    case "clean":
      return `<!doctype html><main><article>${part.title}${part.publicationDate}${part.cover}${part.description}</article></main>`;
    case "wrapped":
      return `<!doctype html><main class="layout"><section class="shell decorative"><article data-kind="book"><header>${part.title}<div class="metadata muted">${part.publicationDate}</div></header><aside>${part.cover}</aside><div class="body chrome">${part.description}</div></article></section></main>`;
    case "table":
      return `<!doctype html><table class="legacy-layout"><tbody><tr><td>${part.cover}</td><td><div>${part.title}</div>${part.publicationDate}${part.description}</td></tr></tbody></table>`;
  }
}

export const bookHtmlFixture = createBookHtmlFixture;

/** Renders the deterministic controlled fixture used by the structure lab. */
export function renderBookFixture(options: RenderBookFixtureOptions): string {
  const { coverImage: _coverImage, ...requiredFields } = DEFAULT_BOOK_FIXTURE;
  const book: BookFields = options.cover
    ? { ...requiredFields, coverImage: DEFAULT_BOOK_FIXTURE.coverImage }
    : requiredFields;
  return createBookHtmlFixture(book, options.layout);
}
