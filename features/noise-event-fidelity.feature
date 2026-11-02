@generator @regression
Feature: Noise records describe eligible source mutations
  The answer key must not claim wrapper noise when no field list is rendered.

  Scenario: Rich listings do not claim scalar field wrappers
    Given a rich listing configured for deep wrapper noise
    When the source noise plan is applied
    Then its answer records no deep wrapper event
    And its rendered document is unchanged by wrapper noise

  Scenario: Removing the last scalar field drops its wrapper event
    Given a detail with one scalar field configured for removal and deep wrappers
    When the source noise plan is applied
    Then its answer records only the field removal
    And the removed field has an absent extraction location
