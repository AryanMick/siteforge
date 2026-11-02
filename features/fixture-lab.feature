@generator @integration
Feature: Controlled legacy websites for an external migration tool
  Source records and private answers are constructed before HTML.
  Fixture generation must not crawl a real website or infer its answer key.

  Scenario Outline: Resolve a reproducible obstacle scenario
    Given a fixture request with scenario "<scenario>" and framework "<framework>"
    When the generator resolves the first site plan twice
    Then both plans contain the same source configuration
    And its noise families are restricted to "<families>"

    Examples:
      | scenario            | framework | families                                                                                                           |
      | legacy-clutter      | html      | extra-wrapper,class-churn,inline-style,boilerplate,malformed-nesting,duplicate-id,missing-metadata,reorder-fields,legacy-document,missing-main,deep-wrapper-tree,legacy-color-attribute,frame-missing-title,split-text-runs,entity-encoded-text,uppercase-legacy-tags,spacer-elements |
      | inconsistent-fields | html      | missing-field,label-variation,date-format,reorder-fields                                                             |
      | client-delay        | react     | delayed-content                                                                                                    |
      | client-delay        | angular   | delayed-content                                                                                                    |
      | extraction-traps    | html      | boilerplate,comment-clutter,hidden-boilerplate,duplicate-heading,conflicting-metadata,link-variants,broken-image,image-missing-alt,onclick-navigation,javascript-only-link,hidden-reader-copy,analytics-beacon,microdata-attributes,inline-svg-icons |
      | parser-stress       | html      | extra-wrapper,malformed-nesting,duplicate-id,nested-layout-table,obsolete-markup,reorder-fields,missing-main,legacy-document,deep-wrapper-tree,legacy-color-attribute,frame-missing-title,uppercase-legacy-tags,entity-encoded-text,split-text-runs |
      | infinite-spaces     | html      | calendar-trap,day-calendar-trap,path-info-trap,date-archive-trap,search-tag-cloud,login-wall-links |

  Scenario Outline: Plan server obstacles separately from source content
    Given a fixture request with scenario "legacy-clutter" and framework "html"
    And its server response profile is "<profile>"
    When the generator plans transport before rendering
    Then the private transport plan has <count> distinct detail paths
    And changing transport does not alter the canonical records

    Examples:
      | profile   | count |
      | none      | 0     |
      | errors    | 6     |
      | redirects | 2     |
      | mixed     | 10    |

  Scenario: Optional source fields remain members of their declared cluster
    Given a fixture request with scenario "legacy-clutter" and framework "html"
    When the fixture source model includes optional fields
    Then book pages with and without their optional summary share one expected cluster
    And book pages with and without their optional cover share one expected cluster

  Scenario: Varied listing clusters follow their source item schemas
    Given a fixture request with scenario "legacy-clutter" and framework "html"
    And its randomness is 80
    When the fixture source model includes optional fields
    Then book and author listings have different item clusters
    And book listings retain one cluster when optional summaries are absent

  Scenario: Static sites cannot pretend to have delayed JavaScript content
    Given a fixture request with scenario "client-delay" and framework "html"
    When the fixture request is validated
    Then the fixture request is rejected before generation

  Scenario: The local page budget prevents an accidental oversized batch
    Given a fixture request for 500 sites of 1000 pages
    When the fixture request is validated
    Then the fixture request is rejected before generation

  Scenario: The regression catalog is a matrix of distinct behavior configurations
    Given the full legacy and protocol case catalog
    When every catalog case is resolved into a fixture plan
    Then there are 1440 distinct configurations excluding names URLs and seeds
    And 720 plans use HTTP and 720 use HTTPS
    And the catalog defines 23040 pages with answers from source records

  Scenario Outline: A random website can be reproduced from its saved seed
    Given a random fixture request with seed <seed>
    When the generator resolves the first site plan twice
    Then both plans contain the same source configuration
    And its 16 source pages already define their clusters and fields

    Examples:
      | seed       |
      | 0          |
      | 4294967295 |

  Scenario Outline: Random websites honor the smallest and largest page counts
    Given a random fixture request with seed 0, <pages> pages and randomness <randomness>
    When the generator resolves the first site plan twice
    Then both plans contain the same source configuration
    And its <pages> source pages already define their clusters and fields
    And the source plan has randomness <randomness>

    Examples:
      | pages | randomness |
      | 5     | 0          |
      | 200   | 100        |

  Scenario Outline: Random website requests reject unsupported page counts
    Given a random fixture request with <pages> pages
    When the random fixture request is validated
    Then the fixture request is rejected before generation

    Examples:
      | pages |
      | 4     |
      | 100001 |

  Scenario: A single website can use the entire page budget
    Given a fixture request for 1 sites of 100000 pages
    When the generator resolves the first site plan twice
    Then both plans contain the same source configuration
    And the planned site contains 100000 pages

  Scenario Outline: Challenge plans keep source answers across rendering modes
    Given a <pages>-page fixture with challenge "<challenge>", noise "<noise>", scenario "<scenario>" and framework "<framework>"
    When its private answer key is assembled from source
    Then the key has exactly <pages> known pages with valid states and local relations
    And its challenge intensity is "<intensity>"

    Examples:
      | pages | challenge | noise  | scenario            | framework | intensity |
      | 16    | standard  | high   | baseline            | html      | standard  |
      | 16    | hard      | high   | baseline            | html      | hard      |
      | 16    | extreme   | high   | baseline            | html      | extreme   |
      | 60    | hard      | high   | inconsistent-fields | html      | hard      |
      | 60    | extreme   | high   | inconsistent-fields | html      | extreme   |
      | 60    | hard      | high   | extraction-traps    | react     | hard      |
      | 60    | extreme   | high   | parser-stress       | angular   | extreme   |
      | 60    | extreme   | high   | client-delay        | react     | extreme   |
      | 60    | hard      | high   | client-delay        | angular   | hard      |
      | 5     | hard      | clean  | baseline            | html      | clean     |
      | 5     | extreme   | clean  | baseline            | html      | clean     |

  Scenario Outline: Invalid answer records cannot be exported
    Given a 60-page fixture with challenge "extreme", noise "high", scenario "baseline" and framework "html"
    When its private answer key is assembled from source
    And the answer key is corrupted with "<defect>"
    Then answer key validation rejects the corruption

    Examples:
      | defect             |
      | duplicate ID       |
      | missing page       |
      | unknown cluster    |
      | invalid state      |
      | stale relation     |
      | nonexistent field  |
      | wrong image        |

  Scenario: A generated answer key has an identical legacy alias outside the public site
    Given a 5-page fixture with challenge "extreme", noise "high", scenario "baseline" and framework "html"
    When its private answer key is generated on disk
    Then both private answer filenames contain identical JSON
    And neither answer filename appears in the public website

  Scenario Outline: Random challenge selection persists through seed replay
    Given a random fixture with seed <seed> and challenge "<challenge>"
    When the generator resolves the first site plan twice
    Then both plans contain the same source configuration
    And its selected challenge is "<challenge>"

    Examples:
      | seed       | challenge |
      | 0          | hard      |
      | 0          | extreme   |
      | 4294967295 | hard      |
      | 4294967295 | extreme   |
