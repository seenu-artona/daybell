# The parent shop's lockout alert (ADR 0022 §2; security re-review R2.5)

**Status: not set up. Seenu to do before the shop takes real codes.**

When wrong access codes across a region reach 600 in a minute, the shop's circuit breaker trips for 15 minutes and
the API writes one line to Vercel's function logs:

```
shop_lockout_breaker_tripped ca
```

That is the whole line: the region only, never a code, a name, an address or a device. It is written once per trip
(a sustained attack writes it again each time the breaker trips anew, at most every 15 minutes).

Today it is only a `console.warn`. Vercel keeps function logs for a short time and pages nobody, so **unless an alert
is set up, nobody may ever see that the shop is under a guessing attack.**

## What Seenu sets up

1. Send the Daybell project's logs somewhere that can alert: a Vercel log drain (Vercel › the Daybell project ›
   Settings › Log Drains; check which plan it needs) to a log service, or a Vercel alert rule if the plan has one.
   The destination stores logs, so for Canadian studios (D113) it must keep them in Canada, or receive only this line
   (filter the drain on `shop_lockout_breaker_tripped` where the service allows it).
2. Make a rule that matches `shop_lockout_breaker_tripped` and pages or emails whoever is on call.
3. Test it once on staging. The pgTAP and route tests prove the line is written; this step proves someone receives it.

## What to do when it fires

The breaker already tightens the networks that keep coming back (ADR 0022 §2). It never refuses outright: a second
stage (proof-of-work or a hard refusal for unknown devices during a sustained attack) is a decision for Seenu, flagged
in ADR 0022. Until it is decided, there is no switch beyond the breaker itself.
