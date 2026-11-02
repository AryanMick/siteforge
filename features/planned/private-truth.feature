@planned
Feature: Private construction-time answer keys
  Gold answers are source-defined and remain private, even when a fixture loses
  information or a candidate produces a persuasive but wrong output.

  @GOLD-01
  Scenario: Establish page membership and fields before rendering
    Given a small canonical source model and disabled renderer and crawler
    When private truth is created
    Then page membership and source fields already exist
    And no crawler output is required to create gold answers

  @GOLD-02
  Scenario: Assign exactly one primary cluster to every generated page
    Given a complete inventory containing book details, author details, home, and listing pages
    When private truth is validated against that inventory
    Then every page has exactly one primary expected cluster
    And no duplicate or orphan page record remains

  @GOLD-03
  Scenario: Keep gold unchanged when candidate predictions are wrong
    Given a candidate output with deliberately wrong page memberships and publication dates
    When it is compared with the answer key
    Then the answer key is unchanged
    And every mismatch is visible instead of being repaired from predictions

  @GOLD-04
  Scenario: Pair clean and noisy variants of one source model
    Given clean and noisy variants of the same library model
    When their private records are compared
    Then canonical digest, logical URLs, and intended content-type membership agree
    And only declared observable states and mutation events differ

  @GOLD-05
  Scenario: Record canonical and observable truth for an omitted date
    Given two variants of book B3 share the same canonical publication date
    When one variant omits the date and the other displays an equivalent written date
    Then the canonical date remains private and the omitted field is marked absent
    And the visible written date has an explicit normalization rule

  @GOLD-06
  Scenario: Distinguish optional absence from extraction failure
    Given a book points to its author and has no optional cover image
    When relationship and field truth are inspected
    Then the author target resolves with valid type and cardinality
    And absent cover is represented as optional absence rather than an extraction failure

  @GOLD-07
  Scenario: Invalidate a fixture whose source truth disagrees with rendering
    Given an independent review of every pilot page and a stratified release sample
    When a source-defined field is not actually observable on a rendered page
    Then the affected fixture is marked invalid
    And gold is not retrospectively rewritten to match the rendering
