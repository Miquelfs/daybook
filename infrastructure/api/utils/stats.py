import math


def pearson(xs: list[float], ys: list[float]) -> float | None:
    """Pearson r. Returns None if n < 3 or zero variance."""
    n = len(xs)
    if n < 3:
        return None
    mx = sum(xs) / n
    my = sum(ys) / n
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    den = math.sqrt(sum((x - mx) ** 2 for x in xs) * sum((y - my) ** 2 for y in ys))
    return round(num / den, 3) if den else None


def p_value_approx(r: float | None, n: int) -> float | None:
    """Two-tailed p-value approximation (normal CDF, no scipy required)."""
    if r is None or n < 4:
        return None
    try:
        t = r * math.sqrt((n - 2) / (1 - r ** 2))
        p = 2 * (1 - _normal_cdf(abs(t)))
        return round(p, 4)
    except (ZeroDivisionError, ValueError):
        return None


def _normal_cdf(x: float) -> float:
    return (1.0 + math.erf(x / math.sqrt(2.0))) / 2.0


def interpret_r(r: float | None) -> str:
    if r is None:
        return "not enough data"
    a = abs(r)
    direction = "positive" if r > 0 else "negative"
    if a >= 0.7:
        return f"strong {direction} correlation"
    if a >= 0.5:
        return f"moderate {direction} correlation"
    if a >= 0.3:
        return f"weak {direction} correlation"
    return "negligible correlation"


def least_squares(xs: list[float], ys: list[float]) -> tuple[float, float] | None:
    """Returns (slope, intercept) for a linear best-fit line, or None if degenerate."""
    n = len(xs)
    if n < 2:
        return None
    sx = sum(xs)
    sy = sum(ys)
    sxy = sum(x * y for x, y in zip(xs, ys))
    sxx = sum(x * x for x in xs)
    denom = n * sxx - sx * sx
    if denom == 0:
        return None
    slope = (n * sxy - sx * sy) / denom
    intercept = (sy - slope * sx) / n
    return round(slope, 6), round(intercept, 6)
