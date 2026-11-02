@planned
Feature: AI assistance, reproducibility, recovery, and capacity
  Optional assisted generation and each pipeline stage must leave bounded,
  reproducible evidence rather than convert an incomplete run into a pass.

  @AI-01
  Scenario: Gate AI-proposed site models with semantic validation
    Given valid, malformed, and contradictory optional-AI template responses
    When they are considered for generation
    Then schema and semantic validation accepts only valid input
    And invalid input fails or enters a bounded documented review or repair step

  @AI-02
  Scenario: Separate frozen-artifact reproducibility from live AI variability
    Given an approved frozen AI artifact and its original live prompt
    When the artifact is replayed and the prompt is called again separately
    Then the frozen artifact reproduces with recorded hashes
    And live output is not promised byte-identical while model prompt and version are logged

  @AI-03
  Scenario: Treat instruction-like reference text as untrusted data
    Given an owned reference page containing text that asks the system to reveal truth or alter scope
    When optional AI processing reads the page
    Then the text cannot change scope, reveal secrets, or trigger actions

  @AI-04
  Scenario: Bound optional AI failures and API spend
    Given enabled AI generation with a fixed API budget and controlled timeout or rate limit
    When the provider fails
    Then the stage is explicitly failed or incomplete
    And no unlimited repair loop or silent paid fallback occurs

  @RUN-01
  Scenario: Reproduce the pilot from a clean documented environment
    Given a clean environment with pinned dependencies and documented runtime settings
    When another tester runs the pilot
    Then it completes without hidden files credentials or undocumented manual changes

  @RUN-02
  Scenario: Record deterministic artifacts and per-seed variation
    Given paired trials with identical conditions and a set of approved seeds
    When they are repeated
    Then exact deterministic artifacts agree
    And paired per-seed score variation is documented

  @RUN-03
  Scenario: Preserve stage integrity through interruption
    Given a run interrupted after generation or during crawling or evaluation
    When recovery begins
    Then completed artifacts are retained and the run is marked incomplete
    And resume cannot silently mix incompatible configurations or versions

  @RUN-04
  Scenario: Separate invalid fixtures from candidate product failures
    Given one invalid fixture and one valid fixture where the candidate fails
    When run outcomes are classified
    Then the invalid fixture is excluded with a visible reason
    And the valid fixture failure remains in product results

  @SCALE-01
  Scenario Outline: Measure generation capacity independently by page volume
    Given an approved resource budget and a single-site configuration of <count> pages
    When generation completes
    Then page count is exact
    And generation time peak memory and disk use are recorded independently

    Examples:
      | count |
      | 20    |
      | 200   |
      | 2000  |

  @SCALE-02
  Scenario: Account for every site in the approved large batch
    Given a confirmed target of 200 sites and 50000 total pages
    When the batch generation runs
    Then per-site and grand totals reconcile
    And no truncation overwrite or incomplete site is labeled complete

  @SCALE-03
  Scenario: Measure crawl cluster and evaluation stages separately at scale
    Given a generated approved large corpus
    When crawling, clustering, and evaluation run as distinct stages
    Then each stage records throughput memory time and failures
    And generation success is not substituted for end-to-end success

  @SCALE-04
  Scenario: Isolate resource exhaustion and a failed site
    Given controlled disk or resource limits and one failed site in a batch
    When the pipeline reaches the failure
    Then stop or isolation policy is predictable with bounded logs
    And completed evidence remains uncorrupted and partial completion visible

  @SCALE-05
  Scenario: Compare a fixed performance profile on fixed hardware
    Given fixed hardware versions and an agreed resource threshold sheet
    When the chosen capacity profile is repeated
    Then measurements are comparable
    And unsupported capacity is reported blocked or failed rather than bypassed
