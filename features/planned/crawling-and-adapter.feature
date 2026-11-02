@planned
Feature: Controlled crawling and product-output adaptation
  The candidate sees only public owned fixtures, and its limitations remain
  measurable rather than silently filled from private truth.

  @CRAWL-01
  Scenario: Account for the complete discoverable clean inventory
    Given the candidate tool receives only an owned clean fixture entry URL
    When it crawls under the agreed policy
    Then every expected discoverable page is accounted for
    And product omissions are reported rather than hidden

  @CRAWL-02
  Scenario: Apply URL identity policy to aliases and loops
    Given duplicate links, fragments, query variants, redirect aliases, and pagination loops
    When the crawler normalizes and schedules URLs
    Then the approved identity policy prevents endless work and double counting
    And genuinely distinct pages are not merged

  @CRAWL-03
  Scenario: Distinguish a request failure from an unattempted or missing page
    Given an inventory with a broken link and a controlled timeout response
    When crawling reaches them
    Then each failed request is recorded separately from missing and unattempted pages
    And no successful observation is fabricated

  @CRAWL-04
  Scenario: Explain delayed content with an observation deadline
    Given a client-rendered field that appears after the agreed readiness deadline
    When raw-HTML and rendered-DOM modes observe the page before and after that deadline
    Then mode, readiness rule, and timeout explain the result
    And an HTTP-only result is not presented as browser rendering

  @CRAWL-05
  Scenario: Honor robots restrictions and forbidden redirect destinations
    Given owned endpoints that deny crawling or redirect to disallowed external or private targets
    When the crawler encounters them
    Then it makes no forbidden destination request
    And denied and unavailable outcomes follow an explicit policy

  @CRAWL-06
  Scenario: Enforce crawl limits and service-error policy
    Given pages exceeding depth, page, time, byte, and frontier limits plus controlled 429 and 503 responses
    When the crawl runs
    Then stop and backoff policy is enforced
    And attempted, skipped, failed, and unattempted outcomes remain available

  @CRAWL-07
  Scenario: Make optional navigation support visible
    Given a frame, JavaScript-only link, or meta refresh in a fixture where that capability is claimed
    When the crawler runs
    Then only documented navigation behavior is accepted
    And unsupported traversal is visible rather than assumed

  @ADAPT-01
  Scenario: Map one real product export without filling gaps from gold
    Given a raw output sample from the candidate tool and a reviewed output contract
    When the adapter maps URLs, clusters, and supported fields
    Then the mapping is reviewable
    And expected answers never supply missing predictions

  @ADAPT-02
  Scenario: Handle invalid and capability-limited product exports explicitly
    Given malformed exports, duplicate URLs, an empty payload, and a product without optional field extraction
    When the adapter processes them
    Then invalid data is rejected or capability coverage is reported explicitly
    And absent capabilities are not silently scored as perfect or zero extraction

  @ADAPT-03
  Scenario: Isolate the candidate from private benchmark artifacts
    Given the candidate tool is configured with public entry URLs only
    When it runs under restricted artifact access
    Then raw product output is preserved
    And private truth and benchmark-only labels are unavailable to the candidate

  @ADAPT-04
  Scenario: Preserve raw-record meaning through normalization
    Given hand-reviewed samples of raw product records and normalized adapter records
    When the records are compared
    Then transformations are faithful
    And normalization and mapping versions are logged without silent dropped predictions
