@generator @locations
Feature: Source-defined field locations
  The fixture owner knows where page fields will be rendered without crawling them.

  Scenario Outline: Extraction instructions exist before a website is rendered
    Given a source library using "<layout>" field markup
    When the source records are constructed without rendering HTML
    Then the title location selects the page heading
    And the author location uses "<reader>" on "<selector>"
    And an optional cover absent at source has no extraction selector

    Examples:
      | layout          | reader      | selector                                                  |
      | definition-list | textContent | #content dl.field-list > dd:nth-of-type(1)                  |
      | table           | textContent | #content table.field-list > tbody > tr:nth-of-type(1) > td  |
      | paragraphs      | afterLabel  | #content section.field-list > p:nth-of-type(1)             |
