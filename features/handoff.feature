@handoff @integration
Feature: Local evaluator handoff
  A generated source website has a separate evaluator folder with private truth.

  Scenario: A completed batch can be opened and exported without exposing answers in its public website
    Given a completed five-page evaluator test set
    When its local handoff and evaluator archive are inspected
    Then the handoff contains a website, answer key and metadata under its generated hostname
    And the public website archive does not contain the answer key
