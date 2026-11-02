@core
Feature: Book pages share a structure despite optional fields and different HTML
  Normalized observations are checked against documented reference shapes.
  The checker does not infer arbitrary schemas from coincidental field names.

  @GOLD-05
  Scenario: A complete book observation conforms
    Given the "book" reference schema
    And the candidate JSON:
      """
      {
        "title": "The Glass Library",
        "publicationDate": "2026-09-25",
        "description": "A precise structural example.",
        "coverImage": "/covers/glass.jpg"
      }
      """
    When I check schema conformance
    Then the candidate conforms
    And its matching schema ids are "book"

  @GOLD-05
  Scenario: A book cover is optional
    Given the "book" reference schema
    And the candidate JSON:
      """
      {
        "title": "No Jacket Required",
        "publicationDate": "2024",
        "description": "The required fields remain present."
      }
      """
    When I check schema conformance
    Then the candidate conforms

  @GOLD-05
  Scenario: Empty strings are a structural boundary, not a semantic failure
    Given the "book" reference schema
    And the candidate JSON:
      """
      { "title": "", "publicationDate": "", "description": "", "coverImage": "" }
      """
    When I check schema conformance
    Then the candidate conforms

  @GOLD-05
  Scenario Outline: Every required book field must be present
    Given the "book" reference schema
    And a complete book candidate without the "<field>" field
    When I check schema conformance
    Then conformance fails with "missing_required" at "<field>"

    Examples:
      | field           |
      | title           |
      | publicationDate |
      | description     |

  @GOLD-05
  Scenario Outline: Every supplied book field must be a primitive string
    Given the "book" reference schema
    And a complete book candidate with "<field>" set to JSON "<value>"
    When I check schema conformance
    Then conformance fails with "type_mismatch" at "<field>", expecting "string" but finding "<actual>"

    Examples:
      | field           | value | actual  |
      | title           | 17    | number  |
      | publicationDate | null  | null    |
      | description     | []    | array   |
      | coverImage      | false | boolean |

  @GOLD-05
  Scenario: Unsupported extra fields are rejected
    Given the "book" reference schema
    And the candidate JSON:
      """
      {
        "title": "Catalogued",
        "publicationDate": "2025",
        "description": "Closed reference shapes are intentional.",
        "isbn": "978-0-00-000000-0"
      }
      """
    When I check schema conformance
    Then conformance fails with "unsupported_field" at "isbn"

  @GOLD-05
  Scenario Outline: Non-record values cannot conform
    Given the "book" reference schema
    And the candidate is JSON "<value>"
    When I check schema conformance
    Then conformance fails with "invalid_record", expecting "object" but finding "<actual>"

    Examples:
      | value | actual |
      | null  | null   |
      | []    | array  |
      | 42    | number |

  @GOLD-05
  Scenario: Author data uses a distinct reference shape
    Given the "author" reference schema
    And the candidate JSON:
      """
      { "name": "Octavia Vale", "biography": "Writes about impossible archives." }
      """
    When I check schema conformance
    Then the candidate conforms
    And its matching schema ids are "author"

  @GOLD-05
  Scenario: An author observation cannot silently acquire an unsupported field
    Given the "author" reference schema
    And the candidate JSON:
      """
      { "name": "Octavia Vale", "biography": "Writes about archives.", "isbn": "not-an-author-field" }
      """
    When I check schema conformance
    Then conformance fails with "unsupported_field" at "isbn"

  @GOLD-05
  Scenario Outline: Every required author field must be present
    Given the "author" reference schema
    And a complete author candidate without the "<field>" field
    When I check schema conformance
    Then conformance fails with "missing_required" at "<field>"

    Examples:
      | field     |
      | name      |
      | biography |

  @NOISE-02
  Scenario: Books with different values and optional covers share one structure
    Given two complete book observations with different values
    When I compare their reference structure
    Then they share a reference structure

  @NOISE-02
  Scenario: A book and an author do not share a reference structure
    Given a complete book observation and a complete author observation
    When I compare their reference structure
    Then they do not share a reference structure

  @WEB-04 @NOISE-02
  Scenario Outline: Cosmetic markup variants retain the observed book structure
    Given a "<variant>" book HTML fixture with a cover
    When I extract observed book fields from the HTML
    Then the observed book fields equal the fixture fields
    And the observed fields conform to the book schema

    Examples:
      | variant |
      | clean   |
      | wrapped |
      | table   |

  @WEB-04
  Scenario: An absent cover remains absent and still conforms
    Given a "clean" book HTML fixture without a cover
    When I extract observed book fields from the HTML
    Then the observed book fields equal the fixture fields
    And the observed fields do not contain "coverImage"
    And the observed fields conform to the book schema

  @WEB-04
  Scenario: A cosmetic date class is not mistaken for the controlled signal
    Given the raw book HTML:
      """
      <article>
        <h1>Almost a Book</h1>
        <time class="published-date">2026-09-25</time>
        <div class="contentwrapper"><p>It lacks the controlled date class.</p></div>
      </article>
      """
    When I extract observed book fields from the HTML
    Then the observed fields do not contain "publicationDate"
    And the observed fields fail the book schema with "missing_required" at "publicationDate"

  @WEB-04
  Scenario: A content wrapper without paragraphs leaves description missing
    Given the raw book HTML:
      """
      <article>
        <h1>No Paragraph</h1>
        <time class="publishdte">2026-09-25</time>
        <div class="contentwrapper">Unmarked prose is not a controlled paragraph.</div>
      </article>
      """
    When I extract observed book fields from the HTML
    Then the observed fields do not contain "description"
    And the observed fields fail the book schema with "missing_required" at "description"
