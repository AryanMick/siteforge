@planned
Feature: Rendering modes, legacy behavior, and controlled noise
  Similarity is based on the underlying data structure while allowing optional
  fields; presentation variation must not silently redefine the record.

  @WEB-01
  Scenario: Serve intended static HTML without JavaScript
    Given a static HTML library fixture
    When it is fetched and navigated with JavaScript disabled
    Then intended content and links remain available

  @WEB-02
  Scenario: Make framework behavior explicit in JavaScript-on and JavaScript-off modes
    Given equivalent React and Angular fixtures
    When each is loaded with JavaScript enabled and disabled
    Then build and runtime evidence confirms the configured framework and rendered mode exposes intended content
    And JavaScript-off limitations are reported rather than called successful extraction

  @WEB-03
  Scenario: Support deep links, refresh, pagination, and cross-links
    Given a detail URL reached directly rather than through the home page
    When it is opened, refreshed, and used to follow pagination and cross-links
    Then expected content appears at the stable URL
    And no hidden home-page visit is required

  @WEB-04
  Scenario: Model browser repair of malformed and legacy markup
    Given variants with malformed nesting, tables, and neutral wrapper layers
    When source HTML and browser DOM are compared
    Then fields remain observable or declared loss is modeled explicitly
    And repaired-DOM evidence is retained

  @WEB-05
  Scenario: Separate usable layouts from intentional overflow defects
    Given clean layouts and a fixture intentionally containing fixed-width overflow
    When desktop and narrow mobile views are inspected
    Then clean pages remain usable and the defect occurs only where specified
    And screenshots and overflow measurements are retained

  @WEB-06
  Scenario: Classify browser contrast audits honestly
    Given readable text, controlled poor-contrast text, and a background requiring review
    When a browser audit is performed
    Then results distinguish pass, fail, and incomplete
    And an unavailable browser launch is never recorded as a pass

  @NOISE-01
  Scenario: Keep clean mode free of intentional mutations
    Given every noise operator is available but the clean profile is selected
    When the site is generated
    Then no intentional mutation or undeclared noise-layer defect is introduced

  @NOISE-02
  Scenario: Preserve semantics through a neutral wrapper mutation
    Given a book page with title, publication date, description, and optional cover image
    When extra div and span wrappers are applied
    Then its Book type and observable field semantics remain unchanged
    And an independent rendered check confirms the invariant

  @NOISE-03
  Scenario: Precisely model destructive information loss
    Given a missing-field operator removes a book publication date
    When observable truth is evaluated
    Then only documented observable states change
    And the evaluator does not require an extractor to guess the removed value

  @NOISE-04
  Scenario: Follow seeded low medium and high selection policy
    Given a fixed seed, compatible operators, selection policy, and per-page caps
    When low, medium, and high profiles run
    Then selected pages, severity ranges, and caps match the versioned policy
    And realized counts are reported

  @NOISE-05
  Scenario Outline: Apply only requested wrapper and class churn operators
    Given wrappers and class churn are the only enabled operators with probability <probability>
    When eligible pages are generated
    Then no other operator applies
    And wrapper or class churn applies <expectation> subject to the stated caps

    Examples:
      | probability | expectation                 |
      | 0           | to no eligible page         |
      | 1           | to every eligible page      |

  @NOISE-06
  Scenario: Attribute every event in high-risk compositions
    Given combinations of wrappers plus reorder, malformed markup plus missing field, and delay plus boilerplate
    When the combinations are rendered
    Then each composition preserves its declared contract or fails validation clearly
    And every contributing mutation remains attributable

  @NOISE-07
  Scenario: Reject or declare an inapplicable operator-framework pairing
    Given a noise operator unsupported by the chosen framework
    When generation is requested
    Then the pairing is rejected or explicitly marked inapplicable
    And it is not silently ignored as though exercised

  @NOISE-08
  Scenario: Rebuild a mutation manifest deterministically
    Given matching clean and noisy generation requests with fixed inputs
    When noisy variants are rebuilt
    Then mutations make the same decisions
    And every event records page ID, operator version, parameters, and expected effect
