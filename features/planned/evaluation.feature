@planned
Feature: Evaluation metrics and observable field scoring
  Scores describe coverage, grouping, fields, values, schemas, and relationships
  separately instead of compressing incompatible evidence into one number.

  @EVAL-01
  Scenario: Score equivalent memberships independently of predicted label names
    Given a perfect six-page prediction and a second prediction with every cluster label renamed
    When clustering is evaluated
    Then both results receive equivalent perfect scores
    And arbitrary label text does not determine correctness

  @EVAL-02
  Scenario: Penalize both a known split and a known merge
    Given gold groups {B1,B2,B3}, {A1,A2}, and {L1}
    When B3 is split from its books and, separately, books and authors are merged
    Then the split lowers pairwise recall with the hand-checked count
    And the merge lowers pairwise precision with the hand-checked count

  @EVAL-03
  Scenario: Expose missing unexpected and duplicate URLs
    Given predictions omit B3, add an unknown URL, and repeat B2
    When coverage is evaluated
    Then omissions and extras are reported
    And duplicate handling is rejected or explicit without inflating accuracy

  @EVAL-04
  Scenario: State degenerate clustering conventions
    Given empty, singleton, all-one-cluster, and all-singleton prediction sets
    When metrics are calculated
    Then undefined denominators and documented conventions are visible
    And no case receives a misleading universal 100 percent score

  @EVAL-05
  Scenario: Score fields only against observable truth
    Given predictions with missing, extra, wrong, and deliberately removed book field values
    When field presence and values are evaluated
    Then declared observable truth is used
    And wrong values reduce precision and recall while unsupported extras are penalized

  @EVAL-06
  Scenario: Normalize only approved unambiguous representations
    Given field aliases, whitespace, Unicode variation, valid date equivalents, and an ambiguous date
    When values are normalized
    Then only versioned approved normalization applies
    And ambiguity is not guessed and alias collisions are rejected

  @EVAL-07
  Scenario: Score schemas and relationships separately from scalar fields
    Given correct, extra, missing, and duplicate schema or relationship predictions
    When supported-capability evaluation runs
    Then applicable precision recall and capability coverage are reported
    And scalar and repeated-record capabilities remain distinct

  @EVAL-08
  Scenario: Reconcile evaluator totals with an independent small calculation
    Given hand-calculated six-page examples and per-type prediction counts
    When the evaluator produces observed-only and full-population results
    Then its arithmetic agrees with the independent examples
    And totals reconcile without concealing missed pages
