@integration @evaluation
Feature: Explain grouping errors without depending on cluster names
  A correct evaluator separates missing pages, false splits and false merges.

  @EVAL-01 @EVAL-02 @EVAL-08
  Scenario Outline: Score the six-page book and author example
    Given known groups of three books two authors and one listing
    When the candidate returns the "<partition>" grouping
    Then there are <tp> true positive pairs <fp> false positive pairs and <fn> false negative pairs
    And all six expected pages are accounted for

    Examples:
      | partition | tp | fp | fn |
      | renamed   | 4  | 0  | 0  |
      | split     | 2  | 0  | 2  |
      | merged    | 4  | 6  | 0  |

  @EVAL-03
  Scenario: Correct grouping of observed pages cannot hide an omitted book
    Given known groups of three books two authors and one listing
    When the candidate omits one book
    Then coverage is five out of six even if observed grouping is correct

  @EVAL-05 @GOLD-03
  Scenario: Do not reward a guessed value for an absent optional cover
    Given a book answer with an absent optional cover
    When the candidate invents a cover image value
    Then the invented cover is a false positive
    And the private answer remains unchanged

  @EVAL-LISTING
  Scenario Outline: Score the records a tool reports on the listing page (2026-11-02)
    Given the listing page lists the three books as records
    When the candidate reports "<records>" listing records
    Then listing records score <tp> found <fp> extra and <fn> missed

    Examples:
      | records                     | tp | fp | fn |
      | all three by link           | 3  | 0  | 0  |
      | two by link                 | 2  | 0  | 1  |
      | three plus one on a book    | 3  | 1  | 0  |
      | one unrelated without link  | 0  | 1  | 3  |
