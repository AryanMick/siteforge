@generator @regression
Feature: New generation requests do not silently discard settings
  Fixed cases keep their defined behavior, while custom sets honor their options.

  Scenario Outline: Reject a custom link setting on a fixed catalog request
    Given a new "<suite>" request with absolute links
    When the generation request is checked
    Then it is rejected with a linkMode field error before a job starts

    Examples:
      | suite           |
      | regression-1440 |
      | catalog-case    |

  Scenario: Preserve custom settings in a custom site plan
    Given a new custom request with CMS markup and absolute links
    When the generation request is checked
    Then its site plan retains CMS markup and absolute links

  Scenario Outline: Reject random builders when WordPress cannot be selected
    Given a new random builder request with "<cms>" CMS
    When the generation request is checked
    Then it is rejected with a builderProfile field error

    Examples:
      | cms     |
      | omitted |
      | none    |
      | drupal  |
