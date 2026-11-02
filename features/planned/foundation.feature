@planned
Feature: Source research, configuration, and benchmark data
  The benchmark begins from documented fictional source data rather than an
  incidental scrape or a renderer's output.

  @REF-01
  Scenario: Document structural inspiration without making transactional sites the corpus
    Given selection notes describe content density, directory/detail navigation, and modern and legacy structures
    When the initial fictional templates are approved
    Then each template maps to an observed structural characteristic
    And transaction-only reference sites are not the primary corpus

  @REF-02
  Scenario: Keep fictional records and branding distinct from references
    Given a generated museum site is structurally inspired by a public collection site
    When names, descriptions, images, branding, and URLs are reviewed
    Then no copied real record or brand appears in the fixture
    And provenance identifies the structural inspiration and synthetic asset source

  @REF-03
  Scenario: Support each noise mechanism with a concrete reference example
    Given a proposed malformed-markup noise operator
    When its rationale is added to the noise catalog
    Then the catalog retains a source or concrete example for the mechanism
    And it does not claim an unmeasured prevalence rate as fact

  @GEN-01
  Scenario: Reject an invalid generator configuration before a completed run is claimed
    Given a configuration with an unknown framework or conflicting count and output options
    When generation is requested
    Then validation identifies the invalid setting before a completed artifact is produced
    And a configuration with valid framework, count, seed, noise, fields, types, and output is accepted

  @GEN-02
  Scenario Outline: Generate the exact requested number of HTML documents
    Given a configuration requesting <count> pages including its home and listing pages
    When the generator completes
    Then exactly <count> HTML documents exist
    And page IDs and normalized URLs are unique while assets are counted separately

    Examples:
      | count |
      | 20    |
      | 200   |
      | 2000  |

  @GEN-03
  Scenario: Produce varied meaningful records including optional data
    Given a library configuration with books, authors, short and long descriptions, and optional cover images
    When records are rendered
    Then pages contain distinguishable content-type information rather than empty filler
    And repeated records do not make an identical corpus that masks clustering failures

  @GEN-04
  Scenario: Reproduce a locked run exactly
    Given locked generator, noise, and schema versions with a fixed configuration and seed
    When the run is generated twice
    Then canonical records, logical URLs, truth, and noise decisions agree
    And content hashes agree after declared volatile metadata is excluded

  @GEN-05
  Scenario: Isolate changes in seed, noise, and renderer
    Given a baseline library source model
    When only the seed, only the noise profile, and only the renderer are changed in separate runs
    Then a seed changes intended data, noise preserves canonical identities, and renderer preserves the logical contract

  @GEN-06
  Scenario: Preserve prior evidence through output collision and interrupted generation
    Given an existing completed output and a separate generation that is interrupted or fails a write
    When the generator handles the target paths
    Then prior evidence is not overwritten
    And partial output is explicitly incomplete with a documented rerun or resume policy

  @DATA-01
  Scenario: Satisfy the proposed ten-site diversity matrix
    Given configurations for library, agency, municipality, university, health, documentation, museum, nonprofit, archive, and news domains
    When representative pages and configuration metadata are reviewed
    Then the stated domain, framework, era, template, and complexity coverage is demonstrated

  @DATA-02
  Scenario: Make every intended clean pilot page discoverable
    Given a clean thirty-page library pilot with home, listings, details, and cross-links
    When the site is traversed from its agreed entry point
    Then every intended crawlable inventory page is reachable
    And navigation, lists, and cross-links agree with the inventory

  @DATA-03
  Scenario: Reveal rare-type failures in balanced and skewed distributions
    Given one balanced type distribution and one distribution dominated by books
    When product results are reported
    Then per-type results expose rare-type failures
    And report totals reconcile with the page inventory

  @DATA-04
  Scenario: Preserve a frozen holdout after development tuning
    Given distinct development and holdout seeds and templates
    When the holdout configuration is evaluated after tuning elsewhere
    Then the manifest records the split
    And no holdout label or score drove an acceptance-run adjustment
