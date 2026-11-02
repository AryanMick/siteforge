@html @regression
Feature: Discover structure despite older HTML conventions
  The candidate sees public HTML, never the private source model.
  Presentation and topic changes must not become content-type boundaries.

  Scenario Outline: Read the same fields from different HTML presentations
    Given a fictional record rendered with the "<layout>" field layout
    When the generic HTML analyzer reads the public markup
    Then its observed fields match the separately constructed source record

    Examples:
      | layout          |
      | definition-list |
      | table           |
      | paragraphs      |

  Scenario: Optional fields do not force a new cluster
    Given three public records with shared core fields and varying optional fields
    When the generic candidate clusters those public records
    Then all three records belong to one predicted cluster

  Scenario: Relative links follow the declared document base
    Given an HTML page with a relative link and an archive base URL
    When the generic HTML analyzer reads the public markup
    Then the discovered link points into the archive directory
