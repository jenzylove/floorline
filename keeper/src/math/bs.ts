/** Standard normal CDF via the error function (Abramowitz & Stegun 7.1.26, |err| < 1.5e-7). */
export function normCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-z * z);
  return 0.5 * (1 + sign * y);
}

const YEAR = 365 * 24 * 3600;

/**
 * Delta of a long European put with zero rates: N(d1) - 1, in [-1, 0].
 * At or after expiry it is the intrinsic step: -1 if strike > spot, else 0.
 */
export function putDelta(spot: number, strike: number, secondsToExpiry: number, vol: number): number {
  if (secondsToExpiry <= 0 || vol <= 0) return strike > spot ? -1 : 0;
  const t = secondsToExpiry / YEAR;
  const d1 = (Math.log(spot / strike) + 0.5 * vol * vol * t) / (vol * Math.sqrt(t));
  return normCdf(d1) - 1;
}
