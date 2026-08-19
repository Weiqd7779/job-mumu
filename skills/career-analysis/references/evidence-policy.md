# Evidence policy

## Evidence order

1. Programmatically calculated JD statistics.
2. Direct single-JD text.
3. Official company and government data.
4. Public firsthand community experience.
5. Public secondhand community discussion.

Lower-ranked evidence may explain higher-ranked evidence but must not silently replace it.

## Statistical claims

- Require `n`, `N`, and the calculation timestamp.
- Use the supplied percentage without recomputing it.
- If `N` is small, keep the result but lower confidence.
- Separate required, preferred, and descriptive mentions.

## Salary claims

- Accept only exact legal-entity matches or confirmed aliases.
- Compare within the same year and industry.
- Define higher-pay companies as the top quartile by non-manager median salary.
- Exclude companies without an official median from the ranking.

## Citations

Attach stable evidence IDs supplied by the pipeline. Never invent URLs or source IDs.

## Confidence

- `high`: consistent direct evidence with adequate coverage.
- `medium`: consistent but incomplete evidence, or mixed source quality.
- `low`: small sample, missing sources, or unresolved disagreement.
