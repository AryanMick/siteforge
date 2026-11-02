@generator @locations
Feature: Source-defined repeated-item locations
  Listing records have private extraction instructions before HTML is rendered.

  Scenario Outline: Repeated values have exact locations in both listing layouts
    Given a varied listing source with seed <seed>
    When its source model is built without rendering HTML
    Then its repeated title uses a "<layout>" selector
    And each repeated scalar uses a strong-label reader
    And an optional repeated field absent at source has no selector

    Examples:
      | seed | layout |
      | 0    | table  |
      | 1    | list   |

  Scenario: A listing source value remains located after detail date noise
    Given a varied listing source with seed 0
    When its source model is built without rendering HTML
    And date-format noise is applied to its detail pages
    Then the listing date remains the source value at its repeated location
