@generator @regression
Feature: Document base relative links
  Controlled fixtures can require a crawler to honor the first document base.

  Scenario: An explicitly selected document base mode reaches the site plan
    Given a fixture request selects document base relative links
    When its site plan is built
    Then the plan retains document base relative links without changing the random link choices

  Scenario: A nested record exposes canonical links through the declared base
    Given a nested record in document base relative mode
    When its public HTML is rendered
    Then the first document base resolves its links to source canonical targets
    And its skip link resolves to the same record content

  Scenario: JavaScript link noise obeys the first base even with a later decoy
    Given a nested public page with two different document bases
    When JavaScript only link noise is applied
    Then its handler uses the destination from the first base
