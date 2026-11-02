@pagepilot
Feature: One-click local benchmark pipeline
  A finished run must distinguish successful execution from accurate predictions.

  Scenario Outline: A clean fictional project is generated and evaluated end to end
    Given a PagePilot "<profile>" project with "clean" noise
    When its complete local pipeline runs
    Then the PagePilot report contains 24 analyzed pages
    And the PagePilot benchmark gates have "passed"
    And the PagePilot report does not expose private answer labels
    Examples:
      | profile    |
      | library    |
      | archive    |
      | government |

  Scenario: Difficult noise is an accuracy failure rather than a false success
    Given a PagePilot "library" project with "high" noise
    When its complete local pipeline runs
    Then the PagePilot report contains 24 analyzed pages
    And the PagePilot benchmark gates have "failed"
    And the PagePilot run needs attention

  Scenario: A public sample cannot claim known-answer accuracy
    When a public PagePilot result is checked without an answer key
    Then its evaluation status is not available

  Scenario: Excluding a captured page cannot inflate benchmark coverage
    Given a PagePilot "library" project with "clean" noise
    When its complete local pipeline runs
    And one captured page is excluded from a saved-snapshot analysis
    Then the saved-snapshot coverage is 23 out of 24
    And the excluded page remains in the observation audit

  Scenario: A clean saved snapshot can be re-clustered without another crawl
    Given a PagePilot "library" project with "clean" noise
    When its complete local pipeline runs
    And its saved snapshot is re-clustered without exclusions
    Then the PagePilot report contains 24 analyzed pages
    And the PagePilot benchmark gates have "passed"
    And snapshot preparation and crawling are skipped
