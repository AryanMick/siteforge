@integration @generator
Feature: Construct reliable benchmark answers before crawling
  The benchmark author knows the source records before a crawler sees any HTML.

  @GEN-02 @GOLD-01 @GOLD-02
  Scenario Outline: Construct every expected page before rendering
    Given a fictional library configured for <count> pages with seed 42
    When the canonical model is constructed without rendering or crawling
    Then its private inventory contains exactly <count> unique pages
    And every inventory page already has an expected cluster and source fields

    Examples:
      | count |
      | 20    |
      | 30    |

  @GEN-04 @GOLD-04 @NOISE-01
  Scenario: Noise settings do not change the underlying source records
    Given a fictional library configured for 30 pages with seed 42
    When clean and high-noise models are constructed from the same seed
    Then their canonical records and expected clusters are identical
    And only the noisy rendering model records intentional mutations

  @GOLD-05 @NOISE-03
  Scenario: A deliberately removed field is not still required as visible data
    Given a fictional library configured for 30 pages with seed 42
    When a missing-field mutation is applied to its records
    Then removed values remain in private canonical records but not observable fields

  @SEC-01 @GEN-06
  Scenario: Generated answers cannot be fetched from the public fixture server
    Given a fictional library configured for 20 pages with seed 42
    When the library is generated and served locally
    Then its public home page is available
    But its private answer key returns not found
    And generating into that completed output again is rejected

  @GEN-01
  Scenario: Reject an unknown rendering framework
    Given a fictional library configured for 20 pages with seed 42
    When the requested framework is not HTML React or Angular
    Then configuration validation rejects the request
