@generator @cms
Feature: Representative CMS markup preserves source extraction
  CMS signatures decorate rendered content without changing source records.

  Scenario Outline: CMS content stays inside the page main landmark
    Given a "<cms>" CMS with the "<builder>" builder
    When a source detail page is rendered
    Then the main landmark contains the source heading and CMS content
    And the CMS markup has the expected "<marker>" signature

    Examples:
      | cms       | builder        | marker                |
      | none      | none           | page-shell            |
      | wordpress | none           | entry-content         |
      | wordpress | gutenberg      | wp-block-group        |
      | wordpress | elementor      | elementor-widget-html |
      | wordpress | beaver-builder | fl-module-html        |
      | wordpress | divi           | et_pb_text_inner      |
      | wordpress | wpbakery       | wpb_text_column       |
      | drupal    | none           | node__content         |

  Scenario: CMS signatures do not enter source page truth
    Given a "none" CMS with the "none" builder
    When the same source is constructed for every CMS profile
    Then every profile has the same private page records
