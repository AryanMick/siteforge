@planned
Feature: Public-private isolation, network safety, and truthful reports
  Evidence must be sufficient to investigate failures without exposing private
  answer keys or converting skipped work into an apparent success.

  @SEC-01
  Scenario: Prevent truth and filesystem leakage from public serving
    Given requests for private paths, encoded traversal, and symlink escapes
    When public bundles and source maps are inspected
    Then private truth config secrets and outside files are not served
    And negative-request evidence is retained

  @SEC-02
  Scenario: Block private addressing through host changes and redirects
    Given controlled endpoints that change hostname or address and redirect to private addresses
    When the crawler follows the request sequence
    Then network policy prevents every private-address request including re-resolution and redirects
    And no unauthorized real target is contacted

  @SEC-03
  Scenario: Render synthetic markup-like values safely
    Given fields and report labels containing synthetic script and HTML strings
    When fixture pages and reports display the values in their intended contexts
    Then untrusted markup does not execute

  @SEC-04
  Scenario: Document dependency and reference-data stewardship
    Given benchmark dependencies, generated artifacts, and retained reference materials
    When they are reviewed
    Then known advisories licenses and retention decisions are documented
    And no credentials or unnecessary real personal records are distributed

  @REPORT-01
  Scenario: Keep different kinds of outcome separate in a mixed run
    Given a run containing successful crawl results, clustering errors, unavailable field capability, and failures
    When its report is generated
    Then coverage clustering extraction and capability coverage are shown separately
    And no unsupported single accuracy claim is made

  @REPORT-02
  Scenario: Compare matched clean and noisy runs across meaningful axes
    Given clean and noisy runs from the same canonical source
    When the comparison is reported by site type framework operator and severity
    Then same-source comparisons and operator overlap are clear
    And representative false splits merges and extraction errors are linked

  @REPORT-03
  Scenario: Trace any selected score back to raw provenance
    Given a selected score in a benchmark report
    When a reviewer follows its evidence
    Then it traces to run configuration hashes product version raw output adapter version and evaluator version

  @REPORT-04
  Scenario: Preserve skipped blocked and unavailable status
    Given one skipped or blocked test and one unavailable browser audit
    When the report is finalized
    Then both statuses remain explicit and are not counted as passed
    And reference and candidate-product scores remain clearly distinguished
